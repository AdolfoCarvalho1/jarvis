/**
 * Política central de ferramentas — inspirada no pipeline do DeepSeek Harness.
 *
 * Três modos de efeito, do mais restrito ao mais amplo:
 *   read-only        → só leitura; nada é escrito nem executado.
 *   workspace-write  → escreve no projeto/vault e no estado do app.
 *   danger-full-access → executa código, controla o PC, chama MCP arbitrário.
 *
 * Regra de ouro (fail-closed):
 *   - ferramenta desconhecida é tratada como danger-full-access;
 *   - se o efeito excede o modo atual, exige aprovação humana;
 *   - aprovação vale para UMA chamada e escala o efeito só naquela chamada.
 *
 * O modo padrão é workspace-write. Pode ser fixado por JARVIS_SANDBOX_MODE.
 */

export type EffectMode = "read-only" | "workspace-write" | "danger-full-access";

export const EFFECT_MODES: EffectMode[] = ["read-only", "workspace-write", "danger-full-access"];

export interface ToolPolicy {
  mode: EffectMode;
  /** Exige aprovação humana mesmo dentro do modo atual. */
  approval: boolean;
  /** Onde o efeito fica confinado, quando aplicável. */
  confinement: "none" | "app" | "project" | "vault";
  reason: string;
}

const RANK: Record<EffectMode, number> = {
  "read-only": 0,
  "workspace-write": 1,
  "danger-full-access": 2,
};

const READ_ONLY = new Set([
  "pesquisar_web",
  "abrir_url",
  "hora_atual",
  "listar_arquivos",
  "ler_arquivo",
  "consultar_obsidian",
  "listar_lembretes",
  "listar_skills",
  "ler_skill",
  "listar_tools_locais",
  "listar_ferramentas",
  "delegar_tarefa",
  "ver_tela",
]);

const WORKSPACE_WRITE = new Set([
  "lembrar",
  "criar_lembrete",
  "concluir_lembrete",
  "propor_melhoria",
  "escrever_arquivo",
  "salvar_nota_obsidian",
]);

const DANGER = new Set([
  "controlar_pc",
  "executar_projeto",
  "executar_tool_local",
]);

const APPROVAL = new Set([
  "ver_tela",
  "controlar_pc",
  "escrever_arquivo",
  "salvar_nota_obsidian",
  "lembrar",
  "criar_lembrete",
  "concluir_lembrete",
  "executar_projeto",
  "acompanhar_arquivo",
  "cancelar_tarefa",
]);

/** Ferramentas locais conhecidas como somente leitura. Novo script = danger até revisão. */
const LOCAL_READ_ONLY = new Set(["disco", "porta", "git_status", "soma", "hora"]);

export function currentSandboxMode(): EffectMode {
  const raw = String(process.env.JARVIS_SANDBOX_MODE ?? "").trim().toLowerCase();
  return (EFFECT_MODES as string[]).includes(raw) ? (raw as EffectMode) : "workspace-write";
}

function readOnly(reason: string): ToolPolicy {
  return { mode: "read-only", approval: false, confinement: "none", reason };
}

function workspace(confinement: ToolPolicy["confinement"], approval: boolean, reason: string): ToolPolicy {
  return { mode: "workspace-write", approval, confinement, reason };
}

function danger(approval: boolean, reason: string): ToolPolicy {
  return { mode: "danger-full-access", approval, confinement: "none", reason };
}

/**
 * Classifica o efeito de uma ferramenta. Função pura: não executa nada,
 * não consulta rede e não depende de estado global além do modo configurado.
 */
export function classifyTool(name: string, args: Record<string, unknown> = {}): ToolPolicy {
  const tool = String(name ?? "").trim();

  // Meta-ferramenta: a política é a da ferramenta-alvo.
  if (tool === "usar_ferramenta") {
    const target = String(args.ferramenta ?? args.nome ?? args.name ?? args.target ?? "").trim();
    if (!target) return danger(true, "meta-ferramenta sem alvo identificável");
    return classifyTool(target, (args.argumentos ?? args.args ?? {}) as Record<string, unknown>);
  }

  // MCP é decidido no executor (a configuração do servidor manda), mas o
  // efeito máximo é sempre perigoso: servidor externo pode fazer qualquer coisa.
  if (tool.startsWith("mcp__")) return danger(true, "servidor MCP externo");

  if (tool === "executar_tool_local") {
    const local = String(args.nome ?? "").trim().toLowerCase();
    if (local === "composio") {
      const acao = String((args.argumentos as Record<string, unknown> | undefined)?.acao ?? "search").trim().toLowerCase();
      return acao === "execute"
        ? danger(true, "Composio: execução de ação externa")
        : readOnly("Composio: consulta de conexões/schema");
    }
    if (LOCAL_READ_ONLY.has(local)) return readOnly(`ferramenta local somente leitura: ${local}`);
    return danger(true, `ferramenta local não classificada: ${local || "(sem nome)"}`);
  }

  if (tool === "gerenciar_rotina") {
    const acao = String(args.acao ?? "listar").trim().toLowerCase();
    if (acao === "listar") return readOnly("listagem de rotinas");
    return danger(true, `rotina com efeito: ${acao}`);
  }

  if (tool === "acompanhar_arquivo") {
    return { mode: "read-only", approval: true, confinement: "none", reason: "abre diagnóstico/arquivo para leitura" };
  }

  if (tool === "listar_tarefas" || tool === "consultar_tarefa") return readOnly("consulta de tarefas");

  if (READ_ONLY.has(tool)) {
    const approval = APPROVAL.has(tool);
    return { mode: "read-only", approval, confinement: "none", reason: approval ? "leitura sensível" : "somente leitura" };
  }

  if (WORKSPACE_WRITE.has(tool)) {
    const confinement: ToolPolicy["confinement"] =
      tool === "salvar_nota_obsidian" ? "vault" : tool === "lembrar" || tool === "criar_lembrete" || tool === "concluir_lembrete" ? "app" : "project";
    return workspace(confinement, APPROVAL.has(tool), `escrita em ${confinement}`);
  }

  if (DANGER.has(tool)) return danger(APPROVAL.has(tool), "execução/controle com efeito amplo");

  // Fail-closed: ferramenta nova sem classificação não roda sem aprovação.
  return danger(true, `ferramenta não classificada: ${tool || "(vazia)"}`);
}

/** A ferramenta cabe no modo atual sem aprovação? */
export function fitsCurrentMode(policy: ToolPolicy): boolean {
  return RANK[policy.mode] <= RANK[currentSandboxMode()];
}

/** Precisa de aprovação humana (por sensibilidade ou por exceder o modo)? */
export function policyRequiresApproval(policy: ToolPolicy): boolean {
  return policy.approval || !fitsCurrentMode(policy);
}

export interface PolicyDecision {
  ok: boolean;
  policy: ToolPolicy;
  error?: string;
}

/**
 * Decide se a chamada pode seguir. `approved` é a aprovação humana de UMA
 * chamada; ela escala o efeito efetivo, mas não vira permissão permanente.
 */
export function decideTool(name: string, args: Record<string, unknown> = {}, approved = false): PolicyDecision {
  const policy = classifyTool(name, args);

  if (policyRequiresApproval(policy) && !approved) {
    return {
      ok: false,
      policy,
      error: policy.approval
        ? "Ação não autorizada."
        : `Ação exige aprovação: ${policy.mode} fora do modo ${currentSandboxMode()}.`,
    };
  }

  if (approved && RANK[policy.mode] > RANK[currentSandboxMode()]) {
    // Aprovação escala só esta chamada; registra no motivo para auditoria.
    return { ok: true, policy: { ...policy, reason: `${policy.reason} (aprovada uma vez)` } };
  }

  return { ok: true, policy };
}

export function sandboxStatus(): {
  mode: EffectMode;
  modes: EffectMode[];
  description: string;
} {
  const mode = currentSandboxMode();
  const description =
    mode === "read-only"
      ? "Só leitura: escritas e execuções exigem aprovação."
      : mode === "workspace-write"
        ? "Escreve no projeto/vault; PC, MCP e código exigem aprovação."
        : "Acesso amplo: use só em sessão confiável.";
  return { mode, modes: EFFECT_MODES, description };
}
