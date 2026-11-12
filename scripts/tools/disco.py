"""Espaço em disco — determinístico, sem modelo."""
from __future__ import annotations

import shutil
import string

NAME = "disco"
DESCRIPTION = "Mostra espaço livre, usado e total dos discos locais (Windows)."
PARAMETERS = {
    "type": "object",
    "properties": {
        "letra": {"type": "string", "description": "Letra do disco, ex.: C (opcional)"},
    },
}


def run(args: dict) -> dict:
    letra = str(args.get("letra", "")).strip().upper().rstrip(":")
    letras = [letra] if letra else list(string.ascii_uppercase)
    discos = []
    for item in letras:
        raiz = f"{item}:\\"
        try:
            total, usado, livre = shutil.disk_usage(raiz)
        except OSError:
            continue
        discos.append({
            "disco": raiz,
            "total_gb": round(total / 1024**3, 1),
            "usado_gb": round(usado / 1024**3, 1),
            "livre_gb": round(livre / 1024**3, 1),
            "livre_pct": round(livre / total * 100, 1) if total else 0,
        })
    if not discos:
        raise ValueError("nenhum disco encontrado")
    return {"discos": discos}
