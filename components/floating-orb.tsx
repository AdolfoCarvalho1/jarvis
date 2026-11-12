"use client";

import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Orb, type OrbState, type OrbTone } from "./orb";

export interface OrbSnapshot {
  energy: number;
  tone: OrbTone;
  state: OrbState;
}

interface DocumentPiP {
  requestWindow(options?: { width?: number; height?: number }): Promise<Window>;
  window: Window | null;
}

function FloatingOrb() {
  const [state, setState] = useState<OrbState>("idle");
  const [tone, setTone] = useState<OrbTone>("blue");
  const energyRef = useRef(0);

  useEffect(() => {
    const channel = new BroadcastChannel("jarvis-orb");
    channel.onmessage = (event: MessageEvent<OrbSnapshot>) => {
      const data = event.data;
      if (!data) return;
      energyRef.current = data.energy;
      setState(data.state);
      setTone(data.tone);
    };
    return () => channel.close();
  }, []);

  const label =
    state === "listening" ? "OUVINDO" : state === "speaking" ? "FALANDO" : state === "thinking" ? "PROCESSANDO" : "J.A.R.V.I.S.";

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
      <Orb size={194} state={state} tone={tone} energyRef={energyRef} />
      <span role="status" style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 10, letterSpacing: "0.16em", color: "#a5c8dc" }}>
        {label}
      </span>
    </div>
  );
}

export async function openFloatingOrb(getSnapshot: () => OrbSnapshot): Promise<boolean> {
  const dpip = (window as unknown as { documentPictureInPicture?: DocumentPiP }).documentPictureInPicture;
  if (!dpip) throw new Error("Janela flutuante exige Chrome ou Edge.");

  if (dpip.window) {
    dpip.window.focus();
    return true;
  }

  const pip = await dpip.requestWindow({ width: 232, height: 264 });
  pip.document.title = "J.A.R.V.I.S.";
  pip.document.body.style.margin = "0";
  pip.document.body.style.background = "radial-gradient(ellipse at center, #0b2334 0%, #040910 72%)";
  pip.document.body.style.overflow = "hidden";

  const host = pip.document.createElement("div");
  host.style.cssText =
    "width:100vw;height:100vh;display:flex;align-items:center;justify-content:center;position:relative";
  pip.document.body.appendChild(host);

  const close = pip.document.createElement("button");
  close.textContent = "×";
  close.setAttribute("aria-label", "Fechar");
  close.style.cssText =
    "position:absolute;top:0;right:8px;background:none;border:0;color:#4a5b6a;font:20px/1.4 sans-serif;cursor:pointer";
  close.onclick = () => pip.close();
  host.appendChild(close);

  const mount = pip.document.createElement("div");
  host.appendChild(mount);

  const root = createRoot(mount);
  root.render(<FloatingOrb />);

  const channel = new BroadcastChannel("jarvis-orb");
  const timer = window.setInterval(() => channel.postMessage(getSnapshot()), 100);
  channel.postMessage(getSnapshot());

  const cleanup = () => {
    window.clearInterval(timer);
    channel.close();
    root.unmount();
  };
  pip.addEventListener("pagehide", cleanup, { once: true });

  return true;
}
