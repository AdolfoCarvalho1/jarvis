import asyncio
import os
import sys

import edge_tts

sys.stdin.reconfigure(encoding="utf-8")


async def main() -> None:
    text = sys.stdin.read().strip()
    if not text:
        sys.exit(2)
    out = sys.argv[1]
    voice = sys.argv[2] if len(sys.argv) > 2 else "pt-BR-AntonioNeural"
    rate = sys.argv[3] if len(sys.argv) > 3 else "+20%"
    for _ in range(3):
        try:
            communicate = edge_tts.Communicate(text, voice, rate=rate)
            await communicate.save(out)
            if os.path.getsize(out) > 200:
                return
        except Exception:
            pass
        await asyncio.sleep(1.2)

    sys.exit(1)


asyncio.run(main())
