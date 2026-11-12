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

export async function GET() {
  const current = store.__jarvisOrbState ?? idle;
  // Se a aba principal fechou, não deixa o HUD preso em "falando".
  if (Date.now() - current.at > 2000) {
    return Response.json({ ...idle, at: current.at }, { headers: { "Cache-Control": "no-store" } });
  }
  return Response.json(current, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as Partial<OrbSnapshot> | null;
  if (!body) return Response.json({ error: "JSON inválido." }, { status: 400 });

  const energy = Number(body.energy);
  const state = ["idle", "thinking", "listening", "speaking"].includes(String(body.state))
    ? (body.state as OrbState)
    : "idle";

  // Várias abas podem publicar; um "idle" de outra aba não apaga a fala por 700 ms.
  const previous = store.__jarvisOrbState;
  if (previous && state === "idle" && previous.state !== "idle" && Date.now() - previous.at < 700) {
    return Response.json({ ok: true, held: true });
  }

  store.__jarvisOrbState = {
    energy: Number.isFinite(energy) ? Math.max(0, Math.min(1, energy)) : 0,
    tone: body.tone === "red" ? "red" : "blue",
    state,
    at: Date.now(),
  };

  return Response.json({ ok: true });
}
