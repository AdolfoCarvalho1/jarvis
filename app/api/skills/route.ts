import { NextResponse } from "next/server";
import { listSkills, readSkill } from "@/lib/skills";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const nome = new URL(request.url).searchParams.get("nome");
  if (nome) {
    const skill = readSkill(nome);
    if (!skill) return NextResponse.json({ error: "skill não encontrada" }, { status: 404 });
    return NextResponse.json(skill);
  }
  return NextResponse.json({ skills: listSkills() });
}
