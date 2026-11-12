import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE, authToken } from "@/lib/auth";
import { timingSafeEqual } from "node:crypto";

const PUBLIC = [
  "/login", "/api/auth", "/manifest.webmanifest", "/icon.svg", "/icon-192.png",
  "/icon-512.png", "/sw.js", "/favicon.ico",
];

export async function proxy(request: NextRequest) {
  const host = request.headers.get("host")?.toLowerCase() ?? "";
  const loopback = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/.test(host);
  const password = process.env.APP_PASSWORD?.trim() ? process.env.APP_PASSWORD : undefined;
  const origin = loopback ? `http://${host}` : process.env.JARVIS_PUBLIC_ORIGIN;
  if (!loopback && (!password || !origin?.startsWith("https://") || origin !== `https://${host}`)) {
    return NextResponse.json({ error: "Acesso de rede desativado." }, { status: 403 });
  }
  const unsafe = !["GET", "HEAD", "OPTIONS"].includes(request.method);
  const source = request.headers.get("origin");
  if (unsafe && (source !== origin || request.headers.get("sec-fetch-site") === "cross-site")) {
    return NextResponse.json({ error: "Origem da solicitação recusada." }, { status: 403 });
  }
  if (!password) return NextResponse.next();

  const { pathname } = request.nextUrl;
  if (PUBLIC.some((path) => pathname === path || pathname.startsWith(`${path}/`))) {
    return NextResponse.next();
  }

  const token = request.cookies.get(AUTH_COOKIE)?.value;
  if (token && /^[a-f0-9]{64}$/.test(token) &&
      timingSafeEqual(Buffer.from(token), Buffer.from(await authToken(password)))) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "não autenticado" }, { status: 401 });
  }

  const url = new URL("/login", origin);
  if (pathname !== "/") url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
