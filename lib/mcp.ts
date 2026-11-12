import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import type { ToolDefinition } from "./tools";

/**
 * Cliente MCP (Model Context Protocol) via stdio.
 *
 * Cada servidor é um processo local descrito em `.data/mcp.json`:
 *   { "servers": { "nome": { "command": "npx", "args": [...], "env": {}, "approval": true } } }
 *
 * As ferramentas aparecem no chat como `mcp__<servidor>__<ferramenta>`.
 * Por padrão toda ferramenta MCP pede aprovação; `"approval": false`
 * libera servidores de leitura (ex.: navegador em modo somente leitura).
 */

interface ServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  approval?: boolean;
  enabled?: boolean;
}

interface McpConfig {
  servers: Record<string, ServerConfig>;
}

interface McpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

type ServerState = "starting" | "ready" | "error" | "stopped";

interface ServerRuntime {
  name: string;
  config: ServerConfig;
  child: ChildProcessWithoutNullStreams | null;
  state: ServerState;
  error: string;
  tools: McpTool[];
  pending: Map<number, { resolve: (value: unknown) => void; reject: (reason: Error) => void; timer: NodeJS.Timeout }>;
  nextId: number;
}

const CONFIG_PATH = path.join(process.cwd(), ".data", "mcp.json");
const INIT_TIMEOUT = 45_000;
const CALL_TIMEOUT = 120_000;

function readConfig(): McpConfig {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw) as McpConfig;
    if (parsed && typeof parsed === "object" && parsed.servers) return parsed;
  } catch {
    /* sem config = sem servidores */
  }
  return { servers: {} };
}

function safeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
}

function toolName(server: string, tool: string): string {
  return `mcp__${safeName(server)}__${safeName(tool)}`.slice(0, 64);
}

class McpServer {
  readonly runtime: ServerRuntime;

  constructor(name: string, config: ServerConfig) {
    this.runtime = { name, config, child: null, state: "starting", error: "", tools: [], pending: new Map(), nextId: 0 };
  }

  private request(method: string, params: Record<string, unknown>, timeout: number): Promise<unknown> {
    const { child, pending } = this.runtime;
    if (!child) return Promise.reject(new Error("servidor não iniciado"));
    const id = ++this.runtime.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`${method} sem resposta em ${Math.round(timeout / 1000)}s`));
      }, timeout);
      pending.set(id, { resolve, reject, timer });
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }

  private notify(method: string, params: Record<string, unknown> = {}) {
    this.runtime.child?.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  }

  async start(): Promise<void> {
    const { config, name } = this.runtime;
    if (this.runtime.child) return;
    if (!config.command) {
      this.runtime.state = "error";
      this.runtime.error = "command ausente";
      return;
    }

    const child = spawn(config.command, config.args ?? [], {
      cwd: config.cwd ? path.resolve(process.cwd(), config.cwd) : process.cwd(),
      env: { ...process.env, ...config.env },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      shell: process.platform === "win32",
    }) as ChildProcessWithoutNullStreams;
    this.runtime.child = child;

    child.on("error", (error) => {
      this.runtime.state = "error";
      this.runtime.error = error.message;
    });
    child.on("exit", (code) => {
      if (this.runtime.state !== "stopped") {
        this.runtime.state = code === 0 ? "stopped" : "error";
        if (code !== 0) this.runtime.error = `processo saiu com código ${code}`;
      }
      for (const [, entry] of this.runtime.pending) {
        clearTimeout(entry.timer);
        entry.reject(new Error("servidor encerrou"));
      }
      this.runtime.pending.clear();
      this.runtime.child = null;
    });

    readline.createInterface({ input: child.stdout }).on("line", (line) => {
      const text = line.trim();
      if (!text) return;
      let message: { id?: number; result?: unknown; error?: { message?: string } };
      try {
        message = JSON.parse(text);
      } catch {
        return;
      }
      if (typeof message.id !== "number") return;
      const entry = this.runtime.pending.get(message.id);
      if (!entry) return;
      this.runtime.pending.delete(message.id);
      clearTimeout(entry.timer);
      if (message.error) entry.reject(new Error(message.error.message ?? "erro MCP"));
      else entry.resolve(message.result);
    });

    readline.createInterface({ input: child.stderr }).on("line", (line) => {
      if (line.trim()) this.runtime.error = line.trim().slice(0, 300);
    });

    await this.request(
      "initialize",
      {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "jarvis", version: "0.1.0" },
      },
      INIT_TIMEOUT,
    );
    this.notify("notifications/initialized");

    const listed = (await this.request("tools/list", {}, INIT_TIMEOUT)) as { tools?: McpTool[] };
    this.runtime.tools = Array.isArray(listed?.tools) ? listed.tools : [];
    this.runtime.state = "ready";
    this.runtime.error = "";
    console.log(`[mcp] ${name} pronto: ${this.runtime.tools.length} ferramenta(s)`);
  }

  async call(tool: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
    if (this.runtime.state !== "ready") throw new Error(`servidor ${this.runtime.name} não está pronto`);
    if (signal?.aborted) throw new Error("cancelado");
    const result = (await this.request("tools/call", { name: tool, arguments: args }, CALL_TIMEOUT)) as {
      content?: Array<{ type?: string; text?: string }>;
      isError?: boolean;
      structuredContent?: unknown;
    };
    const parts = (result?.content ?? [])
      .map((item) => (item?.type === "text" ? item.text ?? "" : `[${item?.type ?? "conteudo"}]`))
      .filter(Boolean);
    const text = parts.length ? parts.join("\n") : JSON.stringify(result ?? {});
    if (result?.isError) return JSON.stringify({ error: text.slice(0, 2000) });
    return text.slice(0, 60_000);
  }

  stop() {
    this.runtime.state = "stopped";
    for (const [, entry] of this.runtime.pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error("servidor encerrado"));
    }
    this.runtime.pending.clear();
    this.runtime.child?.kill();
    this.runtime.child = null;
  }
}

interface McpStore {
  servers: Map<string, McpServer>;
  starting: Promise<void> | null;
}

const globalStore = globalThis as unknown as { __jarvisMcp?: McpStore };
const store: McpStore = (globalStore.__jarvisMcp ??= { servers: new Map(), starting: null });

function enabledServers(): Array<[string, ServerConfig]> {
  return Object.entries(readConfig().servers).filter(([, config]) => config.enabled !== false);
}

async function ensureStarted(): Promise<void> {
  const wanted = enabledServers();
  for (const [name, config] of wanted) {
    if (!store.servers.has(name)) store.servers.set(name, new McpServer(name, config));
  }
  for (const name of [...store.servers.keys()]) {
    if (!wanted.some(([item]) => item === name)) {
      store.servers.get(name)?.stop();
      store.servers.delete(name);
    }
  }
  if (store.starting) return store.starting;
  store.starting = (async () => {
    await Promise.all(
      [...store.servers.values()].map(async (server) => {
        if (server.runtime.state === "ready" || server.runtime.child) return;
        try {
          await server.start();
        } catch (error) {
          server.runtime.state = "error";
          server.runtime.error = error instanceof Error ? error.message : "falha ao iniciar";
          console.error(`[mcp] ${server.runtime.name}: ${server.runtime.error}`);
        }
      }),
    );
  })().finally(() => {
    store.starting = null;
  });
  return store.starting;
}

export async function mcpToolDefinitions(): Promise<ToolDefinition[]> {
  try {
    await ensureStarted();
  } catch {
    /* servidores indisponíveis não derrubam o chat */
  }
  const definitions: ToolDefinition[] = [];
  for (const server of store.servers.values()) {
    if (server.runtime.state !== "ready") continue;
    for (const tool of server.runtime.tools) {
      definitions.push({
        type: "function",
        function: {
          name: toolName(server.runtime.name, tool.name),
          description: `[MCP ${server.runtime.name}] ${tool.description ?? tool.name}`.slice(0, 900),
          parameters:
            tool.inputSchema && typeof tool.inputSchema === "object"
              ? (tool.inputSchema as Record<string, unknown>)
              : { type: "object", properties: {} },
        },
      });
    }
  }
  return definitions;
}

export function isMcpTool(name: string): boolean {
  return name.startsWith("mcp__");
}

export function mcpRequiresApproval(name: string): boolean {
  if (!isMcpTool(name)) return false;
  const [, serverName] = name.split("__");
  const config = readConfig().servers[Object.keys(readConfig().servers).find((key) => safeName(key) === serverName) ?? ""];
  return config?.approval !== false;
}

export async function executeMcpTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
  if (!isMcpTool(name)) return JSON.stringify({ error: "ferramenta MCP inválida" });
  await ensureStarted();
  const [rawServer, rawTool] = name.split("__").slice(1);
  const entry = [...store.servers.entries()].find(([key]) => safeName(key) === rawServer);
  if (!entry) return JSON.stringify({ error: `servidor MCP "${rawServer}" não encontrado` });
  const [, server] = entry;
  const tool = server.runtime.tools.find((item) => safeName(item.name) === rawTool);
  if (!tool) return JSON.stringify({ error: `ferramenta "${rawTool}" não existe em ${server.runtime.name}` });
  try {
    return await server.call(tool.name, args, signal);
  } catch (error) {
    return JSON.stringify({ error: error instanceof Error ? error.message : "falha ao chamar MCP" });
  }
}

export interface McpStatus {
  config: string;
  servers: Array<{
    name: string;
    state: ServerState;
    error: string;
    approval: boolean;
    enabled: boolean;
    tools: Array<{ name: string; description: string; exposed: string }>;
  }>;
}

export async function mcpStatus(): Promise<McpStatus> {
  await ensureStarted();
  return {
    config: CONFIG_PATH,
    servers: [...store.servers.values()].map((server) => ({
      name: server.runtime.name,
      state: server.runtime.state,
      error: server.runtime.error,
      approval: server.runtime.config.approval !== false,
      enabled: server.runtime.config.enabled !== false,
      tools: server.runtime.tools.map((tool) => ({
        name: tool.name,
        description: (tool.description ?? "").slice(0, 400),
        exposed: toolName(server.runtime.name, tool.name),
      })),
    })),
  };
}

/** Liga/desliga, alterna aprovação ou substitui o env de um servidor no .data/mcp.json. */
export async function updateMcpServer(
  name: string,
  patch: { enabled?: boolean; approval?: boolean; env?: Record<string, string> | null },
): Promise<McpStatus> {
  const cfg = readConfig();
  const key = Object.keys(cfg.servers).find((item) => safeName(item) === safeName(name));
  if (!key) throw new Error(`servidor "${name}" não está na configuração`);

  const next: ServerConfig = { ...cfg.servers[key] };
  if (typeof patch.enabled === "boolean") next.enabled = patch.enabled;
  if (typeof patch.approval === "boolean") next.approval = patch.approval;
  if (patch.env !== undefined) next.env = patch.env ?? {};

  cfg.servers[key] = next;
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(cfg, null, 2)}\n`, "utf8");

  const existing = store.servers.get(safeName(key)) ?? store.servers.get(key);
  existing?.stop();
  store.servers.delete(key);
  store.servers.delete(safeName(key));
  return mcpStatus();
}

export async function reloadMcp(): Promise<McpStatus> {
  for (const server of store.servers.values()) server.stop();
  store.servers.clear();
  store.starting = null;
  return mcpStatus();
}
