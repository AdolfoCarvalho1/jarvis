import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type OrbState = "idle" | "thinking" | "listening" | "speaking";
type OrbTone = "blue" | "red";

interface OrbSnapshot {
  energy: number;
  tone: OrbTone;
  state: OrbState;
  at: number;
}

const idle: OrbSnapshot = { energy: 0, tone: "blue", state: "idle", at: 0 };
const store = globalThis as typeof globalThis & { __jarvisOrbState?: OrbSnapshot };

/**
 * Stream do estado do orbe para o HUD Electron.
 * Substitui o polling de 10 Hz: em repouso não trafega nada e, quando o app
 * publica uma mudança, o HUD recebe em ~100 ms.
 */
export async function GET(request: NextRequest) {
  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | null = null;
  let closed = false;
  let last = "";

  const stream = new ReadableStream({
    start(controller) {
      const stop = () => {
        if (closed) return;
        closed = true;
        if (timer) clearInterval(timer);
        try {
          controller.close();
        } catch {
          /* já fechado */
        }
      };

      const send = () => {
        if (closed) return;
        const current = store.__jarvisOrbState ?? idle;
        const fresh = Date.now() - current.at <= 2000 ? current : idle;
        const payload = JSON.stringify({ energy: fresh.energy, tone: fresh.tone, state: fresh.state });
        if (payload === last) return;
        last = payload;
        try {
          controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
        } catch {
          stop();
        }
      };

      send();
      timer = setInterval(send, 100);
      request.signal.addEventListener("abort", stop);
    },
    cancel() {
      closed = true;
      if (timer) clearInterval(timer);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
