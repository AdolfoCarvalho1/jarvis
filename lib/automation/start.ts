import { fork, type ChildProcess } from "node:child_process";
import path from "node:path";
import { storage } from "../db";
import { automationEnabled, syncReminderTask } from "./tasks";

const workerState = globalThis as typeof globalThis & { jarvisTaskWorker?: ChildProcess };

export function startTaskWorker() {
  if (!automationEnabled() || workerState.jarvisTaskWorker) return;
  const worker = fork(/* turbopackIgnore: true */ path.join(process.cwd(), "scripts", "task-worker.ts"), [], {
    execArgv: [],
    windowsHide: true,
    stdio: ["ignore", "inherit", "inherit", "ipc"],
  });
  workerState.jarvisTaskWorker = worker;
  worker.on("error", (error) => console.error("[Jarvis] processo de tarefas:", error.message));
  worker.on("close", () => {
    delete workerState.jarvisTaskWorker;
    setTimeout(startTaskWorker, 5000).unref();
  });

  void storage.listReminders(true).then((reminders) => {
    for (const reminder of reminders) {
      if (reminder.due_at && Date.parse(reminder.due_at) >= Date.now()) syncReminderTask(reminder);
    }
  }).catch((error) => console.error("[Jarvis] lembretes:", error));
}
