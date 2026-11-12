const BASE_URL = process.env.OPENCODE_BASE_URL || "https://opencode.ai/inference/openai/v1";
const API_KEY = process.env.OPENCODE_GO_API_KEY || "";

export interface ModelInfo {
  id: string;
  name: string;
  context: number;
  inputPrice: number;
  free: boolean;
  featured: boolean;
}

/** Ordem do seletor: os que interessam primeiro. */
const PREFERRED = [
  "deepseek-v4.1-flash",
  "deepseek-v4.1-flash-free",
  "gpt-6.1-sol",
  "gpt-6-luna",
  "gemini-3.8-flash",
  "gemini-3.5-flash-lite",
  "claude-haiku-5-5",
  "qwen3.8-flash",
  "glm-5.3-flash",
  "kimi-k3",
  "minimax-m3",
  "mimo-v2.6-flash-free",
];

interface RawModel {
  id?: string;
  name?: string;
  type?: string;
  limit?: { context?: number };
  cost?: { text?: { input?: { price?: number } } };
  capabilities?: { tools?: { supported?: boolean } };
}

let cache: { at: number; models: ModelInfo[] } | null = null;
const TTL = 10 * 60 * 1000;

export async function listModels(force = false): Promise<ModelInfo[]> {
  if (!force && cache && Date.now() - cache.at < TTL) return cache.models;
  if (!API_KEY) return [];

  const response = await fetch(`${BASE_URL}/models`, {
    headers: { Authorization: `Bearer ${API_KEY}` },
    signal: AbortSignal.timeout(15000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`catálogo de modelos respondeu ${response.status}`);

  const payload = (await response.json()) as { data?: RawModel[] };
  const all = (payload.data ?? [])
    .filter((model) => model.id && model.type === "chat" && model.capabilities?.tools?.supported)
    .map((model) => ({
      id: String(model.id),
      name: model.name || String(model.id),
      context: model.limit?.context ?? 0,
      inputPrice: model.cost?.text?.input?.price ?? 0,
      free: (model.cost?.text?.input?.price ?? 0) === 0,
      featured: PREFERRED.includes(String(model.id)),
    }));

  const rank = (id: string) => {
    const index = PREFERRED.indexOf(id);
    return index === -1 ? PREFERRED.length + 1 : index;
  };
  const sorted = all.slice().sort((a, b) => rank(a.id) - rank(b.id) || a.name.localeCompare(b.name));

  cache = { at: Date.now(), models: sorted };
  return sorted;
}

export async function modelExists(id: string): Promise<boolean> {
  const models = await listModels();
  return models.some((model) => model.id === id);
}
