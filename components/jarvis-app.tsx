"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Orb, type OrbEmotion, type OrbState, type OrbTone } from "./orb";
import { AudioTrace } from "./audio-trace";
import { openFloatingOrb } from "./floating-orb";
import { TaskPanel } from "./task-panel";
import { useVoiceInput } from "./use-voice-input";
import { sentimentOf } from "@/lib/sentiment";
import { takeSpeech } from "@/lib/speech-text";
import {
  CheckIcon,
  CloseIcon,
  FloatIcon,
  MicIcon,
  PanelIcon,
  PlusIcon,
  SendIcon,
  SpeakerIcon,
  SpeakerOffIcon,
  TrashIcon,
} from "./icons";
import type { ChatMessage, MemoryItem, Reminder, StreamEvent, ToolEvent } from "@/lib/types";

interface ModelInfo {
  id: string;
  name: string;
  context: number;
  inputPrice: number;
  free: boolean;
  featured: boolean;
}

interface ContextInfo {
  summary: string;
  chars: number;
  messages: number;
  obsidian: boolean;
}

interface ConversationPage extends ContextInfo {
  history: ChatMessage[];
  conversationId: string;
  before: number | null;
}

interface StatusInfo {
  ok: boolean;
  storage: string;
  obsidian: boolean;
  model: string;
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

interface SpeechQueue {
  controller: AbortController;
  items: Array<{ text: string; audio?: Promise<Blob | null> }>;
  draining: boolean;
}

function formatMs(ms: number) {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1).replace(".", ",")} s`;
}

function readOperation(content: string): ToolEvent | null {
  try {
    const event = JSON.parse(content);
    return typeof event?.id === "string" && typeof event.label === "string" ? event : null;
  } catch {
    return null;
  }
}

const operationLabels: Record<ToolEvent["status"], string> = {
  approval: "Aguardando confirmação", running: "Em andamento", done: "Concluída",
  error: "Falhou", cancelled: "Interrompida",
};

function Operation({ event }: { event: ToolEvent }) {
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  async function decide(approved: boolean) {
    setSending(true);
    setError("");
    try {
      const response = await fetch("/api/approvals", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: event.approvalId, approved }),
      });
      if (!response.ok) throw new Error((await response.json()).error || "Falha ao enviar a decisão.");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Falha ao enviar a decisão.");
      setSending(false);
    }
  }
  const needsApproval = event.status === "approval";
  return (
    <article id={`operation-${event.id}`} className="operation" data-status={event.status} tabIndex={-1}>
      <header><strong>{event.label}</strong><span>{operationLabels[event.status]}</span></header>
      {event.detail ? needsApproval
        ? <pre tabIndex={0} aria-label="Parâmetros da operação">{event.detail}</pre> : <p>{event.detail}</p> : null}
      {needsApproval ? (
        <div className="operation-actions">
          <button type="button" disabled={sending} onClick={() => void decide(false)}>Recusar</button>
          <button type="button" disabled={sending} onClick={() => void decide(true)}>Autorizar</button>
        </div>
      ) : null}
      {error && needsApproval ? <p role="alert">{error}</p> : null}
      {event.proposalId ? <a href={`/api/proposals?id=${encodeURIComponent(event.proposalId)}`} download>Baixar diff para revisão</a> : null}
    </article>
  );
}

function shortDate(iso: string | null): string {
  if (!iso) return "sem prazo";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "sem prazo";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  }).format(date);
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`GET ${url} → ${response.status}`);
  return (await response.json()) as T;
}

export default function JarvisApp({ hud = false }: { hud?: boolean }) {
  const router = useRouter();
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [model, setModel] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [before, setBefore] = useState<number | null>(null);
  const [olderLoading, setOlderLoading] = useState(false);
  const [streamText, setStreamText] = useState("");
  const [toolEvents, setToolEvents] = useState<ToolEvent[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [drawer, setDrawer] = useState<null | "memoria" | "lembretes" | "contexto" | "tarefas">(null);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [contextInfo, setContextInfo] = useState<ContextInfo>({
    summary: "",
    chars: 0,
    messages: 0,
    obsidian: false,
  });
  const [status, setStatus] = useState<StatusInfo | null>(null);
  const [autoSpeak, setAutoSpeak] = useState(true);
  const [tone, setTone] = useState<OrbTone>("blue");
  const [showTranscript, setShowTranscript] = useState(true);
  const [perf, setPerf] = useState<{ tokens: number; ms: number; tps: number } | null>(null);
  const [timing, setTiming] = useState<{ firstTextMs?: number; totalMs?: number; audioMs?: number; sttMs?: number }>({});
  const [remoteState, setRemoteState] = useState<OrbState>("idle");
  const [speaking, setSpeaking] = useState(false);
  const [voiceSession, setVoiceSession] = useState(false);
  const [voiceNote, setVoiceNote] = useState("");
  const [reminderDraft, setReminderDraft] = useState("");
  const [reminderWhen, setReminderWhen] = useState("");
  const [memoryDraft, setMemoryDraft] = useState("");

  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const streamRef = useRef("");
  const abortRef = useRef<AbortController | null>(null);
  const audioStarted = useRef<number | null>(null);
  const pinnedToBottom = useRef(true);
  const conversationRef = useRef<string | null>(null);
  const expandedHistory = useRef(false);
  const preserveScroll = useRef<{ top: number; height: number } | null>(null);
  const energyRef = useRef(0);
  const energyTimerRef = useRef<number | null>(null);
  const pulseRef = useRef<number | null>(null);
  const streamRafRef = useRef<number | null>(null);
  const autoSpeakRef = useRef(autoSpeak);
  const toneLiveRef = useRef<OrbTone>("blue");
  const stateLiveRef = useRef<OrbState>("idle");
  const speechQueueRef = useRef<SpeechQueue | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const energyRafRef = useRef<number | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const sentimentAtRef = useRef(0);

  const { phase: voicePhase, heardSpeech, analyser: micAnalyserRef, start: startVoice,
    finish: finishVoice, cancel: cancelVoice } = useVoiceInput({
    energy: energyRef,
    playing: () => Boolean(speechQueueRef.current?.draining),
    onSpeechStart: stopResponse,
    onTranscript: (text, ms) => {
      void submitMessage(text, ms);
    },
    onError: (message) => {
      setVoiceSession(false);
      setVoiceNote(message);
    },
  });
  const listening = voicePhase === "listening";
  const transcribing = voicePhase === "transcribing";

  const loadContext = useCallback(async () => {
    try {
      const data = await getJson<ConversationPage>("/api/context");
      setContextInfo({
        summary: data.summary,
        chars: data.chars,
        messages: data.messages,
        obsidian: data.obsidian,
      });
      if (abortRef.current) return;
      if (conversationRef.current !== data.conversationId) {
        conversationRef.current = data.conversationId;
        expandedHistory.current = false;
      }
      const keepOlder = expandedHistory.current;
      if (!keepOlder) setBefore(data.before);
      setMessages((prev) => {
        const oldest = data.history[0];
        const older = keepOlder && oldest ? prev.filter((message) =>
          message.created_at < oldest.created_at ||
          (message.created_at === oldest.created_at && message.id < oldest.id)) : [];
        const next = [...older, ...data.history];
        return prev.length === next.length && prev.at(-1)?.id === next.at(-1)?.id ? prev : next;
      });
    } catch {
      /* silencioso */
    }
  }, []);

  async function loadOlder() {
    const id = conversationRef.current;
    if (!id || before === null || olderLoading) return;
    setOlderLoading(true);
    try {
      const data = await getJson<ConversationPage>(`/api/context?conversation=${encodeURIComponent(id)}&before=${before}`);
      if (conversationRef.current !== id) return;
      expandedHistory.current = true;
      const panel = scrollRef.current;
      if (panel) preserveScroll.current = { top: panel.scrollTop, height: panel.scrollHeight };
      setMessages((prev) => {
        const ids = new Set(prev.map((message) => message.id));
        return [...data.history.filter((message) => !ids.has(message.id)), ...prev];
      });
      setBefore(data.before);
    } catch {
      setError("Não foi possível carregar as mensagens anteriores.");
    } finally {
      setOlderLoading(false);
    }
  }

  const loadLists = useCallback(async () => {
    try {
      const [remindersData, memoriesData] = await Promise.all([
        getJson<{ reminders: Reminder[] }>("/api/reminders"),
        getJson<{ memories: MemoryItem[] }>("/api/memories"),
      ]);
      setReminders(remindersData.reminders);
      setMemories(memoriesData.memories);
    } catch {
      /* silencioso */
    }
  }, []);

  useEffect(() => {
    const stored = window.localStorage.getItem("jarvis:autoSpeak");
    if (stored != null) queueMicrotask(() => setAutoSpeak(stored === "1"));

    const synth = "speechSynthesis" in window ? window.speechSynthesis : null;
    const warm = () => synth?.getVoices();
    synth?.getVoices();
    synth?.addEventListener("voiceschanged", warm);

    (async () => {
      try {
        const [modelsData, healthData] = await Promise.all([
          getJson<{ models: ModelInfo[]; active: string }>("/api/models"),
          getJson<StatusInfo>("/api/health"),
        ]);
        setModels(modelsData.models);
        setModel(modelsData.active);
        setStatus(healthData);
      } catch {
        /* o seletor fica com o que já existe */
      }
      void loadContext();
      void loadLists();
    })();

    return () => synth?.removeEventListener("voiceschanged", warm);
  }, [loadContext, loadLists]);

  useEffect(() => {
    const refresh = () => { if (!document.hidden && !abortRef.current) void loadContext(); };
    const timer = window.setInterval(refresh, 4500);
    window.addEventListener("focus", refresh);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [loadContext]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const anchor = preserveScroll.current;
    if (anchor) {
      element.scrollTop = anchor.top + element.scrollHeight - anchor.height;
      preserveScroll.current = null;
    } else if (pinnedToBottom.current) element.scrollTop = element.scrollHeight;
  }, [messages, streamText, toolEvents, showTranscript]);

  useEffect(() => {
    if (voiceSession && voicePhase === "idle") {
      const timer = window.setTimeout(() => void startVoice(true), 220);
      return () => window.clearTimeout(timer);
    }
  }, [voiceSession, voicePhase, startVoice]);

  useEffect(() => {
    if (!hud) return;
    window.jarvisHud?.setOpen(showTranscript);
  }, [hud, showTranscript]);

  useEffect(() => {
    if (!hud) return;
    const source = new EventSource("/api/orb-state/stream");
    source.onmessage = (event) => {
      const { state } = JSON.parse(event.data);
      if (["idle", "thinking", "listening", "speaking"].includes(state)) setRemoteState(state);
    };
    source.onerror = () => setRemoteState("idle");
    return () => source.close();
  }, [hud]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 180)}px`;
  }, [input]);

  useEffect(() => {
    autoSpeakRef.current = autoSpeak;
  }, [autoSpeak]);

  useEffect(() => {
    return () => {
      if (energyTimerRef.current != null) window.clearInterval(energyTimerRef.current);
      if (pulseRef.current != null) window.clearInterval(pulseRef.current);
      if (energyRafRef.current != null) cancelAnimationFrame(energyRafRef.current);
      if (streamRafRef.current != null) cancelAnimationFrame(streamRafRef.current);
      speechQueueRef.current?.controller.abort();
      if (audioRef.current) audioRef.current.pause();
      void audioCtxRef.current?.close();
      window.speechSynthesis?.cancel();
      abortRef.current?.abort();
      energyRef.current = 0;
    };
  }, []);

  const orbState: OrbState = heardSpeech ? "listening" : speaking ? "speaking"
    : pending || transcribing ? "thinking" : listening ? "listening" : remoteState;

  // Emoção é o "humor" do orbe: deriva do que ele está fazendo agora.
  const orbEmotion: OrbEmotion = tone === "red" ? "angry"
    : heardSpeech ? "curious"
    : speaking ? "excited"
    : orbState === "thinking" ? "focused"
    : orbState === "listening" ? "curious"
    : orbState === "speaking" ? "excited"
    : "calm";

  useEffect(() => {
    toneLiveRef.current = tone;
  }, [tone]);

  useEffect(() => {
    stateLiveRef.current = orbState;
  }, [orbState]);

  // O HUD Electron não compartilha BroadcastChannel com o navegador: publica o estado no servidor.
  // 10 Hz só com o orbe ativo; mudança de estado sai na hora; em repouso, batimento de 2 s.
  useEffect(() => {
    if (hud) return;
    let lastState: OrbState | null = null;
    let lastTone: OrbTone | null = null;
    let lastAt = 0;

    const publish = () => {
      lastState = stateLiveRef.current;
      lastTone = toneLiveRef.current;
      lastAt = Date.now();
      void fetch("/api/orb-state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          energy: energyRef.current,
          tone: lastTone,
          state: lastState,
        }),
        keepalive: true,
      }).catch(() => {});
    };

    const timer = window.setInterval(() => {
      const state = stateLiveRef.current;
      const nextTone = toneLiveRef.current;
      if (state !== lastState || nextTone !== lastTone) {
        publish();
        return;
      }
      // Em repouso não publica nada: o HUD cai para idle sozinho pelo atraso.
      if (state !== "idle" && Date.now() - lastAt >= 100) publish();
    }, 100);
    return () => window.clearInterval(timer);
  }, [hud]);

  async function toggleFloating() {
    try {
      const response = await fetch("/api/hud", { method: "POST" });
      if (response.ok) return;
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(data?.error || "HUD indisponível");
    } catch (error) {
      try {
        await openFloatingOrb(() => ({
          energy: energyRef.current,
          tone: toneLiveRef.current,
          state: stateLiveRef.current,
        }));
      } catch {
        setError(error instanceof Error ? error.message : "não foi possível abrir o HUD");
      }
    }
  }

  const storedOperations = new Set(messages.filter((message) => message.role === "tool")
    .map((message) => readOperation(message.content)?.id));
  const liveOperations = toolEvents.filter((event) => !storedOperations.has(event.id));
  const awaitingApproval = liveOperations.find((event) => event.status === "approval");
  const pendingReminders = useMemo(() => reminders.filter((item) => !item.done).length, [reminders]);

  const pickerModels = useMemo(() => {
    const featured = models.filter((item) => item.featured);
    if (model && !featured.some((item) => item.id === model)) {
      const active = models.find((item) => item.id === model);
      if (active) return [active, ...featured];
    }
    return featured;
  }, [models, model]);

  function startEnergyDecay() {
    if (energyTimerRef.current) window.clearInterval(energyTimerRef.current);
    energyTimerRef.current = window.setInterval(() => {
      energyRef.current *= 0.9;
      if (energyRef.current < 0.02) energyRef.current = 0;
    }, 80);
  }

  function stopEnergy() {
    energyRef.current = 0;
    if (energyTimerRef.current) {
      window.clearInterval(energyTimerRef.current);
      energyTimerRef.current = null;
    }
  }

  function clearSpeechTimers() {
    if (pulseRef.current) {
      window.clearInterval(pulseRef.current);
      pulseRef.current = null;
    }
  }

  function endSpeechEnergy() {
    setSpeaking(false);
    stopEnergy();
    clearSpeechTimers();
  }

  function stopAudio() {
    if (energyRafRef.current) {
      cancelAnimationFrame(energyRafRef.current);
      energyRafRef.current = null;
    }
    if (sourceRef.current) {
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }
    if (analyserRef.current) {
      analyserRef.current.disconnect();
      analyserRef.current = null;
    }
    if (audioRef.current) {
      audioRef.current.onended = null;
      audioRef.current.onerror = null;
      audioRef.current.pause();
      audioRef.current.src = "";
      audioRef.current = null;
    }
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  }

  // Energia real da voz: RMS do áudio do edge-tts, amostrado no rAF.
  function pumpEnergy() {
    const analyser = analyserRef.current;
    if (!analyser) return;
    const data = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      const sample = (data[i] - 128) / 128;
      sum += sample * sample;
    }
    const rms = Math.sqrt(sum / data.length);
    energyRef.current = Math.max(0.1, Math.min(1, rms * 5.2));
    energyRafRef.current = requestAnimationFrame(pumpEnergy);
  }

  function startSimulatedSpeech() {
    energyRef.current = 0.72;
    startEnergyDecay();
    if (pulseRef.current) window.clearInterval(pulseRef.current);
    pulseRef.current = window.setInterval(() => {
      energyRef.current = Math.min(1, 0.62 + Math.random() * 0.38);
    }, 190);
  }

  function speakNative(text: string, signal: AbortSignal): Promise<void> {
    if (!("speechSynthesis" in window)) {
      setVoiceNote("Áudio indisponível neste navegador.");
      return Promise.resolve();
    }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "pt-BR";
    utterance.rate = 1;
    utterance.pitch = 0.82;
    const voices = window.speechSynthesis.getVoices();
    const preferred =
      voices.find((voice) => voice.lang === "pt-BR" && /antonio|daniel|ricardo|male|masculin/i.test(voice.name)) ??
      voices.find((voice) => voice.lang === "pt-BR") ??
      voices.find((voice) => voice.lang.startsWith("pt"));
    if (preferred) utterance.voice = preferred;

    return new Promise((resolve) => {
      if (signal.aborted) return resolve();
      startSimulatedSpeech();
      const finish = () => {
        window.clearTimeout(timeout);
        signal.removeEventListener("abort", finish);
        resolve();
      };
      const timeout = window.setTimeout(() => {
        window.speechSynthesis.cancel();
        finish();
      }, Math.min(90_000, Math.max(8_000, text.length * 130)));
      signal.addEventListener("abort", finish, { once: true });
      utterance.onend = finish;
      utterance.onerror = finish;
      utterance.onstart = markAudioStart;
      window.speechSynthesis.speak(utterance);
    });
  }

  async function prepareSpeech(text: string, signal: AbortSignal): Promise<Blob | null> {
    try {
      const response = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
        signal,
      });
      return response.ok ? await response.blob() : null;
    } catch {
      return null;
    }
  }

  async function playSpeech(text: string, blob: Blob | null, signal: AbortSignal) {
    if (signal.aborted) return;
    try {
      if (!blob) throw new Error("TTS indisponível.");
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

      await new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(() => fail(new Error("Tempo de reprodução excedido.")), 90_000);
        const finish = () => {
          window.clearTimeout(timer);
          signal.removeEventListener("abort", finish);
          resolve();
        };
        const fail = (error: unknown) => {
          window.clearTimeout(timer);
          signal.removeEventListener("abort", finish);
          reject(error);
        };
        signal.addEventListener("abort", finish, { once: true });
        audio.onended = finish;
        audio.onerror = fail;
        void audio.play().then(() => {
          if (!signal.aborted) {
            markAudioStart();
            pumpEnergy();
          }
        }, fail);
      });
    } catch {
      if (!signal.aborted) {
        stopAudio();
        await speakNative(text, signal);
      }
    } finally {
      if (!signal.aborted) {
        stopAudio();
        stopEnergy();
        clearSpeechTimers();
      }
    }
  }

  function queueSpeech(queue: SpeechQueue, phrases: string[]) {
    if (!phrases.length || queue.controller.signal.aborted || !autoSpeakRef.current) return;
    queue.items.push(...phrases.map((text) => ({ text })));
    const first = queue.items[0];
    first.audio ??= prepareSpeech(first.text, queue.controller.signal);
    if (!queue.draining) void drainSpeech(queue);
  }

  async function drainSpeech(queue: SpeechQueue) {
    queue.draining = true;
    setSpeaking(true);
    const signal = queue.controller.signal;
    try {
      while (queue.items.length && !signal.aborted) {
        const item = queue.items.shift()!;
        const audio = await (item.audio ?? prepareSpeech(item.text, signal));
        const next = queue.items[0];
        if (next && !signal.aborted) next.audio ??= prepareSpeech(next.text, signal);
        await playSpeech(item.text, audio, signal);
      }
    } finally {
      queue.draining = false;
      if (speechQueueRef.current === queue && !signal.aborted) {
        endSpeechEnergy();
      }
    }
  }

  function stopSpeaking() {
    speechQueueRef.current?.controller.abort();
    speechQueueRef.current = null;
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    stopAudio();
    endSpeechEnergy();
  }

  function markAudioStart() {
    if (audioStarted.current === null) return;
    const audioMs = Math.round(performance.now() - audioStarted.current);
    audioStarted.current = null;
    setTiming((previous) => ({ ...previous, audioMs }));
  }

  function stopResponse() {
    abortRef.current?.abort();
    stopSpeaking();
  }

  function toggleSpeak() {
    const next = !autoSpeak;
    autoSpeakRef.current = next;
    setAutoSpeak(next);
    window.localStorage.setItem("jarvis:autoSpeak", next ? "1" : "0");
    if (!next) stopSpeaking();
  }

  function setVoiceMode(active: boolean) {
    cancelVoice();
    setVoiceNote("");
    setVoiceSession(active);
  }

  function toggleMic() {
    if (voicePhase === "listening") {
      finishVoice();
      return;
    }
    if (voicePhase !== "idle") {
      setVoiceMode(false);
      return;
    }
    stopResponse();
    setVoiceNote("");
    void startVoice(voiceSession);
  }

  const talkRef = useRef(toggleMic);
  const hideRef = useRef(() => {
    stopResponse();
    setVoiceMode(false);
  });
  useEffect(() => {
    talkRef.current = toggleMic;
    hideRef.current = () => {
      stopResponse();
      setVoiceMode(false);
    };
  });
  useEffect(() => {
    if (!hud || !window.jarvisHud) return;
    const stopTalk = window.jarvisHud.onTalk(() => talkRef.current());
    const stopHide = window.jarvisHud.onHidden(() => hideRef.current());
    return () => { stopTalk(); stopHide(); };
  }, [hud]);

  async function changeModel(next: string) {
    const previous = model;
    setModel(next);
    const response = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: next }),
    });
    if (!response.ok) {
      setModel(previous);
      setError("Este modelo não está disponível agora.");
    }
  }

  async function newSession() {
    if (!window.confirm("Começar uma sessão nova? O histórico atual e o contexto serão apagados.")) return;
    stopResponse();
    setVoiceMode(false);
    const response = await fetch("/api/context", { method: "DELETE" }).catch(() => null);
    if (!response?.ok) {
      const result = await response?.json().catch(() => null);
      setError(result?.error || "Não foi possível iniciar uma nova sessão.");
      return;
    }
    setMessages([]);
    setStreamText("");
    setToolEvents([]);
    streamRef.current = "";
    setError("");
    setDrawer(null);
    await loadContext();
  }

  async function submitMessage(raw?: string, sttMs?: number) {
    const text = (raw ?? input).trim();
    if (!text) return;
    if (abortRef.current && !abortRef.current.signal.aborted) {
      if (raw) {
        setInput((draft) => draft ? draft + "\n" + raw : raw);
        setVoiceNote("A transcrição ficou no campo de mensagem enquanto a resposta termina.");
      }
      return;
    }

    if (!voiceSession) cancelVoice();
    stopSpeaking();
    audioStarted.current = performance.now();
    setTiming({ sttMs });
    pinnedToBottom.current = true;
    setShowTranscript(true);
    const controller = new AbortController();
    abortRef.current = controller;
    const speech: SpeechQueue = { controller: new AbortController(), items: [], draining: false };
    speechQueueRef.current = speech;
    let speechBuffer = "";
    const speakPart = (chunk: string, final = false) => {
      if (!autoSpeakRef.current || speech.controller.signal.aborted) return;
      const next = takeSpeech(speechBuffer + chunk, final);
      speechBuffer = next.rest;
      queueSpeech(speech, next.phrases);
    };

    setPending(true);
    setError("");
    setTone("blue");
    setPerf(null);
    setVoiceNote("");
    setStreamText("");
    streamRef.current = "";
    setToolEvents([]);
    if (raw === undefined) setInput("");

    const localUser: ChatMessage = {
      id: `local-${Date.now()}`,
      conversation_id: "",
      role: "user",
      content: text,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, localUser]);
    let accepted = false;
    let ended = false;

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, ack: autoSpeakRef.current }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        const detail = (await response.json().catch(() => ({ error: "falha ao contatar o modelo" }))) as {
          error?: string;
        };
        throw new Error(detail.error ?? `HTTP ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      const handleEvent = (event: StreamEvent) => {
        if (controller.signal.aborted || abortRef.current !== controller) return;
        switch (event.type) {
          case "ack": {
            // Frase de espera do agente rápido: entra na mesma fila da resposta.
            if (speechQueueRef.current) queueSpeech(speechQueueRef.current, [event.text]);
            break;
          }
          case "meta": {
            accepted = true;
            if (event.model) setModel(event.model);
            break;
          }
          case "timing": {
            setTiming((prev) => ({
              ...prev, firstTextMs: event.firstTextMs ?? prev.firstTextMs, totalMs: event.totalMs ?? prev.totalMs,
            }));
            break;
          }
          case "perf": {
            setPerf({ tokens: event.tokens, ms: event.ms, tps: event.tps });
            break;
          }
          case "text": {
            streamRef.current += event.value;
            speakPart(event.value);
            if (streamRafRef.current == null) {
              streamRafRef.current = requestAnimationFrame(() => {
                streamRafRef.current = null;
                setStreamText(streamRef.current);
              });
            }
            if (Date.now() - sentimentAtRef.current > 450) {
              sentimentAtRef.current = Date.now();
              setTone(sentimentOf(streamRef.current) === "negative" ? "red" : "blue");
            }
            break;
          }
          case "tool": {
            if (event.status === "approval") setShowTranscript(true);
            setToolEvents((prev) => {
              if (prev.some((item) => item.id === event.id)) return prev.map((item) => item.id === event.id ? event : item);
              return [...prev, event];
            });
            break;
          }
          case "context": {
            setContextInfo((prev) => ({ ...prev, chars: event.chars }));
            break;
          }
          case "done": {
            ended = true;
            const finalText = streamRef.current;
            setMessages((prev) => [
              ...prev,
              {
                id: event.messageId,
                conversation_id: "",
                role: "assistant",
                content: finalText,
                created_at: event.createdAt,
              },
            ]);
            if (streamRafRef.current != null) {
              cancelAnimationFrame(streamRafRef.current);
              streamRafRef.current = null;
            }
            setStreamText("");
            streamRef.current = "";
            setTone(sentimentOf(finalText) === "negative" ? "red" : "blue");
            speakPart("", true);
            void loadLists();
            break;
          }
          case "error": {
            ended = true;
            stopSpeaking();
            if (streamRafRef.current != null) {
              cancelAnimationFrame(streamRafRef.current);
              streamRafRef.current = null;
            }
            setError(event.message);
            setTone("red");
            setStreamText("");
            streamRef.current = "";
            break;
          }
        }
      };

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
              handleEvent(JSON.parse(line.slice(5).trim()) as StreamEvent);
            } catch {
              /* evento parcial */
            }
          }
        }
      }
      if (buffer.trim()) {
        for (const line of buffer.split("\n")) {
          if (!line.startsWith("data:")) continue;
          try {
            handleEvent(JSON.parse(line.slice(5).trim()) as StreamEvent);
          } catch {
            /* resto incompleto */
          }
        }
      }
      if (!ended && !controller.signal.aborted) throw new Error("A conexão encerrou antes da resposta. Confira o histórico.");
    } catch (failure) {
      if (abortRef.current === controller) {
        if (!controller.signal.aborted) {
          setError(failure instanceof Error ? failure.message : "Falha inesperada.");
          if (!accepted) setInput((draft) => draft ? `${draft}\n${text}` : text);
        }
        stopSpeaking();
        setStreamText("");
        streamRef.current = "";
      }
    } finally {
      if (abortRef.current === controller) {
        setPending(false);
        abortRef.current = null;
        setToolEvents((prev) => prev.map((item) =>
          item.status === "approval" || item.status === "running" ? { ...item, status: "cancelled" } : item));
        if (!controller.signal.aborted) void loadContext();
        else window.setTimeout(() => void loadContext(), 650);
      }
    }
  }

  async function addReminder() {
    const title = reminderDraft.trim();
    if (!title) return;
    const dueAt = reminderWhen ? new Date(reminderWhen).toISOString() : null;
    const response = await fetch("/api/reminders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, due_at: dueAt }),
    });
    if (response.ok) {
      setReminderDraft("");
      setReminderWhen("");
      void loadLists();
      void loadContext();
    }
  }

  async function toggleReminder(reminder: Reminder) {
    setReminders((prev) =>
      prev.map((item) => (item.id === reminder.id ? { ...item, done: item.done ? 0 : 1 } : item)),
    );
    await fetch(`/api/reminders/${reminder.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ done: !reminder.done }),
    });
    void loadLists();
  }

  async function removeReminder(id: string) {
    setReminders((prev) => prev.filter((item) => item.id !== id));
    await fetch(`/api/reminders/${id}`, { method: "DELETE" });
  }

  async function addMemory() {
    const content = memoryDraft.trim();
    if (!content) return;
    const response = await fetch("/api/memories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
    if (response.ok) {
      setMemoryDraft("");
      void loadLists();
    }
  }

  async function removeMemory(id: string) {
    setMemories((prev) => prev.filter((item) => item.id !== id));
    await fetch(`/api/memories/${id}`, { method: "DELETE" });
  }

  async function logout() {
    await fetch("/api/auth", { method: "DELETE" });
    router.replace("/login");
    router.refresh();
  }

  return (
    <div className={`shell ${hud ? "shell--hud" : ""} ${showTranscript ? messages.length === 0 && !pending ? "shell--empty" : "" : "shell--hologram"}`}
      data-hud={hud ? "assistant" : undefined}>
      <header className="topbar">
        <div className="brand-min" title={hud ? "Arraste aqui para mover a janela" : undefined}>
          J.<span>A.</span>R.<span>V.</span>I.<span>S.</span>
        </div>
        <div className="top-actions">
          <label className="model-picker">
            <span className="sr-only">Modelo</span>
            <select value={model} onChange={(event) => void changeModel(event.target.value)} aria-label="Modelo">
              {pickerModels.length === 0 && model ? <option value={model}>{model}</option> : null}
              {pickerModels.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <button
            className={`icon-btn ${autoSpeak ? "is-on" : ""}`}
            onClick={toggleSpeak}
            aria-label={autoSpeak ? "Desativar voz" : "Ativar voz"}
            title={autoSpeak ? "Voz ativada" : "Voz desativada"}
          >
            {autoSpeak ? <SpeakerIcon /> : <SpeakerOffIcon />}
          </button>
          {hud ? (
            <button type="button" className="icon-btn" onClick={() => {
              stopResponse();
              setVoiceMode(false);
              if (window.jarvisHud) window.jarvisHud.hide();
              else router.push("/");
            }} aria-label="Ocultar HUD" title="Ocultar HUD">
              <CloseIcon />
            </button>
          ) : (
            <button type="button" className="icon-btn" onClick={() => void toggleFloating()}
              aria-label="Abrir HUD" title="Abrir HUD">
              <FloatIcon />
            </button>
          )}
          <button
            className={`icon-btn ${drawer ? "is-on" : ""}`}
            onClick={() => setDrawer(drawer ? null : "memoria")}
            aria-label="Memória, lembretes, contexto e tarefas"
            title="Memória, lembretes, contexto e tarefas"
          >
            <PanelIcon />
          </button>
        </div>
      </header>

      <section className={`hero ${showTranscript ? "is-compact" : ""}`} data-state={orbState}>
        <div className="hologram-stage">
          <Orb className="hologram-orb" state={orbState} size={showTranscript ? (hud ? 76 : 114) : (hud ? 200 : 540)} tone={tone} emotion={orbEmotion} energyRef={energyRef} />
        </div>
        {!showTranscript ? <AudioTrace active={listening || speaking} source={listening ? micAnalyserRef : analyserRef} /> : null}
      </section>

      <div className="content" id="jarvis-transcript" hidden={!showTranscript}>
      {showTranscript ? (
      <main className="stage" ref={scrollRef} aria-label="Histórico da conversa" tabIndex={0}
        onScroll={(event) => {
          const panel = event.currentTarget;
          pinnedToBottom.current = panel.scrollHeight - panel.clientHeight - panel.scrollTop < 72;
        }}>
        {before !== null ? <button type="button" className="history-more" disabled={olderLoading} onClick={() => void loadOlder()}>
          {olderLoading ? "Carregando…" : "Carregar mensagens anteriores"}
        </button> : null}
        {messages.length === 0 && !pending ? (
          <div className="chat-empty">
            <h1>Como posso ajudar?</h1>
            <p>Escreva uma mensagem ou use o microfone para falar com o Jarvis.</p>
          </div>
        ) : null}
        {messages.map((message) => {
          if (message.role === "tool") {
            const operation = readOperation(message.content);
            return operation ? <Operation key={message.id} event={operation} /> : null;
          }
          return (
          <article
            key={message.id}
            className={`msg ${message.role === "user" ? "msg--user" : "msg--jarvis"}`}
          >
            <p className="msg-author">{message.role === "user" ? "Você" : "Jarvis"}</p>
            <div className="msg-body">
              {message.role === "user" ? (
                <p>{message.content}</p>
              ) : (
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    a: ({ href, children }) => (
                      <a href={href} target="_blank" rel="noreferrer noopener">
                        {children}
                      </a>
                    ),
                  }}
                >
                  {message.content}
                </ReactMarkdown>
              )}
            </div>
          </article>
          );
        })}

        {liveOperations.map((event) => <Operation key={event.id} event={event} />)}

        {streamText ? (
          <article className="msg msg--jarvis">
            <div className="msg-body">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{streamText}</ReactMarkdown>
              <span className="caret" />
            </div>
          </article>
        ) : null}

      </main>
      ) : null}
      </div>

      <footer className="composer-zone" data-tone={tone} data-orb={orbState} data-speaking={speaking ? "1" : "0"}>
        {voiceNote ? <p className="voice-note" role="status">{voiceNote}</p> : null}
        {error ? <div className="alert composer-alert" role="alert">
          <p>{error}</p>
          <button type="button" onClick={() => setError("")}>Fechar</button>
        </div> : null}
        <div className="composer-top">
          <button
            type="button"
            className={`transcript-btn ${showTranscript ? "is-on" : ""}`}
            aria-expanded={showTranscript}
            aria-controls="jarvis-transcript"
            onClick={() => {
              pinnedToBottom.current = true;
              setShowTranscript((value) => !value);
            }}
          >
            {showTranscript ? "Modo esfera" : "Abrir conversa"}
            {!showTranscript && messages.length > 0 ? <span className="dot" /> : null}
          </button>
          <button type="button" className="transcript-btn" aria-pressed={voiceSession}
            onClick={() => setVoiceMode(!voiceSession)}>
            {voiceSession ? "Encerrar modo contínuo" : "Voz contínua"}
          </button>
          {speaking && !pending ? (
            <button type="button" className="stop-speech" onClick={stopResponse}>
              <span className="stop-square" /> Parar áudio
            </button>
          ) : null}
        </div>
        <form
          className={`composer ${listening ? "is-listening" : ""}`}
          onSubmit={(event) => {
            event.preventDefault();
            void submitMessage();
          }}
        >
          <textarea
            ref={textareaRef}
            value={input}
            rows={1}
            aria-label="Mensagem"
            placeholder={listening && !voiceSession ? "Gravando áudio…" : "Mensagem"}
            maxLength={24_000}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void submitMessage();
              }
            }}
          />
          <div className="composer-tools">
            <button type="button" className={`icon-btn mic ${listening ? "is-live" : ""}`}
              onClick={toggleMic}
              aria-pressed={listening}
              aria-label={listening ? "Finalizar gravação" : voicePhase === "idle" ? "Gravar áudio" : "Cancelar microfone"}
              title={listening ? "Finalizar gravação" : transcribing ? "Cancelar transcrição" : hud ? "Gravar áudio (F9)" : "Gravar áudio"}>
              <MicIcon />
            </button>
            <button
              type={pending ? "button" : "submit"}
              className={`send-btn ${pending ? "is-stop" : ""}`}
              disabled={!pending && !input.trim()}
              onClick={pending ? stopResponse : undefined}
              aria-label={pending ? "Parar resposta" : "Enviar"}
            >
              {pending ? <><span className="stop-square" /> Parar</> : <SendIcon />}
            </button>
          </div>
        </form>
        <div className="hero-status composer-status">
          {awaitingApproval ? (
            <button type="button" className="review-operation" onClick={() => {
              setShowTranscript(true);
              requestAnimationFrame(() => {
                const element = document.getElementById(`operation-${awaitingApproval.id}`);
                element?.scrollIntoView({ block: "nearest" });
                element?.focus({ preventScroll: true });
              });
            }}>Revisar operação</button>
          ) : (
            <span role="status">{transcribing ? "Transcrevendo" : voicePhase === "opening" ? "Abrindo microfone"
              : heardSpeech ? "Ouvindo" : speaking ? "Falando" : pending ? "Processando" : listening ? "Ouvindo"
              : remoteState !== "idle" ? "Navegador em atividade" : "Em repouso"}</span>
          )}
          {Object.values(timing).some((value) => typeof value === "number") || perf ? (
            <details className="latency">
              <summary>Tempos</summary>
              <dl>
                {timing.sttMs !== undefined ? <><dt>Transcrição</dt><dd>{formatMs(timing.sttMs)}</dd></> : null}
                {timing.firstTextMs !== undefined ? <><dt>Primeiro texto</dt><dd>{formatMs(timing.firstTextMs)}</dd></> : null}
                {timing.audioMs !== undefined ? <><dt>Primeiro áudio</dt><dd>{formatMs(timing.audioMs)}</dd></> : null}
                {timing.totalMs !== undefined ? <><dt>Resposta completa</dt><dd>{formatMs(timing.totalMs)}</dd></> : null}
                {perf ? <><dt>Geração do modelo</dt><dd>{Math.round(perf.tps)} tok/s</dd></> : null}
              </dl>
            </details>
          ) : null}
        </div>
      </footer>

      {drawer ? <button className="drawer-backdrop" aria-label="Fechar" onClick={() => setDrawer(null)} /> : null}
      <aside className={`drawer ${drawer ? "is-open" : ""}`}>
        <header className="drawer-head">
          <div className="tabs">
            <button className={drawer === "memoria" ? "is-active" : ""} onClick={() => setDrawer("memoria")}>
              MEMÓRIA
            </button>
            <button className={drawer === "lembretes" ? "is-active" : ""} onClick={() => setDrawer("lembretes")}>
              LEMBRETES
              {pendingReminders > 0 ? <b>{pendingReminders}</b> : null}
            </button>
            <button className={drawer === "contexto" ? "is-active" : ""} onClick={() => setDrawer("contexto")}>
              CONTEXTO
            </button>
            <button className={drawer === "tarefas" ? "is-active" : ""} onClick={() => setDrawer("tarefas")}>
              TAREFAS
            </button>
          </div>
          <button className="icon-btn" onClick={() => setDrawer(null)} aria-label="Fechar painel">
            <CloseIcon />
          </button>
        </header>

        <div className="drawer-body">
          {drawer === "tarefas" ? <TaskPanel /> : null}
          {drawer === "memoria" ? (
            <>
              <form
                className="mini-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void addMemory();
                }}
              >
                <input
                  value={memoryDraft}
                  onChange={(event) => setMemoryDraft(event.target.value)}
                  placeholder="Um fato para lembrar sempre"
                  aria-label="Nova memória"
                />
                <button type="submit" className="mini-submit" disabled={!memoryDraft.trim()} aria-label="Salvar">
                  <PlusIcon size={15} />
                </button>
              </form>
              <div className="list">
                {memories.length === 0 ? (
                  <p className="hint">Nada guardado. O Jarvis também grava sozinho o que for durável.</p>
                ) : (
                  memories.map((memory) => (
                    <div key={memory.id} className="row">
                      <p>{memory.content}</p>
                      <button className="row-delete" onClick={() => void removeMemory(memory.id)} aria-label="Apagar">
                        <TrashIcon size={13} />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </>
          ) : null}

          {drawer === "lembretes" ? (
            <>
              <form
                className="mini-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void addReminder();
                }}
              >
                <input
                  value={reminderDraft}
                  onChange={(event) => setReminderDraft(event.target.value)}
                  placeholder="Novo lembrete"
                  aria-label="Novo lembrete"
                />
                <input
                  type="datetime-local"
                  value={reminderWhen}
                  onChange={(event) => setReminderWhen(event.target.value)}
                  aria-label="Prazo"
                />
                <button type="submit" className="mini-submit" disabled={!reminderDraft.trim()} aria-label="Adicionar">
                  <PlusIcon size={15} />
                </button>
              </form>
              <div className="list">
                {reminders.length === 0 ? (
                  <p className="hint">Nada agendado.</p>
                ) : (
                  reminders.map((reminder) => (
                    <div key={reminder.id} className={`row reminder ${reminder.done ? "is-done" : ""}`}>
                      <button className="check" onClick={() => void toggleReminder(reminder)} aria-label="Concluir">
                        {reminder.done ? <CheckIcon size={12} /> : null}
                      </button>
                      <div className="row-text">
                        <p>{reminder.title}</p>
                        <span>{shortDate(reminder.due_at)}</span>
                      </div>
                      <button
                        className="row-delete"
                        onClick={() => void removeReminder(reminder.id)}
                        aria-label="Apagar"
                      >
                        <TrashIcon size={13} />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </>
          ) : null}

          {drawer === "contexto" ? (
            <div className="context-panel">
              <p className="hint">
                {contextInfo.messages} mensagens · {contextInfo.chars.toLocaleString("pt-BR")} caracteres de contexto
                salvo
              </p>
              {contextInfo.summary ? (
                <div className="context-text">{contextInfo.summary}</div>
              ) : (
                <p className="hint">
                  Ainda não há resumo. O Jarvis compacta a conversa sozinho quando ela cresce e guarda o contexto no
                  banco.
                </p>
              )}
              <button className="ghost-btn" onClick={() => void newSession()}>
                NOVA SESSÃO
              </button>
            </div>
          ) : null}
        </div>

        <footer className="drawer-foot">
          <span>{status?.storage === "supabase" ? "SUPABASE" : "SQLITE"}</span>
          <span>{status?.obsidian ? "OBSIDIAN OK" : "OBSIDIAN OFF"}</span>
          {status?.ok === false ? <button onClick={() => void logout()}>SAIR</button> : null}
        </footer>
      </aside>
    </div>
  );
}
