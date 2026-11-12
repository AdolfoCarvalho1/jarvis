"use client";

import { useEffect, useRef, type MutableRefObject } from "react";

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

type Color = [number, number, number];

/**
 * Cada emoção é um perfil de movimento e cor. Os valores são alvo de uma
 * transição suave — trocar de emoção não corta a animação, ela migra.
 */
interface EmotionProfile {
  primary: Color;
  secondary: Color;
  accent: Color;
  spin: number;
  energy: number;
  pulse: number;
  jitter: number;
  spark: number;
  aperture: number;
  tilt: number;
  glow: number;
  sweep: number;
  dim: number;
  scale: number;
}

const EMOTIONS: Record<OrbEmotion, EmotionProfile> = {
  // calmo: grande, apagado, respiração lenta
  calm: {
    primary: [46, 215, 255], secondary: [194, 251, 255], accent: [255, 180, 77],
    spin: 1, energy: 0, pulse: 0.35, jitter: 0, spark: 0.3, aperture: 1,
    tilt: 0, glow: 1.16, sweep: 0.78, dim: 0.48, scale: 1.07,
  },
  // curioso: inclina o disco e vira turquesa, como quem olha de lado
  curious: {
    primary: [96, 255, 220], secondary: [214, 255, 248], accent: [255, 198, 112],
    spin: 1.45, energy: 0.14, pulse: 0.8, jitter: 0.18, spark: 0.62, aperture: 1.12,
    tilt: 0.38, glow: 1.02, sweep: 1.2, dim: 1, scale: 1.01,
  },
  // concentrado: menor, azul profundo, varredura estreita e rápida
  focused: {
    primary: [62, 150, 255], secondary: [150, 206, 255], accent: [255, 150, 60],
    spin: 2.3, energy: 0.2, pulse: 0.22, jitter: 0, spark: 0.55, aperture: 0.84,
    tilt: 0.08, glow: 0.9, sweep: 2.4, dim: 1, scale: 0.86,
  },
  // animado: maior, ciano claro, pulsos largos e muita poeira
  excited: {
    primary: [120, 250, 255], secondary: [240, 255, 255], accent: [255, 214, 96],
    spin: 2.9, energy: 0.45, pulse: 1.9, jitter: 0.3, spark: 1, aperture: 1.24,
    tilt: 0.2, glow: 1.08, sweep: 1.3, dim: 1, scale: 1.08,
  },
  // irritado: vermelho, tremor curto, pulsos agressivos
  angry: {
    primary: [255, 92, 70], secondary: [255, 194, 166], accent: [255, 132, 58],
    spin: 3.5, energy: 0.55, pulse: 2.3, jitter: 1, spark: 1.2, aperture: 0.82,
    tilt: 0.06, glow: 0.9, sweep: 1.6, dim: 1, scale: 0.96,
  },
  // alerta: âmbar elétrico, batida forte, piscada
  alert: {
    primary: [255, 152, 62], secondary: [255, 232, 184], accent: [255, 86, 58],
    spin: 3, energy: 0.5, pulse: 2.8, jitter: 0.85, spark: 1.1, aperture: 1.2,
    tilt: 0.12, glow: 0.94, sweep: 1.8, dim: 1, scale: 0.98,
  },
};
type Point = { x: number; y: number };
type Ring = { radius: number; depth: number; speed: number; phase: number; ticks: number };
const TAU = Math.PI * 2;
const CYAN: Color = [46, 215, 255];
const ICE: Color = [194, 251, 255];
const AMBER: Color = [255, 180, 77];
const CORAL: Color = [255, 88, 72];

// Depth is interleaved across radii to keep the assembly open and flat at its center.
const RINGS: Ring[] = [
  { radius: 1, depth: -0.27, speed: 0.018, phase: 0.1, ticks: 156 },
  { radius: 0.925, depth: 0.22, speed: -0.025, phase: 0.6, ticks: 128 },
  { radius: 0.815, depth: -0.48, speed: 0.035, phase: 1.3, ticks: 120 },
  { radius: 0.715, depth: 0.33, speed: -0.04, phase: 0.35, ticks: 100 },
  { radius: 0.605, depth: -0.16, speed: 0.045, phase: 2.1, ticks: 100 },
  { radius: 0.485, depth: 0.06, speed: -0.055, phase: 0.12, ticks: 84 },
  { radius: 0.355, depth: -0.25, speed: 0.07, phase: 2.7, ticks: 52 },
];
const PAINT_ORDER = RINGS.map((ring, index) => ({ ring, index })).sort((a, b) => a.ring.depth - b.ring.depth);
const APERTURE: ReadonlyArray<readonly [number, number]> = [
  [-0.17, -0.09], [-0.08, -0.17], [0.11, -0.17], [0.19, -0.08],
  [0.19, 0.08], [0.08, 0.16], [-0.11, 0.16], [-0.17, 0.09],
];

function color(rgb: Color, alpha: number) {
  return `rgba(${rgb[0] | 0},${rgb[1] | 0},${rgb[2] | 0},${Math.max(0, Math.min(1, alpha)).toFixed(3)})`;
}

/** Live perspective-projected holographic core; no bitmap or 3D dependency. */
export function Orb({ state = "idle", tone = "blue", emotion, energyRef, size = 240, className = "" }: OrbProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef(state);
  const toneRef = useRef(tone);
  const emotionRef = useRef<OrbEmotion>(emotion ?? "calm");
  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => { toneRef.current = tone; }, [tone]);
  useEffect(() => { emotionRef.current = emotion ?? "calm"; }, [emotion]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d", { alpha: true });
    if (!canvas || !ctx) return;

    // Document PiP has its own visibility and animation clock.
    let frameWindow = canvas.ownerDocument.defaultView ?? window;
    const motion = frameWindow.matchMedia("(prefers-reduced-motion: reduce)");
    let reduced = motion.matches;
    const onMotion = () => { reduced = motion.matches; };
    motion.addEventListener("change", onMotion);
    const inputWindow = frameWindow;
    let pointerX = 0, pointerY = 0, targetX = 0, targetY = 0;
    const onPointer = (event: PointerEvent) => {
      if (event.pointerType === "touch" || reduced) return;
      const bounds = canvas.getBoundingClientRect();
      const reach = Math.max(bounds.width * 0.63, 1);
      targetX = Math.max(-1, Math.min(1, (event.clientX - bounds.left - bounds.width / 2) / reach));
      targetY = Math.max(-1, Math.min(1, (event.clientY - bounds.top - bounds.height / 2) / reach));
    };
    const resetPointer = () => { targetX = 0; targetY = 0; };
    const onPointerOut = (event: PointerEvent) => { if (!event.relatedTarget) resetPointer(); };
    inputWindow.addEventListener("pointermove", onPointer, { passive: true });
    inputWindow.addEventListener("pointerout", onPointerOut, { passive: true });
    inputWindow.addEventListener("blur", resetPointer);
    const dpr = Math.min(frameWindow.devicePixelRatio || 1, 2);
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const small = size < 150;
    const center = size / 2;
    const baseRadius = size * 0.41;
    const unit = size / 520;
    let visible = true;
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; });
    observer.observe(canvas);
    let frame = 0, last = 0, rotation = 0, energy = 0, clock = 0;
    const cyan: Color = [...CYAN], ice: Color = [...ICE], amber: Color = [...AMBER];
    const feel = { spin: 1, energy: 0, pulse: 0.35, jitter: 0, spark: 0.3, aperture: 1, tilt: 0, glow: 1, sweep: 1, dim: 1, scale: 1 };

    const draw = (now: number) => {
      frameWindow = canvas.ownerDocument.defaultView ?? frameWindow;
      frame = frameWindow.requestAnimationFrame(draw);
      if (now - last < (reduced ? 100 : 1000 / 30)) return;
      const elapsed = last ? Math.min((now - last) / 1000, 0.08) : 1 / 30;
      last = now;
      if (!visible || canvas.ownerDocument.hidden) return;
      const currentState = stateRef.current;
      const profile = toneRef.current === "red" ? EMOTIONS.angry : EMOTIONS[emotionRef.current] ?? EMOTIONS.calm;
      const mood = 1 - Math.exp(-elapsed * 2.6);
      clock += elapsed;
      feel.spin += (profile.spin - feel.spin) * mood;
      feel.energy += (profile.energy - feel.energy) * mood;
      feel.pulse += (profile.pulse - feel.pulse) * mood;
      feel.jitter += (profile.jitter - feel.jitter) * mood;
      feel.spark += (profile.spark - feel.spark) * mood;
      feel.aperture += (profile.aperture - feel.aperture) * mood;
      feel.tilt += (profile.tilt - feel.tilt) * mood;
      feel.glow += (profile.glow - feel.glow) * mood;
      feel.sweep += (profile.sweep - feel.sweep) * mood;
      feel.dim += (profile.dim - feel.dim) * mood;
      feel.scale += (profile.scale - feel.scale) * mood;
      for (let i = 0; i < 3; i++) {
        cyan[i] += (profile.primary[i] - cyan[i]) * mood;
        ice[i] += (profile.secondary[i] - ice[i]) * mood;
        amber[i] += (profile.accent[i] - amber[i]) * mood;
      }
      const activity = currentState === "idle" ? 0 : currentState === "thinking" ? 0.13 : 0.2;
      const audio = energyRef?.current ?? 0;
      const wanted = Math.max(
        Number.isFinite(audio) ? Math.min(1, Math.max(0, audio)) : 0,
        activity,
        feel.energy * 0.55,
      );
      energy += (wanted - energy) * (1 - Math.exp(-elapsed * (wanted > energy ? 15 : 5)));
      if (!reduced) {
        rotation += elapsed * (currentState === "thinking" ? 2.4 : 1 + energy * 0.65) * feel.spin;
      }
      const follow = 1 - Math.exp(-elapsed * 6);
      pointerX += ((reduced ? 0 : targetX) - pointerX) * follow;
      pointerY += ((reduced ? 0 : targetY) - pointerY) * follow;
      const parallaxX = reduced ? 0 : pointerX * 0.35;
      const parallaxY = reduced ? 0 : pointerY * 0.29;
      const breathe = reduced ? 0 : Math.sin(clock * (0.9 + feel.pulse * 1.4)) * (0.004 + feel.pulse * 0.005);
      const radius = baseRadius * (1 + (reduced ? 0 : energy * 0.035) + breathe) * feel.scale;
      // Inclinação de perspectiva: "curioso" vira o disco para olhar de lado.
      const tilt = reduced ? 0 : feel.tilt + Math.sin(clock * 0.6) * feel.tilt * 0.35;
      const tiltCos = Math.cos(tilt), tiltSin = Math.sin(tilt);
      // Keep a frontal view. Near and far planes slide in opposite directions.
      const project = (x: number, y: number, z: number): Point => {
        const y2 = y * tiltCos - z * tiltSin;
        const z2 = y * tiltSin + z * tiltCos;
        const scale = radius * 3.9 / (3.9 - z2);
        return {
          x: center + (x + z2 * parallaxX) * scale,
          y: center + (y2 + z2 * parallaxY) * scale,
        };
      };
      const polar = (r: number, a: number, z: number) => project(Math.cos(a) * r, Math.sin(a) * r, z);
      const line = (a: Point, b: Point) => { ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); };
      const scanAngle = reduced ? -0.85 : -0.85 + rotation * 0.51;
      const scanLight = (angle: number) => Math.max(0, Math.cos(angle - scanAngle)) ** (20 * feel.sweep);
      const arcPath = (r: number, z: number, start: number, end: number, reverse = false) => {
        const count = Math.max(3, Math.ceil(Math.abs(end - start) * (small ? 13 : 27)));
        for (let i = 0; i <= count; i++) {
          const a = reverse ? end - (end - start) * i / count : start + (end - start) * i / count;
          const p = polar(r, a, z);
          if (i === 0 && !reverse) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
        }
      };
      const arc = (r: number, z: number, start: number, end: number, width: number, rgb: Color, alpha: number) => {
        ctx.beginPath(); arcPath(r, z, start, end);
        ctx.lineWidth = Math.max(0.45, width * unit);
        ctx.strokeStyle = color(rgb, alpha); ctx.stroke();
      };
      const face = (points: Point[], fill: string) => {
        ctx.beginPath();
        points.forEach((p, i) => { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
        ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
      };
      const annulus = (r: number, width: number, z: number, start: number, end: number, fill: string | CanvasGradient) => {
        ctx.beginPath();
        arcPath(r + width / 2, z, start, end);
        arcPath(r - width / 2, z, start, end, true);
        ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
      };
      const wall = (r: number, width: number, z: number, thickness: number, start: number, end: number, rgb: Color) => {
        const steps = Math.max(2, Math.ceil((end - start) * (small ? 10 : 20)));
        for (let edge = 0; edge < 2; edge++) {
          const edgeR = r + (edge === 0 ? width / 2 : -width / 2);
          for (let i = 0; i < steps; i++) {
            const a = start + (end - start) * i / steps;
            const b = start + (end - start) * (i + 1) / steps;
            const middle = (a + b) / 2;
            const facing = (Math.cos(middle) * parallaxX + Math.sin(middle) * parallaxY) * (edge === 0 ? 1 : -1);
            if (facing <= 0) continue;
            const light = 0.23 + facing * 0.32;
            face([polar(edgeR, a, z - thickness), polar(edgeR, b, z - thickness), polar(edgeR, b, z), polar(edgeR, a, z)],
              color([rgb[0] * light, rgb[1] * light, rgb[2] * light], 0.16 + facing * 0.4));
          }
        }
        if (end - start < TAU - 0.01) {
          for (const a of [start, end]) {
            face([polar(r - width / 2, a, z - thickness), polar(r + width / 2, a, z - thickness),
              polar(r + width / 2, a, z), polar(r - width / 2, a, z)],
              color(rgb, 0.38));
          }
        }
      };
      const glassRing = (r: number, z: number, width: number, thickness: number, phase: number) => {
        // Interrupted transparent planes show the gap and the geometry behind them.
        for (const offset of [0, 2.05, 4.3]) {
          const start = phase + offset;
          const end = start + (offset === 2.05 ? 1.72 : 1.36);
          wall(r, width, z, thickness, start, end, cyan);
          annulus(r, width, z, start, end, color(cyan, 0.066));
          arc(r + width / 2, z - thickness, start, end, 1, cyan, 0.36);
          arc(r + width / 2, z, start, end, 1.15, cyan, 0.61);
          arc(r - width / 2, z, start, end, 0.65, ice, 0.23);
        }
      };
      const band = (r: number, z: number, start: number, end: number, width: number, rgb: Color, alpha: number) => {
        if (width > 0.025) wall(r, width, z, 0.075, start, end, rgb);
        annulus(r, width, z, start, end, color(rgb, alpha));
        arc(r + width / 2, z, start, end, 1.3, ice, alpha * 0.75);
      };
      const luminousArc = (r: number, z: number, start: number, end: number, rgb: Color, width: number) => {
        ctx.beginPath(); arcPath(r, z, start, end);
        for (const [spread, opacity] of [[2.7, 0.055], [1.7, 0.14], [1, 0.58]]) {
          ctx.lineWidth = Math.max(0.6, width * unit * spread);
          ctx.strokeStyle = color(rgb, opacity * (1 + energy * 0.45));
          ctx.stroke();
        }
        ctx.lineWidth = Math.max(0.6, width * unit * 0.23);
        ctx.strokeStyle = color(ice, 0.76);
        ctx.stroke();
      };
      const node = (r: number, a: number, z: number, rgb: Color, nodeSize: number) => {
        const p = polar(r, a, z), s = Math.max(0.65, nodeSize * unit);
        const halo = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, s * 5);
        halo.addColorStop(0, color(rgb, 0.45)); halo.addColorStop(1, color(rgb, 0));
        ctx.fillStyle = halo; ctx.fillRect(p.x - s * 5, p.y - s * 5, s * 10, s * 10);
        ctx.beginPath(); ctx.arc(p.x, p.y, s, 0, TAU);
        ctx.fillStyle = color(rgb, 0.95); ctx.fill();
        ctx.beginPath(); ctx.arc(p.x - s * 0.15, p.y - s * 0.15, s * 0.4, 0, TAU);
        ctx.fillStyle = color(ice, 0.9); ctx.fill();
      };

      ctx.clearRect(0, 0, size, size);
      ctx.globalAlpha = feel.dim;
      ctx.lineCap = "butt";
      const emitter = project(0, 0, -0.54);
      const aura = ctx.createRadialGradient(emitter.x, emitter.y, 0, emitter.x, emitter.y, radius * 1.23 * feel.glow);
      aura.addColorStop(0, color(cyan, 0.11 + energy * 0.1));
      aura.addColorStop(0.5, color(cyan, 0.047 + energy * 0.035));
      aura.addColorStop(0.83, color(cyan, 0.05 + energy * 0.04));
      aura.addColorStop(1, color(cyan, 0));
      ctx.fillStyle = aura; ctx.fillRect(0, 0, size, size);
      arc(1.065, -0.63, 0, TAU, 0.8, cyan, 0.2);
      arc(1.055, -0.33, 0.15, TAU - 0.12, 0.9, cyan, 0.28);
      arc(1.075, -0.52, 0.6, 2.45, 1.1, amber, 0.48);
      ctx.beginPath();
      const cageLines = small ? 18 : 48;
      for (let i = 0; i < cageLines; i++) {
        const a = i / cageLines * TAU + rotation * 0.012;
        line(polar(1.065, a, -0.63), polar(1.055, a, -0.33));
      }
      ctx.strokeStyle = color(cyan, 0.19); ctx.lineWidth = Math.max(0.4, unit * 0.65); ctx.stroke();

      // Short light guides reveal the separation between the outer planes.
      for (const angle of [-2.65, -0.38, 0.74, 2.25]) {
        const rear = polar(0.92, angle, -0.48);
        const front = polar(0.92, angle, 0.22);
        const light = ctx.createLinearGradient(rear.x, rear.y, front.x, front.y);
        light.addColorStop(0, color(cyan, 0.03));
        light.addColorStop(0.75, color(cyan, 0.36 + energy * 0.2));
        light.addColorStop(1, color(ice, 0.7));
        ctx.beginPath();
        line(rear, front);
        ctx.strokeStyle = light;
        ctx.lineWidth = Math.max(0.65, unit * 1.35);
        ctx.stroke();
      }

      ctx.beginPath();
      for (let i = 0; i < (small ? 4 : 8); i++) {
        const a = i / (small ? 4 : 8) * TAU + rotation * 0.012;
        for (let j = 0; j < RINGS.length - 1; j++) {
          const rear = RINGS[j], front = RINGS[j + 1];
          line(polar(rear.radius - 0.015, a, rear.depth - 0.06), polar(front.radius + 0.015, a, front.depth - 0.06));
        }
      }
      ctx.strokeStyle = color(cyan, 0.18); ctx.lineWidth = Math.max(0.5, unit * 1.05); ctx.stroke();

      // A recessed reticle leaves its center empty.
      const aperture = APERTURE.map(([x, y]) => project(x * feel.aperture, y * feel.aperture, -0.3));
      face(aperture, color(cyan, 0.035));
      ctx.beginPath();
      for (const edge of [0, 1, 3, 4, 6]) {
        line(aperture[edge], aperture[(edge + 1) % aperture.length]);
      }
      ctx.strokeStyle = color(ice, 0.69 + energy * 0.21);
      ctx.lineWidth = Math.max(0.7, unit * 1.45);
      ctx.stroke();
      ctx.beginPath();
      for (const edge of [2, 5, 7]) {
        line(aperture[edge], aperture[(edge + 1) % aperture.length]);
      }
      ctx.strokeStyle = color(cyan, 0.25);
      ctx.lineWidth = Math.max(0.5, unit);
      ctx.stroke();

      // Pulsos concêntricos: a "batida" muda de ritmo conforme a emoção.
      if (!reduced && feel.pulse > 0.2) {
        const period = 2.6 / Math.max(0.4, feel.pulse);
        for (let p = 0; p < 2; p++) {
          const age = (clock / period + p * 0.5) % 1;
          const ringRadius = 0.18 + age * 0.95;
          const alpha = (1 - age) ** 2 * 0.5 * Math.min(1, feel.pulse);
          arc(ringRadius, -0.1 + age * 0.12, 0, TAU, 1.1 + age * 1.6, p === 0 ? cyan : amber, alpha);
        }
      }

      for (const { ring, index } of PAINT_ORDER) {
        const r = ring.radius + (reduced ? 0 : Math.sin(clock * 6.3 + index) * 0.003 * feel.jitter);
        const z = ring.depth + (reduced ? 0 : energy * ring.depth * 0.17 + Math.sin(clock * 8.5 + index * 1.7) * 0.014 * feel.jitter);
        const spin = ring.phase + rotation * ring.speed;
        const count = small ? Math.floor(ring.ticks / 2) : ring.ticks;
        const principal = index === 0 || index === 1 || index === 3 || index === 5;
        if (principal) glassRing(r - 0.012, z - 0.012, index === 5 ? 0.082 : 0.058, index === 0 ? 0.115 : 0.09, spin);
        arc(r, z, 0, TAU, principal ? 1.1 : 0.6, cyan, principal ? 0.48 : 0.16);
        arc(r - 0.046, z - 0.025, 0, TAU, 0.7, cyan, principal ? 0.22 : 0.1);
        ctx.beginPath();
        for (let i = 0; i < count; i++) {
          const a = spin + i / count * TAU;
          const length = i % 8 === 0 ? 0.037 : 0.012 + (i % 3) * 0.004;
          line(polar(r - 0.015, a, z), polar(r - 0.015 - length, a, z));
        }
        ctx.strokeStyle = color(index === 3 ? amber : cyan, (principal ? 0.58 : 0.24) + energy * 0.15);
        ctx.lineWidth = Math.max(0.5, (index === 0 ? 1.6 : 1.05) * unit); ctx.stroke();
        if (index <= 4) {
          ctx.beginPath();
          for (let i = 0; i < count; i++) {
            const a = spin + i / count * TAU;
            const strength = scanLight(a - index * 0.13);
            if (strength < 0.21) continue;
            line(polar(r + 0.005, a, z), polar(r - 0.02 - strength * 0.042, a, z));
          }
          ctx.strokeStyle = color(index === 3 ? amber : ice, 0.62 + energy * 0.22);
          ctx.lineWidth = Math.max(0.6, unit * 1.35);
          ctx.stroke();
        }
        if (!small) {
          ctx.beginPath();
          for (let i = 0; i < count; i++) {
            if ((i + index) % 5 === 0) continue;
            const a = spin * -0.65 + i / count * TAU;
            line(polar(r - 0.068, a, z - 0.025), polar(r - 0.073, a, z - 0.025));
          }
          ctx.strokeStyle = color(index % 3 === 0 ? amber : ice, principal ? 0.4 : 0.19);
          ctx.lineWidth = unit * 1.25; ctx.stroke();
        }
        // Asymmetric arcs carry the reference's cyan / amber silhouette.
        if (index <= 4 && index !== 2) {
          const start = -2.95 + spin * 0.4 + index * 0.72;
          const end = start + (index === 0 ? 1.85 : 1.36);
          if (principal) luminousArc(r - 0.005, z, start, end, cyan, index === 0 ? 5 : 3.8);
          band(r - 0.005, z, start, end, index <= 1 ? 0.027 : 0.018, cyan, principal ? 0.77 : 0.5);
          band(r - 0.005, z, start + 3.15, end + 2.3, 0.012, cyan, principal ? 0.76 : 0.4);
        }
        if (index === 5) {
          const start = -1.66 + rotation * 0.045;
          luminousArc(r - 0.007, z, start, start + 1.38, amber, 6);
          for (let i = 0; i < 7; i++) {
            const a = start + i * 0.205;
            band(r - 0.007, z, a, a + 0.185, 0.046, amber, 0.9);
          }
          for (let i = 0; i < 4; i++) {
            const a = start + 3.1 + i * 0.24;
            band(r - 0.007, z, a, a + 0.215, 0.04, amber, 0.85);
          }
          luminousArc(r - 0.007, z, start + 1.5, start + 2.65, cyan, 5);
          band(r - 0.007, z, start + 1.5, start + 2.65, 0.037, cyan, 0.82);
        }
        if (index === 6) {
          arc(r, z, 2.45 - rotation * 0.04, 3.32 - rotation * 0.04, 1.8, cyan, 0.59);
          arc(r, z, -1.12 - rotation * 0.04, -0.3 - rotation * 0.04, 1.8, cyan, 0.52);
        }
        for (let j = 0; j < (small ? 2 : 4); j++) {
          const a = spin + j * TAU / 4;
          band(r, z + 0.015, a, a + (index % 2 ? 0.045 : 0.065), 0.022, cyan, principal ? 0.9 : 0.42);
        }
        if (index % 2 === 0) {
          const a = spin + 0.9;
          node(r, a, z + 0.025, index === 4 ? amber : cyan, index === 0 ? 3 : 2.2);
          if (!small) node(r, a + 2.8, z, amber, 1.8);
        }
      }
      // Poeira orbital: quantidade e velocidade acompanham a emoção.
      const motes = small ? 0 : Math.round(3 + feel.spark * 8);
      for (let i = 0; i < motes; i++) {
        const seed = i * 2.399;
        const orbit = 0.44 + ((i * 37) % 100) / 100 * 0.6;
        const direction = i % 2 ? -1 : 1;
        const a = seed + clock * (0.32 + (i % 3) * 0.2) * feel.spin * direction;
        const z = -0.18 + Math.sin(clock * 1.15 + seed) * 0.3;
        node(orbit, a, z, i % 4 === 0 ? amber : cyan, 0.75 + (i % 3) * 0.3);
      }

      // Faíscas curtas: só aparecem em emoções agitadas.
      if (!reduced && feel.jitter > 0.15) {
        ctx.beginPath();
        for (let i = 0; i < 16; i++) {
          if (Math.sin(clock * 11 + i * 3.7) < 0.35) continue;
          const a = i * 0.393 + clock * 1.6;
          const z = -0.2 + Math.sin(a * 2.3) * 0.22;
          line(polar(1.02, a, z), polar(1.02 + 0.04 + feel.jitter * 0.06, a, z));
        }
        ctx.strokeStyle = color(amber, 0.32 * feel.jitter);
        ctx.lineWidth = Math.max(0.6, unit * 1.15);
        ctx.stroke();
      }

      for (let i = 0; i < (small ? 3 : 7); i++) {
        const a = i * 2.399 + rotation * (i % 2 ? -0.02 : 0.028);
        node(1.07 + (i % 3) * 0.025, a, -0.33 + Math.sin(a) * 0.19, i % 3 ? cyan : amber, i % 3 ? 1.8 : 2.9);
      }
      ctx.globalAlpha = 1;
    };
    frame = frameWindow.requestAnimationFrame(draw);
    return () => {
      frameWindow.cancelAnimationFrame(frame);
      observer.disconnect();
      motion.removeEventListener("change", onMotion);
      inputWindow.removeEventListener("pointermove", onPointer);
      inputWindow.removeEventListener("pointerout", onPointerOut);
      inputWindow.removeEventListener("blur", resetPointer);
    };
  }, [size, energyRef]);

  return (
    <div className={`orb orb--${state} orb--${tone} orb--${emotion ?? "calm"} ${className}`} style={{ width: size, height: size }} aria-hidden>
      <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />
    </div>
  );
}
