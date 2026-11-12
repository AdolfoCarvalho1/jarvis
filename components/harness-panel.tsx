"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Tab = "navegador" | "arquivos" | "skills" | "mcp";

interface BrowserState {
  url: string;
  title: string;
  shotAt: number;
  error?: string;
}

interface FileEntry {
  caminho: string;
  tamanho: number;
}

interface SkillEntry {
  slug: string;
  description: string;
  quando: string[];
  bytes: number;
  invalid?: string;
}

interface McpServer {
  name: string;
  state: string;
  error: string;
  approval: boolean;
  enabled: boolean;
  tools: Array<{ name: string; exposed: string }>;
}

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "navegador", label: "navegador" },
  { id: "arquivos", label: "arquivos" },
  { id: "skills", label: "skills" },
  { id: "mcp", label: "mcp" },
];

async function post<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(data?.error ?? `HTTP ${response.status}`);
  return data;
}

export function HarnessPanel() {
  const [tab, setTab] = useState<Tab>("navegador");
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside className={`hpanel ${collapsed ? "is-collapsed" : ""}`} data-panel="harness">
      <div className="hpanel-tabs">
        <button type="button" className="hpanel-collapse" onClick={() => setCollapsed((value) => !value)} title={collapsed ? "Abrir painel" : "Recolher painel"}>
          {collapsed ? "‹" : "›"}
        </button>
        {!collapsed &&
          TABS.map((item) => (
            <button key={item.id} type="button" className={tab === item.id ? "is-on" : ""} onClick={() => setTab(item.id)}>
              {item.label}
            </button>
          ))}
      </div>
      {!collapsed && (
        <div className="hpanel-body">
          {tab === "navegador" && <BrowserTab />}
          {tab === "arquivos" && <FilesTab />}
          {tab === "skills" && <SkillsTab />}
          {tab === "mcp" && <McpTab />}
        </div>
      )}
      <style>{CSS}</style>
    </aside>
  );
}

function BrowserTab() {
  const [browser, setBrowser] = useState<BrowserState>({ url: "", title: "", shotAt: 0 });
  const [url, setUrl] = useState("https://example.com");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    void fetch("/api/browser")
      .then((response) => response.json())
      .then((data: BrowserState) => {
        setBrowser(data);
        if (data.url) setUrl(data.url);
      })
      .catch(() => undefined);
  }, []);

  const act = useCallback(
    async (acao: "navegar" | "voltar" | "atualizar") => {
      setBusy(acao);
      setError("");
      try {
        const data = await post<BrowserState>(`/api/browser`, { acao, url });
        setBrowser(data);
        if (data.url) setUrl(data.url);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "falha");
      } finally {
        setBusy("");
      }
    },
    [url],
  );

  return (
    <div className="hp-tab">
      <div className="hp-row">
        <input value={url} onChange={(event) => setUrl(event.target.value)} onKeyDown={(event) => event.key === "Enter" && act("navegar")} placeholder="https://…" spellCheck={false} />
        <button type="button" onClick={() => act("navegar")} disabled={busy !== ""}>
          {busy === "navegar" ? "…" : "ir"}
        </button>
      </div>
      <div className="hp-row hp-row-actions">
        <button type="button" onClick={() => act("voltar")} disabled={busy !== ""}>voltar</button>
        <button type="button" onClick={() => act("atualizar")} disabled={busy !== ""}>capturar</button>
      </div>
      <p className="hp-meta">{browser.title || "sem página"}{browser.url ? ` · ${browser.url}` : ""}</p>
      {error ? <p className="hp-error">{error}</p> : null}
      <div className="hp-shot">
        {browser.shotAt ? (
          <a href={`/api/browser?shot=1&t=${browser.shotAt}`} target="_blank" rel="noreferrer" title="Abrir a captura em tamanho real">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/browser?shot=1&t=${browser.shotAt}`} alt="captura da página" />
          </a>
        ) : (
          <span>sem captura ainda</span>
        )}
      </div>
    </div>
  );
}

function FilesTab() {
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [selected, setSelected] = useState("");
  const [content, setContent] = useState("");
  const [hash, setHash] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement | null>(null);

  const loadTree = useCallback(async () => {
    const data = (await fetch("/api/files").then((response) => response.json())) as { arquivos?: FileEntry[] };
    setFiles(data.arquivos ?? []);
  }, []);

  useEffect(() => {
    void loadTree().catch(() => undefined);
  }, [loadTree]);

  const open = useCallback(async (caminho: string) => {
    setSelected(caminho);
    setStatus("abrindo…");
    try {
      const data = (await fetch(`/api/files?caminho=${encodeURIComponent(caminho)}`).then((response) => response.json())) as {
        conteudo?: string;
        hash?: string;
        error?: string;
      };
      if (data.error) throw new Error(data.error);
      setContent(data.conteudo ?? "");
      setHash(data.hash ?? "");
      setStatus("");
      areaRef.current?.focus();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "falha");
    }
  }, []);

  const save = useCallback(async () => {
    setBusy(true);
    setStatus("gravando…");
    try {
      const data = await post<{ linhasAntes: number; linhasDepois: number; backup: string }>("/api/files", {
        caminho: selected,
        conteudo: content,
        hashBase: hash,
      });
      setStatus(`gravado · ${data.linhasAntes} → ${data.linhasDepois} linhas · backup ${data.backup.split("/").slice(-2).join("/")}`);
      await open(selected);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "falha");
    } finally {
      setBusy(false);
    }
  }, [content, hash, open, selected]);

  return (
    <div className="hp-tab hp-split">
      <ul className="hp-list">
        {files.map((file) => (
          <li key={file.caminho}>
            <button type="button" className={selected === file.caminho ? "is-on" : ""} onClick={() => void open(file.caminho)}>
              <span>{file.caminho}</span>
              <em>{Math.round(file.tamanho / 1024)}k</em>
            </button>
          </li>
        ))}
      </ul>
      <div className="hp-editor">
        <div className="hp-row">
          <strong>{selected || "escolha um arquivo"}</strong>
          <button type="button" onClick={() => void save()} disabled={!selected || busy}>salvar</button>
        </div>
        <textarea ref={areaRef} value={content} onChange={(event) => setContent(event.target.value)} spellCheck={false} disabled={!selected} />
        {status ? <p className="hp-meta">{status}</p> : null}
      </div>
    </div>
  );
}

function SkillsTab() {
  const [skills, setSkills] = useState<SkillEntry[]>([]);
  const [body, setBody] = useState("");
  const [name, setName] = useState("");

  useEffect(() => {
    void fetch("/api/skills")
      .then((response) => response.json())
      .then((data: { skills?: SkillEntry[] }) => setSkills(data.skills ?? []))
      .catch(() => undefined);
  }, []);

  const open = useCallback(async (slug: string) => {
    setName(slug);
    setBody("carregando…");
    const data = (await fetch(`/api/skills?nome=${encodeURIComponent(slug)}`).then((response) => response.json())) as {
      body?: string;
      corpo?: string;
      error?: string;
    };
    setBody(data.body ?? data.corpo ?? data.error ?? "");
  }, []);

  return (
    <div className="hp-tab hp-split">
      <ul className="hp-list">
        {skills.map((skill) => (
          <li key={skill.slug}>
            <button type="button" className={name === skill.slug ? "is-on" : ""} onClick={() => void open(skill.slug)}>
              <span>{skill.slug}{skill.invalid ? " ⚠" : ""}</span>
              <em>{Math.round(skill.bytes / 1024)}k</em>
            </button>
            <small>{skill.description}</small>
          </li>
        ))}
        {!skills.length ? <li className="hp-empty">nenhuma skill</li> : null}
      </ul>
      <div className="hp-editor">
        <strong>{name || "escolha uma skill"}</strong>
        <pre>{body}</pre>
      </div>
    </div>
  );
}

function McpTab() {
  const [servers, setServers] = useState<McpServer[]>([]);
  const [status, setStatus] = useState("carregando…");
  const [envFor, setEnvFor] = useState("");
  const [envText, setEnvText] = useState("");

  const load = useCallback(async () => {
    const data = (await fetch("/api/mcp").then((response) => response.json())) as { servers?: McpServer[] };
    setServers(data.servers ?? []);
    setStatus("");
  }, []);

  useEffect(() => {
    void load().catch(() => undefined);
  }, [load]);

  const reload = useCallback(async () => {
    setStatus("recarregando…");
    try {
      const data = await post<{ servers?: McpServer[] }>("/api/mcp", { acao: "recarregar" });
      setServers(data.servers ?? []);
      setStatus("ok");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "falha");
    }
  }, []);

  const patch = useCallback(
    async (nome: string, mudanca: { enabled?: boolean; approval?: boolean; env?: Record<string, string> | null }) => {
      setStatus("aplicando…");
      try {
        const data = await post<{ servers?: McpServer[] }>("/api/mcp", { acao: "servidor", nome, patch: mudanca });
        setServers(data.servers ?? []);
        setStatus("ok");
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "falha");
      }
    },
    [],
  );

  const saveEnv = useCallback(
    async (nome: string) => {
      let parsed: Record<string, string>;
      try {
        parsed = envText.trim() ? (JSON.parse(envText) as Record<string, string>) : {};
      } catch {
        setStatus("JSON de env inválido");
        return;
      }
      await patch(nome, { env: parsed });
      setEnvFor("");
      setEnvText("");
    },
    [envText, patch],
  );

  return (
    <div className="hp-tab">
      <div className="hp-row">
        <button type="button" onClick={() => void reload()}>recarregar</button>
        <span className="hp-meta">{status}</span>
      </div>
      <ul className="hp-servers">
        {servers.map((server) => (
          <li key={server.name}>
            <div>
              <strong>{server.name}</strong>
              <em className={server.state === "ready" ? "ok" : "bad"}>{server.enabled ? server.state : "off"}</em>
            </div>
            <small>{server.tools.length} ferramentas · aprovação {server.approval ? "sim" : "não"}</small>
            {server.error ? <p className="hp-error">{server.error}</p> : null}
            <div className="hp-mcp-actions">
              <button type="button" onClick={() => void patch(server.name, { enabled: !server.enabled })}>
                {server.enabled ? "desligar" : "ligar"}
              </button>
              <button type="button" onClick={() => void patch(server.name, { approval: !server.approval })}>
                aprovação {server.approval ? "on" : "off"}
              </button>
              <button type="button" onClick={() => { setEnvFor(envFor === server.name ? "" : server.name); setEnvText(""); }}>
                env
              </button>
            </div>
            {envFor === server.name ? (
              <div className="hp-env">
                <textarea
                  value={envText}
                  onChange={(event) => setEnvText(event.target.value)}
                  placeholder={'{"CHAVE":"valor"} — substitui todo o env'}
                  spellCheck={false}
                />
                <button type="button" onClick={() => void saveEnv(server.name)}>salvar env</button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

const CSS = `
  .hpanel {
    width: 380px; flex: 0 0 380px; display: flex; flex-direction: column; min-height: 0;
    background: rgba(5,14,20,.97); border-left: 1px solid rgba(72,178,214,.18);
    font-family: var(--font-geist-sans), system-ui, sans-serif; color: #d8eef7;
  }
  .hpanel.is-collapsed { width: 30px; flex-basis: 30px; }
  .hpanel-tabs { display: flex; gap: 4px; align-items: center; padding: 6px 8px; border-bottom: 1px solid rgba(72,178,214,.14); }
  .hpanel-tabs button {
    cursor: pointer; border: 1px solid rgba(72,178,214,.2); background: rgba(12,36,48,.7); color: #9dc4d4;
    border-radius: 7px; padding: 3px 8px; font: 10px/1.4 var(--font-geist-mono), ui-monospace, monospace; letter-spacing: .08em;
  }
  .hpanel-tabs button.is-on { color: #eafaff; border-color: rgba(96,216,255,.55); background: rgba(22,70,92,.9); }
  .hpanel-collapse { width: 22px; padding: 3px 0 !important; }
  .hpanel-body { flex: 1; min-height: 0; display: flex; }
  .hp-tab { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 8px; padding: 10px; overflow: hidden; }
  .hp-row { display: flex; gap: 6px; align-items: center; }
  .hp-row input, .hp-editor textarea {
    flex: 1; min-width: 0; border-radius: 8px; border: 1px solid rgba(72,178,214,.22);
    background: rgba(3,12,18,.9); color: #e4f6ff; padding: 6px 8px; font: 11px/1.4 var(--font-geist-mono), ui-monospace, monospace;
  }
  .hp-row button {
    cursor: pointer; border-radius: 8px; padding: 5px 10px; border: 1px solid rgba(72,178,214,.25);
    background: rgba(18,54,72,.9); color: #cdeffb; font-size: 11px;
  }
  .hp-row button:disabled { opacity: .45; cursor: default; }
  .hp-row-actions button { flex: 1; }
  .hp-meta { margin: 0; font: 10px/1.4 var(--font-geist-mono), ui-monospace, monospace; color: #7ea6b6; word-break: break-all; }
  .hp-error { margin: 0; font-size: 10.5px; color: #ff9d8d; }
  .hp-shot { flex: 1; min-height: 120px; border-radius: 10px; border: 1px solid rgba(72,178,214,.18); background: #040a0f; display: grid; place-items: center; overflow: auto; }
  .hp-shot img { max-width: 100%; display: block; }
  .hp-shot span { font-size: 10.5px; color: #5f8b9c; }
  .hp-split { flex-direction: row; gap: 8px; }
  .hp-list { flex: 0 0 130px; margin: 0; padding: 0 4px 0 0; list-style: none; overflow-y: auto; }
  .hp-list li { margin-bottom: 4px; }
  .hp-list button {
    width: 100%; display: flex; justify-content: space-between; gap: 4px; cursor: pointer;
    border: 1px solid transparent; border-radius: 6px; background: transparent; color: #b9dce9;
    font: 10px/1.3 var(--font-geist-mono), ui-monospace, monospace; padding: 3px 4px; text-align: left;
  }
  .hp-list button span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .hp-list button em { color: #567f90; font-style: normal; flex: 0 0 auto; }
  .hp-list button.is-on { background: rgba(22,70,92,.7); border-color: rgba(96,216,255,.35); color: #eafaff; }
  .hp-list small { display: block; font-size: 9px; color: #5f8b9c; padding: 0 4px 4px; }
  .hp-empty { font-size: 10px; color: #5f8b9c; }
  .hp-editor { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
  .hp-editor strong { font-size: 10.5px; color: #a8d4e2; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .hp-editor textarea { flex: 1; resize: none; font-size: 10.5px; line-height: 1.5; }
  .hp-editor pre { flex: 1; overflow: auto; margin: 0; font: 10px/1.5 var(--font-geist-mono), ui-monospace, monospace; color: #c7e6f2; white-space: pre-wrap; }
  .hp-servers { margin: 0; padding: 0; list-style: none; overflow-y: auto; display: grid; gap: 6px; }
  .hp-servers li { border: 1px solid rgba(72,178,214,.16); border-radius: 8px; padding: 7px 8px; background: rgba(8,24,32,.6); }
  .hp-servers div { display: flex; justify-content: space-between; align-items: center; }
  .hp-servers strong { font-size: 11px; }
  .hp-servers em { font: 9px/1 var(--font-geist-mono), ui-monospace, monospace; font-style: normal; letter-spacing: .1em; }
  .hp-servers em.ok { color: #6fe0a8; }
  .hp-servers em.bad { color: #ff8f7d; }
  .hp-servers small { font-size: 9.5px; color: #6d97a8; }
  .hp-mcp-actions { display: flex; gap: 4px; margin-top: 6px; flex-wrap: wrap; }
  .hp-mcp-actions button {
    flex: 1 1 auto; cursor: pointer; border-radius: 6px; padding: 3px 6px; font-size: 9.5px;
    border: 1px solid rgba(72,178,214,.22); background: rgba(12,36,48,.8); color: #b9dce9;
  }
  .hp-mcp-actions button:hover { background: rgba(22,70,92,.9); color: #eafaff; }
  .hp-env { display: grid; gap: 4px; margin-top: 6px; }
  .hp-env textarea {
    min-height: 52px; resize: vertical; border-radius: 6px; padding: 5px;
    border: 1px solid rgba(72,178,214,.22); background: rgba(3,12,18,.9); color: #dff2fa;
    font: 9.5px/1.4 var(--font-geist-mono), ui-monospace, monospace;
  }
  .hp-env button {
    justify-self: end; cursor: pointer; border-radius: 6px; padding: 3px 8px; font-size: 9.5px;
    border: 1px solid rgba(72,178,214,.25); background: rgba(18,54,72,.9); color: #cdeffb;
  }
`;
