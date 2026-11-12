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

  const count = loading ? "Carregando…" : total > events.length ? `${events.length} de ${total} eventos` : `${events.length} eventos`;

  return (
    <section className="activity-panel" aria-label="Atividade do Jarvis" aria-busy={loading}>
      <div className="activity-head">
        <p className="hint">{count}</p>
        <button
          type="button"
          className="activity-refresh"
          onClick={() => void load()}
          disabled={loading}
          aria-label="Recarregar atividade"
        >
          RECARREGAR
        </button>
      </div>

      {loading ? (
        <p className="hint" role="status">
          Carregando eventos…
        </p>
      ) : null}

      {error ? (
        <div className="activity-error" role="alert">
          <p>{error}</p>
          <button type="button" onClick={() => void load()} aria-label="Tentar carregar a atividade de novo">
            TENTAR DE NOVO
          </button>
        </div>
      ) : null}

      {!loading && !error && events.length === 0 ? (
        <p className="hint">Nenhum evento registrado ainda. As ações do Jarvis aparecem aqui.</p>
      ) : null}

      {events.length > 0 ? (
        <ol className="activity-list" role="list" aria-label="Eventos de atividade, mais recente primeiro">
          {events.map((event) => {
            const { label, detail } = describe(event);
            const time = timeOf(event.created_at);
            return (
              <li key={event.id} className="activity-item" data-tone={toneOf(event)}>
                <time className="activity-time" dateTime={time.iso}>
                  {time.text}
                </time>
                <div className="activity-main">
                  <span className="activity-label">{label}</span>
                  {detail ? <span className="activity-detail">{detail}</span> : null}
                </div>
              </li>
            );
          })}
        </ol>
      ) : null}
    </section>
  );
}
