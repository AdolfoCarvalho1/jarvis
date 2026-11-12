import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROOT = process.cwd();
const VOICE = process.env.JARVIS_TTS_VOICE || "pt-BR-AntonioNeural";
const RATE = process.env.JARVIS_TTS_RATE || "+0%";
const PYTHON = process.env.JARVIS_TTS_PYTHON || path.join(ROOT, ".jarvis", "tts-venv", "Scripts", "python.exe");
const SCRIPT = path.join(ROOT, "scripts", "tts.py");
const CACHE = path.join(process.env.JARVIS_DATA_DIR || path.join(ROOT, ".data"), "tts");

async function synthesize(text: string, signal: AbortSignal): Promise<Buffer> {
  const key = createHash("sha1").update(`${VOICE}|${RATE}|${text}`).digest("hex");
  const file = path.join(CACHE, `${key}.mp3`);
  try {
    const cached = await readFile(file);
    if (cached.byteLength > 200) return cached;
  } catch {
    /* ainda não está em cache */
  }

  await mkdir(CACHE, { recursive: true });
  const temporary = path.join(CACHE, `${key}-${randomUUID()}.mp3`);
  try {
    await new Promise<void>((resolve, reject) => {
      signal.throwIfAborted();
      const child = spawn(/* turbopackIgnore: true */ PYTHON, [SCRIPT, temporary, VOICE, RATE], { cwd: ROOT, windowsHide: true, signal });
      let stderr = "";
      const timer = setTimeout(() => child.kill(), 25_000);
      child.stderr.on("data", (chunk: Buffer) => {
        stderr = (stderr + chunk.toString()).slice(-3000);
      });
      let failure: Error | undefined;
      child.on("error", (error) => { failure = error; });
      child.stdin.on("error", (error) => { failure ??= error; });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (failure) reject(failure);
        else if (code === 0) resolve();
        else reject(new Error(stderr.trim() || `tts exit ${code}`));
      });
      child.stdin.end(text);
    });
    const audio = await readFile(temporary);
    if (audio.byteLength < 200) throw new Error("tts vazio");
    await rename(temporary, file).catch(() => undefined);
    return audio;
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

export async function POST(request: NextRequest) {
  const payload = (await request.json().catch(() => ({ text: "" }))) as { text?: string };
  const text = String(payload.text ?? "").trim();
  if (!text) return Response.json({ error: "texto vazio" }, { status: 400 });
  if (text.length > 3000) return Response.json({ error: "texto longo demais" }, { status: 413 });

  try {
    const audio = await synthesize(text, request.signal);
    return new Response(new Uint8Array(audio), {
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": String(audio.byteLength),
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "falha ao sintetizar voz" },
      { status: 500 },
    );
  }
}
