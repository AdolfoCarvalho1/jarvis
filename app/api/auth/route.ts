import type { NextRequest } from "next/server";
import { AUTH_COOKIE, authToken } from "@/lib/auth";
import { timingSafeEqual } from "node:crypto";

export const runtime = "nodejs";

const loginState = globalThis as typeof globalThis & { jarvisLogin?: { failures: number; resetAt: number } };
const rate = loginState.jarvisLogin ??= { failures: 0, resetAt: 0 };

export async function GET(request: NextRequest) {
  const password = process.env.APP_PASSWORD;
  if (!password?.trim()) return Response.json({ required: false, authenticated: true });
  const token = request.cookies.get(AUTH_COOKIE)?.value;
  return Response.json({
    required: true,
    authenticated: token === (await authToken(password)),
  });
}

export async function POST(request: NextRequest) {
  const password = process.env.APP_PASSWORD;
  if (!password?.trim()) return Response.json({ ok: true, required: false });

  const now = Date.now();
  if (rate.resetAt <= now) {
    rate.failures = 0;
    rate.resetAt = now + 60_000;
  }
  const isPublic = request.headers.get("origin") === process.env.JARVIS_PUBLIC_ORIGIN;
  if (isPublic && rate.failures >= 12) return Response.json({ error: "Muitas tentativas. Aguarde um minuto." }, {
    status: 429, headers: { "Retry-After": String(Math.ceil((rate.resetAt - now) / 1000)) },
  });
  const body = (await request.json().catch(() => ({}))) as { password?: string };
  if (isPublic) rate.failures++;
  const token = await authToken(password);
  if (typeof body?.password !== "string" || body.password.length > 1024 ||
    !timingSafeEqual(Buffer.from(await authToken(body.password)), Buffer.from(token))) {
    return Response.json({ error: "senha incorreta" }, { status: 401 });
  }
  if (isPublic) rate.failures = 0;

  const response = Response.json({ ok: true });
  response.headers.append(
    "Set-Cookie",
    `${AUTH_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${60 * 60 * 24 * 30}${
      request.headers.get("origin")?.startsWith("https://") ? "; Secure" : ""
    }`,
  );
  return response;
}

export async function DELETE() {
  const response = Response.json({ ok: true });
  response.headers.append("Set-Cookie", `${AUTH_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  return response;
}
