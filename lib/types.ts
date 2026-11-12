export type Role = "user" | "assistant" | "system" | "tool";

export interface Conversation {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface ChatMessage {
  id: string;
  conversation_id: string;
  role: Role;
  content: string;
  created_at: string;
}

export interface Reminder {
  id: string;
  title: string;
  due_at: string | null;
  done: number;
  created_at: string;
}

export interface MemoryItem {
  id: string;
  content: string;
  created_at: string;
}

export interface StoredTurn {
  id: string;
  role: Role;
  content: string;
  created_at: string;
}

export interface ToolEvent {
  id: string;
  name: string;
  label: string;
  status: "approval" | "running" | "done" | "error" | "cancelled";
  detail?: string;
  approvalId?: string;
  proposalId?: string;
}

export type StreamEvent =
  | { type: "meta"; conversationId: string; title: string; model?: string }
  | { type: "text"; value: string }
  | ({ type: "tool" } & ToolEvent)
  | { type: "timing"; firstTextMs?: number; totalMs?: number }
  | { type: "context"; chars: number }
  | { type: "usage"; promptTokens: number; completionTokens: number }
  | { type: "perf"; tokens: number; ms: number; tps: number }
  | { type: "ack"; text: string }
  | { type: "done"; messageId: string; createdAt: string }
  | { type: "error"; message: string };
