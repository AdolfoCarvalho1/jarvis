export const checks = ["build", "lint", "test"] as const;
export type Check = (typeof checks)[number];
export const apps = ["chrome", "edge", "spotify", "notepad", "explorer", "vscode", "calc", "whatsapp", "telegram"] as const;
export type App = (typeof apps)[number];

export type TaskStep =
  | { action: "check"; check: Check }
  | { action: "open-project" }
  | { action: "open-error" }
  | { action: "open-app"; app: App }
  | { action: "open-folder" }
  | { action: "watch-file"; file: string; openFolder: boolean }
  | { action: "verify-edit"; backup: string }
  | { action: "remind"; title: string };

export type TaskStatus = "queued" | "running" | "waiting" | "succeeded" | "failed" | "cancelled";

export interface Diagnostic {
  file: string;
  line: number;
  column: number;
  message: string;
}

export interface StepResult {
  summary: string;
  ok: boolean;
  diagnostic?: Diagnostic;
  output?: string;
}

export interface Task {
  id: string;
  title: string;
  project: string;
  status: TaskStatus;
  steps: TaskStep[];
  results: StepResult[];
  cursor: number;
  summary: string;
  createdAt: number;
  updatedAt: number;
}

export interface Routine {
  name: string;
  steps: TaskStep[];
}

export function readRoutineSteps(value: unknown): TaskStep[] {
  if (!Array.isArray(value) || !value.length || value.length > 8) {
    throw new Error("Uma rotina precisa de 1 a 8 passos.");
  }

  return value.map((step: unknown): TaskStep => {
    if (!step || typeof step !== "object" || !("action" in step)) {
      throw new Error("Passo de rotina inválido.");
    }
    switch (step.action) {
      case "check":
        if ("check" in step && checks.includes(step.check as Check)) {
          return { action: "check", check: step.check as Check };
        }
        break;
      case "open-project":
      case "open-error":
      case "open-folder":
        return { action: step.action };
      case "open-app":
        if ("app" in step && apps.includes(step.app as App)) {
          return { action: "open-app", app: step.app as App };
        }
        break;
    }
    throw new Error("Use build, lint, test, abrir projeto, abrir erro, abrir pasta ou abrir app <nome>.");
  });
}
