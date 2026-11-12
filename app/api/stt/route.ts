import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest } from "next/server";
import { sttStatus, transcribe } from "@/lib/stt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_BYTES = 20 * 1024 * 1024;
const DIR = path.join(process.env.JARVIS_DATA_DIR || path.join(process.cwd(), ".data"), "stt");

export async function GET() {
  return Response.json(sttStatus(), { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  if (Number(request.headers.get("content-length")) > MAX_BYTES) {
    return Response.json({ error: "áudio grande demais" }, { status: 413 });
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = request.body?.getReader();
  if (!reader) return Response.json({ error: "áudio vazio" }, { status: 400 });
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.length;
      if (size > MAX_BYTES) {
        void reader.cancel().catch(() => undefined);
        return Response.json({ error: "áudio grande demais" }, { status: 413 });
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  const audio = Buffer.concat(chunks, size);
  if (audio.byteLength < 1200) {
    return Response.json({ error: "áudio vazio" }, { status: 400 });
  }
  if (audio.byteLength > MAX_BYTES) {
    return Response.json({ error: "áudio grande demais" }, { status: 413 });
  }

  const type = (request.headers.get("content-type") || "audio/webm").toLowerCase();
  const extension = type.includes("wav")
    ? "wav"
    : type.includes("mpeg") || type.includes("mp3")
      ? "mp3"
      : type.includes("mp4") || type.includes("m4a") || type.includes("aac")
        ? "m4a"
        : "webm";
  await mkdir(DIR, { recursive: true });
  const file = path.join(DIR, `${randomUUID()}.${extension}`);
  await writeFile(file, audio);

  try {
    const started = performance.now();
    const result = await transcribe(file, request.signal);
    return Response.json({ ...result, ms: Math.round(performance.now() - started) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "falha ao transcrever" },
      { status: 500 },
    );
  } finally {
    await rm(file, { force: true }).catch(() => undefined);
  }
}
