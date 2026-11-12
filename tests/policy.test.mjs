import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyTool,
  decideTool,
  policyRequiresApproval,
  sandboxStatus,
} from "../lib/policy.ts";

test("leitura comum não pede aprovação", () => {
  const policy = classifyTool("pesquisar_web");
  assert.equal(policy.mode, "read-only");
  assert.equal(policyRequiresApproval(policy), false);
  assert.equal(decideTool("pesquisar_web").ok, true);
});

test("leitura sensível pede aprovação sem virar escrita", () => {
  const policy = classifyTool("ver_tela");
  assert.equal(policy.mode, "read-only");
  assert.equal(policy.approval, true);
  assert.equal(decideTool("ver_tela").ok, false);
  assert.equal(decideTool("ver_tela", {}, true).ok, true);
});

test("ferramenta local conhecida é read-only; desconhecida é fail-closed", () => {
  assert.equal(classifyTool("executar_tool_local", { nome: "soma" }).mode, "read-only");
  assert.equal(decideTool("executar_tool_local", { nome: "soma" }).ok, true);

  const unknown = classifyTool("executar_tool_local", { nome: "script-novo" });
  assert.equal(unknown.mode, "danger-full-access");
  assert.equal(unknown.approval, true);
  assert.equal(decideTool("executar_tool_local", { nome: "script-novo" }).ok, false);
});

test("Composio: consulta passa, execute exige aprovação", () => {
  const search = classifyTool("executar_tool_local", { nome: "composio", argumentos: { acao: "search" } });
  assert.equal(search.mode, "read-only");
  assert.equal(policyRequiresApproval(search), false);

  const exec = classifyTool("executar_tool_local", { nome: "composio", argumentos: { acao: "execute" } });
  assert.equal(exec.mode, "danger-full-access");
  assert.equal(decideTool("executar_tool_local", { nome: "composio", argumentos: { acao: "execute" } }).ok, false);
});

test("meta-ferramenta herda a política do alvo", () => {
  const policy = classifyTool("usar_ferramenta", {
    nome: "executar_tool_local",
    argumentos: { nome: "soma" },
  });
  assert.equal(policy.mode, "read-only");
  assert.equal(policyRequiresApproval(policy), false);

  const blocked = classifyTool("usar_ferramenta", {
    nome: "controlar_pc",
    argumentos: { acao: "bloquear" },
  });
  assert.equal(blocked.mode, "danger-full-access");
  assert.equal(blocked.approval, true);
});

test("ferramenta nova é perigosa até ser classificada", () => {
  const policy = classifyTool("ferramenta_inexistente");
  assert.equal(policy.mode, "danger-full-access");
  assert.equal(policy.approval, true);
  assert.equal(decideTool("ferramenta_inexistente").ok, false);
});

test("modo read-only bloqueia escrita sem aprovação e libera com aprovação de uma chamada", () => {
  const previous = process.env.JARVIS_SANDBOX_MODE;
  process.env.JARVIS_SANDBOX_MODE = "read-only";
  try {
    assert.equal(sandboxStatus().mode, "read-only");
    const without = decideTool("propor_melhoria", { arquivos: [] });
    assert.equal(without.ok, false);
    assert.match(without.error ?? "", /fora do modo read-only/);

    const withApproval = decideTool("propor_melhoria", { arquivos: [] }, true);
    assert.equal(withApproval.ok, true);
    assert.match(withApproval.policy.reason, /aprovada uma vez/);
  } finally {
    if (previous === undefined) delete process.env.JARVIS_SANDBOX_MODE;
    else process.env.JARVIS_SANDBOX_MODE = previous;
  }
});
