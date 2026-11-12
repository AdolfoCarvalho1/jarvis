#!/usr/bin/env python3
"""
Runner de ferramentas locais do J.A.R.V.I.S.

Cada arquivo em scripts/tools/ (menos este e os que começam com _) pode expor:

    NAME = "disco"
    DESCRIPTION = "Espaço livre e total dos discos."
    PARAMETERS = {"type": "object", "properties": {...}, "required": [...]}

    def run(args: dict) -> dict | str:
        ...

Uso:
    python scripts/tools/runner.py list
    python scripts/tools/runner.py run disco --json "{}"

Saída sempre JSON em uma linha: {"ok": true, "resultado": ...} ou {"ok": false, "erro": "..."}.

Ferramentas determinísticas aqui não passam pelo modelo: são baratas, rápidas e
reproduzíveis. Um binário Rust pode entrar no mesmo contrato: recebe JSON no
argv/stdin e devolve JSON no stdout — basta apontar LOCAIS_EXTRA para ele.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from pathlib import Path

TOOLS_DIR = Path(__file__).resolve().parent


def discover() -> dict[str, dict]:
    tools: dict[str, dict] = {}
    for file in sorted(TOOLS_DIR.glob("*.py")):
        if file.name.startswith("_") or file.name == "runner.py":
            continue
        spec = importlib.util.spec_from_file_location(f"jarvis_tool_{file.stem}", file)
        if not spec or not spec.loader:
            continue
        module = importlib.util.module_from_spec(spec)
        try:
            spec.loader.exec_module(module)
        except Exception as error:  # noqa: BLE001 - ferramenta quebrada não derruba o runner
            tools[file.stem] = {"erro": f"falha ao carregar: {error}"}
            continue
        name = getattr(module, "NAME", file.stem)
        if not getattr(module, "run", None):
            continue
        tools[name] = {
            "nome": name,
            "descricao": getattr(module, "DESCRIPTION", "").strip(),
            "parametros": getattr(module, "PARAMETERS", {"type": "object", "properties": {}}),
            "arquivo": file.name,
            "_run": module.run,
        }
    return tools


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("acao", choices=["list", "run"])
    parser.add_argument("nome", nargs="?")
    parser.add_argument("--json", dest="payload", default="{}")
    args = parser.parse_args()

    tools = discover()

    if args.acao == "list":
        print(json.dumps({
            "ok": True,
            "ferramentas": [
                {"nome": t["nome"], "descricao": t["descricao"], "parametros": t["parametros"]}
                for t in tools.values() if "_run" in t
            ],
            "quebradas": {k: v["erro"] for k, v in tools.items() if "erro" in v},
        }, ensure_ascii=False))
        return 0

    tool = tools.get(args.nome or "")
    if not tool or "_run" not in tool:
        print(json.dumps({"ok": False, "erro": f"ferramenta '{args.nome}' não encontrada"}, ensure_ascii=False))
        return 1

    try:
        payload = json.loads(args.payload or "{}")
        if not isinstance(payload, dict):
            raise ValueError("argumentos precisam ser um objeto")
    except Exception as error:  # noqa: BLE001
        print(json.dumps({"ok": False, "erro": f"JSON inválido: {error}"}, ensure_ascii=False))
        return 1

    try:
        result = tool["_run"](payload)
        print(json.dumps({"ok": True, "resultado": result}, ensure_ascii=False))
        return 0
    except Exception as error:  # noqa: BLE001
        print(json.dumps({"ok": False, "erro": str(error)}, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    sys.exit(main())
