"""Exemplo mínimo de ferramenta local (aritmética exata, sem modelo)."""
from __future__ import annotations

NAME = "soma"
DESCRIPTION = "Soma uma lista de números e devolve total e média. Use para contas exatas."
PARAMETERS = {
    "type": "object",
    "properties": {
        "numeros": {
            "type": "array",
            "items": {"type": "number"},
            "description": "Números a somar",
        },
    },
    "required": ["numeros"],
}


def run(args: dict) -> dict:
    numeros = args.get("numeros")
    if not isinstance(numeros, list) or not numeros:
        raise ValueError("envie uma lista não vazia em 'numeros'")
    valores = [float(item) for item in numeros]
    total = sum(valores)
    return {
        "total": int(total) if total.is_integer() else round(total, 6),
        "media": round(total / len(valores), 6),
        "quantidade": len(valores),
    }
