interface Waiter {
  grant: () => void;
}

const shared = globalThis as typeof globalThis & { jarvisTurnLock?: { held: boolean; queue: Waiter[] } };
const lock = shared.jarvisTurnLock ??= { held: false, queue: [] };

export class TurnBusy extends Error {
  constructor() {
    super("Há uma resposta em andamento. Aguarde ou pare a resposta na interface que a iniciou.");
  }
}

function release() {
  const next = lock.queue.shift();
  if (next) next.grant();
  else lock.held = false;
}

export async function takeTurn(signal: AbortSignal, waitMs = 8_000): Promise<() => void> {
  signal.throwIfAborted();
  if (!lock.held) {
    lock.held = true;
    return release;
  }
  if (!waitMs || lock.queue.length >= 4) throw new TurnBusy();
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
    };
    const waiter = { grant: () => { cleanup(); resolve(release); } };
    const rejectWait = (error: unknown) => {
      cleanup();
      const index = lock.queue.indexOf(waiter);
      if (index >= 0) lock.queue.splice(index, 1);
      reject(error);
    };
    const onAbort = () => rejectWait(signal.reason);
    const timer = setTimeout(() => rejectWait(new TurnBusy()), waitMs);
    lock.queue.push(waiter);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
