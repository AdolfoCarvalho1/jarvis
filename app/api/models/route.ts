import { listModels } from "@/lib/models";
import { getActiveModel } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const active = await getActiveModel();
  try {
    const models = await listModels();
    return Response.json({ models, active });
  } catch (error) {
    return Response.json({
      models: [],
      active,
      error: error instanceof Error ? error.message : "falha ao listar modelos",
    });
  }
}
