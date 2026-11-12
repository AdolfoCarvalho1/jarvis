import type { ToolDefinition } from "./tools";

/**
 * Ferramentas que ficam no schema de toda mensagem.
 * O resto (MCP, Obsidian, skills, tarefas, ferramentas locais, escrita de código)
 * é descoberto por listar_ferramentas e executado por usar_ferramenta.
 */
export const CORE_TOOL_NAMES = new Set([
  "pesquisar_web",
  "abrir_url",
  "hora_atual",
  "ver_tela",
  "lembrar",
  "criar_lembrete",
  "listar_lembretes",
  "concluir_lembrete",
  "ler_arquivo",
  "listar_arquivos",
]);

export const META_TOOLS: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "listar_ferramentas",
      description:
        "Procura ferramentas fora do núcleo (navegador MCP, Obsidian, skills, tarefas e rotinas, ferramentas locais em Python/Rust, controle do PC, escrita de código). Devolve nome, descrição e parâmetros. Use antes de usar_ferramenta.",
      parameters: {
        type: "object",
        properties: {
          busca: { type: "string", description: "O que você precisa fazer (ex.: navegar, abrir site, obsidian, build, skill, disco)." },
          limite: { type: "number", description: "Máximo de ferramentas retornadas (padrão 6, teto 10)." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "usar_ferramenta",
      description:
        "Executa uma ferramenta descoberta por listar_ferramentas. Informe o nome exato e os argumentos no formato do schema dela. Ferramentas com confirmação continuam pedindo aprovação na interface.",
      parameters: {
        type: "object",
        properties: {
          nome: { type: "string", description: "Nome exato da ferramenta (ex.: mcp__navegador__browser_navigate)." },
          argumentos: { type: "object", description: "Argumentos da ferramenta, conforme o schema retornado por listar_ferramentas." },
        },
        required: ["nome"],
      },
    },
  },
];

export function coreToolDefinitions(all: ToolDefinition[]): ToolDefinition[] {
  return all.filter((tool) => CORE_TOOL_NAMES.has(tool.function.name));
}

export function findToolDefinition(all: ToolDefinition[], name: string): ToolDefinition | undefined {
  return all.find((tool) => tool.function.name === name);
}

function score(tool: ToolDefinition, terms: string[]): number {
  const name = tool.function.name.toLowerCase();
  const description = (tool.function.description ?? "").toLowerCase();
  let total = 0;
  for (const term of terms) {
    if (!term) continue;
    if (name.includes(term)) total += 4;
    if (description.includes(term)) total += 1;
  }
  return total;
}

export interface ToolSearchResult {
  total: number;
  encontradas: number;
  ferramentas: Array<{ nome: string; descricao: string; parametros: unknown }>;
  dica?: string;
}

export function searchTools(all: ToolDefinition[], busca: string, limite = 6): ToolSearchResult {
  const terms = busca
    .toLowerCase()
    .split(/[\s,;:./_-]+/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2);
  const candidates = all.filter((tool) => !CORE_TOOL_NAMES.has(tool.function.name));
  const ranked = candidates
    .map((tool) => ({ tool, score: terms.length ? score(tool, terms) : 0 }))
    .sort((a, b) => b.score - a.score || a.tool.function.name.localeCompare(b.tool.function.name));
  const chosen = (terms.length ? ranked.filter((entry) => entry.score > 0) : ranked)
    .slice(0, Math.max(1, Math.min(10, Math.trunc(limite) || 6)))
    .map((entry) => entry.tool);
  return {
    total: candidates.length,
    encontradas: chosen.length,
    ferramentas: chosen.map((tool) => ({
      nome: tool.function.name,
      descricao: (tool.function.description ?? "").slice(0, 700),
      parametros: tool.function.parameters ?? { type: "object", properties: {} },
    })),
    dica: chosen.length
      ? "Chame usar_ferramenta com o nome exato e os argumentos."
      : "Nada casou. Tente outra palavra (ex.: navegador, site, obsidian, build, skill, disco).",
  };
}
