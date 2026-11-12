import { randomUUID } from "node:crypto";

const approvals = globalThis as typeof globalThis & {
  jarvisApprovals?: Map<string, (approved: boolean) => void>;
};
const pending = approvals.jarvisApprovals ??= new Map();

export function askApproval(signal: AbortSignal) {
  const id = randomUUID();
  const decision = new Promise<boolean>((resolve) => {
    const finish = (approved: boolean) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", cancel);
      pending.delete(id);
      resolve(approved);
    };
    const cancel = () => finish(false);
    const timer = setTimeout(cancel, 120_000);
    pending.set(id, finish);
    if (signal.aborted) cancel();
    else signal.addEventListener("abort", cancel, { once: true });
  });
  return { id, decision };
}

export function decideApproval(id: string, approved: boolean) {
  const resolve = pending.get(id);
  if (!resolve) return false;
  resolve(approved);
  return true;
}
