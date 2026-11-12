import { storage } from "./db";
import type { Conversation } from "./types";

const MAIN_KEY = "main_conversation_id";
const MODEL_KEY = "model";
const SUMMARY_KEY = "context_summary";
const state = globalThis as typeof globalThis & { jarvisMainConversation?: Promise<Conversation> };

/** Conversa única e contínua. Toda mensagem entra nela. */
export function getMainConversation(): Promise<Conversation> {
  if (state.jarvisMainConversation) return state.jarvisMainConversation;
  const pending = findOrCreate().finally(() => {
    if (state.jarvisMainConversation === pending) delete state.jarvisMainConversation;
  });
  state.jarvisMainConversation = pending;
  return pending;
}

async function findOrCreate(): Promise<Conversation> {
  const storedId = await storage.getSetting(MAIN_KEY);
  if (storedId) {
    const existing = await storage.getConversation(storedId);
    if (existing) return existing;
  }
  const created = await storage.createConversation("Conversa principal");
  await storage.setSetting(MAIN_KEY, created.id);
  return created;
}

/** Nova sessão: apaga a conversa atual, o contexto compactado e recomeça do zero. */
export async function resetMainConversation(): Promise<Conversation> {
  const existing = state.jarvisMainConversation;
  const replacement = (async () => {
    const storedId = (await existing)?.id ?? await storage.getSetting(MAIN_KEY);
    await storage.setSetting(SUMMARY_KEY, "");
    const created = await storage.createConversation("Conversa principal");
    await storage.setSetting(MAIN_KEY, created.id);
    if (storedId) await storage.deleteConversation(storedId);
    return created;
  })();
  state.jarvisMainConversation = replacement;
  try {
    return await replacement;
  } finally {
    if (state.jarvisMainConversation === replacement) delete state.jarvisMainConversation;
  }
}

export async function getActiveModel(): Promise<string> {
  const saved = await storage.getSetting(MODEL_KEY);
  return saved || process.env.JARVIS_MODEL || "deepseek-v4.1-flash";
}

export async function setActiveModel(model: string): Promise<void> {
  await storage.setSetting(MODEL_KEY, model);
}

export interface ContextState {
  summary: string;
  compactedMessages: number;
}

export async function getContextState(conversationId: string): Promise<ContextState> {
  const saved = await storage.getSetting(`${SUMMARY_KEY}:${conversationId}`);
  if (saved) return JSON.parse(saved) as ContextState;
  return { summary: (await storage.getSetting(SUMMARY_KEY)) || "", compactedMessages: 0 };
}

export async function saveContextState(conversationId: string, state: ContextState): Promise<void> {
  await storage.setSetting(`${SUMMARY_KEY}:${conversationId}`, JSON.stringify(state));
}
