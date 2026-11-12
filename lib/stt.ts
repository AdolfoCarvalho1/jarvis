import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";

const ROOT = process.cwd();
const PYTHON = process.env.JARVIS_STT_PYTHON || path.join(ROOT, ".jarvis", "stt-venv", "Scripts", "python.exe");
const SCRIPT = path.join(ROOT, "scripts", "stt_server.py");
const READY_TIMEOUT = 90_000;
const JOB_TIMEOUT = 35_000;

type Child = ChildProcessWithoutNullStreams;
type Job = {
  id: string;
  file: string;
  finish: (error: Error | null, text?: string) => void;
  timer?: NodeJS.Timeout;
};
interface Worker {
  child?: Child;
  ready: boolean;
  error?: string;
  retryAt: number;
  startup?: NodeJS.Timeout;
  current?: Job;
  queue: Job[];
}
const global = globalThis as typeof globalThis & { jarvisVoiceWorker?: Worker };
const state = global.jarvisVoiceWorker ??= { ready: false, retryAt: 0, queue: [] };

function stop(child: Child, error: Error, restart = false) {
  if (child !== state.child) return;
  state.child = undefined;
  state.ready = false;
  state.error = error.message;
  state.retryAt = Date.now() + (restart ? 0 : 4_000);
  clearTimeout(state.startup);
  child.kill();
  const current = state.current;
  state.current = undefined;
  current?.finish(error);
  if (restart) start();
  else for (const job of state.queue.splice(0)) job.finish(error);
}

function pump() {
  const child = state.child;
  if (!child || !state.ready || state.current) return;
  const job = state.queue.shift();
  if (!job) return;
  state.current = job;
  clearTimeout(job.timer);
  job.timer = setTimeout(() => stop(child, new Error("A transcrição excedeu o prazo."), true), JOB_TIMEOUT);
  child.stdin.write(`${JSON.stringify({ id: job.id, file: job.file })}\n`);
}

function start() {
  if (state.child || state.retryAt > Date.now()) return;
  if (!existsSync(/* turbopackIgnore: true */ PYTHON) || !existsSync(/* turbopackIgnore: true */ SCRIPT)) {
    state.error = "Motor de voz não instalado.";
    state.retryAt = Date.now() + 4_000;
    return;
  }
  const child = spawn(/* turbopackIgnore: true */ PYTHON, [SCRIPT], { cwd: ROOT, windowsHide: true });
  state.child = child;
  state.error = undefined;
  state.startup = setTimeout(() => stop(child, new Error("O motor de voz demorou para carregar.")), READY_TIMEOUT);
  child.stderr.resume();
  child.once("error", (error) => stop(child, error));
  child.stdin.on("error", (error) => stop(child, error));
  child.once("close", (code) => stop(child, new Error(`O motor de voz encerrou (${code ?? "interrompido"}).`)));
  const lines = createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    if (state.child !== child) return;
    let reply: { ready?: boolean; id?: string; error?: string; text?: string };
    try { reply = JSON.parse(line); } catch { return; }
    if (!reply || typeof reply !== "object") return;
    if (reply.ready === true) {
      clearTimeout(state.startup);
      state.ready = true;
      pump();
      return;
    }
    if (!reply.id && reply.error) {
      stop(child, new Error(reply.error));
      return;
    }
    const current = state.current;
    if (!current || reply.id !== current.id) return;
    state.current = undefined;
    current.finish(typeof reply.text === "string" ? null : new Error(reply.error || "Resposta inválida da transcrição."), reply.text);
    pump();
  });
}

export function sttStatus(): { status: "loading" | "ready" | "error"; detail?: string } {
  start();
  if (state.ready) return { status: "ready" };
  if (state.error) return { status: "error", detail: state.error };
  return { status: "loading" };
}

export async function transcribe(file: string, signal: AbortSignal): Promise<{ text: string }> {
  signal.throwIfAborted();
  start();
  if (!state.child) throw new Error(state.error ?? "Motor de voz indisponível.");
  if (state.queue.length >= 4) throw new Error("Fila de voz ocupada. Tente novamente em instantes.");
  return new Promise((resolve, reject) => {
    const job: Job = {
      id: randomUUID(), file,
      finish: (error, text) => {
        clearTimeout(job.timer);
        signal.removeEventListener("abort", cancel);
        if (error) reject(error);
        else resolve({ text: text ?? "" });
      },
    };
    const drop = (error: Error) => {
      if (state.current === job && state.child) {
        stop(state.child, error, true);
      } else {
        const index = state.queue.indexOf(job);
        if (index >= 0) state.queue.splice(index, 1);
        job.finish(error);
      }
    };
    const cancel = () => drop(signal.reason);
    job.timer = setTimeout(() => drop(new Error("A espera na fila de voz excedeu o prazo.")), READY_TIMEOUT + JOB_TIMEOUT);
    state.queue.push(job);
    signal.addEventListener("abort", cancel, { once: true });
    pump();
  });
}
