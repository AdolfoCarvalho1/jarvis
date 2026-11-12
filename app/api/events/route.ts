import { countEvents, listEvents } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_LIMIT = 200;

function intParam(value: string | null, fallback: number, min: number, max: number): number {
  if (value === null || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const conversationId = searchParams.get("conversationId")?.trim() || undefined;
  const limit = intParam(searchParams.get("limit"), 100, 1, MAX_LIMIT);
  const offset = intParam(searchParams.get("offset"), 0, 0, Number.MAX_SAFE_INTEGER);
  return Response.json({
    events: listEvents({ conversationId, limit, offset }),
    total: countEvents(conversationId),
  });
}
