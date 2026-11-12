import { NextResponse } from "next/server";
import { executeMcpTool, isMcpTool, mcpRequiresApproval, mcpStatus, reloadMcp } from "@/lib/mcp";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await mcpStatus());
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | { acao?: string; ferramenta?: string; argumentos?: Record<string, unknown>; aprovado?: boolean }
    | null;
  const acao = String(body?.acao ?? "");

  if (acao === "recarregar") {
    return NextResponse.json(await reloadMcp());
  }

  if (acao === "chamar") {
    const ferramenta = String(body?.ferramenta ?? "");
    if (!isMcpTool(ferramenta)) {
      return NextResponse.json({ error: "ferramenta MCP inválida" }, { status: 400 });
    }
    if (mcpRequiresApproval(ferramenta) && body?.aprovado !== true) {
      return NextResponse.json(
        { error: "esta ferramenta exige aprovação explícita", aprovacaoNecessaria: true },
        { status: 403 },
      );
    }
    const argumentos = body?.argumentos && typeof body.argumentos === "object" ? body.argumentos : {};
    return NextResponse.json({ texto: await executeMcpTool(ferramenta, argumentos) });
  }

  return NextResponse.json({ error: "ação desconhecida" }, { status: 400 });
}
