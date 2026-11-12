import { readProposal } from "@/lib/selfedit";

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  const patch = await readProposal(id);
  if (patch === null) return new Response("Proposta não encontrada.", { status: 404 });
  return new Response(patch, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="jarvis-${id}.patch"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
