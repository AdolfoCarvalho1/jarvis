import type { NextRequest } from "next/server";
import { storage } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const memories = await storage.listMemories();
  return Response.json({ memories });
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as { content?: string };
  const content = String(body.content ?? "").trim();
  if (!content) return Response.json({ error: "conteúdo obrigatório" }, { status: 400 });
  const memory = await storage.addMemory(content);
  return Response.json({ memory }, { status: 201 });
}
