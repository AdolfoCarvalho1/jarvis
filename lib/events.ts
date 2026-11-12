import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * Trilha de eventos auditável de cada turno do chat.
 * Usa o mesmo arquivo SQLite do app, com conexão e tabela próprias para não
 * acoplar ao store de mensagens.
 */
const dataDir = process.env.JARVIS_DATA_DIR || path.join(process.cwd(), ".data");

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 200;
const MAX_STRING = 1200;
const MAX_ARRAY = 20;
const MAX_DEPTH = 4;

const globalForEvents = globalThis as unknown as { __jarvisEventsDb?: DatabaseSync };

export interface SessionEvent {
  id: string;
  conversation_id: string;
  turn_id: string;
  type: string;
  payload: Record<string, unknown>;
  created_at: string;
}

function getDb(): DatabaseSync {
  if (!globalForEvents.__jarvisEventsDb) {
    fs.mkdirSync(dataDir, { recursive: true });
    const db = new DatabaseSync(path.join(dataDir, "jarvis.db"));
    db.exec(`
      PRAGMA busy_timeout = 3000;
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS session_events (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        turn_id TEXT NOT NULL,
        type TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_session_events_conversation ON session_events(conversation_id, created_at);
    `);
    globalForEvents.__jarvisEventsDb = db;
  }
  return globalForEvents.__jarvisEventsDb;
}

/** Reduz o payload a algo pequeno e serializável: sem ciclos, sem lixo gigante. */
function sanitize(value: unknown, depth: number): unknown {
  if (typeof value === "string") {
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean" || value === null) return value;
  if (value === undefined) return undefined;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "function" || typeof value === "symbol") return null;
  if (value instanceof Date) return value.toISOString();
  if (depth >= MAX_DEPTH) {
    return Array.isArray(value) ? `[lista com ${value.length} itens]` : "[objeto aninhado]";
  }
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY).map((item) => sanitize(item, depth + 1) ?? null);
  }
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    const clean = sanitize(item, depth + 1);
    if (clean !== undefined) out[key] = clean;
  }
  return out;
}

function sanitizePayload(payload: Record<string, unknown>): Record<string, unknown> {
  const clean = sanitize(payload, 0);
  return clean && typeof clean === "object" && !Array.isArray(clean)
    ? (clean as Record<string, unknown>)
    : {};
}

function clampInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function rowToEvent(row: Record<string, unknown>): SessionEvent {
  let payload: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(String(row.payload));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      payload = parsed as Record<string, unknown>;
    }
  } catch {
    payload = {};
  }
  return {
    id: String(row.id),
    conversation_id: String(row.conversation_id),
    turn_id: String(row.turn_id),
    type: String(row.type),
    payload,
    created_at: String(row.created_at),
  };
}

/** Grava um evento do turno. Nunca lança: auditoria não pode derrubar o chat. */
export function appendEvent(
  conversationId: string,
  turnId: string,
  type: string,
  payload: Record<string, unknown> = {},
): void {
  try {
    getDb()
      .prepare(
        "INSERT INTO session_events (id, conversation_id, turn_id, type, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(
        randomUUID(),
        conversationId,
        turnId,
        type,
        JSON.stringify(sanitizePayload(payload)),
        new Date().toISOString(),
      );
  } catch (error) {
    console.error("[Jarvis] evento de sessão:", error instanceof Error ? error.message : error);
  }
}

export function listEvents(
  options: { conversationId?: string; limit?: number; offset?: number } = {},
): SessionEvent[] {
  const limit = clampInteger(options.limit, DEFAULT_LIMIT, 1, MAX_LIMIT);
  const offset = clampInteger(options.offset, 0, 0, Number.MAX_SAFE_INTEGER);
  const db = getDb();
  const rows = options.conversationId
    ? db
        .prepare(
          "SELECT * FROM session_events WHERE conversation_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?",
        )
        .all(options.conversationId, limit, offset)
    : db
        .prepare("SELECT * FROM session_events ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?")
        .all(limit, offset);
  return (rows as Record<string, unknown>[]).map(rowToEvent);
}

export function countEvents(conversationId?: string): number {
  const db = getDb();
  const row = (conversationId
    ? db.prepare("SELECT COUNT(*) AS total FROM session_events WHERE conversation_id = ?").get(conversationId)
    : db.prepare("SELECT COUNT(*) AS total FROM session_events").get()) as { total: number } | undefined;
  return Number(row?.total ?? 0);
}
