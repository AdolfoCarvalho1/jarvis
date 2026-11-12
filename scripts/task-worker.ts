import { fileFingerprint, notifyDesktop, openCode, openDirectory, openFolder, runCheck } from "../lib/automation/actions.ts";
import { claimTask, finishStep, renewTask, waitTask, type ClaimedTask } from "../lib/automation/store.ts";
import type { StepResult } from "../lib/automation/types.ts";
import { runPcAction } from "../lib/pc.ts";

const lanes = new Map<boolean, AbortController>();
let closing = false;

function finish(task: ClaimedTask, result: StepResult, stop = false, cursor?: number) {
  const status = finishStep(task, result, stop, cursor);
  if ((status === "failed" || status === "succeeded") && process.env.JARVIS_TASK_NOTIFICATIONS !== "0") {
    const message = task.results.find((item) => !item.ok)?.summary ?? result.summary;
    void notifyDesktop(task.title, message).catch((error) => console.error("[Jarvis] aviso:", error.message));
  }
}

async function execute(task: ClaimedTask, signal: AbortSignal) {
  const step = task.steps[task.cursor];
  if (task.interrupted && !["watch-file", "remind", "verify-edit"].includes(step.action)) {
    finish(task, { ok: false, summary: "A execução foi interrompida pelo reinício. Execute a tarefa novamente." }, true);
    return;
  }

  switch (step.action) {
    case "check": {
      const result = await runCheck(task.project, step.check, signal);
      const openError = task.steps.findIndex((next, index) => index > task.cursor && next.action === "open-error");
      if (!result.ok && openError >= 0) finish(task, result, false, openError);
      else finish(task, result, !result.ok);
      return;
    }
    case "open-project":
      await openCode(task.project);
      finish(task, { ok: true, summary: "Solicitei a abertura do projeto no VS Code." });
      return;
    case "open-folder":
      await openDirectory(task.project);
      finish(task, { ok: true, summary: "Solicitei a abertura da pasta de trabalho." });
      return;
    case "open-app": {
      const result = await runPcAction("abrir", step.app, signal);
      finish(task, {
        ok: result.ok,
        summary: result.ok ? `Solicitei a abertura de ${step.app}.` : `Não consegui abrir ${step.app}.`,
        output: result.output,
      }, !result.ok);
      return;
    }
    case "open-error": {
      const failure = task.results.find((item) => !item.ok);
      if (failure?.diagnostic) {
        await openCode(task.project, failure.diagnostic);
        finish(task, { ok: true, summary: "Enviei o primeiro diagnóstico ao VS Code." });
      } else {
        finish(task, { ok: true, summary: failure ? "A saída está disponível no painel de tarefas." : "Nenhum erro encontrado." });
      }
      return;
    }
    case "watch-file": {
      const now = Date.now();
      if (now - task.createdAt > 4 * 60 * 60 * 1000) {
        finish(task, { ok: false, summary: "O arquivo não estabilizou dentro de quatro horas." }, true);
        return;
      }
      const fingerprint = fileFingerprint(step.file);
      const previous = task.observation;
      const changedAt = previous?.fingerprint === fingerprint ? previous.changedAt : now;
      if (!fingerprint || !changedAt || now - changedAt < 12_000) {
        waitTask(task, { fingerprint, changedAt });
        return;
      }
      if (step.openFolder) await openFolder(step.file);
      finish(task, { ok: true, summary: "O arquivo ficou 12 segundos sem alterações." });
      return;
    }
    case "remind":
      finish(task, { ok: true, summary: step.title });
      return;
    case "verify-edit":
      finish(task, { ok: false, summary: "A verificação automática foi substituída pela revisão de diffs." }, true);
      return;
  }
}

async function tick(timed: boolean) {
  if (closing || lanes.has(timed)) return;
  const task = claimTask(timed);
  if (!task) return;
  const controller = new AbortController();
  lanes.set(timed, controller);
  const heartbeat = setInterval(() => {
    try {
      if (!renewTask(task)) controller.abort();
    } catch (error) {
      console.error("[Jarvis] fila:", error);
    }
  }, 2500);
  try {
    await execute(task, controller.signal);
  } catch (error) {
    if (!controller.signal.aborted) {
      finish(task, { ok: false, summary: error instanceof Error ? error.message : "Falha na tarefa." }, true);
    }
  } finally {
    clearInterval(heartbeat);
    lanes.delete(timed);
    if (closing && !lanes.size) process.exit(0);
  }
}

function poll() {
  for (const timed of [false, true]) {
    void tick(timed).catch((error) => console.error("[Jarvis] fila:", error));
  }
}

const timer = setInterval(poll, 650);
poll();

function shutdown() {
  closing = true;
  clearInterval(timer);
  if (!lanes.size) process.exit(0);
  for (const controller of lanes.values()) controller.abort();
}

process.once("disconnect", shutdown);
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
