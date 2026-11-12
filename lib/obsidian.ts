import fs from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const VAULT = process.env.OBSIDIAN_VAULT_PATH || "";
const FOLDER = "JARVIS";

export function obsidianEnabled(): boolean {
  return Boolean(VAULT && fs.existsSync(/* turbopackIgnore: true */ VAULT));
}

function slug(value: string): string {
  return (
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "nota"
  );
}

function folderPath(): string {
  const target = path.join(VAULT, FOLDER);
  fs.mkdirSync(target, { recursive: true });
  return target;
}

/** Grava o contexto compactado como nota viva no vault. */
export async function syncContextToVault(summary: string): Promise<boolean> {
  if (!obsidianEnabled()) return false;
  const stamp = new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  }).format(new Date());
  const body = `---\nupdated: ${new Date().toISOString()}\ntags: [jarvis, contexto]\n---\n\n# Contexto J.A.R.V.I.S.\n\n_Atualizado em ${stamp}_\n\n${summary}\n`;
  fs.writeFileSync(path.join(folderPath(), "contexto.md"), body, "utf8");
  return true;
}

/** Cria/atualiza uma nota simples no vault. */
export async function saveNote(title: string, content: string): Promise<string> {
  if (!obsidianEnabled()) throw new Error("vault do Obsidian não configurado");
  const file = path.join(folderPath(), `${slug(title)}.md`);
  const body = `---\ncreated: ${new Date().toISOString()}\ntags: [jarvis, nota]\n---\n\n# ${title}\n\n${content}\n`;
  fs.writeFileSync(file, body, "utf8");
  return file;
}

interface Hit {
  file: string;
  score: number;
  excerpt: string;
}

/** Busca textual simples no vault (sem embeddings). */
export async function searchVault(query: string, limit = 5, signal?: AbortSignal): Promise<Hit[]> {
  if (!obsidianEnabled()) throw new Error("vault do Obsidian não configurado");
  const terms = query
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/\s+/)
    .filter((term) => term.length > 2);
  if (!terms.length) return [];

  const files: string[] = [];
  const walk = async (dir: string) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      signal?.throwIfAborted();
      if (files.length >= 700) return;
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) files.push(full);
    }
  };
  await walk(VAULT);

  const hits: Hit[] = [];
  for (const file of files) {
    let raw: string;
    try {
      raw = await readFile(file, { encoding: "utf8", signal });
    } catch {
      signal?.throwIfAborted();
      continue;
    }
    const haystack = raw.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    let score = 0;
    for (const term of terms) score += haystack.includes(term) ? 1 : 0;
    if (!score) continue;
    const index = Math.max(0, haystack.indexOf(terms[0]) - 120);
    hits.push({
      file: path.relative(VAULT, file),
      score,
      excerpt: raw.slice(index, index + 320).replace(/\s+/g, " ").trim(),
    });
  }

  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}
