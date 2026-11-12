"""Ponte com o Composio CLI (roda no WSL quando não há binário no Windows)."""
from __future__ import annotations

import json
import shutil
import subprocess

NAME = "composio"
DESCRIPTION = (
    "Consulta e executa ferramentas do Composio (Gmail, GitHub, Slack etc.). "
    "Ações: search (buscar por caso de uso), connections (contas conectadas), "
    "schema (entrada esperada de uma ferramenta) e execute (rodar por slug). "
    "execute exige aprovação."
)
PARAMETERS = {
    "type": "object",
    "properties": {
        "acao": {"type": "string", "enum": ["search", "connections", "schema", "execute"]},
        "consulta": {"type": "string", "description": "Texto da busca (acao=search)"},
        "limite": {"type": "integer", "description": "Resultados da busca (padrão 5)"},
        "slug": {"type": "string", "description": "Slug da ferramenta (acao=schema/execute)"},
        "dados": {"type": "object", "description": "Argumentos da ferramenta (acao=execute)"},
        "conta": {"type": "string", "description": "Conta conectada (opcional, acao=execute)"},
    },
    "required": ["acao"],
}

WSL = ["wsl", "-d", "Ubuntu", "-u", "root", "--", "/root/.composio/composio"]
TIMEOUT = 90


def command() -> list[str]:
    local = shutil.which("composio")
    return [local] if local else WSL


def call(args: list[str]) -> dict:
    result = subprocess.run(
        command() + args,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=TIMEOUT,
    )
    output = (result.stdout or "").strip()
    error = (result.stderr or "").strip()
    if result.returncode != 0 and not output:
        raise RuntimeError(error or f"composio saiu com código {result.returncode}")

    payload = output
    if output:
        try:
            payload = json.loads(output)
        except json.JSONDecodeError:
            payload = output[-8000:]
    return {"codigo": result.returncode, "saida": payload, "erro": error[-2000:] if error else ""}


def run(args: dict) -> dict:
    acao = str(args.get("acao", "")).strip().lower()

    if acao == "search":
        consulta = str(args.get("consulta", "")).strip()
        if not consulta:
            raise ValueError("informe 'consulta' para buscar")
        limite = max(1, min(int(args.get("limite", 5)), 20))
        return call(["search", consulta, "--limit", str(limite)])

    if acao == "connections":
        return call(["connections", "list"])

    if acao == "schema":
        slug = str(args.get("slug", "")).strip()
        if not slug:
            raise ValueError("informe 'slug'")
        return call(["execute", slug, "--get-schema"])

    if acao == "execute":
        slug = str(args.get("slug", "")).strip()
        if not slug:
            raise ValueError("informe 'slug' para executar")
        dados = args.get("dados") or {}
        if not isinstance(dados, dict):
            raise ValueError("'dados' precisa ser um objeto")
        extra = ["--account", str(args["conta"])] if args.get("conta") else []
        return call(["execute", slug, "-d", json.dumps(dados, ensure_ascii=False), *extra])

    raise ValueError(f"ação desconhecida: {acao}")
