"use client";

import { useState, type CSSProperties } from "react";
import { Orb } from "@/components/orb";
import { OldOrb } from "@/components/orb-old";

type Blend = "screen" | "lighten" | "normal";

export default function OrbCompare() {
  const [opacity, setOpacity] = useState(0.6);
  const [blend, setBlend] = useState<Blend>("screen");
  const [showNew, setShowNew] = useState(true);
  const [showOld, setShowOld] = useState(true);
  const [layout, setLayout] = useState<"overlay" | "split">("overlay");

  const oldStyle: CSSProperties = {
    opacity: showOld ? opacity : 0,
    mixBlendMode: blend as CSSProperties["mixBlendMode"],
  };

  return (
    <main className="cmp">
      <header className="cmp-head">
        <p className="cmp-kicker">Comparação</p>
        <h1>Orbe antigo sobre o novo</h1>
        <p className="cmp-sub">
          O novo é o canvas atual, com a concha de partículas. O antigo é a versão anterior, sobreposta por cima.
        </p>
      </header>

      <section className={`cmp-body is-${layout}`}>
        <div className="cmp-stage">
          {showNew ? (
            <div className="cmp-layer cmp-new" aria-label="Orbe novo">
              <Orb state="idle" emotion="calm" size={520} />
            </div>
          ) : null}
          <div className="cmp-layer cmp-old" style={oldStyle} aria-label="Orbe antigo sobreposto">
            <OldOrb state="idle" emotion="calm" size={520} />
          </div>
          <span className="cmp-badge cmp-badge-new">novo</span>
          {showOld ? <span className="cmp-badge cmp-badge-old">antigo · {Math.round(opacity * 100)}%</span> : null}
        </div>

        <aside className="cmp-controls" aria-label="Controles da comparação">
          <div className="cmp-group">
            <p className="cmp-label">Composição</p>
            <div className="cmp-switch">
              <button type="button" className={layout === "overlay" ? "is-on" : ""} onClick={() => setLayout("overlay")}>
                Sobrepor
              </button>
              <button type="button" className={layout === "split" ? "is-on" : ""} onClick={() => setLayout("split")}>
                Lado a lado
              </button>
            </div>
          </div>

          <label className="cmp-field">
            <span className="cmp-label">Opacidade do antigo</span>
            <span className="cmp-value">{Math.round(opacity * 100)}%</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={opacity}
              onChange={(event) => setOpacity(Number(event.target.value))}
            />
          </label>

          <label className="cmp-field">
            <span className="cmp-label">Blend</span>
            <select value={blend} onChange={(event) => setBlend(event.target.value as Blend)}>
              <option value="screen">screen</option>
              <option value="lighten">lighten</option>
              <option value="normal">normal</option>
            </select>
          </label>

          <div className="cmp-group">
            <p className="cmp-label">Camadas</p>
            <label className="cmp-check">
              <input type="checkbox" checked={showNew} onChange={(event) => setShowNew(event.target.checked)} />
              <span>Novo</span>
            </label>
            <label className="cmp-check">
              <input type="checkbox" checked={showOld} onChange={(event) => setShowOld(event.target.checked)} />
              <span>Antigo</span>
            </label>
          </div>

          <p className="cmp-note">
            Arraste a opacidade para separar as duas camadas. Em <b>screen</b>, o preto do antigo desaparece e só as
            partículas somam luz.
          </p>
        </aside>
      </section>

      <style>{`
        html, body { background: #070809; }
        .cmp {
          min-height: 100dvh; display: grid; grid-template-rows: auto minmax(0, 1fr); gap: 28px;
          padding: 30px 44px 38px; color: var(--jv-text, #f2f2ee);
          font-family: var(--font-geist-sans), system-ui, sans-serif;
          background: radial-gradient(720px 520px at 38% 44%, rgba(255, 138, 30, .06), transparent 70%), #070809;
        }
        .cmp-head { display: grid; gap: 8px; }
        .cmp-kicker {
          margin: 0; color: var(--jv-dim, #8a8a83);
          font: 500 10px/1 var(--font-geist-mono), ui-monospace, monospace;
          letter-spacing: .22em; text-transform: uppercase;
        }
        .cmp-head h1 { margin: 0; font-size: clamp(24px, 3vw, 36px); letter-spacing: -.04em; line-height: 1; }
        .cmp-sub { margin: 0; max-width: 60ch; color: var(--jv-muted, #9b9b95); font-size: 13px; line-height: 1.55; }
        .cmp-body { min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) 290px; gap: 44px; align-items: center; }
        .cmp-stage {
          position: relative; width: min(600px, 100%); aspect-ratio: 1; justify-self: center;
          display: grid; place-items: center;
        }
        .cmp-layer { grid-area: 1 / 1; width: 100%; height: 100%; display: grid; place-items: center; }
        .cmp-old { pointer-events: none; }
        .cmp-badge {
          position: absolute; bottom: 10px; font: 500 9px/1 var(--font-geist-mono), ui-monospace, monospace;
          letter-spacing: .16em; text-transform: uppercase; color: var(--jv-dim, #8a8a83);
        }
        .cmp-badge-new { left: 4px; }
        .cmp-badge-old { right: 4px; color: var(--jv-accent, #ff8a1e); }
        .cmp-controls { display: grid; gap: 24px; align-content: center; }
        .cmp-group { display: grid; gap: 9px; }
        .cmp-label {
          margin: 0; color: var(--jv-muted, #9b9b95);
          font: 600 10px/1.4 var(--font-geist-mono), ui-monospace, monospace;
          letter-spacing: .16em; text-transform: uppercase;
        }
        .cmp-switch { display: flex; gap: 18px; }
        .cmp-switch button {
          border: 0; background: none; padding: 0 0 7px; cursor: pointer; color: var(--jv-dim, #8a8a83);
          font: 500 11px/1 var(--font-geist-mono), ui-monospace, monospace; letter-spacing: .08em;
          border-bottom: 1px solid transparent;
        }
        .cmp-switch button.is-on { color: var(--jv-text, #f2f2ee); border-bottom-color: var(--jv-accent, #ff8a1e); }
        .cmp-field { display: grid; grid-template-columns: 1fr auto; gap: 8px 12px; align-items: baseline; }
        .cmp-value { color: var(--jv-text, #f2f2ee); font: 500 11px/1 var(--font-geist-mono), ui-monospace, monospace; }
        .cmp-field input[type="range"] { grid-column: 1 / -1; width: 100%; accent-color: var(--jv-accent, #ff8a1e); }
        .cmp-field select {
          grid-column: 1 / -1; width: 100%; appearance: none; background: none; color: var(--jv-text, #f2f2ee);
          border: 0; border-bottom: 1px solid var(--jv-line-strong, rgba(255,255,255,.18)); padding: 7px 0;
          font: 400 12px/1.4 var(--font-geist-mono), ui-monospace, monospace; outline: none;
        }
        .cmp-check { display: flex; align-items: center; gap: 9px; color: var(--jv-muted, #9b9b95); font-size: 12px; cursor: pointer; }
        .cmp-check input { accent-color: var(--jv-accent, #ff8a1e); }
        .cmp-note { margin: 0; color: var(--jv-dim, #8a8a83); font-size: 11px; line-height: 1.55; }
        .cmp-note b { color: var(--jv-muted, #9b9b95); font-weight: 500; }
        .cmp-body.is-split .cmp-stage { grid-template-columns: 1fr 1fr; place-items: stretch; }
        .cmp-body.is-split .cmp-layer { width: 100%; }
        .cmp-body.is-split .cmp-new { justify-self: start; }
        .cmp-body.is-split .cmp-old { justify-self: end; grid-column: 2; }
        .cmp-body.is-split .cmp-badge-new { left: 4px; }
        .cmp-body.is-split .cmp-badge-old { right: 4px; }
        @media (max-width: 900px) {
          .cmp { padding: 22px 20px 28px; gap: 20px; }
          .cmp-body { grid-template-columns: 1fr; gap: 24px; }
          .cmp-controls { order: 2; }
        }
      `}</style>
    </main>
  );
}
