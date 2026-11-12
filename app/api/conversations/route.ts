import type { NextRequest } from "next/server";
import { storage } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const conversations = await storage.listConversations();
  return Response.json({ conversations });
}

export async function POST(request: NextRequest) {
  let title = "Nova conversa";
  try {
    const body = (await request.json()) as { title?: string };
    if (body?.title) title = String(body.title);
  } catch {
    // corpo opcional
  }
  const conversation = await storage.createConversation(title);
  return Response.json({ conversation }, { status: 201 });
}
