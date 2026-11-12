import type { NextRequest } from "next/server";
import { storage } from "@/lib/db";
import { syncReminderTask } from "@/lib/automation/tasks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const onlyPending = request.nextUrl.searchParams.get("pending") === "1";
  const reminders = await storage.listReminders(onlyPending);
  return Response.json({ reminders });
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as { title?: string; due_at?: string | null };
  const title = String(body.title ?? "").trim();
  if (!title) return Response.json({ error: "título obrigatório" }, { status: 400 });
  const due = body.due_at ? new Date(body.due_at) : null;
  const reminder = await storage.addReminder(title, due && !Number.isNaN(due.getTime()) ? due.toISOString() : null);
  syncReminderTask(reminder);
  return Response.json({ reminder }, { status: 201 });
}
