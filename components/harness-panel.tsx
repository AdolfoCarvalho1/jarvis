"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";

type Tab = "inicio" | "navegador" | "tela" | "arquivos" | "skills" | "mcp" | "atividade";

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

interface HarnessEvent {
  id: string;
  type: string;
  payload?: unknown;
  created_at?: string | null;
}

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "inicio", label: "INÍCIO" },
  { id: "navegador", label: "NAVEGADOR" },
  { id: "tela", label: "TELA" },
  { id: "arquivos", label: "ARQUIVOS" },
  { id: "skills", label: "SKILLS" },
  { id: "mcp", label: "MCP" },
  { id: "atividade", label: "ATIVIDADE" },
];

const eventClock = new Intl.DateTimeFormat("pt-BR", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
  timeZone: "America/Sao_Paulo",
});

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

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function clip(value: string, max = 120): string {
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function stamp(event: HarnessEvent): number {
  const value = event.created_at ? Date.parse(event.created_at) : Number.NaN;
  return Number.isNaN(value) ? 0 : value;
}

function describeEvent(event: HarnessEvent): { kind: string; detail: string } {
  const payload = asRecord(event.payload);
  switch (event.type) {
    case "turn/start":
      return { kind: "turno", detail: asText(payload.model) || "iniciado" };
    case "user/message": {
      const chars = asText(payload.chars);
      return { kind: "pedido", detail: chars ? `${chars} chars` : "" };
    }
    case "model/request": {
      const round = asText(payload.round);
      const tokens = asText(payload.tokens);
      const usage = tokens
        ? `${tokens} tokens`
        : [asText(payload.promptTokens ?? payload.prompt_tokens), asText(payload.completionTokens ?? payload.completion_tokens)]
            .filter(Boolean)
            .join(" + ");
      return { kind: "modelo", detail: [round ? `${round}ª rodada` : "", usage].filter(Boolean).join(" · ") };
    }
    case "tool/call": {
      const name = clip(asText(payload.name) || "ferramenta", 40);
      const args = payload.args ?? payload.arguments ?? payload.input;
      let detail = "";
      if (typeof args === "string") detail = args;
      else if (args) {
        try {
          detail = JSON.stringify(args);
        } catch {
          detail = "";
        }
      }
      return { kind: "tool", detail: clip([name, detail].filter(Boolean).join(" · "), 120) };
    }
    case "tool/result": {
      const name = clip(asText(payload.name) || "ferramenta", 40);
      const status = asText(payload.status);
      const ms = asText(payload.ms);
      return { kind: "tool", detail: clip([name, status, ms ? `${ms} ms` : ""].filter(Boolean).join(" · "), 120) };
    }
    case "assistant/message": {
      const chars = asText(payload.chars);
      return { kind: "resposta", detail: chars ? `${chars} chars` : "" };
    }
    case "turn/end": {
      const ms = asText(payload.ms);
      return { kind: "turno", detail: ms ? `${ms} ms` : "concluído" };
    }
    case "turn/error":
      return { kind: "erro", detail: clip(asText(payload.message) || "falha no turno", 120) };
    default:
      return { kind: clip(event.type || "evento", 32), detail: "" };
  }
}

function failedEvent(event: HarnessEvent): boolean {
  if (event.type === "turn/error") return true;
  if (event.type !== "tool/result") return false;
  return /(error|erro|fail|falh)/i.test(asText(asRecord(event.payload).status));
}

export function HarnessPanel() {
  const [tab, setTab] = useState<Tab>("inicio");
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const open = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail;
      if (TABS.some((item) => item.id === detail)) setTab(detail as Tab);
    };
    window.addEventListener("jarvis:harness-tab", open);
    return () => window.removeEventListener("jarvis:harness-tab", open);
  }, []);

  const moveTab = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const index = TABS.findIndex((item) => item.id === tab);
      let next = index;
      if (event.key === "ArrowRight") next = (index + 1) % TABS.length;
      else if (event.key === "ArrowLeft") next = (index - 1 + TABS.length) % TABS.length;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = TABS.length - 1;
      else return;
      event.preventDefault();
      const target = TABS[next];
      setTab(target.id);
      document.getElementById(`hp-tab-${target.id}`)?.focus();
    },
    [tab],
  );

  return (
    <aside className={`hpanel ${collapsed ? "is-collapsed" : ""}`} data-panel="harness">
      <button
        type="button"
        className="hp-collapse"
        onClick={() => setCollapsed((value) => !value)}
        aria-expanded={!collapsed}
        aria-controls="hp-pane"
        aria-label={collapsed ? "Abrir painel" : "Recolher painel"}
        title={collapsed ? "Abrir painel" : "Recolher painel"}
      >
        {collapsed ? "‹" : "›"}
      </button>
      {!collapsed && (
        <>
          <div className="hp-tabs" role="tablist" aria-label="Ferramentas do harness" onKeyDown={moveTab}>
            {TABS.map((item) => (
              <button
                key={item.id}
                id={`hp-tab-${item.id}`}
                type="button"
                role="tab"
                aria-selected={tab === item.id}
                aria-controls="hp-pane"
                tabIndex={tab === item.id ? 0 : -1}
                className={tab === item.id ? "is-on" : ""}
                onClick={() => setTab(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="hp-body">
            <div className="hp-pane" id="hp-pane" role="tabpanel" aria-labelledby={`hp-tab-${tab}`}>
              {tab === "inicio" && <StartTab onOpen={setTab} />}
              {tab === "navegador" && <BrowserTab />}
              {tab === "tela" && <ScreenTab />}
              {tab === "arquivos" && <FilesTab />}
              {tab === "skills" && <SkillsTab />}
              {tab === "mcp" && <McpTab />}
              {tab === "atividade" && <ActivityTab />}
            </div>
          </div>
        </>
      )}
      <style>{CSS}</style>
    </aside>
  );
}

function StartTab({ onOpen }: { onOpen: (tab: Tab) => void }) {
  return (
    <div className="hp-tab hp-start">
      <h2 className="hp-start-title">Abrir</h2>
      <p className="hp-start-sub">Ferramentas desta sessão.</p>

      <div className="hp-start-list">
        <button type="button" className="hp-start-action" onClick={() => onOpen("arquivos")}>
          <span className="hp-start-glyph" aria-hidden="true">▤</span>
          <span className="hp-start-copy">
            <b>Arquivos</b>
            <small>Explorar o workspace desta sessão</small>
          </span>
          <span className="hp-start-arrow" aria-hidden="true">↗</span>
        </button>
        <button type="button" className="hp-start-action" onClick={() => onOpen("navegador")}>
          <span className="hp-start-glyph" aria-hidden="true">◌</span>
          <span className="hp-start-copy">
            <b>Navegador</b>
            <small>Abrir uma página e ver a captura</small>
          </span>
          <span className="hp-start-arrow" aria-hidden="true">↗</span>
        </button>
        <button type="button" className="hp-start-action" onClick={() => onOpen("atividade")}>
          <span className="hp-start-glyph" aria-hidden="true">⌁</span>
          <span className="hp-start-copy">
            <b>Atividade</b>
            <small>O que o JARVIS fez neste turno</small>
          </span>
          <span className="hp-start-arrow" aria-hidden="true">↗</span>
        </button>
      </div>
    </div>
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

  const scheme = /^http:\/\//i.test(url) ? "http://" : "https://";
  const address = url.replace(/^https?:\/\//i, "");
  const hasShot = Boolean(browser.shotAt && browser.title && browser.url);
  const shotTime = hasShot ? new Date(browser.shotAt).toLocaleTimeString("pt-BR") : "";

  return (
    <div className="hp-tab">
      <div className="hp-urlblock">
        <div className="hp-url">
          <span className="hp-proto" aria-hidden="true">
            {scheme}
          </span>
          <input
            value={address}
            onChange={(event) => {
              const value = event.target.value;
              setUrl(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `${scheme}${value}`);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") void act("navegar");
            }}
            placeholder="example.com"
            aria-label="Endereço"
            spellCheck={false}
          />
          <button type="button" className="hp-act" onClick={() => void act("navegar")} disabled={busy !== ""}>
            {busy === "navegar" ? "…" : "IR"}
          </button>
        </div>
        <div className="hp-actions">
          <button type="button" className="hp-act hp-act-muted" onClick={() => void act("voltar")} disabled={busy !== ""}>
            voltar
          </button>
          <button type="button" className="hp-act hp-act-muted" onClick={() => void act("atualizar")} disabled={busy !== ""}>
            capturar
          </button>
        </div>
      </div>

      {error || browser.error ? (
        <p className="hp-error" role="alert">
          {error || browser.error}
        </p>
      ) : null}

      <div className="hp-head">
        <span>viewport</span>
        {shotTime ? <b>{shotTime}</b> : null}
      </div>
      <div className={`hp-frame hp-frame-view ${hasShot ? "" : "is-empty"}`}>
        {hasShot ? (
          <a href={`/api/browser?shot=1&t=${browser.shotAt}`} target="_blank" rel="noreferrer" title="Abrir a captura em tamanho real">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/browser?shot=1&t=${browser.shotAt}`} alt="captura da página" />
          </a>
        ) : (
          <span className="hp-frame-empty">Nenhuma captura. Digite um endereço e use IR.</span>
        )}
      </div>

      {hasShot ? (
        <>
          <div className="hp-head">
            <span>página</span>
          </div>
          <ul className="hp-rows">
            <li className="hp-row">
              <span className="hp-row-key">título</span>
              <span className="hp-row-val"><b>{browser.title}</b></span>
            </li>
            <li className="hp-row">
              <span className="hp-row-key">endereço</span>
              <span className="hp-row-val">{browser.url}</span>
            </li>
          </ul>
        </>
      ) : null}
    </div>
  );
}

function ScreenTab() {
  const [state, setState] = useState<{ at: number; error?: string }>({ at: 0 });
  const [busy, setBusy] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => {
    void fetch("/api/screen")
      .then((response) => response.json())
      .then((data: { at: number; error?: string }) => setState(data))
      .catch(() => undefined);
  }, []);

  const capture = useCallback(async () => {
    setBusy("capturar");
    setStatus("capturando…");
    try {
      const data = await post<{ at: number }>("/api/screen", { acao: "capturar" });
      setState(data);
      setStatus("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "falha ao capturar");
    } finally {
      setBusy("");
    }
  }, []);

  const control = useCallback(async (comando: string) => {
    if (comando === "bloquear" && !window.confirm("Bloquear o PC agora?")) return;
    setBusy(comando);
    setStatus("");
    try {
      await post("/api/screen", { acao: "controle", comando });
      setStatus(`${comando} ok`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "falha no comando");
    } finally {
      setBusy("");
    }
  }, []);

  return (
    <div className="hp-tab">
      <div className="hp-head">
        <span>tela do pc</span>
        <span className="hp-head-right">
          {status || state.at ? <b>{status || new Date(state.at).toLocaleTimeString("pt-BR")}</b> : null}
          <button type="button" className="hp-act" onClick={() => void capture()} disabled={busy !== ""}>
            {busy === "capturar" ? "capturando…" : "capturar"}
          </button>
        </span>
      </div>

      {state.error ? (
        <p className="hp-error" role="alert">
          {state.error}
        </p>
      ) : null}

      <div className={`hp-frame hp-frame-img ${state.at ? "" : "is-empty"}`}>
        {state.at ? (
          <a href={`/api/screen?shot=1&t=${state.at}`} target="_blank" rel="noreferrer" title="Abrir em tamanho real">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/screen?shot=1&t=${state.at}`} alt="captura da tela do PC" />
          </a>
        ) : (
          <span className="hp-frame-empty">sem captura ainda</span>
        )}
      </div>

      <div className="hp-head">
        <span>controles</span>
        <b>whitelist</b>
      </div>
      <ul className="hp-rows">
        <li className="hp-row">
          <span className="hp-row-key">volume</span>
          <span className="hp-row-acts">
            <button type="button" onClick={() => void control("volume-down")} disabled={busy !== ""} aria-label="Abaixar volume">
              vol −
            </button>
            <button type="button" onClick={() => void control("mute")} disabled={busy !== ""} aria-label="Silenciar">
              mudo
            </button>
            <button type="button" onClick={() => void control("volume-up")} disabled={busy !== ""} aria-label="Aumentar volume">
              vol +
            </button>
          </span>
        </li>
        <li className="hp-row">
          <span className="hp-row-key">mídia</span>
          <span className="hp-row-acts">
            <button type="button" className="hp-glyph" onClick={() => void control("anterior")} disabled={busy !== ""} aria-label="Faixa anterior">
              ⏮
            </button>
            <button type="button" className="hp-glyph" onClick={() => void control("play-pause")} disabled={busy !== ""} aria-label="Tocar ou pausar">
              ⏯
            </button>
            <button type="button" className="hp-glyph" onClick={() => void control("proxima")} disabled={busy !== ""} aria-label="Próxima faixa">
              ⏭
            </button>
          </span>
        </li>
        <li className="hp-row">
          <span className="hp-row-key">sistema</span>
          <span className="hp-row-acts">
            <button type="button" className="hp-danger" onClick={() => void control("bloquear")} disabled={busy !== ""}>
              bloquear
            </button>
          </span>
        </li>
      </ul>
    </div>
  );
}

function FilesTab() {
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [selected, setSelected] = useState("");
  const [content, setContent] = useState("");
  const [hash, setHash] = useState("");
  const [status, setStatus] = useState("");
  const [treeError, setTreeError] = useState("");
  const [busy, setBusy] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement | null>(null);

  const loadTree = useCallback(async () => {
    try {
      const data = (await fetch("/api/files").then((response) => response.json())) as { arquivos?: FileEntry[]; error?: string };
      if (data.error) throw new Error(data.error);
      setFiles(data.arquivos ?? []);
      setTreeError("");
    } catch (failure) {
      setTreeError(failure instanceof Error ? failure.message : "falha ao listar arquivos");
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadTree().catch(() => undefined);
    }, 0);
    return () => window.clearTimeout(timer);
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
    <div className="hp-tab">
      <div className="hp-head">
        <span>workspace</span>
        <b>{files.length} arquivos</b>
      </div>

      {treeError ? (
        <p className="hp-error" role="alert">
          {treeError}
        </p>
      ) : null}

      <ul className="hp-list hp-files">
        {files.map((file) => (
          <li key={file.caminho}>
            <button
              type="button"
              className={`hp-file ${selected === file.caminho ? "is-on" : ""}`}
              onClick={() => void open(file.caminho)}
              aria-pressed={selected === file.caminho}
              title={file.caminho}
            >
              <span>{file.caminho}</span>
              <em>{Math.round(file.tamanho / 1024)}k</em>
            </button>
          </li>
        ))}
        {!files.length && !treeError ? <li className="hp-empty">nenhum arquivo</li> : null}
      </ul>

      <div className="hp-toolbar">
        <span className="hp-sel" title={selected || undefined}>
          {selected || "escolha um arquivo"}
        </span>
        <button type="button" className="hp-act" onClick={() => void save()} disabled={!selected || busy}>
          salvar
        </button>
      </div>
      <textarea
        ref={areaRef}
        className="hp-textarea"
        value={content}
        onChange={(event) => setContent(event.target.value)}
        spellCheck={false}
        disabled={!selected}
        aria-label="Conteúdo do arquivo"
        placeholder="selecione um arquivo para editar"
      />
      {status ? (
        <p className="hp-meta" role="status">
          {status}
        </p>
      ) : null}
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
    <div className="hp-tab">
      <div className="hp-head">
        <span>skills instaladas</span>
        <b>{skills.length}</b>
      </div>

      <ul className="hp-list hp-skills">
        {skills.map((skill) => (
          <li key={skill.slug}>
            <button
              type="button"
              className={`hp-skill ${name === skill.slug ? "is-on" : ""}`}
              onClick={() => void open(skill.slug)}
              aria-pressed={name === skill.slug}
              title={skill.invalid || skill.description}
            >
              <span className="hp-skill-top">
                <b>
                  {skill.slug}
                  {skill.invalid ? " ⚠" : ""}
                </b>
                <em>{Math.round(skill.bytes / 1024)}k</em>
              </span>
              <span className="hp-skill-desc">{skill.description}</span>
            </button>
          </li>
        ))}
        {!skills.length ? <li className="hp-empty">nenhuma skill</li> : null}
      </ul>

      <div className="hp-toolbar">
        <span className="hp-sel" title={name || undefined}>
          {name || "escolha uma skill"}
        </span>
        <span className="hp-meta">prévia</span>
      </div>
      <pre className="hp-pre">{body}</pre>
    </div>
  );
}

function McpTab() {
  const [servers, setServers] = useState<McpServer[]>([]);
  const [status, setStatus] = useState("carregando…");
  const [envFor, setEnvFor] = useState("");
  const [envText, setEnvText] = useState("");

  const load = useCallback(async () => {
    try {
      const data = (await fetch("/api/mcp").then((response) => response.json())) as { servers?: McpServer[] };
      setServers(data.servers ?? []);
      setStatus("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "falha ao carregar mcp");
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load().catch(() => undefined);
    }, 0);
    return () => window.clearTimeout(timer);
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
      <div className="hp-head">
        <span>servidores</span>
        <span className="hp-head-right">
          <b>{status || `${servers.length} configurados`}</b>
          <button type="button" className="hp-act" onClick={() => void reload()}>
            recarregar
          </button>
        </span>
      </div>

      <ul className="hp-list hp-servers">
        {servers.map((server) => (
          <li key={server.name} className="hp-server">
            <div className="hp-server-top">
              <strong>{server.name}</strong>
              <em className={server.state === "ready" && server.enabled ? "hp-state-ok" : "hp-state-bad"}>
                {server.enabled ? server.state : "off"}
              </em>
            </div>
            <p className="hp-server-meta">
              {server.tools.length} ferramentas · aprovação {server.approval ? "sim" : "não"}
            </p>
            {server.error ? (
              <p className="hp-error" role="alert">
                {server.error}
              </p>
            ) : null}
            <div className="hp-server-actions">
              <button type="button" onClick={() => void patch(server.name, { enabled: !server.enabled })}>
                {server.enabled ? "desligar" : "ligar"}
              </button>
              <button type="button" onClick={() => void patch(server.name, { approval: !server.approval })}>
                aprovação {server.approval ? "on" : "off"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setEnvFor(envFor === server.name ? "" : server.name);
                  setEnvText("");
                }}
              >
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
                  aria-label={`Variáveis de ambiente de ${server.name}`}
                />
                <button type="button" className="hp-act" onClick={() => void saveEnv(server.name)}>
                  salvar env
                </button>
              </div>
            ) : null}
          </li>
        ))}
        {!servers.length && !status ? <li className="hp-empty">nenhum servidor</li> : null}
      </ul>
    </div>
  );
}

function ActivityTab() {
  const [events, setEvents] = useState<HarnessEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const ticketRef = useRef(0);

  const load = useCallback(async () => {
    const ticket = ++ticketRef.current;
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/events?limit=60", { cache: "no-store" });
      if (!response.ok) {
        throw new Error(response.status === 404 ? "rota /api/events indisponível" : `falha ao carregar atividade (${response.status})`);
      }
      const data = (await response.json().catch(() => null)) as { events?: HarnessEvent[]; total?: number } | null;
      if (!data) throw new Error("resposta inválida de /api/events");
      if (ticket !== ticketRef.current) return;
      const list = Array.isArray(data.events) ? data.events.filter((event) => event && typeof event.type === "string") : [];
      const sorted = [...list].sort((a, b) => stamp(b) - stamp(a));
      setEvents(sorted);
      setTotal(typeof data.total === "number" ? data.total : sorted.length);
    } catch (failure) {
      if (ticket !== ticketRef.current) return;
      setError(failure instanceof Error ? failure.message : "falha ao carregar atividade");
    } finally {
      if (ticket === ticketRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => {
      window.clearTimeout(timer);
      ticketRef.current += 1;
    };
  }, [load]);

  const count = loading ? "carregando…" : total > events.length ? `${events.length} de ${total}` : `${events.length} eventos`;

  return (
    <div className="hp-tab" aria-busy={loading}>
      <div className="hp-head">
        <span>atividade</span>
        <span className="hp-head-right">
          <b>{count}</b>
          <button type="button" className="hp-act" onClick={() => void load()} disabled={loading}>
            atualizar
          </button>
        </span>
      </div>

      {error ? (
        <p className="hp-error" role="alert">
          {error}
        </p>
      ) : null}

      {!loading && !error && events.length === 0 ? <p className="hp-empty">nenhum evento ainda</p> : null}

      {events.length > 0 ? (
        <ol className="hp-events" aria-label="Eventos de atividade, mais recente primeiro">
          {events.map((event) => {
            const { kind, detail } = describeEvent(event);
            const at = event.created_at ? new Date(event.created_at) : null;
            const valid = at && !Number.isNaN(at.getTime()) ? at : null;
            return (
              <li key={event.id} className={`hp-event ${failedEvent(event) ? "is-bad" : ""}`}>
                <time dateTime={event.created_at ?? undefined}>{valid ? eventClock.format(valid) : "--:--:--"}</time>
                <span className="hp-event-kind">{kind}</span>
                <span className="hp-event-detail">{detail || "—"}</span>
              </li>
            );
          })}
        </ol>
      ) : null}
    </div>
  );
}

const CSS = `
  .hpanel {
    width: 360px; flex: 0 0 360px; min-height: 0;
    display: flex; flex-direction: column;
    padding: 0 18px 16px 22px;
    position: relative; overflow: hidden;
    background: transparent;
    color: var(--jv-text);
    font-family: var(--font-geist-sans), system-ui, sans-serif;
  }
  .hpanel.is-collapsed { width: 30px; flex-basis: 30px; padding: 0; }

  .hp-collapse {
    position: absolute; top: 0; right: 4px; z-index: 2;
    width: 20px; height: 20px; display: grid; place-items: center;
    border: 0; background: none; padding: 0; margin: 0;
    color: var(--jv-dim); cursor: pointer;
    font: 400 13px/1 var(--font-geist-mono), ui-monospace, monospace;
  }
  .hp-collapse:hover { color: var(--jv-text); }
  .hpanel.is-collapsed .hp-collapse { top: 10px; right: 5px; }

  .hp-tabs {
    display: grid; grid-template-columns: repeat(4, minmax(0, 1fr));
    column-gap: 10px; row-gap: 6px;
    padding: 22px 0 0;
  }
  .hp-tabs button {
    position: relative; border: 0; background: none; margin: 0;
    padding: 0 0 7px; text-align: left; cursor: pointer;
    color: var(--jv-dim);
    font: 600 10.5px/1 var(--font-geist-mono), ui-monospace, monospace;
    letter-spacing: .1em; text-transform: uppercase;
    transition: color .15s ease;
  }
  .hp-tabs button:hover { color: var(--jv-muted); }
  .hp-tabs button.is-on { color: var(--jv-accent); }
  .hp-tabs button.is-on::after {
    content: ""; position: absolute; left: 0; right: 0; bottom: 0;
    height: 1px; background: var(--jv-accent);
  }

  .hp-body { flex: 1; min-height: 0; display: flex; flex-direction: column; }
  .hp-pane { flex: 1; min-height: 0; display: flex; flex-direction: column; }
  .hp-tab {
    flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 12px;
    padding-top: 18px; overflow-y: auto; overflow-x: hidden;
    scrollbar-width: thin; scrollbar-color: var(--jv-line-strong) transparent;
  }

  /* início: três entradas grandes, sem cartões */
  .hp-start { gap: 0; }
  .hp-start-kicker {
    margin: 0; color: var(--jv-dim);
    font: 600 9.5px/1 var(--font-geist-mono), ui-monospace, monospace;
    letter-spacing: .2em; text-transform: uppercase;
  }
  .hp-start-title {
    margin: 9px 0 0; color: var(--jv-text);
    font: 600 21px/1.1 var(--font-geist-sans), system-ui, sans-serif;
    letter-spacing: -.035em;
  }
  .hp-start-sub { margin: 7px 0 0; color: var(--jv-muted); font-size: 12px; line-height: 1.45; }
  .hp-start-list { display: grid; margin-top: 22px; border-top: 1px solid var(--jv-line); }
  .hp-start-action {
    display: grid; grid-template-columns: 24px minmax(0, 1fr) 12px; gap: 11px;
    align-items: center; width: 100%; border: 0; border-bottom: 1px solid var(--jv-line);
    background: none; padding: 15px 0; text-align: left; cursor: pointer; color: inherit;
    transition: border-color .15s ease;
  }
  .hp-start-action:hover { border-bottom-color: var(--jv-line-strong); }
  .hp-start-glyph { color: var(--jv-accent); font-size: 15px; line-height: 1; text-align: center; }
  .hp-start-copy { display: grid; gap: 4px; min-width: 0; }
  .hp-start-copy b {
    color: var(--jv-text); font: 500 13px/1.25 var(--font-geist-sans), system-ui, sans-serif;
  }
  .hp-start-copy small { color: var(--jv-dim); font-size: 11px; line-height: 1.35; }
  .hp-start-arrow { color: var(--jv-dim); font-size: 12px; transition: color .15s ease, transform .15s ease; }
  .hp-start-action:hover .hp-start-arrow { color: var(--jv-accent); transform: translate(1px, -1px); }
  .hp-start-kicker-2 { margin-top: 25px; }
  .hp-start-links { display: flex; gap: 20px; margin-top: 13px; }
  .hp-start-links button {
    border: 0; background: none; padding: 0 0 5px; cursor: pointer;
    border-bottom: 1px solid var(--jv-line); color: var(--jv-muted);
    font: 500 11px/1 var(--font-geist-mono), ui-monospace, monospace; letter-spacing: .04em;
    transition: color .15s ease, border-color .15s ease;
  }
  .hp-start-links button:hover { color: var(--jv-accent); border-bottom-color: var(--jv-accent); }

  .hp-urlblock { display: grid; gap: 7px; }
  .hp-url {
    display: flex; align-items: baseline; gap: 8px;
    padding: 0 0 10px; border-bottom: 1px solid var(--jv-line);
  }
  .hp-proto {
    flex: 0 0 auto; color: var(--jv-dim);
    font: 500 10px/1 var(--font-geist-mono), ui-monospace, monospace;
    letter-spacing: .04em;
  }
  .hp-url input {
    flex: 1; min-width: 0; border: 0; outline: 0; background: none;
    padding: 2px 0; color: var(--jv-muted);
    font: 400 11px/1.5 var(--font-geist-mono), ui-monospace, monospace;
    caret-color: var(--jv-accent);
  }
  .hp-url input:focus { color: var(--jv-text); }
  .hp-url input::placeholder { color: var(--jv-dim); }

  .hp-actions { display: flex; align-items: center; gap: 18px; }

  .hp-act {
    display: inline-flex; align-items: center; min-height: 22px;
    border: 0; background: none; padding: 0; margin: 0; cursor: pointer;
    color: var(--jv-accent);
    font: 600 10px/1 var(--font-geist-mono), ui-monospace, monospace;
    letter-spacing: .1em; text-transform: uppercase;
    white-space: nowrap;
  }
  .hp-act:hover { color: var(--jv-accent-2); }
  .hp-act:disabled { color: var(--jv-dim); cursor: default; }
  .hp-act-muted { color: var(--jv-muted); font-weight: 500; }
  .hp-act-muted:hover { color: var(--jv-text); }

  .hp-meta {
    margin: 0; color: var(--jv-dim);
    font: 400 10px/1.5 var(--font-geist-mono), ui-monospace, monospace;
    overflow-wrap: anywhere;
  }
  .hp-error {
    margin: 0; color: var(--jv-danger);
    font: 400 10.5px/1.5 var(--font-geist-mono), ui-monospace, monospace;
    overflow-wrap: anywhere;
  }
  .hp-empty {
    margin: 0; padding: 10px 0; color: var(--jv-dim);
    font: 400 10px/1.5 var(--font-geist-mono), ui-monospace, monospace;
  }

  .hp-head {
    display: flex; align-items: baseline; justify-content: space-between; gap: 12px;
    padding-bottom: 7px; border-bottom: 1px solid var(--jv-line);
    color: var(--jv-dim); text-transform: uppercase;
    font: 600 10px/1.3 var(--font-geist-mono), ui-monospace, monospace;
    letter-spacing: .14em;
  }
  .hp-head b {
    min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    color: var(--jv-muted); font-weight: 500; letter-spacing: .06em;
  }
  .hp-head-right { display: flex; align-items: baseline; gap: 14px; min-width: 0; }

  .hp-rows { margin: 0; padding: 0; list-style: none; }
  .hp-row {
    display: grid; grid-template-columns: 64px minmax(0, 1fr);
    gap: 12px; align-items: baseline; padding: 9px 0;
  }
  .hp-row + .hp-row { border-top: 1px solid var(--jv-line); }
  .hp-row-key {
    color: var(--jv-dim); letter-spacing: .04em;
    font: 500 10px/1.5 var(--font-geist-mono), ui-monospace, monospace;
  }
  .hp-row-val {
    color: var(--jv-muted); overflow-wrap: anywhere;
    font: 400 10.5px/1.5 var(--font-geist-mono), ui-monospace, monospace;
  }
  .hp-row-val b { color: var(--jv-text); font-weight: 500; }
  .hp-row-acts { display: flex; flex-wrap: wrap; align-items: center; gap: 0 18px; }
  .hp-row-acts button {
    border: 0; background: none; padding: 0; margin: 0; min-height: 24px; cursor: pointer;
    color: var(--jv-muted);
    font: 500 10px/1 var(--font-geist-mono), ui-monospace, monospace;
    letter-spacing: .06em; text-transform: uppercase;
  }
  .hp-row-acts button:hover { color: var(--jv-text); }
  .hp-row-acts button:disabled { color: var(--jv-dim); cursor: default; }
  .hp-row-acts .hp-glyph { font-size: 12px; letter-spacing: 0; }
  .hp-row-acts button.hp-danger { color: var(--jv-danger); }
  .hp-row-acts button.hp-danger:hover { opacity: .8; }

  .hp-list {
    margin: 0; padding: 0; list-style: none;
    overflow-y: auto; min-height: 0;
    scrollbar-width: thin; scrollbar-color: var(--jv-line-strong) transparent;
  }
  .hp-list > li + li { border-top: 1px solid var(--jv-line); }

  .hp-files { flex: 0 1 auto; max-height: 40%; }
  .hp-file {
    width: 100%; display: flex; align-items: baseline; justify-content: space-between; gap: 10px;
    border: 0; background: none; padding: 8px 0; margin: 0; cursor: pointer; text-align: left;
    color: var(--jv-muted);
    font: 400 11px/1.35 var(--font-geist-mono), ui-monospace, monospace;
  }
  .hp-file span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .hp-file em { flex: 0 0 auto; font-style: normal; color: var(--jv-dim); font-size: 10px; }
  .hp-file:hover { color: var(--jv-text); }
  .hp-file.is-on { color: var(--jv-accent); }

  .hp-toolbar { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
  .hp-sel {
    min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    color: var(--jv-muted);
    font: 500 10.5px/1.45 var(--font-geist-mono), ui-monospace, monospace;
  }

  .hp-textarea {
    flex: 1; min-height: 110px; width: 100%; resize: none;
    border: 0; border-top: 1px solid var(--jv-line); background: transparent;
    padding: 10px 0; margin: 0; outline: 0;
    color: var(--jv-text); caret-color: var(--jv-accent);
    font: 400 14px/1.55 var(--font-geist-mono), ui-monospace, monospace;
    scrollbar-width: thin; scrollbar-color: var(--jv-line-strong) transparent;
  }
  .hp-textarea:focus { border-top-color: var(--jv-line-strong); }
  .hp-textarea:disabled { color: var(--jv-dim); }
  .hp-textarea::placeholder { color: var(--jv-dim); }

  .hp-frame {
    border: 1px solid var(--jv-line); background: #0a0c0e;
    display: grid; place-items: center; overflow: auto;
    scrollbar-width: thin; scrollbar-color: var(--jv-line-strong) transparent;
  }
  .hp-frame-view { width: 100%; aspect-ratio: 16 / 10; overflow: auto; display: block; }
  .hp-frame-view .hp-frame-empty { display: grid; place-items: center; height: 100%; }
  .hp-frame-view.is-empty,
  .hp-frame-img.is-empty {
    aspect-ratio: auto; min-height: 132px;
    border: 0; border-top: 1px solid var(--jv-line); background: transparent;
  }
  .hp-frame-view.is-empty .hp-frame-empty,
  .hp-frame-img.is-empty .hp-frame-empty {
    display: block; height: auto; max-width: 32ch; color: var(--jv-muted); text-align: left;
  }
  .hp-frame-img { width: 100%; aspect-ratio: 16 / 10; overflow: hidden; }
  .hp-frame a { display: block; width: 100%; }
  .hp-frame img { display: block; width: 100%; height: auto; }
  .hp-frame-empty {
    color: var(--jv-dim);
    font: 400 11px/1.5 var(--font-geist-mono), ui-monospace, monospace;
    letter-spacing: .04em;
  }

  .hp-skills { flex: 0 1 auto; max-height: 46%; }
  .hp-skill {
    width: 100%; display: grid; gap: 4px; border: 0; background: none;
    padding: 9px 0; margin: 0; cursor: pointer; text-align: left;
  }
  .hp-skill-top { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; min-width: 0; }
  .hp-skill-top b {
    min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    color: var(--jv-muted); font: 500 11px/1.3 var(--font-geist-mono), ui-monospace, monospace;
  }
  .hp-skill-top em { flex: 0 0 auto; font-style: normal; color: var(--jv-dim); font-size: 10px; }
  .hp-skill-desc {
    color: var(--jv-dim); font-size: 10px; line-height: 1.45;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
  }
  .hp-skill:hover b { color: var(--jv-text); }
  .hp-skill.is-on b { color: var(--jv-accent); }

  .hp-pre {
    flex: 1; min-height: 100px; margin: 0; overflow: auto; padding: 10px 0 0;
    color: var(--jv-muted); white-space: pre-wrap; overflow-wrap: anywhere;
    font: 400 14px/1.6 var(--font-geist-mono), ui-monospace, monospace;
    scrollbar-width: thin; scrollbar-color: var(--jv-line-strong) transparent;
  }

  .hp-servers { flex: 1; }
  .hp-server { display: grid; gap: 5px; padding: 11px 0; }
  .hp-server-top { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
  .hp-server-top strong {
    min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    color: var(--jv-text); font: 500 11px/1.3 var(--font-geist-mono), ui-monospace, monospace;
  }
  .hp-server-top em {
    flex: 0 0 auto; font-style: normal; font-weight: 600; font-size: 10px;
    letter-spacing: .1em; text-transform: uppercase;
    font-family: var(--font-geist-mono), ui-monospace, monospace;
  }
  .hp-state-ok { color: var(--jv-ok); }
  .hp-state-bad { color: var(--jv-danger); }
  .hp-server-meta {
    margin: 0; color: var(--jv-dim);
    font: 400 10px/1.5 var(--font-geist-mono), ui-monospace, monospace;
  }
  .hp-server-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 16px; }
  .hp-server-actions button {
    border: 0; background: none; padding: 0; margin: 0; min-height: 22px; cursor: pointer;
    color: var(--jv-muted);
    font: 500 10px/1 var(--font-geist-mono), ui-monospace, monospace;
    letter-spacing: .04em;
  }
  .hp-server-actions button:hover { color: var(--jv-text); }

  .hp-env { display: grid; gap: 6px; margin-top: 2px; }
  .hp-env textarea {
    min-height: 58px; resize: vertical; width: 100%;
    border: 0; border-top: 1px solid var(--jv-line); background: transparent;
    padding: 8px 0; margin: 0; outline: 0;
    color: var(--jv-text); caret-color: var(--jv-accent);
    font: 400 14px/1.5 var(--font-geist-mono), ui-monospace, monospace;
  }
  .hp-env textarea:focus { border-top-color: var(--jv-line-strong); }
  .hp-env textarea::placeholder { color: var(--jv-dim); }
  .hp-env .hp-act { justify-self: start; }

  .hp-events {
    flex: 1; min-height: 0; margin: 0; padding: 0; list-style: none; overflow-y: auto;
    scrollbar-width: thin; scrollbar-color: var(--jv-line-strong) transparent;
  }
  .hp-event {
    display: grid; grid-template-columns: 54px 70px minmax(0, 1fr); gap: 10px;
    align-items: baseline; padding: 8px 0;
    font: 400 10px/1.5 var(--font-geist-mono), ui-monospace, monospace;
  }
  .hp-event + .hp-event { border-top: 1px solid var(--jv-line); }
  .hp-event time { color: var(--jv-dim); }
  .hp-event-kind {
    color: var(--jv-muted); font-weight: 600; font-size: 10px;
    letter-spacing: .04em; text-transform: uppercase;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .hp-event-detail { color: var(--jv-muted); overflow-wrap: anywhere; }
  .hp-event.is-bad .hp-event-kind { color: var(--jv-danger); }

  .hpanel button:focus-visible,
  .hpanel input:focus-visible,
  .hpanel textarea:focus-visible {
    outline: 1px solid var(--jv-accent); outline-offset: 2px;
  }

  @media (prefers-reduced-motion: reduce) {
    .hp-tabs button { transition: none; }
  }
`;
