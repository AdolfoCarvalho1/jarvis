import type { NextRequest } from "next/server";
import { storage } from "@/lib/db";
import { cancelTask } from "@/lib/automation/store";
import { automationEnabled, syncReminderTask } from "@/lib/automation/tasks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { done?: boolean };
  await storage.setReminderDone(id, body.done !== false);
  if (automationEnabled()) {
    if (body.done !== false) cancelTask(`reminder:${id}`);
    else {
      const reminder = (await storage.listReminders(true)).find((item) => item.id === id);
      if (reminder) syncReminderTask(reminder);
    }
  }
  return Response.json({ ok: true });
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  await storage.deleteReminder(id);
  if (automationEnabled()) cancelTask(`reminder:${id}`);
  return Response.json({ ok: true });
}
