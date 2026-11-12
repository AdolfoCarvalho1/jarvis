import { NextResponse } from "next/server";
import { mcpToolDefinitions } from "@/lib/mcp";
import { tools } from "@/lib/tools";
import { META_TOOLS, coreToolDefinitions } from "@/lib/tool-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Diagnóstico do schema de ferramentas enviado em cada mensagem. */
export async function GET() {
  const all = [...tools, ...(await mcpToolDefinitions())];
  const core = coreToolDefinitions(all);
  const request = [...core, ...META_TOOLS];
  const bytes = JSON.stringify(request).length;
  return NextResponse.json({
    nucleo: core.map((tool) => tool.function.name),
    meta: META_TOOLS.map((tool) => tool.function.name),
    sobDemanda: all.length - core.length,
    totalDisponivel: all.length,
    ferramentasNoRequest: request.length,
    bytes,
    tokensAprox: Math.round(bytes / 3.6),
    todas: all.map((tool) => tool.function.name).sort(),
  });
}
