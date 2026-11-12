import { deleteRoutine, listRoutines, taskById } from "@/lib/automation/store";
import { automationEnabled, queueRoutine, storeRoutine } from "@/lib/automation/tasks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ routines: automationEnabled() ? listRoutines() : [] });
}

export async function POST(request: Request) {
  if (!automationEnabled()) return Response.json({ error: "Rotinas disponíveis no Jarvis local para Windows." }, { status: 503 });
  const input = await request.json().catch(() => null);
  const name = String(input?.name ?? "");
  try {
    switch (input?.action) {
      case "save":
        return Response.json({ routine: storeRoutine(name, input.steps, taskById(String(input.taskId ?? ""))?.steps) });
      case "run":
        return Response.json({ task: queueRoutine(name, String(input.project ?? "")) }, { status: 202 });
      case "delete":
        return Response.json({ ok: deleteRoutine(name) });
      default:
        return Response.json({ error: "Ação inválida." }, { status: 400 });
    }
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Não foi possível alterar a rotina." }, { status: 400 });
  }
}
