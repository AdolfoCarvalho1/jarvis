import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { captureScreen, runPcAction } from "@/lib/pc";

export const dynamic = "force-dynamic";

/**
 * Painel de tela do harness.
 * GET ?shot=1 devolve a última captura; POST captura de novo ou dispara um
 * comando de PC da whitelist do scripts/pc.ps1.
 */

const FILE = path.join(process.cwd(), ".data", "screens", "painel.png");
const CONTROL = new Set(["volume-up", "volume-down", "mute", "play-pause", "proxima", "anterior", "bloquear"]);

const globalState = globalThis as unknown as { __jarvisScreen?: { at: number; error: string } };
const state = (globalState.__jarvisScreen ??= { at: 0, error: "" });

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (url.searchParams.has("shot")) {
    try {
      const bytes = await fs.readFile(FILE);
      return new NextResponse(new Uint8Array(bytes), {
        headers: { "content-type": "image/png", "cache-control": "no-store" },
      });
    } catch {
      return new NextResponse("sem captura", { status: 404 });
    }
  }
  let at = state.at;
  if (!at) {
    try {
      at = (await fs.stat(FILE)).mtimeMs;
    } catch {
      /* ainda sem captura */
    }
  }
  return NextResponse.json({ at, error: state.error, shotUrl: `/api/screen?shot=1&t=${at}` });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { acao?: string; comando?: string } | null;
  const acao = String(body?.acao ?? "capturar");

  if (acao === "capturar") {
    try {
      const shot = await captureScreen(AbortSignal.timeout(40_000));
      await fs.mkdir(path.dirname(FILE), { recursive: true });
      await fs.writeFile(FILE, Buffer.from(shot.base64, "base64"));
      state.at = Date.now();
      state.error = "";
      return NextResponse.json({ ok: true, at: state.at, origem: shot.path, shotUrl: `/api/screen?shot=1&t=${state.at}` });
    } catch (error) {
      state.error = error instanceof Error ? error.message : "falha ao capturar";
      return NextResponse.json({ error: state.error }, { status: 500 });
    }
  }

  if (acao === "controle") {
    const comando = String(body?.comando ?? "").trim().toLowerCase();
    if (!CONTROL.has(comando)) {
      return NextResponse.json({ error: `comando não permitido: ${comando}` }, { status: 400 });
    }
    const result = await runPcAction(comando, "", AbortSignal.timeout(40_000));
    return NextResponse.json({ ok: result.ok, saida: result.output.slice(0, 400) }, { status: result.ok ? 200 : 500 });
  }

  return NextResponse.json({ error: "ação desconhecida" }, { status: 400 });
}
