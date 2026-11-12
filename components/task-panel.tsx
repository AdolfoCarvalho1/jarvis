"use client";

import { useCallback, useEffect, useState } from "react";
import { checks, type Check, type Routine, type Task, type TaskStatus, type TaskStep } from "@/lib/automation/types";

const statusLabels: Record<TaskStatus, string> = {
  queued: "Na fila",
  running: "Em execução",
  waiting: "Aguardando",
  succeeded: "Concluída",
  failed: "Falhou",
  cancelled: "Cancelada",
};

function formatStep(step: TaskStep): string {
  if (step.action === "check") return step.check;
  if (step.action === "open-project") return "abrir projeto";
  if (step.action === "open-error") return "abrir erro";
  if (step.action === "open-folder") return "abrir pasta";
  if (step.action === "open-app") return `abrir app ${step.app}`;
  return "";
}

function parseSteps(text: string): unknown[] {
  return text.split("\n").map((line) => line.trim().toLowerCase()).filter(Boolean).map((step) => {
    if (step === "abrir projeto") return { action: "open-project" };
    if (step === "abrir erro") return { action: "open-error" };
    if (step === "abrir pasta") return { action: "open-folder" };
    if (step.startsWith("abrir app ")) return { action: "open-app", app: step.slice("abrir app ".length).trim() };
    return { action: "check", check: step };
  });
}

export function TaskPanel() {
  const [tasks, setTasks] = useState<Array<Task & { hasOutput: boolean }>>([]);
  const [outputs, setOutputs] = useState<Record<string, string[]>>({});
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [project, setProject] = useState("");
  const [check, setCheck] = useState<Check>("build");
  const [file, setFile] = useState("");
  const [draft, setDraft] = useState<{ name: string; steps: string } | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    const options: RequestInit = { cache: "no-store", signal };
    const [tasksResponse, routinesResponse] = await Promise.all([
      fetch("/api/tasks", options),
      fetch("/api/routines", options),
    ]);
    if (!tasksResponse.ok || !routinesResponse.ok) throw new Error("Não consegui carregar as tarefas.");
    const [jobs, saved] = await Promise.all([tasksResponse.json(), routinesResponse.json()]);
    if (!signal?.aborted) {
      setTasks(jobs.tasks);
      setEnabled(jobs.enabled);
      setRoutines(saved.routines);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const refresh = () => {
      void load(controller.signal).catch((failure) => {
        if (!controller.signal.aborted) setError(failure.message);
      });
    };
    refresh();
    const interval = window.setInterval(refresh, 2500);
    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, [load]);

  async function send(route: "tasks" | "routines", body: object): Promise<boolean> {
    setError("");
    setSaving(true);
    try {
      const response = await fetch(`/api/${route}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error ?? "Não consegui completar a ação.");
      }
      await load();
      return true;
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Não consegui completar a ação.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  function edit(steps: TaskStep[], name = "") {
    setDraft({ name, steps: steps.map(formatStep).filter(Boolean).join("\n") });
  }

  async function loadOutput(task: Task) {
    const key = `${task.id}:${task.results.length}`;
    if (outputs[key]) return;
    try {
      const response = await fetch(`/api/tasks?id=${encodeURIComponent(task.id)}`, { cache: "no-store" });
      if (!response.ok) throw new Error();
      const result = await response.json() as { task: Task };
      setOutputs((previous) => ({ ...previous, [key]: result.task.results.flatMap((step) => step.output ? [step.output] : []) }));
    } catch {
      setError("Não consegui carregar a saída da execução.");
    }
  }

  return (
    <section className="task-panel">
      {error ? <p className="hint" role="alert">{error}</p> : null}
      {enabled === null ? <p className="hint">Carregando tarefas…</p> : null}
      {enabled === false ? <p className="hint">Tarefas disponíveis no Jarvis local para Windows.</p> : null}
      {enabled ? <>
        <form className="task-form" onSubmit={(event) => {
          event.preventDefault();
          void send("tasks", { action: "check", project, check, openError: true });
        }}>
          <label>Projeto<input value={project} onChange={(event) => setProject(event.target.value)} placeholder="Jarvis" /></label>
          <label>Checagem<select value={check} onChange={(event) => setCheck(event.target.value as Check)}>
            {checks.map((value) => <option key={value}>{value}</option>)}
          </select></label>
          <button type="submit" disabled={saving}>Executar e abrir erro</button>
        </form>
        <form className="task-form" onSubmit={async (event) => {
          event.preventDefault();
          if (await send("tasks", { action: "watch", file, openFolder: false })) setFile("");
        }}>
          <label>Arquivo para acompanhar<input required value={file} onChange={(event) => setFile(event.target.value)} placeholder={"C:\\Vídeos\\exportação.mp4"} /></label>
          <button type="submit" disabled={saving}>Acompanhar arquivo</button>
        </form>

        <h3>Execuções</h3>
        {tasks.length === 0 ? <p className="hint">Nenhuma tarefa executada.</p> : null}
        {tasks.map((task) => {
          const active = ["queued", "running", "waiting"].includes(task.status);
          const canSave = task.steps.every((step) => Boolean(formatStep(step)));
          return <article className="task-item" key={task.id}>
            <strong>{task.title}</strong>
            <p>{statusLabels[task.status]}{task.summary ? ` · ${task.summary}` : ""}</p>
            {task.hasOutput ? <details onToggle={(event) => {
              if (event.currentTarget.open) void loadOutput(task);
            }}>
              <summary>Saída da execução</summary>
              {(outputs[`${task.id}:${task.results.length}`] ?? []).map((output, index) => <pre key={index}>{output}</pre>)}
            </details> : null}
            {active ? <button disabled={saving} onClick={() => void send("tasks", { action: "cancel", id: task.id })}>Cancelar</button> : null}
            {!active && canSave ? <button onClick={() => edit(task.steps)}>Salvar como rotina</button> : null}
          </article>;
        })}

        <div className="task-heading"><h3>Rotinas</h3><button onClick={() => edit([{ action: "check", check: "build" }, { action: "open-error" }])}>Nova</button></div>
        {draft ? <form className="task-form" onSubmit={async (event) => {
          event.preventDefault();
          if (await send("routines", { action: "save", name: draft.name, steps: parseSteps(draft.steps) })) setDraft(null);
        }}>
          <label>Nome<input required maxLength={80} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
          <label>Passos, um por linha<textarea required rows={4} value={draft.steps} onChange={(event) => setDraft({ ...draft, steps: event.target.value })} /></label>
          <p className="hint">abrir projeto, build, lint, test, abrir erro, abrir pasta ou abrir app spotify</p>
          <button type="submit" disabled={saving}>Salvar</button>
          <button type="button" onClick={() => setDraft(null)}>Fechar edição</button>
        </form> : null}
        {routines.map((routine) => <article className="task-item" key={routine.name}>
          <strong>{routine.name}</strong>
          <p>{routine.steps.map(formatStep).join(" → ")}</p>
          <button disabled={saving} onClick={() => void send("routines", { action: "run", name: routine.name, project })}>Executar</button>
          <button onClick={() => edit(routine.steps, routine.name)}>Editar</button>
          <button disabled={saving} onClick={() => void send("routines", { action: "delete", name: routine.name })}>Apagar</button>
        </article>)}
      </> : null}
    </section>
  );
}
