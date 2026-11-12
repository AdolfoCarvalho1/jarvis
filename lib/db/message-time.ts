const clock = globalThis as typeof globalThis & { jarvisLastMessageMs?: number };

export function messageTime() {
  const ms = Math.max(Date.now(), (clock.jarvisLastMessageMs ?? 0) + 1);
  clock.jarvisLastMessageMs = ms;
  return new Date(ms).toISOString();
}
