import type { NextRequest } from "next/server";
import { storage } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ id: string }>;
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  await storage.deleteMemory(id);
  return Response.json({ ok: true });
}
