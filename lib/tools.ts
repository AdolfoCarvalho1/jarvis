import { storage } from "./db";
import { obsidianEnabled, saveNote, searchVault } from "./obsidian";
import { captureScreen, runPcAction } from "./pc";
import { listProjectFiles, proposeProjectFiles, readProjectFile, type EditFile } from "./selfedit";
import { readPublicPage } from "./public-page";
import { describeImage } from "./vision";
import { executeTaskTool, taskTools } from "./automation/chat-tools";
import { automationEnabled, syncReminderTask } from "./automation/tasks";
import { cancelTask } from "./automation/store";
import { executeMcpTool, isMcpTool, mcpRequiresApproval } from "./mcp";
import { listSkills, readSkill } from "./skills";
import { writeProjectFile } from "./editor";
import { listLocalTools, runLocalTool } from "./localtools";
import { defaultModel } from "./ai";
import { runSubagent } from "./subagent";
import { classifyTool, decideTool, policyRequiresApproval } from "./policy";

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";

function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(parseInt(dec, 10)));
}

function clean(value: string): string {
  return decodeEntities(
    value
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">"),
  )
    .replace(/\s+/g, " ")
    .trim();
}

function decodeDuckDuckGo(href: string): string {
  try {
    const url = new URL(href, "https://duckduckgo.com");
    const target = url.searchParams.get("uddg");
    if (target) return decodeURIComponent(target);
    return url.toString();
  } catch {
    return href;
  }
}

function decodeBing(href: string): string {
  try {
    const normalized = href.replace(/&amp;/g, "&");
    const url = new URL(normalized, "https://www.bing.com");
    const encoded = url.searchParams.get("u");
    if (encoded?.startsWith("a1")) {
      const base64 = encoded.slice(2).replace(/-/g, "+").replace(/_/g, "/");
      const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
      return Buffer.from(padded, "base64").toString("utf8");
    }
    return url.toString();
  } catch {
    return href;
  }
}

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

async function searchBing(query: string, maxResults: number, signal: AbortSignal): Promise<SearchResult[]> {
  const response = await fetch(
    `https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=pt-BR&count=${Math.min(maxResults * 2, 20)}`,
    {
      headers: {
        "User-Agent": UA,
        "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.7",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
      cache: "no-store",
    },
  );
  if (!response.ok) return [];

  const html = await response.text();
  const blocks = html.split(/class="b_algo"/i).slice(1);
  const results: SearchResult[] = [];

  for (const block of blocks) {
    const match = /<h2[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(block);
    if (!match) continue;
    const title = clean(match[2]);
    if (!title) continue;
    const paragraph = /<p[^>]*>([\s\S]*?)<\/p>/i.exec(block);
    results.push({
      title,
      url: decodeBing(match[1]),
      snippet: clean(paragraph?.[1] ?? ""),
    });
    if (results.length >= maxResults) break;
  }

  return results;
}

async function searchDuckDuckGo(query: string, maxResults: number, signal: AbortSignal): Promise<SearchResult[]> {
  const response = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=br-pt`, {
    headers: {
      "User-Agent": UA,
      "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.7",
      Accept: "text/html,application/xhtml+xml",
    },
    signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
    cache: "no-store",
  });
  if (!response.ok) return [];

  const html = await response.text();
  const anchors = [...html.matchAll(/<a\b([^>]*class="[^"]*result__a[^"]*"[^>]*)>([\s\S]*?)<\/a>/gi)];
  const snippets = [...html.matchAll(/<a\b[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/gi)];
  const results: SearchResult[] = [];

  for (let i = 0; i < anchors.length && results.length < maxResults; i++) {
    const attrs = anchors[i][1] ?? "";
    const href = /href="([^"]+)"/i.exec(attrs)?.[1] ?? "";
    if (!href || href.includes("duckduckgo.com/y.js")) continue;
    const title = clean(anchors[i][2] ?? "");
    if (!title) continue;
    results.push({
      title,
      url: decodeDuckDuckGo(href),
      snippet: clean(snippets[i]?.[1] ?? ""),
    });
  }

  return results;
}

async function searchWeb(query: string, maxResults: number, signal: AbortSignal): Promise<string> {
  const trimmed = query.trim();
  if (!trimmed) return JSON.stringify({ error: "consulta vazia" });

  try {
    const bing = await searchBing(trimmed, maxResults, signal);
    if (bing.length) return JSON.stringify({ query: trimmed, source: "bing", results: bing });
  } catch {
    signal.throwIfAborted();
  }

  try {
    const ddg = await searchDuckDuckGo(trimmed, maxResults, signal);
    if (ddg.length) return JSON.stringify({ query: trimmed, source: "duckduckgo", results: ddg });
  } catch {
    signal.throwIfAborted();
  }

  return JSON.stringify({
    query: trimmed,
    results: [],
    note: "nenhum resultado encontrado; os buscadores podem estar bloqueando consultas automáticas",
  });
}

async function openUrl(url: string, signal: AbortSignal): Promise<string> {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return JSON.stringify({ error: "URL inválida" });
  }
  if (!/^https?:$/.test(target.protocol)) return JSON.stringify({ error: "somente http/https" });

  try {
    const { status, type, raw } = await readPublicPage(target,
      { "User-Agent": UA, "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.7" },
      AbortSignal.any([signal, AbortSignal.timeout(20_000)]));
    if (status < 200 || status >= 300) return JSON.stringify({ error: `HTTP ${status}`, url: target.toString() });
    const text = type.includes("html") ? clean(raw) : raw.replace(/\s+/g, " ").trim();
    return JSON.stringify({
      url: target.toString(),
      title: /<title[^>]*>([\s\S]*?)<\/title>/i.exec(raw)?.[1]?.trim() ?? "",
      content: text.slice(0, 12000),
      truncated: text.length > 12000,
    });
  } catch (error) {
    return JSON.stringify({ error: error instanceof Error ? error.message : "falha ao abrir" });
  }
}

export const TOOL_LABELS: Record<string, string> = {
  pesquisar_web: "Pesquisando na web",
  abrir_url: "Abrindo página",
  lembrar: "Gravando na memória",
  criar_lembrete: "Criando lembrete",
  listar_lembretes: "Consultando lembretes",
  concluir_lembrete: "Concluindo lembrete",
  hora_atual: "Verificando o relógio",
  consultar_obsidian: "Consultando o Obsidian",
  salvar_nota_obsidian: "Salvando nota",
  listar_arquivos: "Explorando o próprio código",
  ler_arquivo: "Lendo arquivo do projeto",
  propor_melhoria: "Gerando diff para revisão",
  ver_tela: "Olhando a tela",
  listar_ferramentas: "Procurando ferramentas",
  usar_ferramenta: "Usando ferramenta",
  listar_skills: "Consultando skills",
  ler_skill: "Lendo skill",
  listar_tools_locais: "Listando ferramentas locais",
  executar_tool_local: "Executando ferramenta local",
  escrever_arquivo: "Escrevendo arquivo",
  controlar_pc: "Controlando o PC",
  executar_projeto: "Enfileirando checagem",
  acompanhar_arquivo: "Acompanhando arquivo",
  consultar_tarefas: "Consultando tarefas",
  cancelar_tarefa: "Cancelando tarefa",
  buscar_arquivos_projeto: "Buscando arquivos",
  gerenciar_rotina: "Gerenciando rotina",
  delegar_tarefa: "Delegando ao subagente",
};

export const tools: ToolDefinition[] = [
  ...taskTools,
  {
    type: "function",
    function: {
      name: "pesquisar_web",
      description:
        "Pesquisa na web em tempo real. Use sempre que a pergunta envolver fatos atuais, notícias, preços, pessoas, produtos ou algo que você não saiba com certeza.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Termos de busca" },
          max_results: { type: "number", description: "Quantidade de resultados (1-8). Padrão 5." },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "abrir_url",
      description: "Abre uma URL e devolve o texto da página. Use depois da busca quando precisar ler o conteúdo completo.",
      parameters: {
        type: "object",
        properties: { url: { type: "string", description: "URL http(s) completa" } },
        required: ["url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "lembrar",
      description:
        "Salva um fato permanente sobre o usuário ou o contexto dele (preferências, projetos, pessoas, rotina). Use quando ele pedir para lembrar ou quando revelar algo durável.",
      parameters: {
        type: "object",
        properties: { fato: { type: "string", description: "Fato curto, em terceira pessoa" } },
        required: ["fato"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "criar_lembrete",
      description:
        "Cria um lembrete com prazo. 'quando' deve ser uma data/hora ISO 8601 (ex.: 2026-11-12T09:00:00-03:00) calculada a partir da data atual informada no sistema.",
      parameters: {
        type: "object",
        properties: {
          titulo: { type: "string", description: "O que precisa ser lembrado" },
          quando: { type: "string", description: "Data/hora ISO 8601; vazio se não houver prazo" },
        },
        required: ["titulo"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "listar_lembretes",
      description: "Lista os lembretes do usuário.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "concluir_lembrete",
      description: "Marca um lembrete como concluído pelo id.",
      parameters: {
        type: "object",
        properties: { id: { type: "string", description: "id do lembrete" } },
        required: ["id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "hora_atual",
      description: "Retorna a data e hora atuais no fuso do usuário.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "consultar_obsidian",
      description:
        "Busca por texto nas notas do vault do Obsidian do usuário. Use quando ele mencionar notas, projetos ou algo que possa estar registrado no vault.",
      parameters: {
        type: "object",
        properties: { consulta: { type: "string", description: "Termos de busca" } },
        required: ["consulta"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "salvar_nota_obsidian",
      description: "Cria uma nota no vault do Obsidian, dentro da pasta JARVIS.",
      parameters: {
        type: "object",
        properties: {
          titulo: { type: "string", description: "Título curto da nota" },
          conteudo: { type: "string", description: "Conteúdo em markdown" },
        },
        required: ["titulo", "conteudo"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "listar_arquivos",
      description:
        "Lista arquivos do próprio projeto J.A.R.V.I.S. (código-fonte). Use antes de ler ou alterar algo, para descobrir os caminhos reais.",
      parameters: {
        type: "object",
        properties: {
          pasta: { type: "string", description: "Pasta inicial relativa (ex.: app, components, lib). Vazio = raiz." },
          limite: { type: "number", description: "Máximo de arquivos (padrão 200)." },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "ler_arquivo",
      description: "Lê um arquivo de texto do próprio projeto. Use para entender o código antes de propor ou aplicar uma melhoria.",
      parameters: {
        type: "object",
        properties: { caminho: { type: "string", description: "Caminho relativo à raiz do projeto" } },
        required: ["caminho"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "ver_tela",
      description:
        "Captura a tela do PC agora e descreve o que está visível. Use quando o usuário perguntar o que está na tela, pedir ajuda com algo que está vendo, ou disser 'olha minha tela'. A captura acontece só nesta chamada.",
      parameters: {
        type: "object",
        properties: {
          pergunta: { type: "string", description: "O que o usuário quer saber sobre a tela (opcional)" },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "controlar_pc",
      description:
        "Controla o PC local: abrir app ou URL, volume, mudo, play/pause, próxima/anterior, bloquear. Use somente quando o usuário pedir explicitamente.",
      parameters: {
        type: "object",
        properties: {
          acao: {
            type: "string",
            enum: ["abrir", "volume-up", "volume-down", "mudo", "play-pause", "proxima", "anterior", "bloquear"],
            description: "Ação a executar",
          },
          valor: { type: "string", description: "Para 'abrir': URL http(s) ou app (chrome, edge, spotify, notepad, explorer, vscode, calc, whatsapp, telegram)" },
        },
        required: ["acao"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "propor_melhoria",
      description:
        "Prepara um diff para revisão humana. Envie o conteúdo completo dos arquivos propostos. A ferramenta gera apenas o diff para baixar.",
      parameters: {
        type: "object",
        properties: {
          motivo: { type: "string", description: "Uma linha explicando o que a mudança resolve" },
          arquivos: {
            type: "array",
            description: "Lista de arquivos a gravar (máx. 8, 60 KB cada)",
            items: {
              type: "object",
              properties: {
                caminho: { type: "string", description: "Caminho relativo (ex.: app/api/ping/route.ts)" },
                conteudo: { type: "string", description: "Conteúdo completo do arquivo" },
              },
              required: ["caminho", "conteudo"],
            },
          },
        },
        required: ["motivo", "arquivos"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "listar_skills",
      description: "Lista as skills disponíveis (nome, descrição, gatilhos e tamanho). Use quando o índice do prompt estiver incompleto ou o usuário perguntar o que você sabe fazer.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "ler_skill",
      description: "Lê o corpo de uma skill pelo slug. Chame antes de executar uma tarefa que casa com a descrição da skill — nunca por curiosidade.",
      parameters: {
        type: "object",
        properties: { nome: { type: "string", description: "Slug da skill (ex.: deploy-local)" } },
        required: ["nome"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "escrever_arquivo",
      description:
        "Grava um arquivo de código do projeto (até 60 KB), com backup automático e escopo restrito. Exige aprovação. Informe hashBase recebido de ler_arquivo para evitar sobrescrever edição concorrente.",
      parameters: {
        type: "object",
        properties: {
          caminho: { type: "string", description: "Caminho relativo dentro do projeto (ex.: lib/ping.ts)" },
          conteudo: { type: "string", description: "Conteúdo completo do arquivo" },
          hashBase: { type: "string", description: "Hash devolvido por ler_arquivo, se o arquivo já existia" },
          motivo: { type: "string", description: "Uma linha explicando a mudança" },
        },
        required: ["caminho", "conteudo"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "listar_tools_locais",
      description: "Lista as ferramentas locais em Python/Rust (scripts/tools) que rodam sem modelo: nome, descrição e parâmetros.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "executar_tool_local",
      description:
        "Executa uma ferramenta local determinística (Python ou binário Rust) e devolve o JSON de saída. Use para contas, disco, porta, git e rotinas exatas em vez de calcular ou inventar.",
      parameters: {
        type: "object",
        properties: {
          nome: { type: "string", description: "Nome da ferramenta (ex.: soma, disco, porta, git_status)" },
          argumentos: { type: "object", description: "Argumentos conforme o schema da ferramenta" },
        },
        required: ["nome"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delegar_tarefa",
      description:
        "Delega uma pesquisa ou análise longa a um subagente isolado e somente leitura: ele usa busca, leitura de URL, arquivos, Obsidian, lembretes e hora, e devolve um resumo. Use para investigações com várias etapas. Não serve para escrever código nem controlar o PC.",
      parameters: {
        type: "object",
        properties: {
          objetivo: {
            type: "string",
            description: "O que o subagente deve descobrir ou analisar, com o critério de conclusão.",
          },
          contexto: {
            type: "string",
            description: "Contexto adicional relevante para o subagente (opcional).",
          },
        },
        required: ["objetivo"],
      },
    },
  },
];

/** Ferramentas somente leitura que o subagente pode executar (sem recursão). */
const SUBAGENT_ALLOWED = new Set([
  "pesquisar_web",
  "abrir_url",
  "ler_arquivo",
  "listar_arquivos",
  "consultar_obsidian",
  "listar_lembretes",
  "hora_atual",
]);

export function toolRequiresApproval(name: string, args: Record<string, unknown>) {
  if (isMcpTool(name)) return mcpRequiresApproval(name);
  return policyRequiresApproval(classifyTool(name, args));
}

export async function executeTool(name: string, args: Record<string, unknown>, signal: AbortSignal, approved = false): Promise<string> {
  signal.throwIfAborted();
  if (isMcpTool(name)) {
    if (toolRequiresApproval(name, args) && !approved) return JSON.stringify({ error: "Ação não autorizada." });
    return executeMcpTool(name, args, signal);
  }
  const decision = decideTool(name, args, approved);
  if (!decision.ok) return JSON.stringify({ error: decision.error ?? "Ação não autorizada.", policy: decision.policy });
  try {
    switch (name) {
      case "listar_skills":
        return JSON.stringify({
          skills: listSkills().map((skill) => ({
            nome: skill.slug,
            descricao: skill.description,
            quando: skill.quando,
            bytes: skill.bytes,
            valida: !skill.invalid,
            erro: skill.invalid,
          })),
        });

      case "ler_skill": {
        const skill = readSkill(String(args.nome ?? "").trim().toLowerCase());
        if (!skill) return JSON.stringify({ error: "skill não encontrada" });
        return JSON.stringify({
          nome: skill.slug,
          descricao: skill.description,
          corpo: skill.body,
          referencias: skill.references,
          truncado: skill.truncated,
        });
      }

      case "escrever_arquivo": {
        const resultado = await writeProjectFile(String(args.caminho ?? ""), String(args.conteudo ?? ""), {
          origem: "agente",
          hashBase: args.hashBase ? String(args.hashBase) : undefined,
          motivo: String(args.motivo ?? ""),
        });
        return JSON.stringify(resultado);
      }

      case "listar_tools_locais": {
        try {
          return JSON.stringify({ ferramentas: await listLocalTools() });
        } catch (error) {
          return JSON.stringify({ error: error instanceof Error ? error.message : "falha ao listar ferramentas locais" });
        }
      }

      case "executar_tool_local":
        return runLocalTool(String(args.nome ?? ""), (args.argumentos ?? {}) as Record<string, unknown>);

      case "delegar_tarefa": {
        const objetivo = String(args.objetivo ?? "").trim();
        if (!objetivo) return JSON.stringify({ error: "objetivo vazio" });
        const contexto = String(args.contexto ?? "").trim();
        const definitions = tools.filter((tool) => SUBAGENT_ALLOWED.has(tool.function.name));
        const resultado = await runSubagent(objetivo, contexto || undefined, signal, {
          definitions,
          execute: (name, toolArgs, toolSignal) => executeTool(name, toolArgs, toolSignal, false),
          model: defaultModel(),
        });
        return JSON.stringify(resultado);
      }

      case "pesquisar_web":
        return await searchWeb(String(args.query ?? ""), Math.min(Number(args.max_results ?? 5) || 5, 8), signal);

      case "abrir_url":
        return await openUrl(String(args.url ?? ""), signal);

      case "lembrar": {
        const fato = String(args.fato ?? "").trim();
        if (!fato) return JSON.stringify({ error: "fato vazio" });
        const saved = await storage.addMemory(fato);
        return JSON.stringify({ ok: true, memoria: saved });
      }

      case "criar_lembrete": {
        const titulo = String(args.titulo ?? "").trim();
        if (!titulo) return JSON.stringify({ error: "título vazio" });
        let when: string | null = null;
        const raw = String(args.quando ?? "").trim();
        if (raw) {
          const parsed = new Date(raw);
          when = Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
        }
        const reminder = await storage.addReminder(titulo, when);
        syncReminderTask(reminder);
        return JSON.stringify({ ok: true, lembrete: reminder });
      }

      case "listar_lembretes": {
        const list = await storage.listReminders(false);
        return JSON.stringify({ lembretes: list });
      }

      case "concluir_lembrete": {
        const id = String(args.id ?? "");
        if (!id) return JSON.stringify({ error: "id vazio" });
        await storage.setReminderDone(id, true);
        if (automationEnabled()) cancelTask(`reminder:${id}`);
        return JSON.stringify({ ok: true });
      }

      case "hora_atual":
        return JSON.stringify({
          iso: new Date().toISOString(),
          local: new Intl.DateTimeFormat("pt-BR", {
            dateStyle: "full",
            timeStyle: "short",
            timeZone: "America/Sao_Paulo",
          }).format(new Date()),
        });

      case "consultar_obsidian": {
        if (!obsidianEnabled()) return JSON.stringify({ error: "vault do Obsidian não configurado" });
        const hits = await searchVault(String(args.consulta ?? ""), 6, signal);
        return JSON.stringify({ consulta: args.consulta, resultados: hits });
      }

      case "salvar_nota_obsidian": {
        if (!obsidianEnabled()) return JSON.stringify({ error: "vault do Obsidian não configurado" });
        const titulo = String(args.titulo ?? "").trim();
        const conteudo = String(args.conteudo ?? "").trim();
        if (!titulo || !conteudo) return JSON.stringify({ error: "título e conteúdo obrigatórios" });
        const file = await saveNote(titulo, conteudo);
        return JSON.stringify({ ok: true, arquivo: file });
      }

      case "listar_arquivos": {
        const files = await listProjectFiles(String(args.pasta ?? ""), Math.min(Number(args.limite ?? 200) || 200, 400), signal);
        return JSON.stringify({ arquivos: files });
      }

      case "ler_arquivo": {
        const file = await readProjectFile(String(args.caminho ?? ""), signal);
        return JSON.stringify(file);
      }

      case "propor_melhoria": {
        const arquivos = Array.isArray(args.arquivos) ? (args.arquivos as EditFile[]) : [];
        const motivo = String(args.motivo ?? "").trim();
        return JSON.stringify(await proposeProjectFiles(arquivos, motivo, signal));
      }

      case "ver_tela": {
        const shot = await captureScreen(signal);
        const pergunta = String(args.pergunta ?? "").trim();
        const prompt = pergunta
          ? `O usuário perguntou: ${pergunta}\nDescreva a tela com objetividade, respondendo ao que ele quer saber.`
          : "Descreva objetivamente o que está na tela do usuário: aplicativos abertos, conteúdo principal e qualquer detalhe relevante.";
        const descricao = await describeImage(shot.base64, prompt, signal);
        return JSON.stringify({ ok: true, descricao, arquivo: shot.path });
      }

      case "controlar_pc": {
        const acao = String(args.acao ?? "").trim();
        const valor = String(args.valor ?? "").trim();
        const result = await runPcAction(acao, valor, signal);
        return JSON.stringify({ ...result, acao });
      }

      default: {
        const result = executeTaskTool(name, args);
        return JSON.stringify(result ?? { error: `ferramenta desconhecida: ${name}` });
      }
    }
  } catch (error) {
    signal.throwIfAborted();
    return JSON.stringify({ error: error instanceof Error ? error.message : "falha na ferramenta" });
  }
}
