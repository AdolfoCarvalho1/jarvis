"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Orb, type OrbEmotion, type OrbState, type OrbTone } from "./orb";
import { CloseIcon, FloatIcon, MicIcon, PanelIcon, RecenterIcon, SendIcon, SpeakerIcon, SpeakerOffIcon } from "./icons";
import { takeSpeech } from "@/lib/speech-text";
import { sentimentOf } from "@/lib/sentiment";

interface SpeechItem {
  text: string;
  audio?: Promise<Blob | null>;
}

interface SpeechQueue {
  items: SpeechItem[];
  draining: boolean;
  controller: AbortController;
}

declare global {
  interface Window {
    jarvisHud?: {
      setOpen: (open: boolean) => void;
      setMode: (mode: "assistant" | "harness") => void;
      recenter: () => void;
      hide: () => void;
      onTalk: (handler: () => void) => () => void;
      onHidden: (handler: () => void) => () => void;
    };
  }
}

const VOICE_KEY = "jarvis:hud:voice";
const BUBBLE_MS = 18000;
const STATES: OrbState[] = ["idle", "thinking", "listening", "speaking"];

export function HudAssistant({ onHarness }: { onHarness?: () => void }) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [voiceOn, setVoiceOn] = useState(true);
  const [tone, setTone] = useState<OrbTone>("blue");
  const [error, setError] = useState("");
  const [remoteState, setRemoteState] = useState<OrbState>("idle");
  const [reply, setReply] = useState("");
  const [question, setQuestion] = useState("");
  const [bubbleVisible, setBubbleVisible] = useState(false);
  const [approval, setApproval] = useState<{ operationId: string; approvalId: string; label: string; detail: string } | null>(null);
  const [approvalSending, setApprovalSending] = useState(false);

  const energyRef = useRef(0);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const busyRef = useRef(false);
  const voiceRef = useRef(true);
  const openRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const speechBufferRef = useRef("");
  const queueRef = useRef<SpeechQueue>({ items: [], draining: false, controller: new AbortController() });
  const bubbleTimerRef = useRef<number | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const energyRafRef = useRef<number | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  const micStreamRef = useRef<MediaStream | null>(null);
  const micCtxRef = useRef<AudioContext | null>(null);
  const micAnalyserRef = useRef<AnalyserNode | null>(null);
  const micRafRef = useRef<number | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const orbState: OrbState = recording
    ? "listening"
    : speaking
      ? "speaking"
      : busy || transcribing
        ? "thinking"
        : remoteState;

  const status = recording
    ? "OUVINDO"
    : transcribing
      ? "TRANSCREVENDO"
      : busy
        ? "PROCESSANDO"
        : speaking
          ? "FALANDO"
          : "EM REPOUSO";

  // Humor do orbe: cada estado vira uma emoção com movimento e cor próprios.
  const emotion: OrbEmotion = tone === "red"
    ? "angry"
    : error
      ? "alert"
      : recording
        ? "curious"
        : transcribing || busy
          ? "focused"
          : speaking
            ? "excited"
            : remoteState === "listening"
              ? "curious"
              : "calm";

  const applyOpen = useCallback((next: boolean) => {
    if (openRef.current === next) return;
    openRef.current = next;
    setOpen(next);
    window.jarvisHud?.setOpen(next);
  }, []);

  useEffect(() => {
    voiceRef.current = voiceOn;
  }, [voiceOn]);

  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  useEffect(() => {
    const stored = window.localStorage.getItem(VOICE_KEY);
    if (stored != null) setVoiceOn(stored === "1");
  }, []);

  useEffect(() => {
    void fetch("/api/stt", { cache: "no-store" }).catch(() => undefined);
  }, []);

  useEffect(() => {
    let source: EventSource | null = null;
    try {
      source = new EventSource("/api/orb-state/stream");
      source.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as { state?: string };
          setRemoteState(STATES.includes(data.state as OrbState) ? (data.state as OrbState) : "idle");
        } catch {
          /* evento malformado */
        }
      };
    } catch {
      /* sem stream: segue com estado local */
    }
    return () => source?.close();
  }, []);

  const showBubble = useCallback(() => {
    setBubbleVisible(true);
    if (bubbleTimerRef.current != null) window.clearTimeout(bubbleTimerRef.current);
    bubbleTimerRef.current = window.setTimeout(() => setBubbleVisible(false), BUBBLE_MS);
  }, []);

  const pumpEnergy = useCallback((analyser: AnalyserNode, rafRef: { current: number | null }) => {
    const data = new Uint8Array(analyser.fftSize);
    const tick = () => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        const sample = (data[i] - 128) / 128;
        sum += sample * sample;
      }
      energyRef.current = Math.max(0.08, Math.min(1, Math.sqrt(sum / data.length) * 5.4));
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const stopAudio = useCallback(() => {
    if (energyRafRef.current != null) {
      cancelAnimationFrame(energyRafRef.current);
      energyRafRef.current = null;
    }
    sourceRef.current?.disconnect();
    sourceRef.current = null;
    analyserRef.current?.disconnect();
    analyserRef.current = null;
    if (audioRef.current) {
      audioRef.current.onended = null;
      audioRef.current.onerror = null;
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    if (window.speechSynthesis) window.speechSynthesis.cancel();
  }, []);

  const prepareSpeech = useCallback(async (text: string): Promise<Blob | null> => {
    try {
      const response = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      return response.ok ? await response.blob() : null;
    } catch {
      return null;
    }
  }, []);

  const playSpeech = useCallback(
    async (text: string, blob: Blob | null) => {
      const signal = queueRef.current.controller.signal;
      if (signal.aborted) return;

      if (!blob) {
        if (!("speechSynthesis" in window)) return;
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = "pt-BR";
        utterance.rate = 1;
        utterance.pitch = 0.82;
        await new Promise<void>((resolve) => {
          utterance.onend = () => resolve();
          utterance.onerror = () => resolve();
          window.speechSynthesis.speak(utterance);
        });
        return;
      }

      try {
        const url = URL.createObjectURL(blob);
        objectUrlRef.current = url;
        const audio = new Audio(url);
        audioRef.current = audio;

        const ctx = audioCtxRef.current ?? new AudioContext();
        audioCtxRef.current = ctx;
        if (ctx.state === "suspended") await ctx.resume();
        if (signal.aborted) return;

        const source = ctx.createMediaElementSource(audio);
        sourceRef.current = source;
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.5;
        source.connect(analyser);
        analyser.connect(ctx.destination);
        analyserRef.current = analyser;

        await new Promise<void>((resolve) => {
          const finish = () => resolve();
          audio.onended = finish;
          audio.onerror = finish;
          void audio.play().then(
            () => pumpEnergy(analyser, energyRafRef),
            () => finish(),
          );
        });
      } catch {
        /* sem áudio: segue só com texto */
      } finally {
        stopAudio();
      }
    },
    [pumpEnergy, stopAudio],
  );

  const drainSpeech = useCallback(async () => {
    const queue = queueRef.current;
    if (queue.draining) return;
    queue.draining = true;
    setSpeaking(true);
    try {
      while (queue.items.length && !queue.controller.signal.aborted) {
        const item = queue.items.shift()!;
        const audio = await (item.audio ?? prepareSpeech(item.text));
        if (queue.controller.signal.aborted) break;
        await playSpeech(item.text, audio);
      }
    } finally {
      queue.draining = false;
      if (!queue.items.length) {
        setSpeaking(false);
        energyRef.current = 0;
      }
    }
  }, [playSpeech, prepareSpeech]);

  const enqueueSpeech = useCallback(
    (phrases: string[]) => {
      const queue = queueRef.current;
      if (!voiceRef.current || !phrases.length || queue.controller.signal.aborted) return;
      queue.items.push(...phrases.map((text) => ({ text })));
      const first = queue.items[0];
      first.audio ??= prepareSpeech(first.text);
      if (!queue.draining) void drainSpeech();
    },
    [drainSpeech, prepareSpeech],
  );

  const stopSpeech = useCallback(() => {
    queueRef.current.controller.abort();
    queueRef.current = { items: [], draining: false, controller: new AbortController() };
    speechBufferRef.current = "";
    setSpeaking(false);
    energyRef.current = 0;
    stopAudio();
  }, [stopAudio]);

  const feedSpeech = useCallback(
    (chunk: string) => {
      const { phrases, rest } = takeSpeech(speechBufferRef.current + chunk, false);
      speechBufferRef.current = rest;
      if (phrases.length) enqueueSpeech(phrases);
    },
    [enqueueSpeech],
  );

  const flushSpeech = useCallback(() => {
    const { phrases } = takeSpeech(speechBufferRef.current, true);
    speechBufferRef.current = "";
    if (phrases.length) enqueueSpeech(phrases);
  }, [enqueueSpeech]);

  const send = useCallback(
    async (raw: string) => {
      const message = raw.trim();
      if (!message || busyRef.current) return;

      busyRef.current = true;
      setBusy(true);
      setError("");
      setQuestion(message);
      setReply("");
      setBubbleVisible(true);
      setTone("blue");
      stopSpeech();

      const controller = new AbortController();
      abortRef.current = controller;
      let acc = "";
      let firstChunkAt = 0;

      const handleEvent = (event: Record<string, unknown>) => {
        if (controller.signal.aborted) return;
        switch (event.type) {
          case "ack": {
            const text = String(event.text ?? "").trim();
            if (text) enqueueSpeech([text]);
            break;
          }
          case "text": {
            const value = String(event.value ?? "");
            acc += value;
            setReply(acc);
            showBubble();
            feedSpeech(value);
            if (!firstChunkAt) firstChunkAt = Date.now();
            if (Date.now() - firstChunkAt > 300) {
              setTone(sentimentOf(acc) === "negative" ? "red" : "blue");
            }
            break;
          }
          case "tool": {
            const operationId = String(event.id ?? "");
            if (event.status === "approval" && event.approvalId) {
              setApproval({
                operationId,
                approvalId: String(event.approvalId),
                label: String(event.label ?? "Operação"),
                detail: String(event.detail ?? ""),
              });
              setBubbleVisible(true);
            } else {
              setApproval((current) => (current && current.operationId === operationId ? null : current));
            }
            break;
          }
          case "done": {
            setTone(sentimentOf(acc) === "negative" ? "red" : "blue");
            flushSpeech();
            showBubble();
            break;
          }
          case "error": {
            setError(String(event.message ?? "erro no modelo"));
            setTone("red");
            setApproval(null);
            break;
          }
        }
      };

      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message, ack: voiceRef.current }),
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          const detail = (await response.json().catch(() => null)) as { error?: string } | null;
          throw new Error(detail?.error ?? `HTTP ${response.status}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const chunks = buffer.split("\n\n");
          buffer = chunks.pop() ?? "";
          for (const chunk of chunks) {
            for (const line of chunk.split("\n")) {
              if (!line.startsWith("data:")) continue;
              try {
                handleEvent(JSON.parse(line.slice(5).trim()) as Record<string, unknown>);
              } catch {
                /* evento parcial */
              }
            }
          }
        }
      } catch (caught) {
        if (!controller.signal.aborted) {
          setError(caught instanceof Error ? caught.message : "falha ao contatar o modelo");
          setTone("red");
        }
      } finally {
        busyRef.current = false;
        setBusy(false);
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [applyOpen, enqueueSpeech, feedSpeech, flushSpeech, showBubble, stopSpeech],
  );

  const decideApproval = useCallback(
    async (approved: boolean) => {
      if (!approval || approvalSending) return;
      setApprovalSending(true);
      setError("");
      try {
        const response = await fetch("/api/approvals", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: approval.approvalId, approved }),
        });
        if (!response.ok) {
          const detail = (await response.json().catch(() => null)) as { error?: string } | null;
          throw new Error(detail?.error ?? `HTTP ${response.status}`);
        }
        setApproval(null);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "falha ao responder à confirmação");
      } finally {
        setApprovalSending(false);
      }
    },
    [approval, approvalSending],
  );

  const stopMicEnergy = useCallback(() => {
    if (micRafRef.current != null) {
      cancelAnimationFrame(micRafRef.current);
      micRafRef.current = null;
    }
    micAnalyserRef.current?.disconnect();
    micAnalyserRef.current = null;
    void micCtxRef.current?.close().catch(() => undefined);
    micCtxRef.current = null;
    energyRef.current = 0;
  }, []);

  const startRecording = useCallback(async () => {
    if (recording || transcribing) return;
    setError("");
    stopSpeech();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
      });
      micStreamRef.current = stream;

      const ctx = new AudioContext();
      micCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.4;
      source.connect(analyser);
      micAnalyserRef.current = analyser;
      pumpEnergy(analyser, micRafRef);

      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm";
      const recorder = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 48000 });
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        void finishRecording();
      };
      recorder.start(250);
      recorderRef.current = recorder;
      setRecording(true);
    } catch {
      setError("Microfone indisponível.");
      stopMicEnergy();
    }

    async function finishRecording() {
      stopMicEnergy();
      micStreamRef.current?.getTracks().forEach((track) => track.stop());
      micStreamRef.current = null;
      recorderRef.current = null;
      setRecording(false);

      const blob = new Blob(chunksRef.current, { type: "audio/webm" });
      chunksRef.current = [];
      if (blob.size < 2400) {
        setError("Não ouvi nada.");
        return;
      }

      setTranscribing(true);
      try {
        const response = await fetch("/api/stt", {
          method: "POST",
          headers: { "Content-Type": "audio/webm" },
          body: blob,
        });
        const data = (await response.json().catch(() => null)) as { text?: string; error?: string } | null;
        if (!response.ok || !data?.text?.trim()) throw new Error(data?.error || "não entendi o áudio");
        setInput("");
        await send(data.text.trim());
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "falha ao transcrever");
      } finally {
        setTranscribing(false);
      }
    }
  }, [applyOpen, pumpEnergy, recording, send, stopMicEnergy, stopSpeech, transcribing]);

  const stopRecording = useCallback(() => {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  }, []);

  const toggleRecording = useCallback(() => {
    if (recording) stopRecording();
    else void startRecording();
  }, [recording, startRecording, stopRecording]);

  const talkRef = useRef(toggleRecording);
  useEffect(() => {
    talkRef.current = toggleRecording;
  }, [toggleRecording]);
  useEffect(() => {
    window.jarvisHud?.onTalk?.(() => talkRef.current());
  }, []);

  const closeWindow = useCallback(() => {
    if (window.jarvisHud) window.jarvisHud.hide();
    else window.close();
  }, []);

  // Se a janela for escondida, nada de áudio tocando nem microfone aberto.
  useEffect(() => {
    window.jarvisHud?.onHidden?.(() => {
      stopSpeech();
      if (recorderRef.current?.state === "recording") recorderRef.current.stop();
      abortRef.current?.abort();
    });
  }, [stopSpeech]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && recording) {
        event.preventDefault();
        stopRecording();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [recording, stopRecording]);

  useEffect(() => {
    return () => {
      stopSpeech();
      stopMicEnergy();
      abortRef.current?.abort();
      micStreamRef.current?.getTracks().forEach((track) => track.stop());
      void audioCtxRef.current?.close().catch(() => undefined);
      if (bubbleTimerRef.current != null) window.clearTimeout(bubbleTimerRef.current);
    };
  }, [stopMicEnergy, stopSpeech]);

  function submit() {
    if (recording) {
      stopRecording();
      return;
    }
    const text = input.trim();
    if (!text || busyRef.current) return;
    setInput("");
    void send(text);
  }

  const bubbleText = reply || (busy ? "" : error);

  return (
    <div
      className={`hud ${open ? "is-open" : ""}`}
      data-hud="assistant"
      data-state={orbState}
    >
      <div className="hud-grip" title="Arraste para mover a janela">
        <i /><i /><i />
      </div>

      <div className="hud-tools">
        <button
          type="button"
          className={voiceOn ? "is-on" : ""}
          onClick={() => {
            const next = !voiceOn;
            setVoiceOn(next);
            window.localStorage.setItem(VOICE_KEY, next ? "1" : "0");
            if (!next) stopSpeech();
          }}
          title={voiceOn ? "Voz ativada" : "Voz desativada"}
          aria-label={voiceOn ? "Desativar voz" : "Ativar voz"}
        >
          {voiceOn ? <SpeakerIcon size={13} /> : <SpeakerOffIcon size={13} />}
        </button>
        <button type="button" onClick={() => window.open("http://127.0.0.1:3300/", "_blank")} title="Abrir o app" aria-label="Abrir o app">
          <FloatIcon size={13} />
        </button>
        {onHarness ? (
          <button type="button" onClick={onHarness} title="Modo harness" aria-label="Modo harness">
            <PanelIcon size={13} />
          </button>
        ) : null}
        <button type="button" onClick={() => window.jarvisHud?.recenter()} title="Recentralizar" aria-label="Recentralizar">
          <RecenterIcon size={13} />
        </button>
        <button type="button" onClick={closeWindow} title="Fechar" aria-label="Fechar">
          <CloseIcon size={13} />
        </button>
      </div>

      <div
        className="hud-core"
        role="button"
        tabIndex={0}
        aria-expanded={open}
        aria-label={open ? "Fechar controles" : "Abrir controles"}
        title={open ? "Clique para fechar" : "Clique para falar ou escrever"}
        onClick={() => applyOpen(!openRef.current)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            applyOpen(!openRef.current);
          }
        }}
      >
        <div className="hud-halo" />
        <Orb state={orbState} tone={tone} emotion={emotion} energyRef={energyRef} size={258} />
        <span className="hud-status">{status}</span>
      </div>

      <div className={`hud-bubble ${bubbleVisible && bubbleText ? "is-visible" : ""}`}>
        {question && bubbleText ? <p className="hud-bubble-q">{question}</p> : null}
        {bubbleText ? (
          <div className="hud-bubble-a">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                a: ({ href, children }) => (
                  <a
                    href={href}
                    target="_blank"
                    rel="noreferrer noopener"
                    onClick={(event) => {
                      event.preventDefault();
                      if (href) window.open(href, "_blank");
                    }}
                  >
                    {children}
                  </a>
                ),
              }}
            >
              {bubbleText}
            </ReactMarkdown>
          </div>
        ) : null}
        {busy && !reply && !error ? <span className="hud-dots"><i /><i /><i /></span> : null}
      </div>

      {approval ? (
        <div className="hud-approval" role="alertdialog" aria-label="Confirmação necessária" data-approval={approval.approvalId}>
          <p>
            <strong>{approval.label}</strong>
            <span>Aguardando sua confirmação</span>
          </p>
          {approval.detail ? <pre>{approval.detail.slice(0, 200)}</pre> : null}
          <div className="hud-approval-actions">
            <button type="button" onClick={() => void decideApproval(false)} disabled={approvalSending}>Recusar</button>
            <button type="button" onClick={() => void decideApproval(true)} disabled={approvalSending}>Autorizar</button>
          </div>
        </div>
      ) : null}

      <div className={`hud-field ${recording ? "is-recording" : ""}`}>
        <textarea
          ref={inputRef}
          value={input}
          rows={1}
          placeholder={recording ? "Gravando…" : "Escreva ou fale"}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
          disabled={recording}
        />
        <button
          type="button"
          className={`hud-icon ${recording ? "is-rec" : ""}`}
          onClick={toggleRecording}
          title={recording ? "Enviar áudio" : "Falar"}
          aria-label={recording ? "Enviar áudio" : "Falar"}
        >
          <MicIcon size={15} />
        </button>
        <button
          type="button"
          className="hud-icon hud-send"
          onClick={submit}
          disabled={busy || transcribing || (!input.trim() && !recording)}
          title="Enviar"
          aria-label="Enviar"
        >
          <SendIcon size={15} />
        </button>
      </div>

      <style>{CSS}</style>
    </div>
  );
}

const CSS = `
  html, body { background: transparent !important; overflow: hidden !important; margin: 0 !important; }
  .hud {
    position: fixed; inset: 0; display: flex; flex-direction: column; align-items: center;
    justify-content: flex-start; padding: 24px 10px 10px; gap: 6px; overflow: hidden;
    font-family: var(--font-geist-sans), system-ui, sans-serif; background: transparent;
  }
  .hud-grip {
    position: absolute; top: 0; left: 50%; transform: translateX(-50%); z-index: 40;
    display: flex; gap: 3px; align-items: center; justify-content: center;
    width: 120px; height: 22px; border-radius: 0 0 11px 11px;
    background: rgba(6,20,29,.55); border: 1px solid rgba(72,178,214,.22); border-top: 0;
    -webkit-app-region: drag; cursor: grab; opacity: .6; transition: opacity .15s ease;
  }
  .hud-grip:hover { opacity: .95; }
  .hud-grip:active { cursor: grabbing; }
  .hud-grip i { width: 3px; height: 3px; border-radius: 50%; background: #8ad6ec; }
  .hud-tools {
    position: absolute; top: 6px; right: 8px; display: flex; gap: 5px; z-index: 3;
    opacity: 0; transition: opacity .18s ease;
  }
  .hud.is-open .hud-tools, .hud-tools:focus-within { opacity: 1; }
  .hud-tools button {
    width: 24px; height: 24px; display: grid; place-items: center; cursor: pointer;
    border-radius: 8px; border: 1px solid rgba(72,178,214,.22);
    background: rgba(6,20,29,.72); color: #8ec4d8; backdrop-filter: blur(6px);
  }
  .hud-tools button:hover { background: rgba(18,54,72,.9); color: #d3f1fd; }
  .hud-tools button.is-on { color: #6fe0ff; border-color: rgba(96,216,255,.4); }
  .hud-core { position: relative; display: flex; flex-direction: column; align-items: center; gap: 0; cursor: pointer; outline: none; border-radius: 50%; -webkit-app-region: no-drag; }
  .hud-core:focus-visible { box-shadow: 0 0 0 1px rgba(96,216,255,.45); }
  .hud-halo {
    position: absolute; inset: -20px -14px -14px; z-index: 0; pointer-events: none;
    background: radial-gradient(closest-side, rgba(8,30,44,.8) 0%, rgba(4,12,18,.35) 64%, rgba(0,0,0,0) 100%);
  }
  .hud-core canvas { position: relative; z-index: 1; display: block; }
  .hud-status {
    position: relative; z-index: 1; margin-top: -4px;
    font: 9.5px/1 var(--font-geist-mono), ui-monospace, monospace; letter-spacing: .22em; color: #8fc6da;
  }
  .hud-bubble {
    width: 100%; max-height: 92px; overflow-y: auto; opacity: 0; transform: translateY(-5px);
    transition: opacity .18s ease, transform .18s ease; pointer-events: none;
    padding: 8px 10px; border-radius: 12px;
    background: rgba(5,17,24,.86); border: 1px solid rgba(72,178,214,.16);
    backdrop-filter: blur(8px); box-shadow: 0 10px 26px rgba(0,0,0,.35);
  }
  .hud-bubble.is-visible { opacity: 1; transform: none; pointer-events: auto; }
  .hud-bubble::-webkit-scrollbar { width: 3px; }
  .hud-bubble::-webkit-scrollbar-thumb { background: rgba(90,180,210,.3); border-radius: 3px; }
  .hud-bubble-q {
    margin: 0 0 5px; font: 600 8px/1.3 var(--font-geist-mono), ui-monospace, monospace;
    letter-spacing: .18em; text-transform: uppercase; color: #5f93a8;
  }
  .hud-bubble-a { font-size: 11.5px; line-height: 1.4; color: #e4f6ff; }
  .hud-bubble-a p { margin: 0 0 5px; }
  .hud-bubble-a p:last-child { margin: 0; }
  .hud-bubble-a strong { color: #c2f0ff; }
  .hud-bubble-a a { color: #6fe0ff; }
  .hud-bubble-a ul, .hud-bubble-a ol { margin: 3px 0 5px; padding-left: 16px; }
  .hud-bubble-a code {
    font: 10px/1.4 var(--font-geist-mono), ui-monospace, monospace;
    background: rgba(40,120,150,.22); padding: 1px 4px; border-radius: 4px;
  }
  .hud-dots { display: inline-flex; gap: 4px; padding: 2px 0; }
  .hud-dots i { width: 4px; height: 4px; border-radius: 50%; background: #5fb8d6; animation: hud-dot 1.1s infinite ease-in-out; }
  .hud-dots i:nth-child(2) { animation-delay: .15s; }
  .hud-dots i:nth-child(3) { animation-delay: .3s; }
  @keyframes hud-dot { 0%, 80%, 100% { opacity: .25; transform: translateY(0); } 40% { opacity: 1; transform: translateY(-2px); } }
  .hud-approval {
    position: absolute; left: 10px; right: 10px; bottom: 56px; z-index: 9;
    padding: 9px 10px; border-radius: 12px; border: 1px solid rgba(255,190,110,.55);
    background: rgba(22,15,6,.97); box-shadow: 0 12px 30px rgba(0,0,0,.55);
    color: #ffe6c2; font: 12px/1.4 var(--font-geist-sans), system-ui, sans-serif;
    -webkit-app-region: no-drag;
  }
  .hud-approval p { display: flex; flex-direction: column; gap: 1px; margin: 0 0 6px; }
  .hud-approval p span { color: #c9a97c; font-size: 10.5px; letter-spacing: .04em; }
  .hud-approval pre {
    margin: 0 0 7px; padding: 5px 6px; max-height: 52px; overflow: hidden;
    border-radius: 7px; background: rgba(0,0,0,.35); color: #e8d6b8;
    font: 10.5px/1.35 ui-monospace, monospace; white-space: pre-wrap; word-break: break-word;
  }
  .hud-approval-actions { display: flex; gap: 6px; justify-content: flex-end; }
  .hud-approval-actions button {
    border: 1px solid rgba(255,200,140,.35); border-radius: 8px; padding: 5px 10px;
    background: rgba(70,45,20,.55); color: #ffe6c2; font: 11px/1 inherit; cursor: pointer;
  }
  .hud-approval-actions button:last-child { background: #8a4f16; border-color: #c98636; color: #fff4e2; }
  .hud-approval-actions button:disabled { opacity: .6; cursor: wait; }
  .hud-field {
    width: 100%; display: flex; align-items: flex-end; gap: 6px; padding: 5px 5px 5px 12px;
    border-radius: 14px; border: 1px solid rgba(72,178,214,.24); background: rgba(4,15,22,.9);
    backdrop-filter: blur(8px); box-shadow: 0 10px 26px rgba(0,0,0,.4);
    opacity: 0; transform: translateY(-5px); pointer-events: none;
    transition: opacity .18s ease, transform .18s ease, border-color .15s, box-shadow .15s;
  }
  .hud.is-open .hud-field { opacity: 1; transform: none; pointer-events: auto; }
  .hud-field:focus-within { border-color: rgba(96,216,255,.5); box-shadow: 0 0 0 3px rgba(40,140,180,.12), 0 10px 26px rgba(0,0,0,.4); }
  .hud-field.is-recording { border-color: rgba(255,110,96,.6); box-shadow: 0 0 0 3px rgba(180,60,50,.14); }
  .hud-field textarea {
    flex: 1; resize: none; height: 30px; max-height: 30px; border: 0; outline: none; background: transparent;
    color: #e6f6ff; font: 12.5px/1.5 var(--font-geist-sans), system-ui, sans-serif; padding: 4px 0;
  }
  .hud-field textarea::placeholder { color: #6b96a8; }
  .hud-icon {
    width: 30px; height: 30px; display: grid; place-items: center; cursor: pointer; flex: 0 0 auto;
    border-radius: 9px; border: 1px solid rgba(72,178,214,.22); background: rgba(14,42,57,.72); color: #a8dcee;
    transition: background .15s, color .15s, border-color .15s;
  }
  .hud-icon:hover { background: rgba(26,70,92,.95); color: #e2f8ff; border-color: rgba(96,216,255,.45); }
  .hud-icon.is-rec { background: rgba(180,52,44,.45); color: #ffd9d4; border-color: rgba(255,120,100,.6); animation: hud-pulse 1.1s ease-in-out infinite; }
  @keyframes hud-pulse { 50% { box-shadow: 0 0 0 5px rgba(255,110,96,.14); } }
  .hud-send { background: rgba(22,84,110,.85); color: #cdf3ff; }
  .hud-send:disabled { opacity: .32; cursor: default; }
`;
