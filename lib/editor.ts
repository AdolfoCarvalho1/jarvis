import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { resolveSource } from "./selfedit";

/**
 * Escrita de arquivo com escopo no projeto.
 *
 * - caminho passa pelo mesmo `resolveSource` da leitura (bloqueia .env, .data,
 *   .git, symlink, hardlink, caminho absoluto);
 * - backup do conteúdo anterior em `.jarvis/backups/<timestamp>/`;
 * - escrita atômica (arquivo temporário + rename), nunca trunca o original;
 * - concorrência otimista: se o chamador passar `hashBase`, o arquivo precisa
 *   estar igual ao que ele leu.
 */

const ROOT = process.cwd();
const MAX_BYTES = 60_000;
const EDITS_LOG = path.join(ROOT, ".data", "edits.json");

function sha(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex").slice(0, 16);
}

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function logEdit(entry: Record<string, unknown>) {
  try {
    await fs.mkdir(path.dirname(EDITS_LOG), { recursive: true });
    let list: unknown[] = [];
    try {
      const raw = await fs.readFile(EDITS_LOG, "utf8");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) list = parsed;
    } catch {
      /* primeira escrita */
    }
    list.push(entry);
    await fs.writeFile(EDITS_LOG, JSON.stringify(list.slice(-500), null, 2), "utf8");
  } catch {
    /* log é opcional */
  }
}

export interface WriteResult {
  ok: true;
  caminho: string;
  criado: boolean;
  bytes: number;
  linhasAntes: number;
  linhasDepois: number;
  hashAntes: string | null;
  hashDepois: string;
  backup: string;
}

export async function writeProjectFile(
  relative: string,
  content: string,
  options: { origem?: string; hashBase?: string; motivo?: string } = {},
): Promise<WriteResult> {
  const bytes = Buffer.byteLength(content, "utf8");
  if (bytes > MAX_BYTES) throw new Error(`Arquivo acima de ${Math.round(MAX_BYTES / 1000)} KB.`);
  if (content.includes("\0")) throw new Error("Conteúdo binário não é permitido.");
  if (!content.trim()) throw new Error("Conteúdo vazio.");

  const info = await resolveSource(relative, "file", true);
  const existed = info.exists;
  let before = "";
  let hashAntes: string | null = null;

  if (existed) {
    before = await fs.readFile(info.abs, "utf8");
    hashAntes = sha(before);
    if (options.hashBase && options.hashBase !== hashAntes) {
      throw new Error("O arquivo mudou desde a leitura (outra edição). Leia de novo antes de gravar.");
    }
  }

  const backupRel = path.posix.join(".jarvis", "backups", stamp(), info.rel);
  const backupAbs = path.join(ROOT, backupRel);
  await fs.mkdir(path.dirname(backupAbs), { recursive: true });
  if (existed) await fs.copyFile(info.abs, backupAbs);
  else await fs.writeFile(`${backupAbs}.novo`, "", "utf8");

  const tmp = `${info.abs}.jarvis-tmp-${process.pid}`;
  await fs.writeFile(tmp, content, "utf8");
  try {
    await fs.rename(tmp, info.abs);
  } catch (error) {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    throw error;
  }

  const hashDepois = sha(content);
  await logEdit({
    ts: new Date().toISOString(),
    caminho: info.rel,
    origem: options.origem ?? "agente",
    motivo: (options.motivo ?? "").slice(0, 200),
    bytes,
    hashAntes,
    hashDepois,
    backup: backupRel,
  });

  return {
    ok: true,
    caminho: info.rel,
    criado: !existed,
    bytes,
    linhasAntes: existed ? before.split(/\r?\n/).length : 0,
    linhasDepois: content.split(/\r?\n/).length,
    hashAntes,
    hashDepois,
    backup: backupRel,
  };
}

/** Cria ou atualiza uma skill pelo mesmo caminho seguro. */
export async function writeSkill(slug: string, content: string, motivo: string): Promise<WriteResult> {
  if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(slug)) {
    throw new Error("Slug de skill inválido (a-z, 0-9, até 40).");
  }
  return writeProjectFile(`skills/${slug}/SKILL.md`, content, { origem: "agente", motivo });
}
