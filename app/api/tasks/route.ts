import { cancelTask, listTasks, taskById } from "@/lib/automation/store";
import { automationEnabled, queueFileWatch, queueProjectCheck } from "@/lib/automation/tasks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const enabled = automationEnabled();
  if (!enabled) return Response.json({ enabled, tasks: [] });
  const id = new URL(request.url).searchParams.get("id");
  if (id) {
    const task = taskById(id);
    return task ? Response.json({ task }) : Response.json({ error: "Tarefa não encontrada." }, { status: 404 });
  }
  const tasks = listTasks().map((task) => ({
    ...task,
    hasOutput: task.results.some((result) => Boolean(result.output)),
    results: task.results.map(({ diagnostic, summary, ok }) => ({ diagnostic, summary, ok })),
  }));
  return Response.json({ enabled, tasks });
}

export async function POST(request: Request) {
  if (!automationEnabled()) return Response.json({ error: "Tarefas disponíveis no Jarvis local para Windows." }, { status: 503 });
  const input = await request.json().catch(() => null);
  try {
    if (input?.action === "cancel") {
      const id = String(input.id ?? "");
      if (!cancelTask(id)) return Response.json({ error: "A tarefa já terminou ou não existe." }, { status: 409 });
      return Response.json({ task: taskById(id) });
    }
    if (input?.action === "watch") {
      const task = queueFileWatch(String(input.file ?? "").trim(), input.openFolder === true);
      return Response.json({ task }, { status: 202 });
    }
    if (input?.action === "check") {
      const task = queueProjectCheck(String(input.project ?? ""), String(input.check ?? ""), input.openError === true);
      return Response.json({ task }, { status: 202 });
    }
    return Response.json({ error: "Ação inválida." }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Não foi possível criar a tarefa." }, { status: 400 });
  }
}
