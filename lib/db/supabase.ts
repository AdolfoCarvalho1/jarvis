import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { ChatMessage, Conversation, MemoryItem, Reminder } from "../types";
import { messageTime } from "./message-time";

/**
 * Driver Supabase (server-only, service role).
 * As tabelas usam o prefixo jarvis_ para poderem morar num projeto compartilhado.
 * SQL para criar as tabelas: supabase/schema.sql
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

export const supabaseEnabled = Boolean(url && key);

let client: SupabaseClient | null = null;

function sb(): SupabaseClient {
  if (!supabaseEnabled) throw new Error("Supabase não configurado");
  if (!client) {
    client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        headers: { "x-application-name": "jarvis" },
        fetch: (input, init) => {
          const timeout = AbortSignal.timeout(10_000);
          const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
          return fetch(input, { ...init, signal });
        },
      },
    });
  }
  return client;
}

function fail(context: string, error: { message: string } | null): never {
  throw new Error(`${context}: ${error?.message ?? "erro desconhecido"}`);
}

const T = {
  conversations: "jarvis_conversations",
  messages: "jarvis_messages",
  reminders: "jarvis_reminders",
  memories: "jarvis_memories",
  settings: "jarvis_settings",
} as const;

export const supabaseStore = {
  name: "supabase" as const,

  async listConversations(): Promise<Conversation[]> {
    const { data, error } = await sb()
      .from(T.conversations)
      .select("id,title,created_at,updated_at")
      .order("updated_at", { ascending: false })
      .limit(200);
    if (error) fail("listar conversas", error);
    return (data ?? []) as Conversation[];
  },

  async createConversation(title: string): Promise<Conversation> {
    const now = new Date().toISOString();
    const conv: Conversation = {
      id: crypto.randomUUID(),
      title: title.trim() || "Nova conversa",
      created_at: now,
      updated_at: now,
    };
    const { error } = await sb().from(T.conversations).insert(conv);
    if (error) fail("criar conversa", error);
    return conv;
  },

  async getConversation(id: string): Promise<Conversation | null> {
    const { data, error } = await sb()
      .from(T.conversations)
      .select("id,title,created_at,updated_at")
      .eq("id", id)
      .maybeSingle();
    if (error) fail("buscar conversa", error);
    return (data as Conversation | null) ?? null;
  },

  async renameConversation(id: string, title: string): Promise<void> {
    const { error } = await sb()
      .from(T.conversations)
      .update({ title: title.trim() || "Nova conversa", updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) fail("renomear conversa", error);
  },

  async deleteConversation(id: string): Promise<void> {
    const { error: messagesError } = await sb().from(T.messages).delete().eq("conversation_id", id);
    if (messagesError) fail("apagar mensagens", messagesError);
    const { error } = await sb().from(T.conversations).delete().eq("id", id);
    if (error) fail("apagar conversa", error);
  },

  async touchConversation(id: string): Promise<void> {
    const { error } = await sb()
      .from(T.conversations)
      .update({ updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) fail("atualizar conversa", error);
  },

  async listMessages(conversationId: string, limit = 200): Promise<ChatMessage[]> {
    const { data, error } = await sb()
      .from(T.messages)
      .select("id,conversation_id,role,content,created_at")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(limit);
    if (error) fail("listar mensagens", error);
    return ((data ?? []) as ChatMessage[]).slice().reverse();
  },

  async listMessageRange(conversationId: string, offset: number, limit: number): Promise<ChatMessage[]> {
    const { data, error } = await sb()
      .from(T.messages)
      .select("id,conversation_id,role,content,created_at")
      .eq("conversation_id", conversationId)
      .order("created_at")
      .order("id")
      .range(offset, offset + limit - 1);
    if (error) fail("listar trecho da conversa", error);
    return (data ?? []) as ChatMessage[];
  },

  async addMessage(conversationId: string, role: ChatMessage["role"], content: string): Promise<ChatMessage> {
    const msg: ChatMessage = {
      id: crypto.randomUUID(),
      conversation_id: conversationId,
      role,
      content,
      created_at: messageTime(),
    };
    const { error } = await sb().from(T.messages).insert(msg);
    if (error) fail("salvar mensagem", error);
    await this.touchConversation(conversationId);
    return msg;
  },

  async listReminders(onlyPending = false): Promise<Reminder[]> {
    let query = sb()
      .from(T.reminders)
      .select("id,title,due_at,done,created_at")
      .order("created_at", { ascending: true })
      .limit(200);
    if (onlyPending) query = query.eq("done", false);
    const { data, error } = await query;
    if (error) fail("listar lembretes", error);
    return ((data ?? []) as Array<Omit<Reminder, "done"> & { done: boolean }>).map((r) => ({
      ...r,
      done: r.done ? 1 : 0,
    }));
  },

  async addReminder(title: string, dueAt: string | null): Promise<Reminder> {
    const reminder = {
      id: crypto.randomUUID(),
      title: title.trim(),
      due_at: dueAt,
      done: false,
      created_at: new Date().toISOString(),
    };
    const { error } = await sb().from(T.reminders).insert(reminder);
    if (error) fail("criar lembrete", error);
    return { ...reminder, done: 0 };
  },

  async setReminderDone(id: string, done: boolean): Promise<void> {
    const { error } = await sb().from(T.reminders).update({ done }).eq("id", id);
    if (error) fail("atualizar lembrete", error);
  },

  async deleteReminder(id: string): Promise<void> {
    const { error } = await sb().from(T.reminders).delete().eq("id", id);
    if (error) fail("apagar lembrete", error);
  },

  async listMemories(): Promise<MemoryItem[]> {
    const { data, error } = await sb()
      .from(T.memories)
      .select("id,content,created_at")
      .order("created_at", { ascending: false })
      .limit(80);
    if (error) fail("listar memórias", error);
    return (data ?? []) as MemoryItem[];
  },

  async addMemory(content: string): Promise<MemoryItem> {
    const memory: MemoryItem = {
      id: crypto.randomUUID(),
      content: content.trim(),
      created_at: new Date().toISOString(),
    };
    const { error } = await sb().from(T.memories).insert(memory);
    if (error) fail("salvar memória", error);
    return memory;
  },

  async deleteMemory(id: string): Promise<void> {
    const { error } = await sb().from(T.memories).delete().eq("id", id);
    if (error) fail("apagar memória", error);
  },

  async getSetting(key: string): Promise<string | null> {
    const { data, error } = await sb().from(T.settings).select("value").eq("key", key).maybeSingle();
    if (error) fail("ler configuração", error);
    return (data as { value: string } | null)?.value ?? null;
  },

  async setSetting(key: string, value: string): Promise<void> {
    const { error } = await sb()
      .from(T.settings)
      .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: "key" });
    if (error) fail("salvar configuração", error);
  },

  async countMessages(conversationId: string): Promise<number> {
    const { count, error } = await sb()
      .from(T.messages)
      .select("id", { count: "exact", head: true })
      .eq("conversation_id", conversationId);
    if (error) fail("contar mensagens", error);
    return count ?? 0;
  },
};
