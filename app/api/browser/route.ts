import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { executeMcpTool } from "@/lib/mcp";

export const dynamic = "force-dynamic";

/**
 * Ponte entre o painel do harness e o Playwright MCP.
 * O screenshot fica em .data/browser (fora do git) porque o servidor MCP roda
 * com `--image-responses omit`: a imagem vem por arquivo, não por base64.
 */

const SHOT_NAME = ".data/browser/harness.png";
const SHOT_PATH = path.join(process.cwd(), SHOT_NAME);

const globalState = globalThis as unknown as {
  __jarvisBrowser?: { url: string; title: string; shotAt: number; lastError: string };
};
const state = (globalState.__jarvisBrowser ??= { url: "", title: "", shotAt: 0, lastError: "" });

function titleFrom(text: string): string {
  const match = text.match(/Page Title:\s*(.+)/i);
  return match ? match[1].trim().slice(0, 160) : "";
}

async function capture(): Promise<void> {
  const result = await executeMcpTool("mcp__navegador__browser_take_screenshot", {
    filename: SHOT_NAME,
    type: "png",
  });
  if (/error/i.test(result) && !result.includes(".png")) state.lastError = result.slice(0, 300);
  state.shotAt = Date.now();
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (url.searchParams.has("shot")) {
    try {
      const bytes = await fs.readFile(SHOT_PATH);
      return new NextResponse(new Uint8Array(bytes), {
        headers: { "content-type": "image/png", "cache-control": "no-store" },
      });
    } catch {
      return new NextResponse("sem captura", { status: 404 });
    }
  }
  let shotAt = state.shotAt;
  if (!shotAt) {
    try {
      const info = await fs.stat(SHOT_PATH);
      shotAt = info.mtimeMs;
    } catch {
      /* sem captura */
    }
  }
  return NextResponse.json({ ...state, shotAt, shotUrl: `/api/browser?shot=1&t=${shotAt}` });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { acao?: string; url?: string } | null;
  const acao = String(body?.acao ?? "atualizar");
  try {
    if (acao === "navegar") {
      const alvo = String(body?.url ?? "").trim();
      if (!/^https?:\/\//i.test(alvo)) {
        return NextResponse.json({ error: "use uma URL http(s)" }, { status: 400 });
      }
      const texto = await executeMcpTool("mcp__navegador__browser_navigate", { url: alvo });
      state.url = alvo;
      state.title = titleFrom(texto);
      state.lastError = "";
    } else if (acao === "voltar") {
      const texto = await executeMcpTool("mcp__navegador__browser_navigate_back", {});
      const next = texto.match(/Page URL:\s*(\S+)/i);
      if (next) state.url = next[1];
      state.title = titleFrom(texto) || state.title;
    }
    await capture();
    return NextResponse.json({ ok: true, ...state, shotUrl: `/api/browser?shot=1&t=${state.shotAt}` });
  } catch (error) {
    const message = error instanceof Error ? error.message : "falha no navegador";
    state.lastError = message;
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
