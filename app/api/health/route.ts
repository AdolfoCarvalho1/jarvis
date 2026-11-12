import { defaultModel, hasCredentials } from "@/lib/ai";
import { storage, storageName } from "@/lib/db";
import { obsidianEnabled } from "@/lib/obsidian";
import { getActiveModel } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  let storeOk = true;
  let storeError: string | null = null;
  try {
    await storage.listConversations();
  } catch (error) {
    storeOk = false;
    storeError = error instanceof Error ? error.message : "erro de armazenamento";
  }

  return Response.json({
    ok: hasCredentials() && storeOk,
    model: await getActiveModel(),
    fallbackModel: defaultModel(),
    provider: "opencode-go",
    storage: storageName,
    storageError: storeError,
    obsidian: obsidianEnabled(),
    authenticated: Boolean(process.env.APP_PASSWORD),
    time: new Date().toISOString(),
  });
}
