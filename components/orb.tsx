"use client";

import type { MutableRefObject } from "react";

export type OrbState = "idle" | "thinking" | "listening" | "speaking";
export type OrbTone = "blue" | "red";
export type OrbEmotion = "calm" | "curious" | "focused" | "excited" | "angry" | "alert";

interface OrbProps {
  state?: OrbState;
  tone?: OrbTone;
  emotion?: OrbEmotion;
  energyRef?: MutableRefObject<number>;
  size?: number;
  className?: string;
}

/**
 * Orbe oficial do J.A.R.V.I.S.
 *
 * É o asset transparente escolhido pelo usuário (concha dourada com núcleo
 * em vórtice), sem placa, moldura ou sombra quadrada. O componente mantém
 * o contrato antigo de estado/tom/emoção para o resto do app não mudar.
 */
export function Orb({ state = "idle", tone = "blue", emotion, energyRef, size = 240, className = "" }: OrbProps) {
  const resolvedEmotion = emotion ?? (state === "thinking" ? "focused" : state === "listening" ? "curious" : state === "speaking" ? "excited" : "calm");
  void energyRef;

  return (
    <div
      className={`orb orb--${state} orb--${tone} orb--${resolvedEmotion} ${className}`}
      style={{ width: size, height: size }}
      aria-hidden
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/orb-reference.png" alt="" draggable={false} />
    </div>
  );
}
