import { storage } from "@/lib/db";
import { obsidianEnabled } from "@/lib/obsidian";
import { getContextState, getMainConversation, resetMainConversation } from "@/lib/session";
import { takeTurn, TurnBusy } from "@/lib/turn-lock";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const conversation = await getMainConversation();
  const params = new URL(request.url).searchParams;
  if (params.has("before") && params.get("conversation") !== conversation.id) {
    return Response.json({ error: "A conversa mudou. Atualize o histórico." }, { status: 409 });
  }
  const [{ summary }, messages] = await Promise.all([
    getContextState(conversation.id),
    storage.countMessages(conversation.id),
  ]);
  const before = params.has("before") ? Number(params.get("before")) : messages;
  if (!Number.isSafeInteger(before) || before < 0 || before > messages) {
    return Response.json({ error: "Posição inválida no histórico." }, { status: 400 });
  }
  const start = Math.max(0, before - 80);
  const history = before > start ? await storage.listMessageRange(conversation.id, start, before - start) : [];
  return Response.json({
    summary,
    chars: summary.length,
    messages,
    history: history.filter((item) => item.role === "user" || item.role === "assistant" || item.role === "tool"),
    conversationId: conversation.id,
    before: start || null,
    obsidian: obsidianEnabled(),
  });
}

export async function DELETE(request: Request) {
  try {
    const release = await takeTurn(request.signal);
    try {
      const conversation = await resetMainConversation();
      return Response.json({ ok: true, conversationId: conversation.id });
    } finally {
      release();
    }
  } catch (error) {
    if (error instanceof TurnBusy) return Response.json({ error: error.message }, { status: 409 });
    throw error;
  }
}
