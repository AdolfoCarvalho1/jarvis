import { after } from "next/server";
import { randomUUID } from "node:crypto";
import { hasCredentials, streamCompletion, type ChatTurn } from "@/lib/ai";
import { askApproval } from "@/lib/approvals";
import { cancelTask } from "@/lib/automation/store";
import { maybeCompact } from "@/lib/context";
import { storage } from "@/lib/db";
import { appendEvent } from "@/lib/events";
import { buildSystemPrompt } from "@/lib/prompt";
import { getActiveModel, getContextState, getMainConversation } from "@/lib/session";
import { TOOL_LABELS, executeTool, toolRequiresApproval, tools } from "@/lib/tools";
import { mcpToolDefinitions } from "@/lib/mcp";
import { META_TOOLS, coreToolDefinitions, findToolDefinition, searchTools } from "@/lib/tool-catalog";
import { takeTurn, TurnBusy } from "@/lib/turn-lock";
import type { StreamEvent, ToolEvent } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_ROUNDS = 12;

function toolResult(result: string): Pick<ToolEvent, "status" | "detail" | "proposalId"> {
  try {
    const data = JSON.parse(result);
    const status = data.error || data.ok === false ? "error" : "done";
    const count = data.results?.length ?? data.resultados?.length ?? data.arquivos?.length ?? data.lembretes?.length ?? data.ferramentas?.length;
    const info = data.memoria?.content ?? data.lembrete?.title ??
      (data.descricao ? "Tela capturada e analisada." : undefined) ??
      (data.arquivo ? `Arquivo: ${data.arquivo}` : undefined) ??
      (typeof data.title === "string" && data.status === "queued" ? `Tarefa na fila: ${data.title}` : undefined);
    return {
      status,
      detail: String(data.error ?? data.resumo ?? data.summary ??
        (status === "error" ? data.output : info) ??
        (typeof count === "number" ? `${count} resultado(s)` : status === "error" ? "Falha na ação." : "Concluído.")).slice(0, 350),
      proposalId: typeof data.proposalId === "string" ? data.proposalId : undefined,
    };
  } catch {
    return { status: "done", detail: result.slice(0, 350) };
  }
}

export async function POST(request: Request) {
  const receivedAt = performance.now();
  const payload = await request.json().catch(() => null);
  const message = typeof payload?.message === "string" ? payload.message.trim() : "";
  if (!message) return Response.json({ error: "Digite ou dite uma mensagem." }, { status: 400 });
  if (message.length > 24_000) return Response.json({ error: "A mensagem excede 24 mil caracteres." }, { status: 413 });
  const turnId = randomUUID();
  if (!hasCredentials()) {
    return Response.json({ error: "Configure OPENCODE_GO_API_KEY no .env.local e reinicie o servidor." }, { status: 503 });
  }

  let release: () => void;
  try {
    release = await takeTurn(request.signal);
  } catch (error) {
    if (error instanceof TurnBusy) return Response.json({ error: error.message }, { status: 409 });
    if (request.signal.aborted) return new Response(null, { status: 499 });
    throw error;
  }

  const client = new AbortController();
  const onDisconnect = () => client.abort();
  if (request.signal.aborted) onDisconnect();
  else request.signal.addEventListener("abort", onDisconnect, { once: true });
  const signal = AbortSignal.any([client.signal, AbortSignal.timeout(150_000)]);
  const encoder = new TextEncoder();
  let compactId: string | undefined;
  after(async () => {
    if (compactId) await maybeCompact(compactId).catch((error) => console.error("[Jarvis] compactação:", error.message));
  });

  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: StreamEvent) => {
        if (!cancelled && !client.signal.aborted) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        }
      };
      const heartbeat = setInterval(() => {
        if (!cancelled && !client.signal.aborted) controller.enqueue(encoder.encode(": keep-alive\n\n"));
      }, 12_000);
      let ack: ReturnType<typeof setTimeout> | undefined;
      let activeTool: ToolEvent | undefined;
      let conversationId: string | undefined;
      let visible = "";
      let rounds = 0;
      const queuedTasks: string[] = [];
      try {
        signal.throwIfAborted();
        const conversation = await getMainConversation();
        conversationId = conversation.id;
        signal.throwIfAborted();
        await storage.addMessage(conversation.id, "user", message);
        const [memories, reminders, context, model, total] = await Promise.all([
          storage.listMemories(), storage.listReminders(true), getContextState(conversation.id),
          getActiveModel(), storage.countMessages(conversation.id),
        ]);
        appendEvent(conversation.id, turnId, "turn/start", { model, message: message.slice(0, 2000) });
        appendEvent(conversation.id, turnId, "user/message", { chars: message.length });
        const history = await storage.listMessages(conversation.id, Math.max(1, Math.min(100, total - context.compactedMessages)));
        signal.throwIfAborted();
        const turns: ChatTurn[] = [
          { role: "system", content: buildSystemPrompt({ memories, reminders, context: context.summary }) },
          ...history.flatMap((item): ChatTurn[] => {
            if (item.role === "tool") return [];
            if (item.role !== "user" && item.role !== "assistant") return [];
            return [{ role: item.role, content: item.content }];
          }),
        ];
        const allTools = [...tools, ...(await mcpToolDefinitions())];
        const chatTools = [...coreToolDefinitions(allTools), ...META_TOOLS];
        send({ type: "meta", conversationId, title: conversation.title, model });
        if (payload.ack === true) ack = setTimeout(() => {
          if (!visible && !signal.aborted) send({ type: "ack", text: "Já vejo isso, senhor." });
        }, 250);

        let finished = false;
        let promptTokens = 0;
        let completionTokens = 0;
        let perfTokens = 0;
        let perfMs = 0;
        for (let round = 0; round < MAX_ROUNDS; round++) {
          signal.throwIfAborted();
          rounds += 1;
          const roundStart = performance.now();
          let lastText = 0;
          const outcome = await streamCompletion({
            messages: turns, tools: chatTools, model, signal,
            onText: (chunk) => {
              lastText = performance.now();
              if (!visible) send({ type: "timing", firstTextMs: Math.round(lastText - receivedAt) });
              visible += chunk;
              send({ type: "text", value: chunk });
            },
          });
          appendEvent(conversationId, turnId, "model/request", {
            round,
            toolCalls: outcome.toolCalls.length,
            promptTokens: outcome.usage?.promptTokens,
            completionTokens: outcome.usage?.completionTokens,
          });
          if (outcome.usage) {
            promptTokens += outcome.usage.promptTokens;
            completionTokens += outcome.usage.completionTokens;
            if (lastText) {
              perfTokens = outcome.usage.completionTokens;
              perfMs = Math.max(1, lastText - roundStart);
            }
          }
          if (!outcome.toolCalls.length) {
            finished = true;
            break;
          }
          turns.push({ role: "assistant", content: outcome.content || null, tool_calls: outcome.toolCalls });
          for (const call of outcome.toolCalls) {
            signal.throwIfAborted();
            const { name } = call.function;
            const id = randomUUID();
            let targetName = name;
            let targetArgs: Record<string, unknown> | null;
            try {
              targetArgs = JSON.parse(call.function.arguments || "{}");
              if (!targetArgs || typeof targetArgs !== "object" || Array.isArray(targetArgs)) targetArgs = null;
            } catch {
              targetArgs = null;
            }
            let result: string;
            let eventName = name;
            let label = TOOL_LABELS[name] ?? name;
            const toolStartedAt = performance.now();
            if (!targetArgs) {
              result = JSON.stringify({ error: "Parâmetros da operação inválidos." });
            } else if (name === "listar_ferramentas") {
              const busca = typeof targetArgs.busca === "string" ? targetArgs.busca : "";
              const limite = Number(targetArgs.limite ?? 6);
              result = JSON.stringify(searchTools(allTools, busca, Number.isFinite(limite) ? limite : 6));
              label = TOOL_LABELS.listar_ferramentas;
            } else {
              if (name === "usar_ferramenta") {
                targetName = String(targetArgs.nome ?? "").trim();
                const rawArgs = targetArgs.argumentos;
                let parsedArgs: Record<string, unknown> = {};
                if (typeof rawArgs === "string") {
                  try {
                    const parsed = JSON.parse(rawArgs);
                    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) parsedArgs = parsed;
                  } catch {
                    parsedArgs = {};
                  }
                } else if (rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs)) {
                  parsedArgs = rawArgs as Record<string, unknown>;
                }
                targetArgs = parsedArgs;
                eventName = targetName || "usar_ferramenta";
                label = TOOL_LABELS[targetName] ??
                  (targetName.startsWith("mcp__navegador__") ? "Navegando"
                    : targetName.startsWith("mcp__") ? "Usando MCP"
                      : targetName ? `Usando ${targetName}` : "Usando ferramenta");
              }
              if (name === "usar_ferramenta" && !findToolDefinition(allTools, targetName)) {
                result = JSON.stringify({ error: `ferramenta "${targetName}" não existe; use listar_ferramentas antes` });
              } else {
                appendEvent(conversationId, turnId, "tool/call", { name: eventName, args: targetArgs });
                const needsApproval = toolRequiresApproval(targetName, targetArgs);
                let approved = false;
                const details = JSON.stringify(targetArgs, null, 2);
                if (needsApproval && details.length <= 12_000) {
                  const approval = askApproval(signal);
                  activeTool = { id, name: eventName, label, status: "approval", detail: details, approvalId: approval.id };
                  send({ type: "tool", ...activeTool });
                  approved = await approval.decision;
                }
                signal.throwIfAborted();
                if (needsApproval && !approved) {
                  result = JSON.stringify({ error: details.length > 12_000 ? "Parâmetros extensos demais para revisão." : "Ação recusada ou confirmação expirada." });
                } else {
                  activeTool = { id, name: eventName, label, status: "running" };
                  send({ type: "tool", ...activeTool });
                  result = await executeTool(targetName, targetArgs, signal, approved);
                  if (["executar_projeto", "acompanhar_arquivo"].includes(targetName) ||
                    (targetName === "gerenciar_rotina" && targetArgs.acao === "executar")) {
                    const queued = JSON.parse(result);
                    if (typeof queued.id === "string") queuedTasks.push(queued.id);
                  }
                }
              }
            }
            const event: ToolEvent = { id, name: eventName, label, ...toolResult(result) };
            appendEvent(conversationId, turnId, "tool/result", {
              name: eventName,
              status: event.status,
              detail: event.detail,
              ms: Math.round(performance.now() - toolStartedAt),
            });
            activeTool = undefined;
            await storage.addMessage(conversationId, "tool", JSON.stringify(event));
            send({ type: "tool", ...event });
            turns.push({ role: "tool", tool_call_id: call.id, content: result });
          }
        }
        if (!finished) {
          const notice = "\n\nAtingi o limite de operações deste pedido.";
          visible += notice;
          send({ type: "text", value: notice });
        }
        if (!visible.trim()) {
          visible = "O modelo encerrou sem resposta.";
          send({ type: "text", value: visible });
        }
        signal.throwIfAborted();
        const saved = await storage.addMessage(conversationId, "assistant", visible);
        appendEvent(conversationId, turnId, "assistant/message", {
          chars: visible.length,
          text: visible.slice(0, 2000),
          promptTokens,
          completionTokens,
        });
        signal.throwIfAborted();
        compactId = conversationId;
        if (perfTokens) send({ type: "perf", tokens: perfTokens, ms: perfMs, tps: perfTokens / (perfMs / 1000) });
        if (promptTokens || completionTokens) send({ type: "usage", promptTokens, completionTokens });
        send({ type: "timing", totalMs: Math.round(performance.now() - receivedAt) });
        send({ type: "done", messageId: saved.id, createdAt: saved.created_at });
      } catch (error) {
        if (signal.aborted) for (const id of queuedTasks) {
          try { cancelTask(id); } catch (error) { console.error("[Jarvis] cancelamento da tarefa:", error); }
        }
        if (activeTool && conversationId) {
          const event: ToolEvent = { id: activeTool.id, name: activeTool.name, label: activeTool.label,
            status: signal.aborted ? "cancelled" : "error",
            detail: activeTool.status === "running" ? "Operação interrompida. Alterações já efetuadas podem permanecer." : "Operação encerrada antes da confirmação." };
          await storage.addMessage(conversationId, "tool", JSON.stringify(event)).catch(console.error);
          send({ type: "tool", ...event });
        }
        const failure = signal.reason?.name === "TimeoutError" || (error as Error)?.name === "TimeoutError"
          ? "O processamento excedeu o prazo. Tente enviar novamente."
          : error instanceof Error ? error.message : "Falha inesperada.";
        send({ type: "error", message: failure });
        if (conversationId) appendEvent(conversationId, turnId, "turn/error", { message: failure });
      } finally {
        if (conversationId) appendEvent(conversationId, turnId, "turn/end", {
          ms: Math.round(performance.now() - receivedAt),
          rounds,
        });
        clearInterval(heartbeat);
        clearTimeout(ack);
        request.signal.removeEventListener("abort", onDisconnect);
        release();
        if (!cancelled) controller.close();
      }
    },
    cancel() {
      cancelled = true;
      client.abort();
    },
  });
  return new Response(stream, { headers: {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    "X-Accel-Buffering": "no",
  } });
}

export async function GET() {
  return Response.json({ model: await getActiveModel(), ready: hasCredentials() });
}
