import assert from "node:assert/strict";
import { link, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { askApproval, decideApproval } from "../lib/approvals.ts";
import { readPublicPage } from "../lib/public-page.ts";
import { takeTurn, TurnBusy } from "../lib/turn-lock.ts";

test("source access rejects redirected and private paths and proposals leave source untouched", async () => {
  const original = process.cwd();
  const previousData = process.env.JARVIS_DATA_DIR;
  const root = await mkdtemp(path.join(tmpdir(), "jarvis-source-test-"));
  try {
    process.chdir(root);
    process.env.JARVIS_DATA_DIR = path.join(root, ".data");
    await mkdir("lib");
    await writeFile(".env.local", "FIXTURE_ONLY=true");
    await writeFile("lib/.env.local", "FIXTURE_ONLY=true");
    await writeFile("lib/example.ts", "export const example = true;\n");
    await link(".env.local", "lib/linked.ts");
    await symlink(root, path.join(root, "lib", "alias"), process.platform === "win32" ? "junction" : "dir");
    const { listProjectFiles, proposeProjectFiles, readProjectFile, readProposal } = await import("../lib/selfedit.ts");
    for (const file of ["lib/../.env.local", ".ENV.LOCAL", "lib/.env.local", "lib/linked.ts", "lib/alias/lib/example.ts", "lib/example.ts:stream"]) {
      await assert.rejects(() => readProjectFile(file));
    }
    assert.deepEqual((await listProjectFiles()).map((file) => file.caminho), ["lib/example.ts"]);
    const signal = AbortSignal.timeout(3000);
    const proposal = await proposeProjectFiles([
      { caminho: "lib/example.ts", conteudo: "export const example = false;\n" },
    ], "Teste", signal);
    assert.match(await readProposal(proposal.proposalId), /^\+export const example = false;/m);
    assert.equal(await readFile("lib/example.ts", "utf8"), "export const example = true;\n");
  } finally {
    process.chdir(original);
    if (previousData === undefined) delete process.env.JARVIS_DATA_DIR;
    else process.env.JARVIS_DATA_DIR = previousData;
    await rm(root, { recursive: true, force: true });
  }
});

test("turns serialize and an aborted waiter does not block the next turn", async () => {
  const signal = AbortSignal.timeout(3000);
  const release = await takeTurn(signal);
  await assert.rejects(takeTurn(signal, 0), TurnBusy);
  const abort = new AbortController();
  const cancelled = takeTurn(abort.signal);
  const next = takeTurn(signal);
  abort.abort();
  await assert.rejects(cancelled, { name: "AbortError" });
  release();
  (await next)();
  (await takeTurn(signal, 0))();
});

test("an approval is single use and disappears on cancellation", async () => {
  const first = askApproval(AbortSignal.timeout(3000));
  assert.equal(decideApproval(first.id, true), true);
  assert.equal(decideApproval(first.id, false), false);
  assert.equal(await first.decision, true);
  const abort = new AbortController();
  const second = askApproval(abort.signal);
  abort.abort();
  assert.equal(await second.decision, false);
  assert.equal(decideApproval(second.id, true), false);
});

test("public pages reject private and reserved addresses", async () => {
  const signal = AbortSignal.timeout(3000);
  for (const address of ["127.0.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "240.0.0.1"]) {
    await assert.rejects(readPublicPage(new URL(`http://${address}/`), {}, signal), /privada ou reservada/);
  }
});

test("STT matches replies by ID, recovers from job errors and starts a fresh process after timeout", async () => {
  const original = process.cwd();
  const python = process.env.JARVIS_STT_PYTHON;
  const setTimer = globalThis.setTimeout;
  const root = await mkdtemp(path.join(tmpdir(), "jarvis-stt-test-"));
  try {
    process.chdir(root);
    process.env.JARVIS_STT_PYTHON = process.execPath;
    globalThis.setTimeout = (fn, ms, ...args) => setTimer(fn, ms === 35_000 ? 400 : ms, ...args);
    await mkdir("scripts");
    await writeFile("scripts/stt_server.py", `
      const { createInterface } = require("node:readline");
      const emit = (value) => console.log(JSON.stringify(value));
      emit({ready: true});
      createInterface({input: process.stdin}).on("line", (line) => {
        const {id,file} = JSON.parse(line);
        emit({id:"different-id",text:"ignore"});
        if (file === "bad") emit({id,error:"fixture-error"});
        else if (file === "slow") setTimeout(() => emit({id,text:"too late"}), 1000);
        else emit({id,text:file + ":" + process.pid});
      });
    `);
    const { transcribe } = await import("../lib/stt.ts");
    const signal = AbortSignal.timeout(7000);
    const first = await transcribe("first", signal);
    await assert.rejects(transcribe("bad", signal), /fixture-error/);
    const second = await transcribe("second", signal);
    assert.equal(first.text.split(":")[1], second.text.split(":")[1]);
    const slow = transcribe("slow", signal);
    const next = transcribe("next", signal);
    await assert.rejects(slow, /excedeu o prazo/);
    const result = await next;
    assert.match(result.text, /^next:/);
    assert.notEqual(result.text.split(":")[1], first.text.split(":")[1]);
  } finally {
    const child = globalThis.jarvisVoiceWorker?.child;
    if (child) {
      const closed = new Promise((resolve) => child.once("close", resolve));
      child.kill();
      await closed;
    }
    process.chdir(original);
    if (python === undefined) delete process.env.JARVIS_STT_PYTHON;
    else process.env.JARVIS_STT_PYTHON = python;
    globalThis.setTimeout = setTimer;
    await rm(root, { recursive: true, force: true });
  }
});
