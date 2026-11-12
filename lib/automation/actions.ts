import { execFile, spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { Check, Diagnostic, StepResult } from "./types.ts";

const exec = promisify(execFile);
const root = process.cwd();
const skippedFolders = new Set(["node_modules", "dist", "build", "coverage"]);

export function resolveWorkspaceFolder(input?: string): string {
  const configuredRoot = realpathSync(/* turbopackIgnore: true */ process.env.JARVIS_WORKSPACE_ROOT || path.dirname(root));
  const project = !input?.trim() || /^jarvis$/i.test(input.trim())
    ? root
    : realpathSync(path.resolve(configuredRoot, input.trim()));
  const relative = path.relative(configuredRoot, project);
  if (project !== root && (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))) {
    throw new Error("Escolha um projeto dentro de JARVIS_WORKSPACE_ROOT.");
  }
  if (!statSync(project).isDirectory()) throw new Error("Escolha uma pasta de trabalho.");
  return project;
}

export function resolveProject(input?: string): string {
  const project = resolveWorkspaceFolder(input);
  if (!existsSync(path.join(project, "package.json"))) {
    throw new Error("A pasta selecionada não contém package.json.");
  }
  return project;
}

export function findProjectFiles(project: string, query: string): string[] {
  const term = query.trim().toLowerCase();
  if (!term) throw new Error("Informe parte do nome do arquivo.");
  const matches: string[] = [];
  const folders = [project];
  for (let index = 0; index < folders.length && index < 450 && matches.length < 30; index++) {
    const folder = folders[index];
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || skippedFolders.has(entry.name)) continue;
      const file = path.join(folder, entry.name);
      if (entry.isDirectory()) folders.push(file);
      else if (entry.isFile() && entry.name.toLowerCase().includes(term)) matches.push(path.relative(project, file));
      if (matches.length >= 30) break;
    }
  }
  return matches;
}

export function firstDiagnostic(output: string, project: string): Diagnostic | undefined {
  const clean = output.replace(/\x1b\[[0-9;]*m/g, "");
  let heading = "";
  for (const raw of clean.split(/\r?\n/)) {
    const line = raw.trim();
    const direct = /^(?:[>→]\s*)?(.+?\.[\w]+):([1-9]\d*)(?::([1-9]\d*))?(?:\s+(.*))?$/.exec(line);
    const typescript = /^(.+?\.[\w]+)\((\d+),(\d+)\):\s*(.*)$/.exec(line);
    const lint = /^(\d+):(\d+)\s+error\s+(.*)$/.exec(line);
    if (/^(?:[A-Za-z]:[\\/]|\.\.?[\\/]).+\.[\w]+$/.test(line)) heading = line;
    const location = direct || typescript;
    if (!location && !(heading && lint)) continue;
    const file = path.resolve(project, location ? location[1] : heading);
    if (!existsSync(file) || !statSync(file).isFile()) continue;
    return {
      file,
      line: Number(location ? location[2] : lint![1]),
      column: Number((location ? location[3] : lint![2]) || 1),
      message: (location ? location[4] : lint![3]) || "",
    };
  }
}

export async function runCheck(project: string, check: Check, signal: AbortSignal): Promise<StepResult> {
  const manifest = JSON.parse(readFileSync(path.join(project, "package.json"), "utf8")) as {
    scripts?: Partial<Record<Check, string>>;
  };
  if (!manifest.scripts?.[check]) return { ok: false, summary: `O projeto não tem o script npm ${check}.` };

  const env = { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" };
  if (project === root && check === "build") Object.assign(env, { JARVIS_CHECK_DIST_DIR: "1" });

  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const windows = process.platform === "win32";
    const child = spawn(
      /* turbopackIgnore: true */ windows ? process.env.ComSpec || "cmd.exe" : "npm",
      windows ? ["/d", "/s", "/c", `npm run ${check}`] : ["run", check],
      { cwd: project, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
    );
    let head = "";
    let tail = "";
    let timedOut = false;
    const collect = (chunk: Buffer) => {
      const content = chunk.toString();
      head = (head + content).slice(0, 9000);
      tail = (tail + content).slice(-9000);
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    const terminate = () => {
      if (windows && child.pid) {
        void exec("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true }).catch(() => child.kill());
      } else child.kill();
    };
    const timer = setTimeout(() => {
      timedOut = true;
      terminate();
    }, 300_000);
    signal.addEventListener("abort", terminate, { once: true });
    child.once("error", reject);
    child.once("close", (code) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", terminate);
      if (signal.aborted) return reject(signal.reason);
      const ok = code === 0 && !timedOut;
      const output = head === tail ? head : `${head}\n…\n${tail}`;
      const diagnostic = ok ? undefined : firstDiagnostic(output, project);
      const summary = timedOut ? `${check} excedeu cinco minutos.`
        : ok ? `${check} passou.`
        : diagnostic ? `${check} falhou em ${path.relative(project, diagnostic.file)}:${diagnostic.line}.`
        : `${check} falhou com código ${code ?? "indisponível"}.`;
      resolve({ ok, summary, diagnostic, output });
    });
  });
}

function codeExecutable() {
  const locations = [
    process.env.JARVIS_CODE_PATH,
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Programs", "Microsoft VS Code", "Code.exe"),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, "Microsoft VS Code", "Code.exe"),
  ];
  const code = locations.find((item): item is string => Boolean(item && existsSync(item)));
  if (!code) throw new Error("VS Code não encontrado. Configure JARVIS_CODE_PATH com o caminho de Code.exe.");
  return code;
}

export function openCode(project: string, diagnostic?: Diagnostic): Promise<void> {
  const args = diagnostic
    ? ["--reuse-window", "--goto", `${diagnostic.file}:${diagnostic.line}:${diagnostic.column}`]
    : [project];
  return launch(codeExecutable(), args);
}

function launch(executable: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { detached: true, stdio: "ignore" });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

export function openFolder(file: string): Promise<void> {
  return openDirectory(path.dirname(file));
}

export function openDirectory(folder: string): Promise<void> {
  return launch("explorer.exe", [folder]);
}

export function fileFingerprint(file: string): string | null {
  const stat = statSync(file, { throwIfNoEntry: false });
  if (stat && !stat.isFile()) throw new Error("Informe o caminho de um arquivo, incluindo a extensão.");
  return stat ? `${stat.size}:${stat.mtimeMs}` : null;
}

export function notifyDesktop(title: string, message: string): Promise<void> {
  const payload = Buffer.from(JSON.stringify({ title, message }), "utf8").toString("base64");
  return exec("powershell.exe", [
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    path.join(root, "scripts", "task-notification.ps1"), payload,
  ], { windowsHide: true, timeout: 12_000 }).then(() => undefined);
}
