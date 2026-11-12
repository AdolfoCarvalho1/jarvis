import { streamCompletion, type ChatTurn } from "./ai";

export interface SubagentDeps {
  definitions: unknown[];
  execute: (name: string, args: Record<string, unknown>, signal: AbortSignal) => Promise<string>;
  model: string;
}

export interface SubagentResult {
  ok: boolean;
  resumo: string;
  rounds: number;
  ferramentas: string[];
  ms: number;
}

const MAX_ROUNDS = 6;
const TIMEOUT_MS = 90_000;

const SYSTEM_PROMPT =
  "Você é um subagente do J.A.R.V.I.S. Trabalhe apenas no objetivo, use as ferramentas disponíveis, não invente fatos, cite fontes quando pesquisar e responda em até 400 palavras. Não peça confirmação e não tente editar arquivos.";

function parseArgs(raw: string): Record<string, unknown> {
  if (!raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // JSON inválido de modelo vira argumentos vazios; a ferramenta valida o resto.
  }
  return {};
}

function definitionNames(definitions: unknown[]): Set<string> {
  const names = new Set<string>();
  for (const item of definitions) {
    const name = (item as { function?: { name?: unknown } } | null)?.function?.name;
    if (typeof name === "string" && name) names.add(name);
  }
  return names;
}

function failureMessage(error: unknown, parentSignal: AbortSignal): string {
  if (parentSignal.aborted) return "cancelado";
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
    return `tempo limite de ${Math.round(TIMEOUT_MS / 1000)}s excedido`;
  }
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.trim() || "erro desconhecido";
}

/**
 * Subagente isolado e somente leitura: recebe um objetivo, roda o próprio loop de
 * tool calling com as definições fornecidas e devolve um resumo. Não importa
 * ./tools para evitar ciclo — a execução chega por deps.
 */
export async function runSubagent(
  objetivo: string,
  contexto: string | undefined,
  parentSignal: AbortSignal,
  deps: SubagentDeps,
): Promise<SubagentResult> {
  const startedAt = Date.now();
  const ferramentas: string[] = [];
  const permitidas = definitionNames(deps.definitions);
  const signal = AbortSignal.any([parentSignal, AbortSignal.timeout(TIMEOUT_MS)]);
  let rounds = 0;

  const messages: ChatTurn[] = [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: contexto?.trim()
        ? `Objetivo: ${objetivo}\n\nContexto: ${contexto.trim()}`
        : `Objetivo: ${objetivo}`,
    },
  ];

  try {
    while (rounds < MAX_ROUNDS) {
      signal.throwIfAborted();
      rounds += 1;

      const outcome = await streamCompletion({
        messages,
        tools: deps.definitions,
        model: deps.model,
        signal,
      });

      if (!outcome.toolCalls.length) {
        return {
          ok: true,
          resumo: outcome.content.trim() || "(subagente encerrou sem resposta)",
          rounds,
          ferramentas,
          ms: Date.now() - startedAt,
        };
      }

      messages.push({ role: "assistant", content: outcome.content || null, tool_calls: outcome.toolCalls });

      for (const call of outcome.toolCalls) {
        signal.throwIfAborted();
        const name = call.function.name;
        let content: string;

        if (!permitidas.has(name)) {
          content = JSON.stringify({
            error: `ferramenta "${name}" não permitida neste subagente (somente leitura)`,
          });
        } else {
          ferramentas.push(name);
          try {
            content = await deps.execute(name, parseArgs(call.function.arguments), signal);
          } catch (error) {
            if (signal.aborted) throw error;
            content = JSON.stringify({
              error: error instanceof Error ? error.message : "falha na ferramenta",
            });
          }
        }

        messages.push({ role: "tool", tool_call_id: call.id, content });
      }
    }

    return {
      ok: false,
      resumo: `Subagente atingiu o limite de ${MAX_ROUNDS} rodadas sem concluir o objetivo.`,
      rounds,
      ferramentas,
      ms: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      ok: false,
      resumo: `Subagente falhou: ${failureMessage(error, parentSignal)}`,
      rounds,
      ferramentas,
      ms: Date.now() - startedAt,
    };
  }
}
