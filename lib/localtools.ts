import { spawn } from "node:child_process";
import path from "node:path";

/**
 * Ferramentas locais (Python/Rust) chamadas fora do modelo.
 *
 * O runner é `scripts/tools/runner.py`; cada ferramenta é um arquivo que expõe
 * NAME/DESCRIPTION/PARAMETERS/run. A saída é JSON. Isso dá ao Jarvis rotinas
 * exatas (disco, porta, git, contas) sem gastar tokens nem alucinar números.
 */

const RUNNER = path.join(process.cwd(), "scripts", "tools", "runner.py");
const TIMEOUT_MS = 30_000;
const MAX_OUTPUT = 60_000;

function pythonCandidates(): string[] {
  const custom = process.env.JARVIS_PYTHON?.trim();
  return custom ? [custom] : process.platform === "win32" ? ["python", "py"] : ["python3", "python"];
}

interface RunResult {
  stdout: string;
  stderr: string;
  code: number;
}

function runPython(command: string, args: string[]): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill(), TIMEOUT_MS);

    child.stdout.on("data", (chunk: Buffer) => {
      if (stdout.length < MAX_OUTPUT) stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < MAX_OUTPUT) stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code: code ?? 1 });
    });
  });
}

async function callRunner(extra: string[]): Promise<RunResult> {
  let lastError: unknown = null;
  for (const python of pythonCandidates()) {
    try {
      return await runPython(python, [RUNNER, ...extra]);
    } catch (error) {
      lastError = error;
      if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") throw error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Python não encontrado");
}

export interface LocalToolInfo {
  nome: string;
  descricao: string;
  parametros: Record<string, unknown>;
}

export async function listLocalTools(): Promise<LocalToolInfo[]> {
  const result = await callRunner(["list"]);
  if (result.code !== 0) throw new Error(result.stderr.trim() || "runner falhou");
  const parsed = JSON.parse(result.stdout) as { ferramentas?: LocalToolInfo[] };
  return parsed.ferramentas ?? [];
}

export async function runLocalTool(nome: string, argumentos: Record<string, unknown>): Promise<string> {
  if (!/^[a-z0-9][a-z0-9_-]{1,40}$/i.test(nome)) {
    return JSON.stringify({ ok: false, erro: "nome de ferramenta inválido" });
  }
  const result = await callRunner(["run", nome, "--json", JSON.stringify(argumentos ?? {})]);
  const text = (result.stdout || result.stderr || "").trim();
  if (!text) return JSON.stringify({ ok: false, erro: `ferramenta ${nome} não respondeu` });
  return text.slice(0, MAX_OUTPUT);
}
