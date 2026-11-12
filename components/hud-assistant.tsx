"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Orb, type OrbEmotion, type OrbState, type OrbTone } from "./orb";
import { CloseIcon, FloatIcon, MicIcon, MoveIcon, PanelIcon, RecenterIcon, SendIcon, SpeakerIcon, SpeakerOffIcon } from "./icons";
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

  // Ao abrir, a linha de comando já recebe o caret.
  useEffect(() => {
    if (!open) return;
    const node = inputRef.current;
    if (node && !node.disabled) node.focus();
  }, [open]);

  useEffect(() => {
    voiceRef.current = voiceOn;
  }, [voiceOn]);

  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  useEffect(() => {
    const stored = window.localStorage.getItem(VOICE_KEY);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- preferência lida uma vez após hidratar
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
            if (text) {
              setReply(text);
              showBubble();
              setTone("blue");
              if (voiceRef.current) enqueueSpeech([text]);
            }
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
            showBubble();
            break;
          }
        }
      };

      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message, ack: true }),
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
          showBubble();
        }
      } finally {
        busyRef.current = false;
        setBusy(false);
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [enqueueSpeech, feedSpeech, flushSpeech, showBubble, stopSpeech],
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
        showBubble();
      } finally {
        setApprovalSending(false);
      }
    },
    [approval, approvalSending, showBubble],
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
      showBubble();
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
        showBubble();
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
        showBubble();
      } finally {
        setTranscribing(false);
      }
    }
  }, [pumpEnergy, recording, send, showBubble, stopMicEnergy, stopSpeech, transcribing]);

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

  const bubbleText = error || reply;
  const bubbleShown = bubbleVisible && (Boolean(bubbleText) || busy);

  return (
    <div
      className={`hud ${open ? "is-open" : ""}`}
      data-hud="assistant"
      data-state={orbState}
      data-pending={approval ? "true" : undefined}
    >
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
        <button type="button" className="hud-drag" title="Mover janela" aria-label="Mover janela">
          <MoveIcon size={13} />
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
        <div className="hud-halo" aria-hidden="true" />
        <div className="hud-orb">
          <Orb state={orbState} tone={tone} emotion={emotion} energyRef={energyRef} size={258} />
        </div>
        <span className="hud-status">{status}</span>
      </div>

      <div className={`hud-bubble ${bubbleShown ? "is-visible" : ""} ${error && !reply ? "is-error" : ""}`}>
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
          <p className="hud-approval-kicker">Confirmação necessária</p>
          <p className="hud-approval-line">
            <strong>{approval.label}</strong>
          </p>
          {approval.detail ? <pre title={approval.detail.slice(0, 200)}>{approval.detail.slice(0, 200)}</pre> : null}
          <div className="hud-approval-actions">
            <button type="button" onClick={() => void decideApproval(true)} disabled={approvalSending}>AUTORIZAR</button>
            <button type="button" onClick={() => void decideApproval(false)} disabled={approvalSending}>RECUSAR</button>
          </div>
        </div>
      ) : null}

      <div className={`hud-field ${recording ? "is-recording" : ""}`}>
        <textarea
          ref={inputRef}
          value={input}
          rows={1}
          placeholder={recording ? "Gravando…" : "Pergunte ou fale"}
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
          <MicIcon size={16} />
        </button>
        <button
          type="button"
          className="hud-icon hud-send"
          onClick={submit}
          disabled={busy || transcribing || (!input.trim() && !recording)}
          title="Enviar"
          aria-label="Enviar"
        >
          <SendIcon size={16} />
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
    justify-content: center; gap: 6px; padding: 8px 12px 12px; overflow: hidden;
    font-family: var(--font-geist-sans), system-ui, sans-serif;
    color: var(--jv-text); background: transparent;
  }
  .hud.is-open { justify-content: flex-start; }
  /* véu neutro único: dá contraste sobre qualquer desktop, sem virar caixa */
  .hud::before {
    content: ""; position: absolute; inset: 0; z-index: 0; pointer-events: none;
    background:
      radial-gradient(78% 56% at 50% 34%, rgba(7,8,9,.7) 0%, rgba(7,8,9,.44) 52%, rgba(7,8,9,0) 78%),
      linear-gradient(180deg, rgba(7,8,9,0) 32%, rgba(7,8,9,.55) 58%, rgba(7,8,9,.9) 100%);
  }
  .hud-tools {
    position: absolute; top: 6px; right: 8px; z-index: 6;
    display: flex; align-items: center; gap: 2px;
    opacity: 0; pointer-events: none; transition: opacity .16s ease;
  }
  /* em repouso nada aparece, mas o canto continua arrastando a janela */
  .hud-tools .hud-drag { pointer-events: auto; }
  .hud.is-open .hud-tools, .hud-tools:focus-within { opacity: 1; pointer-events: auto; }
  .hud.is-open .hud-tools {
    position: static; align-self: stretch; justify-content: flex-end;
    flex: 0 0 auto; height: 22px;
  }
  .hud-tools button {
    width: 22px; height: 22px; display: grid; place-items: center;
    border: 0; border-radius: 0; background: none; color: var(--jv-muted);
    cursor: pointer; transition: color .15s ease; -webkit-app-region: no-drag;
  }
  .hud-tools button:hover { color: var(--jv-accent-2); }
  .hud-tools button.is-on { color: var(--jv-accent); }
  .hud-tools button:focus-visible { outline: 1px solid var(--jv-accent); outline-offset: 1px; }
  .hud-tools button.hud-drag { -webkit-app-region: drag; cursor: grab; }
  .hud-tools button.hud-drag:active { cursor: grabbing; }
  .hud-core {
    position: relative; z-index: 1; display: flex; flex-direction: column; align-items: center;
    gap: 2px; cursor: pointer; outline: none; border-radius: 50%;
    -webkit-app-region: no-drag;
  }
  .hud[data-pending] .hud-bubble { opacity: 0; }
  .hud-core:focus-visible { outline: 1px solid var(--jv-accent); outline-offset: 8px; }
  .hud-halo {
    position: absolute; left: 50%; top: 46%; width: 318px; height: 318px;
    transform: translate(-50%, -50%); border-radius: 50%; pointer-events: none; z-index: 0;
    background: radial-gradient(circle, rgba(255,138,30,.12) 0%, rgba(255,120,20,.045) 44%, rgba(255,120,20,0) 68%);
    animation: hud-halo 9s ease-in-out infinite;
  }
  .hud-orb {
    position: relative; z-index: 1; display: grid; place-items: center;
    animation: hud-breathe 8s ease-in-out infinite; will-change: transform;
  }
  .hud-orb .orb { animation: hud-turn 240s linear infinite; will-change: transform; }
  .hud-status {
    position: relative; z-index: 1; display: inline-flex; align-items: center; gap: 8px;
    font: 500 10px/1 var(--font-geist-mono), ui-monospace, monospace;
    letter-spacing: .2em; text-transform: uppercase; color: var(--jv-muted);
    white-space: nowrap; user-select: none;
  }
  .hud-status::before {
    content: ""; width: 4px; height: 4px; flex: 0 0 auto;
    transform: rotate(45deg); background: currentColor; opacity: .85;
  }
  .hud[data-state="listening"] .hud-status,
  .hud[data-state="thinking"] .hud-status,
  .hud[data-state="speaking"] .hud-status { color: var(--jv-accent-2); }
  .hud-core canvas { position: relative; z-index: 1; display: block; }
  .hud-bubble {
    position: relative; z-index: 1;
    width: calc(100% + 24px); max-height: 0; opacity: 0; overflow: hidden; pointer-events: none;
    margin: 0 -12px; padding: 0 14px;
    transition: opacity .18s ease, max-height .22s ease, padding .22s ease;
  }
  .hud-bubble.is-visible {
    max-height: 90px; opacity: 1; pointer-events: auto; overflow-y: auto;
    padding: 10px 14px 12px;
  }
  .hud-bubble::-webkit-scrollbar { width: 3px; }
  .hud-bubble::-webkit-scrollbar-thumb { background: rgba(255,255,255,.16); border-radius: 3px; }
  .hud-bubble-q {
    margin: 0 0 5px; font: 400 11px/1.4 var(--font-geist-mono), ui-monospace, monospace;
    letter-spacing: .02em; color: var(--jv-muted);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .hud-bubble-a { font-size: 14px; line-height: 1.55; color: var(--jv-text); word-break: break-word; }
  .hud-bubble-a p { margin: 0 0 6px; }
  .hud-bubble-a p:last-child { margin: 0; }
  .hud-bubble-a strong { color: var(--jv-text); font-weight: 600; }
  .hud-bubble-a em { color: var(--jv-muted); }
  .hud-bubble-a a {
    color: var(--jv-accent-2); text-decoration: underline;
    text-underline-offset: 3px; text-decoration-thickness: 1px;
  }
  .hud-bubble-a ul, .hud-bubble-a ol { margin: 4px 0 6px; padding-left: 18px; }
  .hud-bubble-a li { margin: 2px 0; }
  .hud-bubble-a code {
    font: 12px/1.5 var(--font-geist-mono), ui-monospace, monospace;
    color: var(--jv-accent-2); background: rgba(255,255,255,.06); padding: 0 3px;
  }
  .hud-bubble-a pre {
    margin: 4px 0 6px; padding: 2px 0 2px 10px; border-left: 1px solid var(--jv-line);
    background: none; overflow-x: auto;
  }
  .hud-bubble-a pre code { background: none; padding: 0; color: var(--jv-muted); }
  .hud-bubble.is-error .hud-bubble-a { color: var(--jv-danger); }
  .hud-dots { display: inline-flex; gap: 4px; padding: 3px 0 1px; }
  .hud-dots i { width: 3px; height: 3px; border-radius: 50%; background: var(--jv-accent); opacity: .35; animation: hud-dot 1.2s infinite ease-in-out; }
  .hud-dots i:nth-child(2) { animation-delay: .15s; }
  .hud-dots i:nth-child(3) { animation-delay: .3s; }
  @keyframes hud-dot { 0%, 80%, 100% { opacity: .2; transform: translateY(0); } 40% { opacity: 1; transform: translateY(-2px); } }
  .hud-approval {
    position: absolute; left: 0; right: 0; bottom: 57px; z-index: 9;
    padding: 12px 14px 10px;
    background: linear-gradient(180deg, rgba(7,8,9,0) 0, rgba(7,8,9,.55) 18%, rgba(7,8,9,.8) 100%);
    color: var(--jv-text); -webkit-app-region: no-drag;
  }
  .hud-approval-kicker {
    margin: 0 0 5px; font: 600 10px/1 var(--font-geist-mono), ui-monospace, monospace;
    letter-spacing: .18em; text-transform: uppercase; color: var(--jv-accent);
  }
  .hud-approval-line {
    margin: 0 0 3px; font: 500 14px/1.3 var(--font-geist-sans), system-ui, sans-serif;
    color: var(--jv-text);
  }
  .hud-approval-line strong { font-weight: 600; }
  .hud-approval pre {
    margin: 0 0 8px; padding: 0; max-height: 16px; overflow: hidden;
    border: 0; background: none; color: var(--jv-muted);
    font: 400 11px/1.45 var(--font-geist-mono), ui-monospace, monospace;
    white-space: nowrap; text-overflow: ellipsis;
  }
  .hud-approval-actions { display: flex; align-items: center; gap: 22px; }
  .hud-approval-actions button {
    min-height: 24px; padding: 0; border: 0; background: none; cursor: pointer;
    color: var(--jv-accent); font: 600 11px/1 var(--font-geist-mono), ui-monospace, monospace;
    letter-spacing: .08em; transition: color .15s ease;
  }
  .hud-approval-actions button:hover { color: var(--jv-accent-2); }
  .hud-approval-actions button:last-child { color: var(--jv-muted); }
  .hud-approval-actions button:last-child:hover { color: var(--jv-text); }
  .hud-approval-actions button:disabled { opacity: .5; cursor: wait; }
  .hud-approval-actions button:focus-visible { outline: 1px solid var(--jv-accent); outline-offset: 3px; }
  .hud-field {
    position: relative; z-index: 1;
    width: 100%; display: flex; align-items: center; gap: 2px;
    max-height: 0; overflow: hidden; padding: 0; border: 0; border-bottom: 1px solid transparent;
    background: none; opacity: 0; pointer-events: none;
    transition: opacity .16s ease, max-height .2s ease, padding .2s ease, border-color .16s ease;
  }
  .hud.is-open .hud-field {
    max-height: 40px; padding: 2px 0 4px; border-bottom-color: var(--jv-line);
    opacity: 1; pointer-events: auto;
  }
  .hud-field:focus-within { border-bottom-color: var(--jv-accent); }
  .hud-field.is-recording { border-bottom-color: var(--jv-danger); }
  .hud-field textarea {
    flex: 1; min-width: 0; height: 30px; max-height: 30px; resize: none; padding: 5px 2px;
    border: 0; border-radius: 0; outline: 0; background: transparent;
    color: var(--jv-text); caret-color: var(--jv-accent);
    font: 400 15px/1.35 var(--font-geist-sans), system-ui, sans-serif;
  }
  .hud-field textarea::placeholder { color: var(--jv-muted); }
  .hud-field textarea:disabled { color: var(--jv-muted); }
  .hud-icon {
    width: 30px; height: 30px; flex: 0 0 auto; display: grid; place-items: center;
    border: 0; border-radius: 0; background: none; color: var(--jv-muted);
    cursor: pointer; transition: color .15s ease;
  }
  .hud-icon:hover { color: var(--jv-accent-2); }
  .hud-icon:focus-visible { outline: 1px solid var(--jv-accent); outline-offset: -3px; }
  .hud-icon.is-rec { color: var(--jv-danger); }
  .hud-icon.is-rec svg { animation: hud-mic 1.4s ease-in-out infinite; }
  .hud-send { color: var(--jv-accent); }
  .hud-send:hover { color: var(--jv-accent-2); }
  .hud-send:disabled { opacity: .3; cursor: default; color: var(--jv-dim); }

  @keyframes hud-breathe { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.014); } }
  @keyframes hud-turn { to { transform: rotate(360deg); } }
  @keyframes hud-halo { 0%, 100% { opacity: .55; } 50% { opacity: 1; } }
  @keyframes hud-mic { 0%, 100% { opacity: .55; } 50% { opacity: 1; } }

  @media (prefers-reduced-motion: reduce) {
    .hud *, .hud *::before, .hud *::after { animation: none !important; transition: none !important; }
  }
`;
