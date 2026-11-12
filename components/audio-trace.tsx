"use client";

import { useEffect, useRef, type RefObject } from "react";

interface AudioTraceProps {
  active: boolean;
  source: RefObject<AnalyserNode | null>;
}

export function AudioTrace({ active, source }: AudioTraceProps) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const bars = 55;
    let samples = new Uint8Array(0);
    let frame = 0;
    let width = 0;
    let height = 0;
    let lastFrame = 0;

    function paint() {
      if (!ctx) return;
      ctx.clearRect(0, 0, width, height);
      const analyser = active && !reducedMotion.matches ? source.current : null;
      if (analyser) {
        if (samples.length !== analyser.fftSize) samples = new Uint8Array(analyser.fftSize);
        analyser.getByteTimeDomainData(samples);
      }

      const step = width / bars;
      const barWidth = Math.min(2.5, step * 0.45);
      const center = height / 2;
      ctx.fillStyle = "rgba(96, 207, 248, 0.16)";
      ctx.fillRect(0, center - 0.5, width, 1);

      for (let bar = 0; bar < bars; bar++) {
        let amplitude = 0;
        if (analyser) {
          const start = Math.floor(bar * samples.length / bars);
          const end = Math.floor((bar + 1) * samples.length / bars);
          let sum = 0;
          for (let index = start; index < end; index++) sum += ((samples[index] - 128) / 128) ** 2;
          amplitude = Math.min(1, Math.sqrt(sum / Math.max(1, end - start)) * 4);
        }
        const envelope = Math.sin(Math.PI * (bar + 0.5) / bars);
        const length = 2 + amplitude * envelope * (height - 4);
        const opacity = 0.22 + envelope * 0.18 + amplitude * 0.56;
        ctx.fillStyle = amplitude > 0.7 && bar % 4 !== 0
          ? `rgba(255, 178, 85, ${opacity})`
          : `rgba(100, 224, 255, ${opacity})`;
        ctx.fillRect((bar + 0.5) * step - barWidth / 2, center - length / 2, barWidth, length);
      }
    }

    function loop(now: number) {
      if (document.hidden || reducedMotion.matches || !active) {
        frame = 0;
        return;
      }
      if (now - lastFrame >= 30) {
        paint();
        lastFrame = now;
      }
      frame = requestAnimationFrame(loop);
    }

    function updateAnimation() {
      cancelAnimationFrame(frame);
      frame = 0;
      paint();
      if (active && !reducedMotion.matches && !document.hidden) frame = requestAnimationFrame(loop);
    }

    const observer = new ResizeObserver(([entry]) => {
      width = entry.contentRect.width;
      height = entry.contentRect.height;
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(width * pixelRatio));
      canvas.height = Math.max(1, Math.round(height * pixelRatio));
      ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      paint();
    });
    observer.observe(canvas);
    reducedMotion.addEventListener("change", updateAnimation);
    document.addEventListener("visibilitychange", updateAnimation);
    updateAnimation();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      reducedMotion.removeEventListener("change", updateAnimation);
      document.removeEventListener("visibilitychange", updateAnimation);
    };
  }, [active, source]);

  return <canvas ref={ref} className="hologram-trace" aria-hidden="true" />;
}
