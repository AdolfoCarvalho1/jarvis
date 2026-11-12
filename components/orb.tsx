"use client";

import { useEffect, useRef, type MutableRefObject } from "react";

export type OrbState = "idle" | "thinking" | "listening" | "speaking";
// Keep the existing public tone contract; the normal hologram is now amber.
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

type Vec = { x: number; y: number; z: number };
type Trace = { points: Vec[]; weight: number; seed: number; terminal: boolean; fill?: number; bright?: boolean };
const TAU = Math.PI * 2;
const MOODS: Record<OrbEmotion, { speed: number; heat: number; tilt: number }> = {
  calm: { speed: 0.15, heat: 0, tilt: 0 },
  curious: { speed: 0.22, heat: 0.12, tilt: 0.2 },
  focused: { speed: 0.32, heat: 0.15, tilt: -0.08 },
  excited: { speed: 0.36, heat: 0.3, tilt: 0.08 },
  angry: { speed: 0.4, heat: 0.35, tilt: -0.05 },
  alert: { speed: 0.3, heat: 0.3, tilt: 0.12 },
};
const random = (n: number) => {
  const v = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return v - Math.floor(v);
};
/** Authored banks of curved circuitry, with dense illuminated strata and dark gaps. */
function makeTraces(small: boolean): Trace[] {
  const traces: Trace[] = [];
  const ringPoint = (r: number, a: number, z: number): Vec => ({
    x: Math.cos(a) * r + z * 0.12,
    y: Math.sin(a) * r * 1.04,
    z: z + Math.cos(a) * r * 0.28,
  });
  const arc = (r: number, start: number, length: number, z: number, weight: number, seed: number, bright = false) => {
    const points: Vec[] = [];
    const steps = Math.max(3, Math.ceil(length * 32));
    for (let k = 0; k <= steps; k++) points.push(ringPoint(r, start + length * k / steps, z));
    if (seed % 3 === 0) {
      const tilt = seed % 2 ? 1.05 : -0.8;
      for (const p of points) {
        const y = p.y, z0 = p.z - z;
        p.y = y * Math.cos(tilt) - z0 * Math.sin(tilt);
        p.z = z + y * Math.sin(tilt) + z0 * Math.cos(tilt);
        p.x += Math.sin(seed) * 0.06;
      }
    }
    traces.push({ points, weight, seed, terminal: false, bright });
  };
  // Eccentric broken belts: the brightest edges live on the left, never a globe grid.
  for (let i = 0; i < (small ? 35 : 75); i++) {
    const r = 0.33 + random(i + 62) * 0.67;
    const a = i % 3 === 0 ? 2.1 + random(i) * 1.6 : random(i + 40) * TAU;
    if (r > 0.87 && a > 4.5 && a < 6.1) continue;
    arc(r, a, 0.22 + random(i + 4) * 1.7, (random(i + 84) - 0.5) * 0.9, i % 9 === 0 ? 2.8 : 0.6 + random(i) * 0.9, i, i % 8 === 0);
  }
  // A broken orange C carries the left-hand energy mass.
  for (let i = 0; i < 5; i++) {
    arc(0.44 + i * 0.008, 2.25, 1.62, 0.18, i === 2 ? 3 : 1, 2801 + i * 3, i === 2);
    arc(0.44 + i * 0.008, 1.3, 0.58, 0.18, 0.8, 2821 + i * 3);
  }
  // Curved transparent circuit panels. Interrupted rectangular borders have physical depth.
  for (let i = 0; i < (small ? 18 : 43); i++) {
    const a = random(i + 191) * TAU;
    const r = 0.57 + random(i + 281) * 0.4;
    const width = 0.08 + random(i + 371) * 0.3;
    const depth = 0.12 + random(i + 471) * 0.34;
    const z = (random(i + 571) - 0.5) * 0.75;
    const points: Vec[] = [];
    for (let k = 0; k <= 9; k++) points.push(ringPoint(r, a + width * k / 9, z));
    for (let k = 9; k >= 0; k--) points.push(ringPoint(r, a + width * k / 9, z - depth));
    points.push(points[0]);
    traces.push({ points, weight: 0.65, seed: i + 120, terminal: i % 4 === 0, fill: i % 3 === 0 ? 0.045 : 0.014 });
    for (let k = 0; k < 5; k++) arc(r - 0.012 * k, a, width * (0.4 + random(i + k) * 0.6), z - depth * k / 5, 0.6, i * 5 + k + 200);
  }
  // Granular energy is concentrated in belts, not uniformly scattered on a shell.
  for (let i = 0; i < (small ? 350 : 1450); i++) {
    const bank = i % 5;
    const r = [0.88, 0.72, 0.51, 0.95, 0.36][bank] + (random(i + 31) - 0.5) * (bank % 2 ? 0.15 : 0.22);
    const a = random(i + 125) * TAU;
    if (bank === 2 && a > 0.2 && a < 1.3) continue;
    if (bank === 3 && a > 3.6 && a < 5.2) continue;
    const z = (random(i + 255) - 0.5) * (bank === 3 ? 1.1 : 0.5);
    const start = ringPoint(r, a, z);
    const end = ringPoint(r + (random(i + 478) - 0.5) * 0.035, a + 0.004 + random(i + 326) * 0.035, z);
    traces.push({ points: [start, end], weight: 0.35 + random(i + 90) * 1.7, seed: i + 500, terminal: i % 29 === 0, bright: i % 7 === 0 });
  }
  // Recognizable floating instrument plates, each facing a different plane.
  for (let i = 0; i < 7; i++) {
    const x = [0.16, 0.38, 0.46, 0.04, -0.18, -0.47, -0.62][i];
    const y = [-0.87, -0.65, -0.43, 0.39, 0.58, -0.35, 0.13][i];
    const w = 0.12 + random(i + 67) * 0.12;
    const h = 0.14 + random(i + 88) * 0.24;
    const z = 0.22 + random(i + 99) * 0.25;
    const plate = (u: number, v: number): Vec => ({ x: x + u - v * 0.1, y: y + v, z: z + u * 0.7 + Math.sin(v * 4) * 0.05 });
    traces.push({ points: [plate(0, h * 0.18), plate(0, 0), plate(w * 0.88, 0), plate(w, h * 0.14), plate(w * 0.94, h), plate(w * 0.25, h)], weight: 0.6, seed: i + 2500, terminal: false, fill: 0.035 });
    for (let j = 1; j < 11; j++) traces.push({ points: [plate(0.01, h * j / 11), plate(w * (0.45 + random(j + i) * 0.5), h * j / 11)], weight: j % 3 ? 0.45 : 1, seed: i * 11 + j + 2600, terminal: false });
  }
  // Unequal horizontal data rails erupt from the emitter through the inner volume.
  for (let i = 0; i < (small ? 28 : 85); i++) {
    const y = (random(i + 730) - 0.5) * 0.52 - 0.04;
    const x = -0.26 + random(i + 820) * 0.35;
    const z = (random(i + 910) - 0.5) * 0.55;
    const length = 0.16 + random(i + 1000) * 0.7;
    traces.push({ points: [{ x, y, z }, { x: x + length, y: y - 0.012, z }, { x: x + length + 0.03, y: y - 0.04, z }], weight: i % 12 === 0 ? 1.5 : 0.3 + random(i + 34) * 0.5, seed: i + 2100, terminal: i % 15 === 0, bright: i % 9 === 0 });
  }
  // An unfinished lower-left fan breaks the circular silhouette.
  for (let i = 0; i < 26; i++) {
    const a = 1.87 + i / 26 * 0.6;
    const r = 0.86 + random(i + 90) * 0.1;
    traces.push({ points: [ringPoint(r, a, 0), ringPoint(1.08 + random(i + 32) * 0.1, a, -0.13), ringPoint(1.1, a + 0.055, -0.13)], weight: i % 5 === 0 ? 3 : 1, seed: i + 2300, terminal: i % 3 === 0, bright: i % 5 === 0 });
  }
  return traces;
}

/** Transparent, perspective-projected circuit sphere shared by chat, PiP and HUD. */
export function Orb({ state = "idle", tone = "blue", emotion, energyRef, size = 240, className = "" }: OrbProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef(state);
  const toneRef = useRef(tone);
  const resolvedEmotion = emotion ?? (state === "thinking" ? "focused" : state === "listening" ? "curious" : state === "speaking" ? "excited" : "calm");
  const emotionRef = useRef(resolvedEmotion);
  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => { toneRef.current = tone; }, [tone]);
  useEffect(() => { emotionRef.current = resolvedEmotion; }, [resolvedEmotion]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d", { alpha: true });
    if (!canvas || !ctx) return;
    let frameWindow = canvas.ownerDocument.defaultView ?? window;
    const inputWindow = frameWindow;
    const motion = inputWindow.matchMedia("(prefers-reduced-motion: reduce)");
    let reduced = motion.matches;
    const onMotion = () => { reduced = motion.matches; };
    motion.addEventListener("change", onMotion);
    let targetX = 0, targetY = 0, pointerX = 0, pointerY = 0;
    const onPointer = (event: PointerEvent) => {
      if (event.pointerType === "touch" || reduced) return;
      const bounds = canvas.getBoundingClientRect();
      const reach = Math.max(bounds.width, 1);
      targetX = Math.max(-1, Math.min(1, (event.clientX - bounds.left - bounds.width / 2) / reach));
      targetY = Math.max(-1, Math.min(1, (event.clientY - bounds.top - bounds.height / 2) / reach));
    };
    const resetPointer = () => { targetX = 0; targetY = 0; };
    const onPointerOut = (event: PointerEvent) => { if (!event.relatedTarget) resetPointer(); };
    inputWindow.addEventListener("pointermove", onPointer, { passive: true });
    inputWindow.addEventListener("pointerout", onPointerOut, { passive: true });
    inputWindow.addEventListener("blur", resetPointer);
    const dpr = Math.min(inputWindow.devicePixelRatio || 1, 2);
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const small = size < 150;
    const traces = makeTraces(small);
    const center = size / 2;
    const unit = size / 460;
    let visible = true;
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; });
    observer.observe(canvas);
    let frame = 0, last = 0, clock = 0, rotation = 0, energy = 0, heat = 0, tilt = 0, red = 0;

    let lastStaticKey = "";
    const draw = (now: number) => {
      frameWindow = canvas.ownerDocument.defaultView ?? frameWindow;
      frame = frameWindow.requestAnimationFrame(draw);
      if (now - last < (reduced ? 100 : 1000 / 30)) return;
      const dt = last ? Math.min((now - last) / 1000, 0.08) : 1 / 30;
      last = now;
      if (!visible || canvas.ownerDocument.hidden) return;
      const current = stateRef.current;
      const staticKey = `${current}:${emotionRef.current}:${toneRef.current}`;
      if (reduced && staticKey === lastStaticKey) return;
      lastStaticKey = reduced ? staticKey : "";
      const mood = MOODS[emotionRef.current];
      const follow = 1 - Math.exp(-dt * 5);
      const audio = reduced ? 0 : energyRef?.current ?? 0;
      const activity = current === "speaking" ? 0.22 : current === "listening" ? 0.1 : current === "thinking" ? 0.16 : 0;
      const wanted = Math.max(Number.isFinite(audio) ? Math.min(1, Math.max(0, audio)) : 0, activity);
      const wantedRed = toneRef.current === "red" || emotionRef.current === "angry" ? 1 : 0;
      energy = reduced ? wanted : energy + (wanted - energy) * (1 - Math.exp(-dt * (wanted > energy ? 15 : 5)));
      heat = reduced ? mood.heat : heat + (mood.heat - heat) * follow;
      tilt = reduced ? mood.tilt : tilt + (mood.tilt - tilt) * follow;
      red = reduced ? wantedRed : red + (wantedRed - red) * follow;
      pointerX += ((reduced ? 0 : targetX) - pointerX) * follow;
      pointerY += ((reduced ? 0 : targetY) - pointerY) * follow;
      if (!reduced) {
        clock += dt;
        rotation += dt * mood.speed * (current === "thinking" ? 1.85 : 1 + energy * 0.5);
      }
      const radius = size * 0.375 * (1 + (reduced ? 0 : Math.sin(clock * 0.9) * 0.006 + energy * 0.025));
      const yaw = -0.25 + (reduced ? 0 : Math.sin(rotation * 0.35) * 0.16 + pointerX * 0.36);
      const pitch = -0.18 + (reduced ? 0 : pointerY * 0.35 + tilt + Math.sin(clock * 0.23) * 0.06);
      const cy = Math.cos(yaw), sy = Math.sin(yaw), cx = Math.cos(pitch), sx = Math.sin(pitch);
      const project = (p: Vec): Vec => {
        const x = p.x * cy + p.z * sy;
        const z = -p.x * sy + p.z * cy;
        const y = p.y * cx - z * sx;
        const depth = p.y * sx + z * cx;
        const scale = radius * 4.8 / (4.8 - depth);
        return { x: center + x * scale, y: center + y * scale, z: depth };
      };
      const ink = (alpha: number, pale = false) => `rgba(255,${Math.round((pale ? 223 : 164) - red * (pale ? 82 : 100))},${pale ? 132 : 37},${Math.min(1, Math.max(0, alpha))})`;
      const node = (p: Vec, strength: number) => {
        const s = Math.max(0.6, unit * strength);
        const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, s * 6);
        glow.addColorStop(0, ink(0.65)); glow.addColorStop(0.25, ink(0.22)); glow.addColorStop(1, ink(0));
        ctx.fillStyle = glow; ctx.fillRect(p.x - s * 6, p.y - s * 6, s * 12, s * 12);
        ctx.beginPath(); ctx.arc(p.x, p.y, s * 0.65, 0, TAU); ctx.fillStyle = ink(0.95, true); ctx.fill();
      };
      ctx.clearRect(0, 0, size, size);
      ctx.globalCompositeOperation = "lighter";
      ctx.lineCap = "round";
      // A faint volume glow leaves the interior transparent and the tiny emitter readable.
      const aura = ctx.createRadialGradient(center, center, 0, center, center, radius * 1.12);
      aura.addColorStop(0, ink(0.045)); aura.addColorStop(0.7, ink(0.025)); aura.addColorStop(1, ink(0));
      ctx.fillStyle = aura; ctx.fillRect(0, 0, size, size);
      // Local pools of projected light interrupt the precision of the circuit edges.
      for (const [x, y, z, spread, opacity] of [
        [-0.58, -0.32, 0.2, 0.32, 0.095], [-0.64, 0.2, 0.1, 0.25, 0.07],
        [0.18, -0.66, 0.3, 0.23, 0.065], [0.42, 0.48, -0.1, 0.26, 0.055],
        [-0.15, -0.12, 0.3, 0.33, 0.08], [-0.4, 0.79, 0.1, 0.2, 0.055],
      ]) {
        const p = project({ x, y, z });
        const haze = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, radius * spread);
        haze.addColorStop(0, ink(opacity)); haze.addColorStop(0.4, ink(opacity * 0.65)); haze.addColorStop(1, ink(0));
        ctx.fillStyle = haze; ctx.fillRect(p.x - radius * spread, p.y - radius * spread, radius * spread * 2, radius * spread * 2);
      }
      for (const trace of traces) {
        const points = trace.points.map(project);
        const mid = points[points.length >> 1];
        const front = (mid.z + 1) / 2;
        const scan = reduced ? 0 : Math.pow(Math.max(0, Math.cos(trace.seed * 0.53 - clock * (current === "thinking" ? 2.2 : 0.7))), 16);
        const mass = mid.x < center - radius * 0.2 ? 1.35 : mid.y > center + radius * 0.3 ? 0.85 : 1;
        const alpha = (0.12 + front * 0.4 + scan * 0.18 + energy * 0.12 + heat * 0.1) * (trace.bright ? 1.8 : 1) * mass;
        ctx.beginPath();
        points.forEach((p, i) => { if (!i) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
        if (trace.fill) { ctx.fillStyle = ink(trace.fill); ctx.fill(); }
        ctx.lineWidth = Math.max(0.3, unit * trace.weight * (0.7 + front * 0.5));
        const isPlate = trace.seed >= 2500 && trace.seed < 2507;
        ctx.setLineDash(isPlate ? [unit * 11, unit * 4, unit * 2, unit * 7] : []);
        ctx.strokeStyle = ink(alpha * (isPlate ? 0.45 : 1), trace.bright || trace.seed % 13 === 0); ctx.stroke();
        ctx.setLineDash([]);
        if (trace.weight > 1.8 || trace.bright) {
          ctx.lineWidth = Math.max(1, unit * 7); ctx.strokeStyle = ink(alpha * 0.11); ctx.stroke();
        }
        if (trace.terminal && mid.z > -0.4) node(points[points.length - 1], 0.7 + front * 0.65 + scan * 0.6);
        // A moving packet follows a physical circuit instead of floating over the canvas.
        if (!reduced && trace.points.length > 5 && trace.seed % (small ? 9 : 7) === 0) {
          const index = Math.floor((clock * (0.28 + energy * 0.3) + random(trace.seed)) % 1 * points.length);
          node(points[index], 1.1 + energy * 0.7);
        }
      }
      // White-gold emitter: a hot, incomplete spiral with horizontal optical streaks.
      const core = project({ x: -0.095, y: -0.035, z: 0.12 });
      const bloom = ctx.createRadialGradient(core.x, core.y, 0, core.x, core.y, radius * 0.38);
      bloom.addColorStop(0, ink(0.65, true)); bloom.addColorStop(0.16, ink(0.24));
      bloom.addColorStop(0.48, ink(0.045)); bloom.addColorStop(1, ink(0));
      ctx.fillStyle = bloom; ctx.fillRect(core.x - radius * 0.38, core.y - radius * 0.38, radius * 0.76, radius * 0.76);
      // Unequal optical streaks spill diagonally from the hot left lip of the core.
      for (let j = 0; j < 7; j++) {
        const x = core.x - radius * 0.04, y = core.y - radius * (0.045 + j * 0.008);
        const endX = x + radius * (0.4 + random(j + 94) * 0.37);
        const endY = y - radius * (0.015 + random(j + 55) * 0.12);
        const flare = ctx.createLinearGradient(x - radius * 0.11, y, endX, endY);
        flare.addColorStop(0, ink(0)); flare.addColorStop(0.15, ink(0.32, true)); flare.addColorStop(0.4, ink(0.13)); flare.addColorStop(1, ink(0));
        ctx.beginPath(); ctx.moveTo(x - radius * 0.11, y + radius * 0.01); ctx.lineTo(endX, endY);
        ctx.lineWidth = Math.max(1, unit * (j % 2 ? 8 : 2)); ctx.strokeStyle = flare; ctx.stroke();
      }
      for (let j = 0; j < 9; j++) {
        ctx.beginPath();
        for (let k = 0; k <= 60; k++) {
          const a = k / 60 * (3.4 + j * 0.21) + j * 0.7 + (reduced ? 0 : Math.sin(rotation) * 0.18);
          const r = 0.045 + j * 0.014 + k / 60 * 0.025 + Math.sin(k * 0.45 + j) * 0.002;
          const p = project({ x: -0.095 + Math.cos(a) * r, y: -0.035 + Math.sin(a) * r * 0.88, z: 0.12 + j * 0.012 });
          if (!k) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
        }
        ctx.lineWidth = Math.max(0.55, unit * (j % 3 === 0 ? 2.1 : 0.7));
        ctx.strokeStyle = ink(j < 4 ? 0.9 : 0.38, true); ctx.stroke();
        ctx.lineWidth = unit * 5; ctx.strokeStyle = ink(0.08); ctx.stroke();
      }
      node({ ...core, x: core.x - radius * 0.035, y: core.y - radius * 0.06 }, 3.2 + energy * 1.5);
      ctx.beginPath(); ctx.moveTo(core.x - radius * 0.25, core.y - radius * 0.06); ctx.lineTo(core.x + radius * 0.56, core.y - radius * 0.06);
      ctx.lineWidth = Math.max(0.4, unit * 0.7); ctx.strokeStyle = ink(0.55, true); ctx.stroke();
      ctx.globalCompositeOperation = "source-over";
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
    <div className={`orb orb--${state} orb--${tone} orb--${resolvedEmotion} ${className}`} style={{ width: size, height: size }} aria-hidden>
      <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />
    </div>
  );
}
