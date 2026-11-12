import type { ToolDefinition } from "../tools";
import { findProjectFiles, resolveProject } from "./actions";
import { cancelTask, listRoutines, listTasks, taskById } from "./store";
import { automationEnabled, queueFileWatch, queueProjectCheck, queueRoutine, storeRoutine } from "./tasks";
import { apps, checks } from "./types";

const string = { type: "string" };
const boolean = { type: "boolean" };

function tool(name: string, description: string, properties: Record<string, unknown>, required: string[] = []): ToolDefinition {
  return { type: "function", function: { name, description, parameters: { type: "object", properties, required } } };
}

export const taskTools = automationEnabled() ? [
  tool("executar_projeto", "Agenda uma checagem npm em um projeto local. A tarefa segue em segundo plano. Sem projeto informado, usa o Jarvis. Informe abrir_erro para navegar ao primeiro diagnóstico no VS Code.", {
    projeto: string, checagem: { type: "string", enum: checks }, abrir_erro: boolean, abrir_projeto: boolean,
  }, ["checagem"]),
  tool("acompanhar_arquivo", "Acompanha um caminho absoluto de arquivo local até ele aparecer ou mudar e estabilizar. O aviso é sobre o arquivo, pois isso não confirma o estado do exportador.", {
    arquivo: string, abrir_pasta: boolean,
  }, ["arquivo"]),
  tool("consultar_tarefas", "Consulta o resultado de uma tarefa pelo ID ou lista as tarefas recentes com seus IDs.", { id: string }),
  tool("cancelar_tarefa", "Cancela a tarefa local indicada pelo ID.", { id: string }, ["id"]),
  tool("buscar_arquivos_projeto", "Busca parte do nome de um arquivo em um projeto local. Sem projeto informado, usa o Jarvis.", {
    projeto: string, nome: string,
  }, ["nome"]),
  tool("gerenciar_rotina", "Lista, salva ou executa rotinas. Para guardar o que já fez, use o ID da tarefa original. Para ensinar ou editar passos explicitamente, envie passos na ordem desejada.", {
    acao: { type: "string", enum: ["listar", "salvar", "executar"] },
    nome: string, projeto: string, tarefa: string,
    passos: { type: "array", items: { type: "object", properties: {
      action: { type: "string", enum: ["open-project", "check", "open-error", "open-folder", "open-app"] },
      check: { type: "string", enum: checks },
      app: { type: "string", enum: apps },
    }, required: ["action"] } },
  }, ["acao"]),
] : [];

export function executeTaskTool(name: string, args: Record<string, unknown>): object | null {
  if (!taskTools.some((entry) => entry.function.name === name)) return null;
  const project = String(args.projeto ?? "");
  switch (name) {
    case "executar_projeto":
      return queueProjectCheck(project, String(args.checagem), args.abrir_erro === true, args.abrir_projeto === true);
    case "acompanhar_arquivo":
      return queueFileWatch(String(args.arquivo ?? "").trim(), args.abrir_pasta === true);
    case "consultar_tarefas": {
      if (!args.id) return { tarefas: listTasks().slice(0, 12).map(({ id, title, status, summary }) => ({ id, title, status, summary })) };
      const task = taskById(String(args.id));
      return task ? {
        ...task,
        results: task.results.map((result) => ({ ...result, output: result.output?.slice(-3000) })),
      } : { error: "Tarefa não encontrada." };
    }
    case "cancelar_tarefa":
      return cancelTask(String(args.id)) ? { ok: true } : { error: "A tarefa já terminou ou não existe." };
    case "buscar_arquivos_projeto":
      return { arquivos: findProjectFiles(resolveProject(project), String(args.nome ?? "")) };
    case "gerenciar_rotina": {
      const label = String(args.nome ?? "");
      if (args.acao === "listar") return { rotinas: listRoutines() };
      if (args.acao === "executar") return queueRoutine(label, project);
      if (args.acao === "salvar") {
        return { rotina: storeRoutine(label, args.passos, taskById(String(args.tarefa ?? ""))?.steps) };
      }
      return { error: "Ação inválida." };
    }
    default:
      return null;
  }
}
