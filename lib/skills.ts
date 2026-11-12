import fs from "node:fs";
import path from "node:path";

/**
 * Skills são instruções reutilizáveis guardadas em `skills/<slug>/SKILL.md`.
 * O índice (nome + descrição + gatilhos) entra no prompt; o corpo só é lido
 * quando o modelo chama `ler_skill`. Assim uma skill grande não custa contexto
 * em todo turno.
 */

const SKILLS_DIR = path.join(process.cwd(), "skills");
const MAX_BODY = 8000;
const MAX_INDEX = 40;
const MAX_INDEX_CHARS = 2000;

export interface SkillInfo {
  slug: string;
  name: string;
  description: string;
  quando: string[];
  version: number;
  bytes: number;
  invalid?: string;
}

export interface SkillBody extends SkillInfo {
  body: string;
  references: string[];
  truncated: boolean;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseFrontmatter(raw: string): { data: Record<string, string>; body: string; quando: string[] } {
  const data: Record<string, string> = {};
  const quando: string[] = [];
  if (!raw.startsWith("---")) return { data, body: raw.trim(), quando };

  const end = raw.indexOf("\n---", 3);
  if (end === -1) return { data, body: raw.trim(), quando };

  const head = raw.slice(3, end).split(/\r?\n/);
  let listKey = "";
  for (const line of head) {
    if (!line.trim()) continue;
    const item = line.match(/^\s*-\s+(.*)$/);
    if (item && listKey) {
      if (listKey === "quando") quando.push(unquote(item[1]));
      continue;
    }
    const pair = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!pair) continue;
    const key = pair[1].toLowerCase();
    const value = pair[2].trim();
    listKey = value ? "" : key;
    if (!value) continue;
    if (key === "quando" && value.startsWith("[")) {
      try {
        const parsed = JSON.parse(value.replace(/'/g, '"')) as unknown;
        if (Array.isArray(parsed)) parsed.forEach((entry) => quando.push(String(entry)));
      } catch {
        /* lista inválida é ignorada */
      }
      continue;
    }
    data[key] = unquote(value);
  }

  const body = raw.slice(end + 4).replace(/^\r?\n/, "").trim();
  return { data, body, quando };
}

export function listSkills(): SkillInfo[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(SKILLS_DIR, { withFileTypes: true });
  } catch {
    return [];
  }

  const skills: SkillInfo[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const file = path.join(SKILLS_DIR, entry.name, "SKILL.md");
    let raw: string;
    try {
      raw = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const { data, quando } = parseFrontmatter(raw);
    const slug = entry.name;
    const name = (data.name || slug).toLowerCase();
    const description = (data.description || "").trim();
    const info: SkillInfo = {
      slug,
      name,
      description,
      quando,
      version: Number(data.version ?? 1) || 1,
      bytes: Buffer.byteLength(raw, "utf8"),
    };
    if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(name) || name !== slug) {
      info.invalid = "name deve ser igual ao nome da pasta (a-z, 0-9, hífen)";
    } else if (description.length < 8 || description.length > 160) {
      info.invalid = "description deve ter entre 8 e 160 caracteres";
    }
    skills.push(info);
  }
  return skills.sort((a, b) => a.slug.localeCompare(b.slug));
}

export function readSkill(slug: string): SkillBody | null {
  if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(slug)) return null;
  const dir = path.join(SKILLS_DIR, slug);
  const file = path.join(dir, "SKILL.md");
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
  const { data, body, quando } = parseFrontmatter(raw);
  let references: string[] = [];
  try {
    references = fs
      .readdirSync(path.join(dir, "references"), { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => `references/${entry.name}`)
      .slice(0, 20);
  } catch {
    /* sem references */
  }
  const truncated = body.length > MAX_BODY;
  return {
    slug,
    name: (data.name || slug).toLowerCase(),
    description: (data.description || "").trim(),
    quando,
    version: Number(data.version ?? 1) || 1,
    bytes: Buffer.byteLength(raw, "utf8"),
    body: truncated ? `${body.slice(0, MAX_BODY)}\n\n[corpo truncado em ${MAX_BODY} caracteres]` : body,
    references,
    truncated,
  };
}

/** Bloco curto injetado no prompt do sistema: nome, descrição e gatilhos. */
export function skillsPromptBlock(): string {
  const skills = listSkills().filter((skill) => !skill.invalid);
  if (!skills.length) return "";
  const lines: string[] = [];
  let used = 0;
  for (const skill of skills.slice(0, MAX_INDEX)) {
    const triggers = skill.quando.length ? ` (quando: ${skill.quando.slice(0, 3).join("; ")})` : "";
    const line = `- ${skill.slug} — ${skill.description}${triggers}`;
    if (used + line.length > MAX_INDEX_CHARS) {
      lines.push(`- +${skills.length - lines.length} skills omitidas; use listar_skills`);
      break;
    }
    lines.push(line);
    used += line.length + 1;
  }
  return lines.join("\n");
}
