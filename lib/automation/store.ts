import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Routine, StepResult, Task, TaskStatus, TaskStep } from "./types.ts";

const state = globalThis as typeof globalThis & { jarvisTasksDb?: DatabaseSync };
const leaseMs = 15_000;

export interface FileObservation {
  fingerprint: string | null;
  changedAt: number;
}

export interface ClaimedTask extends Task {
  owner: string;
  observation: FileObservation | null;
  interrupted: boolean;
}

function db() {
  if (!state.jarvisTasksDb) {
    const directory = process.env.JARVIS_DATA_DIR || path.join(process.cwd(), ".data");
    mkdirSync(directory, { recursive: true });
    const database = new DatabaseSync(path.join(directory, "automation.db"));
    database.exec(`
      PRAGMA busy_timeout = 5000;
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        project TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued',
        steps TEXT NOT NULL,
        results TEXT NOT NULL DEFAULT '[]',
        cursor INTEGER NOT NULL DEFAULT 0,
        summary TEXT NOT NULL DEFAULT '',
        observation TEXT,
        owner TEXT,
        lease_until INTEGER NOT NULL DEFAULT 0,
        next_run INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS tasks_next_run ON tasks(status, next_run);
      CREATE TABLE IF NOT EXISTS routines (
        name TEXT PRIMARY KEY COLLATE NOCASE,
        steps TEXT NOT NULL
      );
    `);
    state.jarvisTasksDb = database;
  }
  return state.jarvisTasksDb;
}

function asTask(row: Record<string, unknown>): Task {
  return {
    id: String(row.id),
    title: String(row.title),
    project: String(row.project),
    status: row.status as TaskStatus,
    steps: JSON.parse(String(row.steps)) as TaskStep[],
    results: JSON.parse(String(row.results)) as StepResult[],
    cursor: Number(row.cursor),
    summary: String(row.summary),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

export function taskById(id: string): Task | null {
  const row = db().prepare("SELECT * FROM tasks WHERE id = ?").get(id);
  return row ? asTask(row) : null;
}

export function listTasks(): Task[] {
  return db().prepare("SELECT * FROM tasks ORDER BY created_at DESC LIMIT 40").all().map(asTask);
}

export function enqueue(
  title: string,
  project: string,
  steps: TaskStep[],
  options: { id?: string; at?: number; observation?: FileObservation } = {},
): Task {
  const now = Date.now();
  const id = options.id ?? randomUUID();
  db().prepare(`
    INSERT INTO tasks (id, title, project, steps, observation, next_run, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING
  `).run(id, title, project, JSON.stringify(steps), options.observation ? JSON.stringify(options.observation) : null,
    options.at ?? now, now, now);
  return taskById(id)!;
}

export function claimTask(timed: boolean): ClaimedTask | null {
  const now = Date.now();
  const owner = randomUUID();
  const row = db().prepare(`
    UPDATE tasks SET status = 'running', owner = ?, lease_until = ?,
      summary = CASE WHEN status = 'running' THEN 'Execução anterior interrompida.' ELSE summary END,
      updated_at = ?
    WHERE id = (
      SELECT id FROM tasks WHERE (
        (status IN ('queued', 'waiting') AND next_run <= ?) OR
        (status = 'running' AND lease_until <= ?)
      ) AND (json_extract(steps, '$[' || cursor || '].action') IN ('watch-file', 'remind', 'verify-edit')) = ?
      ORDER BY next_run, created_at LIMIT 1
    ) AND NOT EXISTS (
      SELECT 1 FROM tasks WHERE status = 'running' AND lease_until > ?
        AND (json_extract(steps, '$[' || cursor || '].action') IN ('watch-file', 'remind', 'verify-edit')) = ?
    )
    RETURNING *
  `).get(owner, now + leaseMs, now, now, now, Number(timed), now, Number(timed));
  return row ? {
    ...asTask(row),
    owner,
    observation: row.observation ? JSON.parse(String(row.observation)) as FileObservation : null,
    interrupted: row.summary === "Execução anterior interrompida.",
  } : null;
}

export function renewTask(task: ClaimedTask): boolean {
  return Number(db().prepare("UPDATE tasks SET lease_until = ? WHERE id = ? AND owner = ? AND status = 'running'")
    .run(Date.now() + leaseMs, task.id, task.owner).changes) === 1;
}

export function waitTask(task: ClaimedTask, observation: FileObservation) {
  const now = Date.now();
  db().prepare(`
    UPDATE tasks SET status = 'waiting', observation = ?, next_run = ?, updated_at = ?, owner = NULL
    WHERE id = ? AND owner = ? AND status = 'running'
  `).run(JSON.stringify(observation), now + 2_000, now, task.id, task.owner);
}

export function finishStep(task: ClaimedTask, result: StepResult, stop = false, cursor = task.cursor + 1): TaskStatus | null {
  const results = [...task.results, result];
  const finished = stop || cursor >= task.steps.length;
  const status = finished ? (results.every((item) => item.ok) ? "succeeded" : "failed") : "queued";
  const summary = finished ? (results.find((item) => !item.ok)?.summary ?? result.summary) : result.summary;
  const now = Date.now();
  const updated = db().prepare(`
    UPDATE tasks SET status = ?, cursor = ?, results = ?, summary = ?, updated_at = ?, next_run = ?, owner = NULL
    WHERE id = ? AND owner = ? AND status = 'running'
  `).run(status, cursor, JSON.stringify(results), summary, now, now, task.id, task.owner);
  return Number(updated.changes) === 1 ? status : null;
}

export function cancelTask(id: string): boolean {
  const result = db().prepare(`
    UPDATE tasks SET status = 'cancelled', summary = 'Tarefa cancelada.', owner = NULL, updated_at = ?
    WHERE id = ? AND status IN ('queued', 'waiting', 'running')
  `).run(Date.now(), id);
  return Number(result.changes) === 1;
}

export function requeueCancelledReminder(id: string, at: number): void {
  db().prepare(`
    UPDATE tasks SET status = 'queued', summary = '', next_run = ?, updated_at = ?
    WHERE id = ? AND status = 'cancelled'
  `).run(at, Date.now(), id);
}

export function getRoutine(name: string): Routine | null {
  const row = db().prepare("SELECT name, steps FROM routines WHERE name = ?").get(name.trim().normalize("NFC"));
  return row ? { name: String(row.name), steps: JSON.parse(String(row.steps)) as TaskStep[] } : null;
}

export function listRoutines(): Routine[] {
  return db().prepare("SELECT name, steps FROM routines ORDER BY name").all().map((row) => ({
    name: String(row.name),
    steps: JSON.parse(String(row.steps)) as TaskStep[],
  }));
}

export function saveRoutine(name: string, steps: TaskStep[]): Routine {
  const label = name.trim().normalize("NFC");
  if (!label || label.length > 80) throw new Error("O nome da rotina deve ter até 80 caracteres.");
  db().prepare(`
    INSERT INTO routines (name, steps) VALUES (?, ?)
    ON CONFLICT(name) DO UPDATE SET steps = excluded.steps
  `).run(label, JSON.stringify(steps));
  return { name: label, steps };
}

export function deleteRoutine(name: string): boolean {
  return Number(db().prepare("DELETE FROM routines WHERE name = ?").run(name.trim().normalize("NFC")).changes) === 1;
}
