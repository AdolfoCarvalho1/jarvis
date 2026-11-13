"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { HudAssistant } from "@/components/hud-assistant";
import { HarnessPanel } from "@/components/harness-panel";
import JarvisApp from "@/components/jarvis-app";

type HudMode = "assistant" | "harness";

const MODE_KEY = "jarvis:hud:mode";
const APP_URL = "http://127.0.0.1:3300/";
const HARNESS_BG = "#070809";

const modeListeners = new Set<() => void>();

function subscribeMode(listener: () => void) {
  modeListeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    modeListeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function readMode(): HudMode {
  try {
    return window.localStorage.getItem(MODE_KEY) === "harness" ? "harness" : "assistant";
  } catch {
    return "assistant";
  }
}

function serverMode(): HudMode {
  return "assistant";
}

function paint(bg: string) {
  document.documentElement.style.setProperty("background", bg, "important");
  document.body.style.setProperty("background", bg, "important");
  document.body.style.setProperty("overflow", "hidden", "important");
  document.body.style.setProperty("margin", "0", "important");
}

function clockLabel() {
  return new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

export default function HudPage() {
  const mode = useSyncExternalStore(subscribeMode, readMode, serverMode);
  const [online, setOnline] = useState<boolean | null>(null);
  const [health, setHealth] = useState<{ provider: string; storage: string; obsidian: boolean | null }>({
    provider: "",
    storage: "",
    obsidian: null,
  });
  const [clock, setClock] = useState(clockLabel);
  const openTool = useCallback((tab: string) => {
    window.dispatchEvent(new CustomEvent("jarvis:harness-tab", { detail: tab }));
  }, []);

  useEffect(() => {
    paint(mode === "harness" ? HARNESS_BG : "transparent");
  }, [mode]);

  useEffect(() => {
    // O processo principal nasce em REST; só o modo salvo precisa redimensionar.
    if (readMode() === "harness") window.jarvisHud?.setMode("harness");
  }, []);

  useEffect(() => {
    if (mode !== "harness") return;
    const tick = window.setInterval(() => setClock(clockLabel()), 30_000);
    return () => window.clearInterval(tick);
  }, [mode]);

  useEffect(() => {
    if (mode !== "harness") return;
    let alive = true;
    const load = async () => {
      try {
        const response = await fetch("/api/health", { cache: "no-store" });
        if (!response.ok) throw new Error("health");
        const data = (await response.json()) as {
          ok?: boolean;
          model?: string;
          provider?: string;
          storage?: string;
          obsidian?: boolean;
        };
        if (!alive) return;
        setOnline(Boolean(data.ok));
        setHealth({
          provider: typeof data.provider === "string" ? data.provider : "",
          storage: typeof data.storage === "string" ? data.storage : "",
          obsidian: typeof data.obsidian === "boolean" ? data.obsidian : null,
        });
      } catch {
        if (alive) setOnline(false);
      }
    };
    void load();
    const poll = window.setInterval(() => void load(), 60_000);
    return () => {
      alive = false;
      window.clearInterval(poll);
    };
  }, [mode]);

  const change = useCallback((next: HudMode) => {
    try {
      window.localStorage.setItem(MODE_KEY, next);
    } catch {
      /* sem persistência: o modo ainda troca nesta sessão */
    }
    window.jarvisHud?.setMode(next);
    modeListeners.forEach((listener) => listener());
  }, []);

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("mode");
    if (requested === "harness" || requested === "assistant") change(requested);
  }, [change]);

  if (mode === "harness") {
    return (
      <div className="harness" data-mode="harness">
        <header className="harness-top">
          <div className="harness-brand">
            <i aria-hidden="true" />
            J.A.R.V.I.S.
          </div>
          <nav className="harness-switch" aria-label="Modo de interface">
            <button type="button" onClick={() => change("assistant")} aria-pressed={false}>
              ASSISTENTE
            </button>
            <button type="button" className="is-on" onClick={() => change("harness")} aria-pressed>
              HARNESS
            </button>
          </nav>
          <div className="harness-status">
            <i className={online === null ? "is-check" : online === false ? "is-off" : undefined} aria-hidden="true" />
            <span>{online === null ? "VERIFICANDO" : online ? "ONLINE" : "OFFLINE"}</span>
            {clock ? (
              <>
                <span className="sep">/</span>
                <span>{clock}</span>
              </>
            ) : null}
          </div>
        </header>

        <div className="harness-body">
          <aside className="harness-rail" aria-label="Bancada">
            <div className="rail-brand">
              <span className="rail-glyph" aria-hidden="true" />
              <div>
                <b>BANCADA</b>
                <span>SESSÃO 01</span>
              </div>
            </div>
            <button
              type="button"
              className="rail-new"
              onClick={() => window.dispatchEvent(new CustomEvent("jarvis:new-session"))}
            >
              <span aria-hidden="true">+</span> NOVA CONVERSA
            </button>
            <div className="rail-block">
              <p className="rail-label">SESSÃO</p>
              <ul className="rail-nav">
                <li>
                  <button type="button" className="is-on" onClick={() => openTool("inicio")}>
                    <span>Conversa atual</span>
                    <em>01</em>
                  </button>
                </li>
              </ul>
            </div>
            <div className="rail-block">
              <p className="rail-label">ATALHOS</p>
              <ul className="rail-keys">
                <li>
                  <b>F9</b>
                  <span>falar</span>
                </li>
                <li>
                  <b>Ctrl+Alt+J</b>
                  <span>mostrar / ocultar</span>
                </li>
                <li>
                  <b>Ctrl+Alt+K</b>
                  <span>clique através</span>
                </li>
              </ul>
            </div>
            <div className="rail-block rail-status">
              <p className="rail-label">SISTEMA</p>
              <ul className="rail-keys">
                <li>
                  <b>{health.provider || "—"}</b>
                  <span>provedor</span>
                </li>
                <li>
                  <b>{health.storage || "—"}</b>
                  <span>armazenamento</span>
                </li>
                <li>
                  <b>{health.obsidian === null ? "—" : health.obsidian ? "ativo" : "off"}</b>
                  <span>obsidian</span>
                </li>
              </ul>
            </div>
            <div className="rail-foot">
              <button type="button" onClick={() => window.jarvisHud?.recenter()}>
                RECENTRALIZAR
              </button>
              <button type="button" className="is-primary" onClick={() => window.open(APP_URL, "_blank")}>
                ABRIR APP →
              </button>
            </div>
          </aside>

          <section className="harness-thread" aria-label="Conversa">
            <div className="harness-thread-head">
              <div>
                <p className="thread-kicker">CANAL DIRETO</p>
                <h1 className="thread-title">Conversa</h1>
              </div>
            </div>
            <JarvisApp hud />
          </section>

          <HarnessPanel />
        </div>

        <style>{HARNESS_CSS}</style>
      </div>
    );
  }

  return <HudAssistant onHarness={() => change("harness")} />;
}

const HARNESS_CSS = `
  html, body { background: #070809 !important; }
  .harness {
    position: fixed; inset: 0; display: flex; flex-direction: column; overflow: hidden;
    background: var(--jv-bg, #070809); color: var(--jv-text, #f2f2ee);
    font-family: var(--font-geist-sans), system-ui, sans-serif;
  }
  .harness :is(button):focus-visible {
    outline: 1px solid var(--jv-accent, #ff8a1e); outline-offset: 3px;
  }

  /* barra superior: marca / modos / status, sem caixa */
  .harness-top {
    flex: 0 0 auto; display: flex; align-items: center; gap: 30px;
    min-height: 56px; padding: 0 28px;
    border-bottom: 1px solid var(--jv-line, rgba(255, 255, 255, .09));
    -webkit-app-region: drag; user-select: none;
  }
  .harness-brand {
    display: flex; align-items: center; gap: 9px; flex: 0 0 auto; white-space: nowrap;
    font: 700 12.5px/1 var(--font-geist-sans), system-ui, sans-serif;
    letter-spacing: .2em; color: var(--jv-text, #f2f2ee);
  }
  .harness-brand i {
    flex: 0 0 auto; width: 6px; height: 6px;
    background: var(--jv-accent, #ff8a1e); transform: rotate(45deg);
  }
  .harness-switch { display: flex; gap: 20px; align-self: stretch; }
  .harness-switch button {
    position: relative; display: inline-flex; align-items: center;
    border: 0; background: none; padding: 0; cursor: pointer;
    color: var(--jv-dim, #64645f);
    font: 600 10px/1 var(--font-geist-mono), ui-monospace, monospace;
    letter-spacing: .16em; transition: color .16s ease;
    -webkit-app-region: no-drag;
  }
  .harness-switch button:hover { color: var(--jv-accent-2, #ffb15a); }
  .harness-switch button.is-on { color: var(--jv-text, #f2f2ee); }
  .harness-switch button.is-on::after {
    content: ""; position: absolute; left: 0; right: 0; bottom: -1px;
    height: 1px; background: var(--jv-accent, #ff8a1e);
  }
  .harness-status {
    margin-left: auto; display: flex; align-items: center; gap: 9px; white-space: nowrap;
    font: 500 10.5px/1 var(--font-geist-mono), ui-monospace, monospace;
    letter-spacing: .1em; color: var(--jv-dim, #64645f);
  }
  .harness-status i {
    width: 5px; height: 5px; border-radius: 50%; flex: 0 0 auto;
    background: var(--jv-accent, #ff8a1e); box-shadow: 0 0 8px rgba(255, 138, 30, .7);
  }
  .harness-status i.is-off { background: var(--jv-danger, #ff7161); box-shadow: none; }
  .harness-status i.is-check { background: var(--jv-muted, #9b9b95); box-shadow: none; }
  .harness-status b { font-weight: 500; color: var(--jv-muted, #9b9b95); }
  .harness-status .sep { color: var(--jv-line-strong, rgba(255, 255, 255, .18)); }

  /* corpo: rail / conversa / painel */
  .harness-body {
    flex: 1 1 auto; min-height: 0; display: grid;
    grid-template-columns: 228px minmax(0, 1fr) auto;
    column-gap: 36px; padding: 24px 28px 18px; overflow: hidden;
  }

  .harness-rail { min-width: 0; display: flex; flex-direction: column; gap: 22px; }
  .rail-brand { display: flex; align-items: center; gap: 10px; }
  .rail-glyph {
    flex: 0 0 auto; width: 7px; height: 7px; transform: rotate(45deg);
    background: var(--jv-accent, #ff8a1e); box-shadow: 0 0 10px rgba(255, 138, 30, .5);
  }
  .rail-brand b {
    display: block; font: 700 10.5px/1.3 var(--font-geist-sans), system-ui, sans-serif;
    letter-spacing: .16em; color: var(--jv-text, #f2f2ee);
  }
  .rail-brand span {
    display: block; margin-top: 4px;
    font: 500 10px/1 var(--font-geist-mono), ui-monospace, monospace;
    letter-spacing: .14em; color: var(--jv-accent, #ff8a1e);
  }
  .rail-new {
    display: flex; align-items: center; gap: 10px; width: 100%;
    border: 0; border-bottom: 1px solid var(--jv-line, rgba(255,255,255,.09));
    background: none; padding: 0 0 11px; text-align: left; cursor: pointer;
    color: var(--jv-text, #f2f2ee);
    font: 600 10.5px/1 var(--font-geist-mono), ui-monospace, monospace;
    letter-spacing: .1em; transition: color .16s ease, border-color .16s ease;
    -webkit-app-region: no-drag;
  }
  .rail-new span { color: var(--jv-accent, #ff8a1e); font-size: 15px; line-height: .7; }
  .rail-new:hover { color: var(--jv-accent-2, #ffb15a); border-bottom-color: var(--jv-line-strong, rgba(255,255,255,.18)); }
  .rail-nav { display: grid; gap: 3px; margin: 0; padding: 0; list-style: none; }
  .rail-nav button {
    display: flex; align-items: baseline; justify-content: space-between; gap: 8px; width: 100%;
    border: 0; background: none; padding: 6px 0; text-align: left; cursor: pointer;
    color: var(--jv-muted, #9b9b95);
    font: 400 12px/1.3 var(--font-geist-sans), system-ui, sans-serif;
    transition: color .15s ease;
    -webkit-app-region: no-drag;
  }
  .rail-nav button:hover { color: var(--jv-text, #f2f2ee); }
  .rail-nav button.is-on { color: var(--jv-accent, #ff8a1e); }
  .rail-nav button.is-on em { color: var(--jv-accent, #ff8a1e); }
  .rail-nav em {
    font: 500 9px/1 var(--font-geist-mono), ui-monospace, monospace;
    font-style: normal; letter-spacing: .08em; color: var(--jv-dim, #8a8a83);
  }
  .rail-label {
    margin: 0 0 10px;
    font: 600 10px/1 var(--font-geist-mono), ui-monospace, monospace;
    letter-spacing: .2em; text-transform: uppercase; color: var(--jv-dim, #64645f);
  }
  .rail-keys { display: grid; gap: 9px; margin: 0; padding: 0; list-style: none; }
  .rail-keys li { display: grid; gap: 3px; min-width: 0; }
  .rail-keys b {
    font: 500 10.5px/1.3 var(--font-geist-mono), ui-monospace, monospace;
    color: var(--jv-text, #f2f2ee); white-space: nowrap;
  }
  .rail-keys span {
    font: 400 10px/1.4 var(--font-geist-mono), ui-monospace, monospace;
    color: var(--jv-dim, #64645f);
  }
  .rail-foot { margin-top: auto; display: grid; gap: 11px; padding-top: 18px; }
  .rail-foot button {
    border: 0; background: none; padding: 0; cursor: pointer; text-align: left;
    font: 600 10px/1.3 var(--font-geist-mono), ui-monospace, monospace;
    letter-spacing: .12em; color: var(--jv-muted, #9b9b95);
    -webkit-app-region: no-drag; transition: color .16s ease;
  }
  .rail-foot button:hover { color: var(--jv-text, #f2f2ee); }
  .rail-foot button.is-primary { color: var(--jv-accent, #ff8a1e); }
  .rail-foot button.is-primary:hover { color: var(--jv-accent-2, #ffb15a); }

  .harness-thread {
    min-width: 0; min-height: 0; height: 100%;
    display: flex; flex-direction: column;
  }
  .harness-thread-head {
    flex: 0 0 auto; display: flex; align-items: flex-end; justify-content: space-between;
    gap: 18px; padding: 0 0 18px;
  }
  .thread-kicker {
    margin: 0 0 7px; color: var(--jv-accent);
    font: 600 9.5px/1 var(--font-geist-mono), ui-monospace, monospace;
    letter-spacing: .2em; text-transform: uppercase;
  }
  .thread-title {
    margin: 0; color: var(--jv-text);
    font: 600 22px/1 var(--font-geist-sans), system-ui, sans-serif;
    letter-spacing: -.04em;
  }
  .harness-thread .shell {
    flex: 1 1 auto; height: auto; max-width: none; margin: 0; padding: 0; min-height: 0;
  }
  .harness-thread .shell--empty .chat-empty {
    align-content: start; padding-top: 18px;
  }
  .harness-thread .shell--empty .hero.is-compact { padding-bottom: 2px; }
  .harness-thread .shell--hud .topbar {
    min-height: 0; padding: 0 0 16px; justify-content: flex-end;
  }
  .harness-thread .shell--hud .topbar .brand-min { display: none; }

  .harness-body > .hpanel { height: 100%; }

  @media (max-width: 1100px) {
    .harness-body {
      grid-template-columns: minmax(0, 1fr) auto;
      column-gap: 24px; padding: 16px 20px 12px;
    }
    .harness-body > .hpanel:not(.is-collapsed) { width: 340px; }
    .harness-rail {
      grid-column: 1 / -1; flex-direction: row; flex-wrap: wrap; align-items: center;
      gap: 10px 22px; padding-bottom: 14px;
    }
    .rail-block { display: flex; align-items: baseline; gap: 10px; }
    .rail-status { display: none; }
    .rail-new, .rail-nav { display: none; }
    .rail-label { display: none; }
    .rail-keys { display: flex; gap: 16px; }
    .rail-keys li { display: flex; align-items: baseline; gap: 6px; }
    .rail-foot { display: none; }
  }

  @media (max-width: 900px) {
    .harness-top { flex-wrap: wrap; gap: 8px 18px; min-height: 0; padding: 10px 20px 0; }
    .harness-switch { order: 3; width: 100%; height: 34px; gap: 18px; align-self: auto; }
    .harness-status { margin-left: auto; }
  }

  @media (max-width: 720px) {
    .harness-body {
      grid-template-columns: minmax(0, 1fr);
      grid-auto-rows: min-content;
      row-gap: 20px;
      overflow-y: auto;
      padding: 14px 16px 12px;
    }
    .harness-body > .hpanel:not(.is-collapsed) { width: 100%; height: 58vh; min-height: 360px; overflow: hidden; }
    .harness-thread { height: 58vh; min-height: 420px; overflow: hidden; }
    .harness-rail { padding-bottom: 2px; }
  }

  @media (prefers-reduced-motion: reduce) {
    .harness * { transition: none !important; }
  }
`;
