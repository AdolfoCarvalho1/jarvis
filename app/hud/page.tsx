"use client";

import { useCallback, useEffect, useState } from "react";
import { HudAssistant } from "@/components/hud-assistant";
import JarvisApp from "@/components/jarvis-app";

type HudMode = "assistant" | "harness";

const MODE_KEY = "jarvis:hud:mode";

function paint(bg: string) {
  document.documentElement.style.setProperty("background", bg, "important");
  document.body.style.setProperty("background", bg, "important");
  document.body.style.setProperty("overflow", "hidden", "important");
  document.body.style.setProperty("margin", "0", "important");
}

export default function HudPage() {
  const [mode, setMode] = useState<HudMode>("assistant");

  useEffect(() => {
    paint("transparent");
    const saved = window.localStorage.getItem(MODE_KEY);
    if (saved === "harness") {
      setMode("harness");
      paint("#03060a");
      window.jarvisHud?.setMode("harness");
    }
  }, []);

  const change = useCallback((next: HudMode) => {
    setMode(next);
    window.localStorage.setItem(MODE_KEY, next);
    window.jarvisHud?.setMode(next);
    paint(next === "harness" ? "#03060a" : "transparent");
  }, []);

  if (mode === "harness") {
    return (
      <div className="harness">
        <header className="harness-bar">
          <button type="button" onClick={() => change("assistant")} title="Voltar ao modo assistente">
            ← assistente
          </button>
          <span className="harness-tag">HARNESS</span>
          <span className="harness-hint">chat · tela · navegador · composio</span>
        </header>
        <div className="harness-body">
          <JarvisApp hud />
        </div>
        <style>{HARNESS_CSS}</style>
      </div>
    );
  }

  return <HudAssistant onHarness={() => change("harness")} />;
}

const HARNESS_CSS = `
  html, body { background: #03060a !important; }
  .harness { position: fixed; inset: 0; display: flex; flex-direction: column; background: #03060a; }
  .harness-bar {
    flex: 0 0 auto; height: 30px; display: flex; align-items: center; gap: 10px; padding: 0 10px;
    background: rgba(4,14,20,.96); border-bottom: 1px solid rgba(72,178,214,.16);
    -webkit-app-region: drag; user-select: none;
  }
  .harness-bar button {
    -webkit-app-region: no-drag; cursor: pointer; border: 1px solid rgba(72,178,214,.22);
    background: rgba(14,42,57,.7); color: #a8dcee; border-radius: 7px; padding: 2px 8px;
    font: 10px/1.4 var(--font-geist-sans), system-ui, sans-serif; letter-spacing: .04em;
  }
  .harness-bar button:hover { background: rgba(26,70,92,.95); color: #e2f8ff; }
  .harness-tag {
    font: 9px/1 var(--font-geist-mono), ui-monospace, monospace; letter-spacing: .24em; color: #6fe0ff;
  }
  .harness-hint {
    font: 9px/1 var(--font-geist-mono), ui-monospace, monospace; letter-spacing: .12em; color: #4f7f92;
  }
  .harness-body { flex: 1 1 auto; min-height: 0; position: relative; overflow: hidden; }
  .harness-body .shell { height: 100% !important; }
`;
