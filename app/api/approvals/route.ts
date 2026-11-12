import { decideApproval } from "@/lib/approvals";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (typeof body?.id !== "string" || typeof body?.approved !== "boolean") {
    return Response.json({ error: "Decisão inválida." }, { status: 400 });
  }
  if (!decideApproval(body.id, body.approved)) {
    return Response.json({ error: "A solicitação já foi resolvida ou expirou." }, { status: 409 });
  }
  return Response.json({ ok: true });
}
