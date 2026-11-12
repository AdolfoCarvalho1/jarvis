"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

type Phase = "idle" | "opening" | "listening" | "transcribing";
type Capture = {
  controller: AbortController;
  stream?: MediaStream;
  context?: AudioContext;
  recorder?: MediaRecorder;
  frame?: number;
  timer?: number;
};
interface Options {
  energy: RefObject<number>;
  playing: () => boolean;
  onSpeechStart: () => void;
  onTranscript: (text: string, ms: number) => void;
  onError: (message: string) => void;
}

function release(capture: Capture) {
  if (capture.frame !== undefined) cancelAnimationFrame(capture.frame);
  window.clearTimeout(capture.timer);
  capture.stream?.getTracks().forEach((track) => track.stop());
  if (capture.context?.state !== "closed") void capture.context?.close().catch(() => undefined);
}

export function useVoiceInput(options: Options) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [heardSpeech, setHeardSpeech] = useState(false);
  const active = useRef<Capture | null>(null);
  const analyser = useRef<AnalyserNode | null>(null);
  const callbacks = useRef(options);
  useEffect(() => { callbacks.current = options; }, [options]);

  const clear = useCallback((capture: Capture) => {
    release(capture);
    if (active.current !== capture) return;
    active.current = null;
    analyser.current = null;
    callbacks.current.energy.current = 0;
    setHeardSpeech(false);
    setPhase("idle");
  }, []);

  const cancel = useCallback(() => {
    const capture = active.current;
    if (!capture) return;
    capture.controller.abort();
    clear(capture);
  }, [clear]);

  useEffect(() => () => {
    const capture = active.current;
    active.current = null;
    if (!capture) return;
    capture.controller.abort();
    release(capture);
  }, []);

  const finish = useCallback(() => {
    const recorder = active.current?.recorder;
    if (recorder?.state === "recording") recorder.stop();
  }, []);

  const start = useCallback(async (automatic: boolean) => {
    if (active.current) return;
    const capture: Capture = { controller: new AbortController() };
    active.current = capture;
    const { signal } = capture.controller;
    setPhase("opening");
    void fetch("/api/stt", { cache: "no-store", signal }).catch(() => undefined);
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
        throw new Error("Este navegador não oferece acesso ao microfone nesta página.");
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false, channelCount: 1 },
      });
      capture.stream = stream;
      if (signal.aborted) {
        release(capture);
        return;
      }
      const mimeType = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 48_000 });
      capture.recorder = recorder;
      const chunks: Blob[] = [];
      recorder.ondataavailable = ({ data }) => { if (data.size) chunks.push(data); };
      recorder.onerror = () => {
        clear(capture);
        if (!signal.aborted) callbacks.current.onError("A gravação foi interrompida. Confira o microfone.");
      };
      let voiced = false;
      recorder.onstop = async () => {
        release(capture);
        if (signal.aborted || active.current !== capture) return;
        analyser.current = null;
        if (automatic && !voiced) {
          clear(capture);
          return;
        }
        const audio = new Blob(chunks, { type: recorder.mimeType || mimeType || "audio/webm" });
        if (audio.size < 1_200) {
          clear(capture);
          callbacks.current.onError("A gravação ficou curta demais. Tente falar novamente.");
          return;
        }
        setPhase("transcribing");
        const started = performance.now();
        try {
          const response = await fetch("/api/stt", { method: "POST", body: audio, signal });
          const result = await response.json();
          signal.throwIfAborted();
          if (!response.ok || !result.text?.trim()) throw new Error(result.error || "Nenhuma fala reconhecida. Tente novamente.");
          clear(capture);
          callbacks.current.onTranscript(result.text.trim(), Math.round(performance.now() - started));
        } catch (error) {
          clear(capture);
          if (!signal.aborted) callbacks.current.onError(error instanceof Error ? error.message : "Falha na transcrição.");
        }
      };
      const context = new AudioContext();
      capture.context = context;
      const meter = context.createAnalyser();
      meter.fftSize = 512;
      context.createMediaStreamSource(stream).connect(meter);
      analyser.current = meter;
      void context.resume().catch(() => undefined);
      const samples = new Float32Array(meter.fftSize);
      let noise = 0.006;
      let onset = 0;
      let lastSpeech = 0;
      const tick = (now: number) => {
        if (signal.aborted || recorder.state !== "recording") return;
        meter.getFloatTimeDomainData(samples);
        const rms = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
        const playing = callbacks.current.playing();
        if (!playing || voiced) callbacks.current.energy.current = Math.min(1, rms * 6);
        const threshold = voiced ? Math.max(0.012, noise * 2.2)
          : Math.max(playing ? 0.046 : 0.022, noise * 3.5);
        if (rms >= threshold) {
          onset ||= now;
          lastSpeech = now;
          if (!voiced && now - onset >= (playing ? 190 : 105)) {
            voiced = true;
            setHeardSpeech(true);
            if (automatic) callbacks.current.onSpeechStart();
          }
        } else {
          onset = 0;
          if (!voiced && !playing) noise = 0.97 * noise + 0.03 * rms;
        }
        if (automatic && voiced && now - lastSpeech >= 850) finish();
        else capture.frame = requestAnimationFrame(tick);
      };
      recorder.start(250);
      capture.timer = window.setTimeout(finish, 24_000);
      capture.frame = requestAnimationFrame(tick);
      setPhase("listening");
    } catch (error) {
      clear(capture);
      if (!signal.aborted) callbacks.current.onError(error instanceof DOMException && error.name === "NotAllowedError"
        ? "Permita o uso do microfone e tente novamente."
        : error instanceof Error ? error.message : "Microfone indisponível.");
    }
  }, [clear, finish]);

  return { phase, heardSpeech, analyser, start, finish, cancel };
}
