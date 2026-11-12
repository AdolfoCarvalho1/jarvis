import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  if (process.platform !== "win32" || process.env.VERCEL) {
    return Response.json({ error: "O HUD é uma janela local do Windows." }, { status: 501 });
  }

  const root = process.cwd();
  const electron = path.join(root, "node_modules", "electron", "dist", "electron.exe");
  if (!existsSync(electron)) {
    return Response.json({ error: "Electron não instalado. Rode npm install." }, { status: 501 });
  }

  const main = path.join(root, "hud");
  const child = spawn(electron, [main], {
    cwd: root,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();

  return Response.json({ ok: true });
}
