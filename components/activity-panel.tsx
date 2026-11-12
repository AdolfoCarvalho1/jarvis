"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface JarvisEvent {
  id: string;
  conversation_id?: string | null;
  turn_id?: string | null;
  type: string;
  payload?: unknown;
  created_at?: string | null;
}

interface EventsResponse {
  events?: JarvisEvent[];
  total?: number;
}

const clock = new Intl.DateTimeFormat("pt-BR", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
  timeZone: "America/Sao_Paulo",
});

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function scalar(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function clip(value: string, max = 120): string {
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function join(...parts: string[]): string {
  return parts.filter(Boolean).join(" · ");
}

function describe(event: JarvisEvent): { label: string; detail: string } {
  const payload = record(event.payload);
  switch (event.type) {
    case "turn/start":
      return { label: "Turno iniciado", detail: clip(scalar(payload.model), 60) };
    case "user/message": {
      const chars = scalar(payload.chars);
      return { label: "Pedido", detail: chars ? `${chars} chars` : "" };
    }
    case "model/request": {
      const round = scalar(payload.round);
      const tokens = scalar(payload.tokens);
      const prompt = scalar(payload.promptTokens ?? payload.prompt_tokens);
      const completion = scalar(payload.completionTokens ?? payload.completion_tokens);
      const usage = tokens
        ? `${tokens} tokens`
        : prompt || completion
          ? `${prompt || "?"} + ${completion || "?"} tokens`
          : "";
      return { label: "Modelo", detail: join(round ? `${round}ª rodada` : "", usage) };
    }
    case "tool/call": {
      const args = payload.args ?? payload.arguments ?? payload.input;
      let detail = "";
      if (typeof args === "string") detail = args;
      else if (args && typeof args === "object") {
        try {
          detail = JSON.stringify(args);
        } catch {
          detail = "";
        }
      }
      return { label: clip(scalar(payload.name) || "Ferramenta", 48), detail: clip(detail, 140) };
    }
    case "tool/result": {
      const status = scalar(payload.status);
      const detail = scalar(payload.detail);
      const ms = scalar(payload.ms);
      return {
        label: clip(scalar(payload.name) || "Ferramenta", 48),
        detail: clip(join(status, detail, ms ? `${ms} ms` : ""), 140),
      };
    }
    case "assistant/message": {
      const chars = scalar(payload.chars);
      return { label: "Resposta", detail: chars ? `${chars} chars` : "" };
    }
    case "turn/end": {
      const ms = scalar(payload.ms);
      return { label: "Turno concluído", detail: ms ? `${ms} ms` : "" };
    }
    case "turn/error":
      return { label: "Erro", detail: clip(scalar(payload.message) || "Falha no turno", 140) };
    default:
      return { label: clip(event.type || "evento", 48), detail: "" };
  }
}

/** Rótulo curto da coluna de tipo — o detalhe específico continua vindo de describe(). */
const KIND_BY_TYPE: Record<string, string> = {
  "turn/start": "Turno",
  "turn/end": "Turno",
  "turn/error": "Erro",
  "user/message": "Pedido",
  "assistant/message": "Resposta",
  "model/request": "Modelo",
  "tool/call": "Tool",
  "tool/result": "Tool",
};

/** O tipo já ocupa a coluna ao lado: evita repetir "Turno…", "Pedido…", "Erro…" no detalhe. */
const KIND_PREFIX = /^(turno|pedido|modelo|ferramenta|resposta|erro)\b[\s·:—-]*/i;

function kindOf(event: JarvisEvent): string {
  return KIND_BY_TYPE[event.type] ?? "Evento";
}

function subjectOf(label: string): string {
  return label.replace(KIND_PREFIX, "").trim();
}

/**
 * accent = eventos principais do turno (início e resposta);
 * error = falha, no turno ou numa ferramenta.
 */
function toneOf(event: JarvisEvent): "neutral" | "accent" | "ok" | "error" {
  if (event.type === "turn/error") return "error";
  if (event.type === "tool/result") {
    const status = scalar(record(event.payload).status).toLowerCase();
    return /(error|erro|fail|falh)/.test(status) ? "error" : "ok";
  }
  if (event.type === "turn/start" || event.type === "assistant/message") return "accent";
  return "neutral";
}

function timeOf(iso: string | null | undefined): { text: string; iso?: string } {
  if (!iso) return { text: "--:--:--" };
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return { text: "--:--:--" };
  return { text: clock.format(date), iso };
}

function sortKey(event: JarvisEvent): number {
  const time = event.created_at ? Date.parse(event.created_at) : Number.NaN;
  return Number.isNaN(time) ? 0 : time;
}

export function ActivityPanel() {
  const [events, setEvents] = useState<JarvisEvent[]>([]);
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
        throw new Error(
          response.status === 404
            ? "A rota /api/events ainda não está disponível."
            : `Não consegui carregar a atividade (${response.status}).`,
        );
      }
      const data = (await response.json().catch(() => null)) as EventsResponse | null;
      if (!data) throw new Error("Resposta inválida de /api/events.");
      if (ticket !== ticketRef.current) return;
      const list = Array.isArray(data?.events) ? data.events.filter((event) => event && typeof event.type === "string") : [];
      setEvents([...list].sort((a, b) => sortKey(b) - sortKey(a)));
      setTotal(typeof data?.total === "number" ? data.total : list.length);
    } catch (failure) {
      if (ticket !== ticketRef.current) return;
      setError(failure instanceof Error ? failure.message : "Falha ao carregar a atividade.");
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

  const count = total > events.length ? `${events.length} de ${total} eventos` : `${events.length} eventos`;
  const showCount = events.length > 0 || (!loading && !error);

  return (
    <section className="activity-tl" aria-label="Atividade do Jarvis" aria-busy={loading}>
      <style>{CSS}</style>

      <div className="activity-tl-head">
        <span className="activity-tl-title">Trilha do turno</span>
        <span className="activity-tl-tail">
          {showCount ? <span className="activity-tl-meta">{count}</span> : null}
          <button
            type="button"
            className="activity-tl-refresh"
            onClick={() => void load()}
            disabled={loading}
            aria-label="Recarregar atividade"
          >
            Recarregar
          </button>
        </span>
      </div>

      {loading ? (
        <p className="activity-tl-state" role="status">
          <span className="activity-tl-dot" aria-hidden="true" />
          {events.length > 0 ? "Atualizando eventos" : "Carregando eventos"}
        </p>
      ) : null}

      {error ? (
        <div className="activity-tl-error" role="alert">
          <p>{error}</p>
          <button type="button" onClick={() => void load()} aria-label="Tentar carregar a atividade de novo">
            Tentar de novo <span aria-hidden="true">→</span>
          </button>
        </div>
      ) : null}

      {!loading && !error && events.length === 0 ? (
        <p className="activity-tl-empty">Nenhum evento registrado ainda. As ações do Jarvis aparecem aqui.</p>
      ) : null}

      {events.length > 0 ? (
        <ol className="activity-tl-list" role="list" aria-label="Eventos de atividade, mais recente primeiro">
          {events.map((event) => {
            const { label, detail } = describe(event);
            const subject = subjectOf(label);
            const time = timeOf(event.created_at);
            return (
              <li key={event.id} className="activity-tl-row" data-tone={toneOf(event)}>
                <time className="activity-tl-clock" dateTime={time.iso}>
                  {time.text}
                </time>
                <span className="activity-tl-kind">{kindOf(event)}</span>
                <span className="activity-tl-detail">
                  {subject ? <b>{subject}</b> : null}
                  {detail ? <span>{subject ? ` · ${detail}` : detail}</span> : null}
                  {!subject && !detail ? (
                    <span aria-hidden="true" className="activity-tl-blank">
                      —
                    </span>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ol>
      ) : null}
    </section>
  );
}

const CSS = `
  .activity-tl {
    --activity-mono: var(--font-geist-mono), ui-monospace, "Cascadia Mono", monospace;
    --activity-hair: rgba(255, 255, 255, 0.055);
    display: flex;
    flex-direction: column;
    min-width: 0;
    font-family: var(--activity-mono);
    color: var(--jv-muted);
  }

  .activity-tl-head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 3px 12px;
    padding-bottom: 9px;
    border-bottom: 1px solid var(--jv-line);
    font-size: 10px;
    font-weight: 600;
    line-height: 1.4;
    letter-spacing: 0.18em;
    text-transform: uppercase;
  }

  .activity-tl-title {
    color: var(--jv-dim);
  }

  .activity-tl-tail {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 3px 12px;
    margin-left: auto;
    min-width: 0;
  }

  .activity-tl-meta {
    color: var(--jv-muted);
    font-weight: 500;
    letter-spacing: 0.1em;
    font-variant-numeric: tabular-nums;
  }

  .activity-tl-refresh {
    flex: none;
    min-height: 24px;
    padding: 0;
    border: 0;
    background: none;
    color: var(--jv-muted);
    font: 600 10px/1 var(--activity-mono);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    transition: color 0.15s ease;
  }

  .activity-tl-refresh:hover:not(:disabled) { color: var(--jv-text); }
  .activity-tl-refresh:disabled { opacity: 0.45; cursor: default; }

  .activity-tl button:focus-visible {
    outline: 2px solid var(--jv-accent);
    outline-offset: 4px;
  }

  .activity-tl-state {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0;
    padding: 12px 0;
    color: var(--jv-dim);
    font-size: 10px;
    font-weight: 500;
    line-height: 1.4;
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }

  .activity-tl-dot {
    flex: none;
    width: 4px;
    height: 4px;
    background: currentColor;
    animation: activity-tl-pulse 1.6s ease-in-out infinite;
  }

  @keyframes activity-tl-pulse {
    0%, 100% { opacity: 0.3; }
    50% { opacity: 1; }
  }

  .activity-tl-error {
    display: grid;
    justify-items: start;
    gap: 7px;
    padding: 12px 0;
  }

  .activity-tl-error p {
    margin: 0;
    color: var(--jv-danger);
    font-size: 11px;
    line-height: 1.6;
    overflow-wrap: anywhere;
  }

  .activity-tl-error button {
    min-height: 24px;
    padding: 0;
    border: 0;
    background: none;
    color: var(--jv-danger);
    font: 600 10px/1 var(--activity-mono);
    letter-spacing: 0.14em;
    text-transform: uppercase;
    transition: color 0.15s ease;
  }

  .activity-tl-error button:hover { color: var(--jv-text); }

  .activity-tl-empty {
    margin: 0;
    padding: 14px 0 4px;
    max-width: 44ch;
    color: var(--jv-muted);
    font-size: 11px;
    line-height: 1.65;
  }

  .activity-tl-list {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .activity-tl-row {
    display: grid;
    grid-template-columns: 44px 86px minmax(0, 1fr);
    column-gap: 10px;
    align-items: baseline;
    padding: 9px 0;
  }

  .activity-tl-row + .activity-tl-row {
    border-top: 1px solid var(--activity-hair);
  }

  .activity-tl-clock {
    color: var(--jv-dim);
    font-size: 10px;
    line-height: 1.5;
    letter-spacing: -0.05em;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .activity-tl-kind {
    color: var(--jv-muted);
    font-size: 10px;
    font-weight: 600;
    line-height: 1.5;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .activity-tl-row[data-tone="accent"] .activity-tl-kind { color: var(--jv-accent); }
  .activity-tl-row[data-tone="error"] .activity-tl-kind { color: var(--jv-danger); }

  .activity-tl-detail {
    min-width: 0;
    color: var(--jv-muted);
    font-size: 10.5px;
    line-height: 1.55;
    overflow-wrap: anywhere;
  }

  .activity-tl-detail b {
    color: var(--jv-text);
    font-weight: 500;
  }

  .activity-tl-row[data-tone="error"] .activity-tl-detail,
  .activity-tl-row[data-tone="error"] .activity-tl-detail b {
    color: var(--jv-danger);
  }

  .activity-tl-blank {
    color: var(--jv-dim);
  }
`;
