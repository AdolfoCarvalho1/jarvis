import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import type { ChatMessage, Conversation, MemoryItem, Reminder } from "../types";
import { messageTime } from "./message-time";

/**
 * Armazenamento local (SQLite nativo do Node 22+).
 * Arquivo em <projeto>/.data/jarvis.db — some do git, sobrevive a restart.
 */
const dataDir = process.env.JARVIS_DATA_DIR || path.join(process.cwd(), ".data");

const globalForDb = globalThis as unknown as { __jarvisSqlite?: DatabaseSync };

function now(): string {
  return new Date().toISOString();
}

function getDb(): DatabaseSync {
  if (!globalForDb.__jarvisSqlite) {
    fs.mkdirSync(dataDir, { recursive: true });
    const db = new DatabaseSync(path.join(dataDir, "jarvis.db"));
    db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at);
      CREATE TABLE IF NOT EXISTS reminders (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        due_at TEXT,
        done INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    globalForDb.__jarvisSqlite = db;
  }
  return globalForDb.__jarvisSqlite;
}

function rowToConversation(row: Record<string, unknown>): Conversation {
  return {
    id: String(row.id),
    title: String(row.title),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function rowToMessage(row: Record<string, unknown>): ChatMessage {
  return {
    id: String(row.id),
    conversation_id: String(row.conversation_id),
    role: row.role as ChatMessage["role"],
    content: String(row.content),
    created_at: String(row.created_at),
  };
}

function rowToReminder(row: Record<string, unknown>): Reminder {
  return {
    id: String(row.id),
    title: String(row.title),
    due_at: row.due_at ? String(row.due_at) : null,
    done: Number(row.done ?? 0),
    created_at: String(row.created_at),
  };
}

function rowToMemory(row: Record<string, unknown>): MemoryItem {
  return {
    id: String(row.id),
    content: String(row.content),
    created_at: String(row.created_at),
  };
}

export const sqliteStore = {
  name: "sqlite" as const,

  async listConversations(): Promise<Conversation[]> {
    const rows = getDb()
      .prepare("SELECT * FROM conversations ORDER BY updated_at DESC")
      .all() as Record<string, unknown>[];
    return rows.map(rowToConversation);
  },

  async createConversation(title: string): Promise<Conversation> {
    const conv: Conversation = {
      id: crypto.randomUUID(),
      title: title.trim() || "Nova conversa",
      created_at: now(),
      updated_at: now(),
    };
    getDb()
      .prepare("INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)")
      .run(conv.id, conv.title, conv.created_at, conv.updated_at);
    return conv;
  },

  async getConversation(id: string): Promise<Conversation | null> {
    const row = getDb().prepare("SELECT * FROM conversations WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? rowToConversation(row) : null;
  },

  async renameConversation(id: string, title: string): Promise<void> {
    getDb()
      .prepare("UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?")
      .run(title.trim() || "Nova conversa", now(), id);
  },

  async deleteConversation(id: string): Promise<void> {
    const db = getDb();
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("DELETE FROM messages WHERE conversation_id = ?").run(id);
      db.prepare("DELETE FROM conversations WHERE id = ?").run(id);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  },

  async touchConversation(id: string): Promise<void> {
    getDb().prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run(now(), id);
  },

  async listMessages(conversationId: string, limit = 200): Promise<ChatMessage[]> {
    const rows = getDb()
      .prepare(
        "SELECT * FROM (SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at DESC, id DESC LIMIT ?) ORDER BY created_at ASC, id ASC",
      )
      .all(conversationId, limit) as Record<string, unknown>[];
    return rows.map(rowToMessage);
  },

  async listMessageRange(conversationId: string, offset: number, limit: number): Promise<ChatMessage[]> {
    return getDb().prepare(
      "SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at, id LIMIT ? OFFSET ?",
    ).all(conversationId, limit, offset).map(rowToMessage);
  },

  async addMessage(conversationId: string, role: ChatMessage["role"], content: string): Promise<ChatMessage> {
    const msg: ChatMessage = {
      id: crypto.randomUUID(),
      conversation_id: conversationId,
      role,
      content,
      created_at: messageTime(),
    };
    getDb()
      .prepare("INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(msg.id, msg.conversation_id, msg.role, msg.content, msg.created_at);
    await this.touchConversation(conversationId);
    return msg;
  },

  async listReminders(onlyPending = false): Promise<Reminder[]> {
    const sql = onlyPending
      ? "SELECT * FROM reminders WHERE done = 0 ORDER BY COALESCE(due_at, created_at) ASC"
      : "SELECT * FROM reminders ORDER BY done ASC, COALESCE(due_at, created_at) ASC";
    const rows = getDb().prepare(sql).all() as Record<string, unknown>[];
    return rows.map(rowToReminder);
  },

  async addReminder(title: string, dueAt: string | null): Promise<Reminder> {
    const reminder: Reminder = {
      id: crypto.randomUUID(),
      title: title.trim(),
      due_at: dueAt,
      done: 0,
      created_at: now(),
    };
    getDb()
      .prepare("INSERT INTO reminders (id, title, due_at, done, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(reminder.id, reminder.title, reminder.due_at, reminder.done, reminder.created_at);
    return reminder;
  },

  async setReminderDone(id: string, done: boolean): Promise<void> {
    getDb().prepare("UPDATE reminders SET done = ? WHERE id = ?").run(done ? 1 : 0, id);
  },

  async deleteReminder(id: string): Promise<void> {
    getDb().prepare("DELETE FROM reminders WHERE id = ?").run(id);
  },

  async listMemories(): Promise<MemoryItem[]> {
    const rows = getDb()
      .prepare("SELECT * FROM memories ORDER BY created_at DESC LIMIT 80")
      .all() as Record<string, unknown>[];
    return rows.map(rowToMemory);
  },

  async addMemory(content: string): Promise<MemoryItem> {
    const memory: MemoryItem = {
      id: crypto.randomUUID(),
      content: content.trim(),
      created_at: now(),
    };
    getDb()
      .prepare("INSERT INTO memories (id, content, created_at) VALUES (?, ?, ?)")
      .run(memory.id, memory.content, memory.created_at);
    return memory;
  },

  async deleteMemory(id: string): Promise<void> {
    getDb().prepare("DELETE FROM memories WHERE id = ?").run(id);
  },

  async getSetting(key: string): Promise<string | null> {
    const row = getDb().prepare("SELECT value FROM settings WHERE key = ?").get(key) as
      | { value: string }
      | undefined;
    return row?.value ?? null;
  },

  async setSetting(key: string, value: string): Promise<void> {
    getDb()
      .prepare(
        "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
      )
      .run(key, value, now());
  },

  async countMessages(conversationId: string): Promise<number> {
    const row = getDb()
      .prepare("SELECT COUNT(*) AS total FROM messages WHERE conversation_id = ?")
      .get(conversationId) as { total: number };
    return Number(row.total);
  },
};

export type Store = typeof sqliteStore;
