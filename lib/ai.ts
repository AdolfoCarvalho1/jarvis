export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface Usage {
  promptTokens: number;
  completionTokens: number;
}

export interface ChatTurn {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface StreamOutcome {
  content: string;
  toolCalls: ToolCall[];
  usage?: Usage;
}

const BASE_URL = process.env.OPENCODE_BASE_URL || "https://opencode.ai/inference/openai/v1";
const API_KEY = process.env.OPENCODE_GO_API_KEY || "";
export const DEFAULT_MODEL = process.env.JARVIS_MODEL || "deepseek-v4.1-flash";

export function defaultModel(): string {
  return DEFAULT_MODEL;
}

export function hasCredentials(): boolean {
  return Boolean(API_KEY);
}

function withDeadline(signal: AbortSignal | undefined, ms: number) {
  const timeout = AbortSignal.timeout(ms);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

interface StreamOptions {
  messages: ChatTurn[];
  tools: unknown[];
  model?: string;
  signal?: AbortSignal;
  onText?: (chunk: string) => void;
  temperature?: number;
}

/**
 * Uma chamada ao modelo com streaming. Devolve o texto e eventuais tool_calls
 * acumulados — quem chama decide se executa ferramentas e faz outra rodada.
 */
export async function streamCompletion({
  messages,
  tools,
  model,
  signal: parentSignal,
  onText,
  temperature = 0.6,
}: StreamOptions): Promise<StreamOutcome> {
  if (!API_KEY) throw new Error("OPENCODE_GO_API_KEY ausente — configure o .env.local");
  const signal = withDeadline(parentSignal, 75_000);

  const body: Record<string, unknown> = {
    model: model || DEFAULT_MODEL,
    messages,
    tools,
    tool_choice: "auto",
    stream: true,
    stream_options: { include_usage: true },
    temperature,
  };

  let response = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal,
  });

  // Alguns backends rejeitam stream_options; repete sem ele antes de desistir.
  if (response.status === 400) {
    const detail = await response.text();
    if (/stream_options|include_usage/i.test(detail)) {
      delete body.stream_options;
      response = await fetch(`${BASE_URL}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal,
      });
    } else {
      throw new Error(`Modelo respondeu 400: ${detail.slice(0, 400)}`);
    }
  }

  if (!response.ok || !response.body) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Modelo respondeu ${response.status}: ${detail.slice(0, 400)}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  const toolMap = new Map<number, ToolCall>();
  let usage: Usage | undefined;
  let finishedByProvider = false;

  const handleLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) return;
    const payload = trimmed.slice(5).trim();
    if (!payload) return false;
    if (payload === "[DONE]") return true;

    let json: {
      choices?: Array<{
        delta?: {
          content?: string | null;
          tool_calls?: Array<{
            index?: number;
            id?: string;
            type?: string;
            function?: { name?: string; arguments?: string };
          }>;
        };
        finish_reason?: string | null;
      }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    try {
      json = JSON.parse(payload);
    } catch {
      return;
    }

    const delta = json.choices?.[0]?.delta;
    if (json.choices?.[0]?.finish_reason) finishedByProvider = true;
    if (delta?.content) {
      content += delta.content;
      onText?.(delta.content);
    }

    for (const [fallbackIndex, call] of (delta?.tool_calls ?? []).entries()) {
      const index = typeof call.index === "number" ? call.index : fallbackIndex;
      const current = toolMap.get(index) ?? {
        id: "",
        type: "function" as const,
        function: { name: "", arguments: "" },
      };
      if (call.id) current.id = call.id;
      if (call.function?.name) current.function.name += call.function.name;
      if (call.function?.arguments) current.function.arguments += call.function.arguments;
      toolMap.set(index, current);
    }

    if (json.usage) {
      usage = {
        promptTokens: json.usage.prompt_tokens ?? 0,
        completionTokens: json.usage.completion_tokens ?? 0,
      };
    }
  };

  try {
    let ended = false;
    while (!ended) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (handleLine(line)) {
          ended = true;
          break;
        }
      }
    }
    if (!ended) ended = handleLine(buffer + decoder.decode()) === true;
    if (!ended && !finishedByProvider) throw new Error("O modelo encerrou a transmissão antes de concluir a resposta.");
  } finally {
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }

  const toolCalls = [...toolMap.values()]
    .filter((call) => call.function.name)
    .map((call, i) => ({ ...call, id: call.id || `call_${Date.now()}_${i}` }));

  return { content, toolCalls, usage };
}

interface CompleteOptions {
  messages: ChatTurn[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
}

/** Chamada simples, sem streaming e sem ferramentas — usada na compactação. */
export async function complete({
  messages,
  model,
  temperature = 0.3,
  maxTokens = 900,
  signal: parentSignal,
  timeoutMs = 30_000,
}: CompleteOptions): Promise<string> {
  if (!API_KEY) throw new Error("OPENCODE_GO_API_KEY ausente");
  const signal = withDeadline(parentSignal, timeoutMs);

  const response = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: model || DEFAULT_MODEL,
      messages,
      temperature,
      max_tokens: maxTokens,
      stream: false,
    }),
    signal,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Modelo respondeu ${response.status}: ${detail.slice(0, 300)}`);
  }

  const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return payload.choices?.[0]?.message?.content ?? "";
}
