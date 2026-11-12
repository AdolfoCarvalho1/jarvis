import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const SCRIPT = path.join(ROOT, "scripts", "pc.ps1");

const ACTIONS: Record<string, string> = {
  abrir: "open",
  "volume-up": "volume-up",
  "volume-down": "volume-down",
  mudo: "mute",
  mute: "mute",
  "play-pause": "media-play-pause",
  proxima: "media-next",
  anterior: "media-prev",
  bloquear: "lock",
  screenshot: "screenshot",
};

interface RunResult {
  ok: boolean;
  output: string;
  code: number;
}

function run(args: string[], timeout: number, signal?: AbortSignal): Promise<RunResult> {
  return new Promise((resolve) => {
    execFile(
      "powershell",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", SCRIPT, ...args],
      { cwd: ROOT, timeout, signal, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const code = error && typeof error.code === "number" ? error.code : error ? 1 : 0;
        resolve({
          ok: !error,
          output: `${stdout ?? ""}${stderr ? `\n${stderr}` : ""}`.trim(),
          code,
        });
      },
    );
  });
}

export async function runPcAction(acao: string, valor = "", signal?: AbortSignal): Promise<RunResult> {
  const mapped = ACTIONS[acao.trim().toLowerCase()];
  if (!mapped) {
    return { ok: false, output: `ação inválida: ${acao}`, code: 2 };
  }
  const args = ["-Action", mapped];
  if (mapped === "open") {
    if (!valor.trim()) return { ok: false, output: "informe o app ou a URL", code: 2 };
    args.push("-Value", valor.trim());
  }
  return run(args, 30000, signal);
}

export async function captureScreen(signal: AbortSignal): Promise<{ path: string; base64: string }> {
  const result = await run(["-Action", "screenshot"], 30000, signal);
  const file = result.output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .pop();
  if (!result.ok || !file) {
    throw new Error(result.output || "não foi possível capturar a tela");
  }
  const buffer = await readFile(file, { signal });
  return { path: file, base64: buffer.toString("base64") };
}
