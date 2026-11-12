import path from "node:path";
import type { Reminder } from "../types";
import { fileFingerprint, resolveProject, resolveWorkspaceFolder } from "./actions";
import { cancelTask, enqueue, getRoutine, requeueCancelledReminder, saveRoutine } from "./store";
import { checks, readRoutineSteps, type Check, type TaskStep } from "./types";

export function automationEnabled() {
  return process.platform === "win32" && !process.env.VERCEL && process.env.JARVIS_TASKS !== "0";
}

export function queueProjectCheck(projectInput: string, check: string, openError: boolean, openProject = false) {
  if (!checks.includes(check as Check)) throw new Error("Escolha build, lint ou test.");
  const project = resolveProject(projectInput);
  const steps: TaskStep[] = [{ action: "check", check: check as Check }];
  if (openProject) steps.unshift({ action: "open-project" });
  if (openError) steps.push({ action: "open-error" });
  return enqueue(`${check} · ${path.basename(project)}`, project, steps);
}

export function queueFileWatch(input: string, openFolder: boolean) {
  if (!path.isAbsolute(input) || input.startsWith("\\\\")) {
    throw new Error("Informe o caminho absoluto de um arquivo local.");
  }
  const file = path.resolve(input);
  const fingerprint = fileFingerprint(file);
  return enqueue(`Acompanhar ${path.basename(file)}`, "", [{ action: "watch-file", file, openFolder }], {
    observation: { fingerprint, changedAt: 0 },
  });
}

export function queueRoutine(name: string, projectInput: string) {
  const routine = getRoutine(name);
  if (!routine) throw new Error("Rotina não encontrada.");
  const project = routine.steps.some((step) => step.action === "check") ? resolveProject(projectInput) : resolveWorkspaceFolder(projectInput);
  return enqueue(routine.name, project, routine.steps);
}

export function storeRoutine(name: string, value: unknown, source?: TaskStep[]) {
  return saveRoutine(name, readRoutineSteps(value ?? source));
}

export function syncReminderTask(reminder: Reminder) {
  if (!automationEnabled()) return;
  const id = `reminder:${reminder.id}`;
  if (reminder.done || !reminder.due_at) {
    cancelTask(id);
    return;
  }
  const at = Date.parse(reminder.due_at);
  if (!Number.isFinite(at)) return;
  enqueue(reminder.title, "", [{ action: "remind", title: reminder.title }], { id, at });
  requeueCancelledReminder(id, at);
}
