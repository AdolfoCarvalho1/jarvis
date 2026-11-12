"use client";

import { useRef, useState } from "react";
import { Orb, type OrbEmotion, type OrbState } from "@/components/orb";

const EMOTIONS: Array<{ id: OrbEmotion; label: string; hint: string }> = [
  { id: "calm", label: "Calmo", hint: "repouso, respiração lenta" },
  { id: "curious", label: "Curioso", hint: "ouvindo, atento" },
  { id: "focused", label: "Concentrado", hint: "pensando, varredura forte" },
  { id: "excited", label: "Animado", hint: "falando, pulsos rápidos" },
  { id: "angry", label: "Irritado", hint: "resposta negativa, tremor" },
  { id: "alert", label: "Alerta", hint: "erro, batida elétrica" },
];

const STATES: OrbState[] = ["idle", "thinking", "listening", "speaking"];

export default function OrbLab() {
  const [emotion, setEmotion] = useState<OrbEmotion>("calm");
  const [state, setState] = useState<OrbState>("idle");
  const [energy, setEnergy] = useState(0);
  const energyRef = useRef(0);
  energyRef.current = energy;

  return (
    <main className="lab">
      <div className="lab-stage">
        <Orb state={state} tone={emotion === "angry" ? "red" : "blue"} emotion={emotion} energyRef={energyRef} size={460} />
        <p className="lab-now">
          {EMOTIONS.find((item) => item.id === emotion)?.label} · {state}
        </p>
      </div>

      <aside className="lab-panel">
        <h1>Laboratório do orbe</h1>
        <p className="lab-sub">Escolha a emoção e o estado para ver o movimento.</p>

        <div className="lab-group">
          {EMOTIONS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={emotion === item.id ? "is-on" : ""}
              onClick={() => setEmotion(item.id)}
            >
              <strong>{item.label}</strong>
              <span>{item.hint}</span>
            </button>
          ))}
        </div>

        <div className="lab-row">
          {STATES.map((item) => (
            <button key={item} type="button" className={state === item ? "is-on" : ""} onClick={() => setState(item)}>
              {item}
            </button>
          ))}
        </div>

        <label className="lab-energy">
          energia {Math.round(energy * 100)}%
          <input type="range" min={0} max={1} step={0.01} value={energy} onChange={(event) => setEnergy(Number(event.target.value))} />
        </label>
      </aside>

      <style>{`
        html, body { background: #03060a; }
        .lab {
          min-height: 100vh; display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 24px;
          padding: 24px; color: #e6f6ff; font-family: var(--font-geist-sans), system-ui, sans-serif;
          background: radial-gradient(circle at 34% 42%, rgba(12,44,62,.55), #03060a 62%);
        }
        .lab-stage { display: grid; place-items: center; gap: 8px; }
        .lab-now {
          margin: 0; font: 11px/1 ui-monospace, monospace; letter-spacing: .22em;
          text-transform: uppercase; color: #7fc4da;
        }
        .lab-panel { display: flex; flex-direction: column; gap: 12px; padding-top: 8px; }
        .lab-panel h1 { margin: 0; font-size: 18px; letter-spacing: .02em; }
        .lab-sub { margin: 0 0 4px; font-size: 12px; color: #7ea6b6; }
        .lab-group { display: grid; gap: 6px; }
        .lab-group button {
          display: flex; flex-direction: column; align-items: flex-start; gap: 2px; cursor: pointer;
          padding: 8px 10px; text-align: left; border-radius: 10px;
          border: 1px solid rgba(72,178,214,.22); background: rgba(8,26,36,.7); color: #cfeaf5;
        }
        .lab-group button strong { font-size: 12px; font-weight: 600; }
        .lab-group button span { font-size: 10.5px; color: #7099aa; }
        .lab-group button.is-on { border-color: rgba(96,216,255,.65); background: rgba(20,64,84,.85); box-shadow: 0 0 0 3px rgba(40,140,180,.12); }
        .lab-row { display: flex; gap: 6px; }
        .lab-row button {
          flex: 1; cursor: pointer; padding: 6px 8px; border-radius: 8px; font-size: 11px;
          border: 1px solid rgba(72,178,214,.22); background: rgba(8,26,36,.7); color: #b9dce9;
        }
        .lab-row button.is-on { border-color: rgba(96,216,255,.6); background: rgba(20,64,84,.85); color: #eafaff; }
        .lab-energy { display: grid; gap: 6px; font: 10.5px/1 ui-monospace, monospace; letter-spacing: .14em; color: #7ea6b6; }
        .lab-energy input { width: 100%; accent-color: #4fd6ff; }
      `}</style>
    </main>
  );
}
