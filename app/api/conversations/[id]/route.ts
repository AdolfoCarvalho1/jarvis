import type { NextRequest } from "next/server";
import { storage } from "@/lib/db";
import { getMainConversation } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  const conversation = await storage.getConversation(id);
  if (!conversation) return Response.json({ error: "conversa não encontrada" }, { status: 404 });
  const messages = await storage.listMessages(id, 400);
  return Response.json({ conversation, messages });
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { title?: string };
  if (!body.title?.trim()) return Response.json({ error: "título vazio" }, { status: 400 });
  await storage.renameConversation(id, body.title);
  return Response.json({ ok: true });
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  if ((await getMainConversation()).id === id) {
    return Response.json({ error: "Use Nova sessão para reiniciar a conversa principal." }, { status: 409 });
  }
  await storage.deleteConversation(id);
  return Response.json({ ok: true });
}
