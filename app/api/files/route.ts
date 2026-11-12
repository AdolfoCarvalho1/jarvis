import { NextResponse } from "next/server";
import { listProjectFiles, readProjectFile } from "@/lib/selfedit";
import { writeProjectFile } from "@/lib/editor";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const caminho = url.searchParams.get("caminho");
  try {
    if (caminho) return NextResponse.json(await readProjectFile(caminho));
    const pasta = url.searchParams.get("pasta") ?? "";
    const lista = await listProjectFiles(pasta, 400);
    return NextResponse.json({ pasta, arquivos: lista });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "falha ao ler" }, { status: 400 });
  }
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | { caminho?: string; conteudo?: string; hashBase?: string; motivo?: string }
    | null;
  if (!body?.caminho || typeof body.conteudo !== "string") {
    return NextResponse.json({ error: "informe caminho e conteudo" }, { status: 400 });
  }
  try {
    const resultado = await writeProjectFile(body.caminho, body.conteudo, {
      origem: "humano",
      hashBase: body.hashBase,
      motivo: body.motivo ?? "edição pelo harness",
    });
    return NextResponse.json(resultado);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "falha ao gravar" }, { status: 400 });
  }
}
