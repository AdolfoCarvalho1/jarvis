"use client";

import { useState } from "react";
import { Orb, type OrbEmotion, type OrbState } from "@/components/orb";

const EMOTIONS: Array<{ id: OrbEmotion; label: string; hint: string }> = [
  { id: "calm", label: "Calmo", hint: "repouso, respiração lenta" },
  { id: "curious", label: "Curioso", hint: "ouvindo, atento" },
  { id: "focused", label: "Concentrado", hint: "pensando, varredura forte" },
  { id: "excited", label: "Animado", hint: "falando, pulsos rápidos" },
  { id: "angry", label: "Irritado", hint: "resposta negativa, tremor" },
  { id: "alert", label: "Alerta", hint: "erro, batida elétrica" },
];

const STATES: Array<{ id: OrbState; label: string }> = [
  { id: "idle", label: "Repouso" },
  { id: "thinking", label: "Pensando" },
  { id: "listening", label: "Ouvindo" },
  { id: "speaking", label: "Falando" },
];

export default function OrbLab() {
  const [emotion, setEmotion] = useState<OrbEmotion>("calm");
  const [state, setState] = useState<OrbState>("idle");

  return (
    <main className="lab">
      <header className="lab-head">
        <p className="lab-kicker">Laboratório</p>
        <h1>Orbe</h1>
      </header>

      <section className="lab-stage" aria-label="Prévia do orbe">
        <Orb
          state={state}
          tone={emotion === "angry" ? "red" : "blue"}
          emotion={emotion}
          size={460}
        />
      </section>

      <aside className="lab-panel" aria-label="Controles do orbe">
        <div className="lab-group">
          <p className="lab-label">Emoção</p>
          {EMOTIONS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={emotion === item.id ? "is-on" : ""}
              aria-pressed={emotion === item.id}
              onClick={() => setEmotion(item.id)}
            >
              <strong>{item.label}</strong>
              <span>{item.hint}</span>
            </button>
          ))}
        </div>

        <div className="lab-group">
          <p className="lab-label">Estado</p>
          <div className="lab-row">
            {STATES.map((item) => (
              <button
                key={item.id}
                type="button"
                className={state === item.id ? "is-on" : ""}
                aria-pressed={state === item.id}
                onClick={() => setState(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      </aside>

      <style>{`
        html, body { background: var(--jv-bg, #070809); }
        .lab {
          min-height: 100dvh;
          display: grid;
          grid-template-columns: minmax(0, 1fr) 360px;
          grid-template-rows: auto minmax(0, 1fr);
          gap: 32px 48px;
          padding: 32px 48px 40px;
          color: var(--jv-text, #f2f2ee);
          font-family: var(--font-geist-sans), system-ui, sans-serif;
          background:
            radial-gradient(760px 520px at 32% 42%, rgba(255, 138, 30, .075), transparent 68%),
            var(--jv-bg, #070809);
        }
        .lab-head { grid-column: 1 / -1; display: flex; align-items: baseline; gap: 18px; }
        .lab-kicker {
          margin: 0;
          font: 500 10px/1 var(--font-geist-mono), ui-monospace, monospace;
          letter-spacing: .22em;
          text-transform: uppercase;
          color: var(--jv-dim, #7d7d76);
        }
        .lab-head h1 { margin: 0; font: 600 28px/1 var(--font-geist-sans), system-ui, sans-serif; letter-spacing: -.035em; }
        .lab-stage { display: grid; place-items: center; align-content: center; gap: 18px; min-width: 0; }
        .lab-stage .orb { width: min(460px, 68vw) !important; height: auto !important; aspect-ratio: 1; }
        .lab-panel { display: flex; flex-direction: column; justify-content: center; gap: 30px; padding-top: 2px; }
        .lab-group { display: grid; gap: 0; }
        .lab-label {
          margin: 0 0 8px;
          font: 600 10px/1 var(--font-geist-mono), ui-monospace, monospace;
          letter-spacing: .2em; text-transform: uppercase; color: var(--jv-muted, #9b9b95);
        }
        .lab-group button {
          position: relative;
          display: grid; grid-template-columns: 96px minmax(0, 1fr); gap: 14px;
          min-width: 0; padding: 9px 0 9px 14px; border: 0; border-bottom: 1px solid var(--jv-line, rgba(255,255,255,.09));
          background: none; text-align: left; color: var(--jv-muted, #9b9b95); cursor: pointer;
        }
        .lab-group button::before {
          content: ""; position: absolute; left: 0; top: 16px;
          width: 4px; height: 4px; background: var(--jv-line-strong, rgba(255,255,255,.18));
          transform: rotate(45deg);
        }
        .lab-group button:hover { color: var(--jv-text, #f2f2ee); }
        .lab-group button strong { font: 500 13px/1.3 var(--font-geist-sans), system-ui, sans-serif; color: inherit; }
        .lab-group button span { font: 400 12.5px/1.4 var(--font-geist-sans), system-ui, sans-serif; color: var(--jv-muted, #9b9b95); }
        .lab-group button.is-on { color: var(--jv-accent, #ff8a1e); }
        .lab-group button.is-on::before { background: var(--jv-accent, #ff8a1e); }
        .lab-group button.is-on strong { font-weight: 600; }
        .lab-group button.is-on span { color: var(--jv-muted, #9b9b95); }
        .lab-row { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 18px; }
        .lab-row button {
          position: relative; display: block; padding: 9px 0 9px 14px; border: 0; border-bottom: 1px solid var(--jv-line, rgba(255,255,255,.09));
          background: none; text-align: left; cursor: pointer;
          font: 400 12.5px/1.3 var(--font-geist-sans), system-ui, sans-serif; color: var(--jv-muted, #9b9b95);
        }
        .lab-row button::before {
          content: ""; position: absolute; left: 0; top: 16px;
          width: 4px; height: 4px; background: var(--jv-line-strong, rgba(255,255,255,.18));
          transform: rotate(45deg);
        }
        .lab-row button:hover { color: var(--jv-text, #f2f2ee); }
        .lab-row button.is-on { color: var(--jv-accent, #ff8a1e); }
        .lab-row button.is-on::before { background: var(--jv-accent, #ff8a1e); }
        @media (max-width: 900px) {
          .lab { grid-template-columns: 1fr; grid-template-rows: auto auto auto; gap: 24px; padding: 24px; }
          .lab-head { grid-column: 1; }
          .lab-stage { order: 2; }
          .lab-panel { order: 3; }
          .lab-stage .orb { width: min(340px, 76vw) !important; }
        }
      `}</style>
    </main>
  );
}
