"""Verificação de porta local — determinístico."""
from __future__ import annotations

import socket

NAME = "porta"
DESCRIPTION = "Diz se uma porta TCP está escutando em 127.0.0.1 (e opcionalmente em outro host)."
PARAMETERS = {
    "type": "object",
    "properties": {
        "numero": {"type": "integer", "description": "Porta TCP, ex.: 3300"},
        "host": {"type": "string", "description": "Host (padrão 127.0.0.1)"},
        "timeout": {"type": "number", "description": "Timeout em segundos (padrão 0.5)"},
    },
    "required": ["numero"],
}


def run(args: dict) -> dict:
    porta = int(args["numero"])
    host = str(args.get("host", "127.0.0.1"))
    timeout = float(args.get("timeout", 0.5))
    if not 1 <= porta <= 65535:
        raise ValueError("porta fora do intervalo 1-65535")
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(timeout)
        aberta = sock.connect_ex((host, porta)) == 0
    return {"host": host, "porta": porta, "escutando": aberta}
