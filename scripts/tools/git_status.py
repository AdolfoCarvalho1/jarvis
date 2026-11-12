"""Estado do git do projeto — determinístico."""
from __future__ import annotations

import subprocess
from pathlib import Path

NAME = "git_status"
DESCRIPTION = "Resume o estado do repositório: branch, arquivos alterados e últimos commits."
PARAMETERS = {
    "type": "object",
    "properties": {
        "caminho": {"type": "string", "description": "Pasta do repositório (padrão: raiz do Jarvis)"},
        "commits": {"type": "integer", "description": "Quantos commits listar (padrão 5)"},
    },
}

ROOT = Path(__file__).resolve().parents[2]


def git(cwd: Path, *args: str) -> str:
    result = subprocess.run(
        ["git", "-C", str(cwd), *args],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=20,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or f"git {' '.join(args)} falhou")
    return result.stdout.strip()


def run(args: dict) -> dict:
    cwd = Path(args.get("caminho") or ROOT).resolve()
    if not (cwd / ".git").exists():
        raise ValueError(f"{cwd} não é um repositório git")
    limite = max(1, min(int(args.get("commits", 5)), 20))
    status = git(cwd, "status", "--short")
    return {
        "repositorio": str(cwd),
        "branch": git(cwd, "branch", "--show-current"),
        "alterados": status.splitlines()[:60],
        "total_alterados": len(status.splitlines()),
        "ultimos_commits": git(cwd, "log", f"-{limite}", "--oneline").splitlines(),
    }
