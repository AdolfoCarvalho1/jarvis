import type { NextRequest } from "next/server";
import { storage, storageName } from "@/lib/db";
import { modelExists } from "@/lib/models";
import { obsidianEnabled } from "@/lib/obsidian";
import { getActiveModel, setActiveModel } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const [model, summary] = await Promise.all([
    getActiveModel(),
    storage.getSetting("context_summary"),
  ]);
  return Response.json({
    model,
    storage: storageName,
    obsidian: obsidianEnabled(),
    contextChars: summary?.length ?? 0,
  });
}

export async function PATCH(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as { model?: string };
  const model = String(body.model ?? "").trim();
  if (!model) return Response.json({ error: "modelo obrigatório" }, { status: 400 });
  if (!(await modelExists(model))) {
    return Response.json({ error: `modelo indisponível: ${model}` }, { status: 400 });
  }
  await setActiveModel(model);
  return Response.json({ ok: true, model });
}
