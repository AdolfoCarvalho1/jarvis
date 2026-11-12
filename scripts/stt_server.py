"""Servidor de transcrição persistente com pedidos e respostas JSON por linha."""

import json
import os
import subprocess
import sys

import numpy as np
from faster_whisper import WhisperModel

MODEL = os.environ.get("JARVIS_STT_MODEL", "small")
DEVICE = os.environ.get("JARVIS_STT_DEVICE", "cpu")
COMPUTE = os.environ.get("JARVIS_STT_COMPUTE", "int8")
FFMPEG = os.environ.get("JARVIS_FFMPEG", "ffmpeg")
sys.stdin.reconfigure(encoding="utf-8")
sys.stdout.reconfigure(encoding="utf-8")


def emit(payload: dict) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def load_audio(path: str) -> np.ndarray:
    """Decodifica com o ffmpeg e entrega float32 16 kHz mono para o modelo.

    Evita o PyAV do faster-whisper: a versão instalada rejeita `metadata_errors`
    e a decodificação falhava em todo áudio.
    """
    result = subprocess.run(
        [FFMPEG, "-v", "error", "-i", path, "-ac", "1", "-ar", "16000", "-f", "f32le", "-"],
        capture_output=True,
        check=True,
        timeout=20,
    )
    return np.frombuffer(result.stdout, dtype=np.float32)


emit({"status": "loading", "model": MODEL, "device": DEVICE})

try:
    model = WhisperModel(MODEL, device=DEVICE, compute_type=COMPUTE)
except Exception as error:  # noqa: BLE001 - o erro vai para o log do app
    emit({"error": f"modelo indisponível: {error}"})
    sys.exit(1)

emit({"ready": True, "model": MODEL, "device": DEVICE})

for raw in sys.stdin:
    try:
        job = json.loads(raw)
        job_id = job["id"]
        path = job["file"]
    except (ValueError, KeyError, TypeError):
        continue
    try:
        audio = load_audio(path)
        segments, info = model.transcribe(audio, language="pt", beam_size=5, vad_filter=True)
        text = "".join(segment.text for segment in segments).strip()
        emit({"id": job_id, "text": text, "language": info.language, "duration": round(float(info.duration), 2)})
    except Exception:  # noqa: BLE001 - mantém o worker pronto para o próximo pedido
        emit({"id": job_id, "error": "Não foi possível decodificar ou transcrever este áudio."})
