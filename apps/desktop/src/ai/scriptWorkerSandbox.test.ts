import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SCRIPT_LIMIT_DEFAULTS, type SandboxJob } from "@plainva/core";
import { createWorkerSandbox, readSandboxEnd, type FromScriptWorker, type SandboxWorker, type ToScriptWorker } from "@plainva/ui";

/**
 * The app's side of the script worker (plan KI-Harness P5.5): the watchdog
 * that ends a worker whose script is out of time — the one limit that does
 * not depend on the engine asking back — and the reading of what a worker
 * reports. The worker is played here; the E2E of both shells runs the real one.
 */

/** A worker played by the test: it records what it is sent and says what the test makes it say. */
function playedWorker() {
  const sent: ToScriptWorker[] = [];
  let terminated = false;
  const worker: SandboxWorker & { say(message: FromScriptWorker | unknown): void; fail(): void } = {
    onmessage: null,
    onerror: null,
    postMessage: (message) => {
      if (terminated) throw new Error("posted to a worker that was ended");
      sent.push(message);
    },
    terminate: () => {
      terminated = true;
    },
    say: (message) => worker.onmessage?.({ data: message }),
    fail: () => worker.onerror?.(new Error("worker failed")),
  };
  return { worker, sent, terminated: () => terminated };
}

const job = (limits: Partial<SandboxJob["limits"]> = {}): SandboxJob => ({ code: "return 1;", input: {}, tools: ["search_vault"], limits: { ...SCRIPT_LIMIT_DEFAULTS, ...limits } });
const usage = { ms: 12, fuel: 3 };
const noHost = { call: async () => '{"ok":true,"data":null}' };

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("the script worker's watchdog", () => {
  it("hands the job to a worker of its own and ends the worker when the run is over", async () => {
    const played = playedWorker();
    const sandbox = createWorkerSandbox(() => played.worker, { available: () => true });
    const run = sandbox.run(job(), noHost);
    expect(played.sent).toEqual([{ type: "run", job: job() }]);
    played.worker.say({ type: "ready" });
    played.worker.say({ type: "working", busy: true, usage: { ms: 0, fuel: 0 } });
    played.worker.say({ type: "working", busy: false, usage });
    played.worker.say({ type: "end", end: { kind: "done", json: "1", usage } });
    expect(await run).toEqual({ kind: "done", json: "1", usage });
    expect(played.terminated()).toBe(true);
  });

  it("carries a tool call to the host and its answer back, and a log line to the host", async () => {
    const played = playedWorker();
    const logs: string[] = [];
    const sandbox = createWorkerSandbox(() => played.worker, { available: () => true });
    const run = sandbox.run(job(), { call: async (tool, args) => JSON.stringify({ ok: true, data: { tool, args } }), log: (level, text) => logs.push(`${level}:${text}`) });
    played.worker.say({ type: "ready" });
    played.worker.say({ type: "call", id: 7, tool: "search_vault", args: '{"query":"x"}' });
    played.worker.say({ type: "log", level: "warn", text: "careful" });
    played.worker.say({ type: "log", level: "made-up", text: "odd level" });
    await vi.advanceTimersByTimeAsync(0);
    expect(played.sent[1]).toEqual({ type: "result", id: 7, json: '{"ok":true,"data":{"tool":"search_vault","args":"{\\"query\\":\\"x\\"}"}}' });
    expect(logs).toEqual(["warn:careful", "log:odd level"]);
    played.worker.say({ type: "end", end: { kind: "done", json: "null", usage } });
    expect((await run).kind).toBe("done");
  });

  it("a host that fails a call answers the script with a lost call, never with silence", async () => {
    const played = playedWorker();
    const sandbox = createWorkerSandbox(() => played.worker, { available: () => true });
    const run = sandbox.run(job(), { call: () => Promise.reject(new Error("bridge closed")) });
    played.worker.say({ type: "call", id: 1, tool: "search_vault", args: "{}" });
    await vi.advanceTimersByTimeAsync(0);
    expect(played.sent[1]).toEqual({ type: "result", id: 1, json: '{"ok":false,"error":"The call was lost."}' });
    played.worker.say({ type: "end", end: { kind: "done", json: "1", usage } });
    await run;
  });

  it("ends a worker whose script is out of time — whether or not the engine ever says so", async () => {
    const played = playedWorker();
    const sandbox = createWorkerSandbox(() => played.worker, { available: () => true, graceMs: 500 });
    const run = sandbox.run(job({ seconds: 2 }), noHost);
    played.worker.say({ type: "ready" });
    played.worker.say({ type: "working", busy: true, usage: { ms: 0, fuel: 0 } });
    // One long step inside a built-in function: the worker says nothing more.
    await vi.advanceTimersByTimeAsync(2400);
    expect(played.terminated()).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    expect(await run).toEqual({ kind: "killed", why: "time", usage: { ms: 2000, fuel: 0 } });
    expect(played.terminated()).toBe(true);
  });

  it("its clock runs only while the engine works: the time a tool takes is not the script's", async () => {
    const played = playedWorker();
    const sandbox = createWorkerSandbox(() => played.worker, { available: () => true, graceMs: 500 });
    let answer: (json: string) => void = () => {};
    const run = sandbox.run(job({ seconds: 2 }), { call: () => new Promise<string>((resolve) => (answer = resolve)) });
    played.worker.say({ type: "ready" });
    played.worker.say({ type: "working", busy: true, usage: { ms: 0, fuel: 0 } });
    played.worker.say({ type: "call", id: 1, tool: "search_vault", args: "{}" });
    played.worker.say({ type: "working", busy: false, usage: { ms: 1500, fuel: 40 } });
    // A slow tool: a minute passes, and nobody is ended.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(played.terminated()).toBe(false);
    answer('{"ok":true,"data":1}');
    await vi.advanceTimersByTimeAsync(0);
    // Working again with half a second of its two left: ended after that and the grace.
    played.worker.say({ type: "working", busy: true, usage: { ms: 1500, fuel: 40 } });
    await vi.advanceTimersByTimeAsync(900);
    expect(played.terminated()).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    expect(await run).toEqual({ kind: "killed", why: "time", usage: { ms: 2000, fuel: 40 } });
  });

  it("an engine that does not load, a worker that fails or cannot be started is an engine that gave way", async () => {
    const slow = playedWorker();
    const slowRun = createWorkerSandbox(() => slow.worker, { available: () => true, bootMs: 5000 }).run(job(), noHost);
    await vi.advanceTimersByTimeAsync(5100);
    expect(await slowRun).toMatchObject({ kind: "killed", why: "crashed" });
    expect(slow.terminated()).toBe(true);

    const failing = playedWorker();
    const failingRun = createWorkerSandbox(() => failing.worker, { available: () => true }).run(job(), noHost);
    failing.worker.fail();
    expect(await failingRun).toMatchObject({ kind: "killed", why: "crashed" });

    const none = createWorkerSandbox(
      () => {
        throw new Error("no worker here");
      },
      { available: () => true },
    );
    expect(await none.run(job(), noHost)).toMatchObject({ kind: "killed", why: "crashed" });
    expect(await createWorkerSandbox(() => playedWorker().worker, { available: () => false }).run(job(), noHost)).toMatchObject({ kind: "killed", why: "crashed" });
    expect(createWorkerSandbox(() => playedWorker().worker, { available: () => false }).available()).toBe(false);
  });

  it("stops with the caller, at once, and does not start once the caller has stopped", async () => {
    const played = playedWorker();
    const controller = new AbortController();
    const run = createWorkerSandbox(() => played.worker, { available: () => true }).run(job(), noHost, controller.signal);
    played.worker.say({ type: "ready" });
    played.worker.say({ type: "working", busy: true, usage });
    controller.abort();
    expect(await run).toEqual({ kind: "killed", why: "stopped", usage });
    expect(played.terminated()).toBe(true);
    // Nothing is sent to a worker that was ended, and what it still says is not heard.
    played.worker.say({ type: "call", id: 1, tool: "search_vault", args: "{}" });
    played.worker.say({ type: "end", end: { kind: "done", json: "1", usage } });
    await vi.advanceTimersByTimeAsync(0);
    expect(played.sent).toHaveLength(1);

    let spawned = 0;
    const never = createWorkerSandbox(() => (spawned++, playedWorker().worker), { available: () => true });
    expect(await never.run(job(), noHost, controller.signal)).toMatchObject({ kind: "killed", why: "stopped" });
    expect(spawned).toBe(0);
  });

  it("reads what a worker reports field by field: what does not read is an engine that gave way", () => {
    expect(readSandboxEnd({ kind: "done", json: "1", usage })).toEqual({ kind: "done", json: "1", usage });
    expect(readSandboxEnd({ kind: "error", message: "x", usage })).toEqual({ kind: "error", message: "x", usage });
    expect(readSandboxEnd({ kind: "killed", why: "fuel", usage })).toEqual({ kind: "killed", why: "fuel", usage });
    for (const odd of [null, undefined, "done", {}, { kind: "done" }, { kind: "done", json: 1 }, { kind: "error" }, { kind: "killed", why: "bored" }, { kind: "approved", json: "1" }]) {
      expect(readSandboxEnd(odd), JSON.stringify(odd)).toEqual({ kind: "killed", why: "crashed", usage: { ms: 0, fuel: 0 } });
    }
    expect(readSandboxEnd({ kind: "done", json: "1", usage: { ms: -5, fuel: "many" } })).toEqual({ kind: "done", json: "1", usage: { ms: 0, fuel: 0 } });
  });

  it("a check asks a worker of its own and ends it", async () => {
    const good = playedWorker();
    const sandbox = createWorkerSandbox(() => good.worker, { available: () => true });
    const checking = sandbox.check("return 1;");
    expect(good.sent).toEqual([{ type: "check", code: "return 1;" }]);
    good.worker.say({ type: "checked", result: { ok: true } });
    expect(await checking).toEqual({ ok: true });
    expect(good.terminated()).toBe(true);

    const bad = playedWorker();
    const refused = createWorkerSandbox(() => bad.worker, { available: () => true }).check("const = 1;");
    bad.worker.say({ type: "checked", result: { ok: false, message: "SyntaxError (line 1)" } });
    expect(await refused).toEqual({ ok: false, message: "SyntaxError (line 1)" });

    const silent = playedWorker();
    const waiting = createWorkerSandbox(() => silent.worker, { available: () => true, bootMs: 3000 }).check("return 1;");
    await vi.advanceTimersByTimeAsync(3100);
    expect(await waiting).toMatchObject({ ok: false });
    expect(silent.terminated()).toBe(true);
  });
});

describe("the engine the sandbox runs", () => {
  // One WebAssembly module, embedded in the package the lockfile pins. A new version of the package is a new engine:
  // these two numbers change with it, and whoever changes them has looked at what the new module can reach.
  const ENGINE_SHA256 = "64a0922ad271e4b20a4bc238bf1a9fdc0561113789257813b2bfadb3378b10f7";
  const ENGINE_IMPORTS = 15;

  function embeddedModule(): Uint8Array {
    // Resolved from the shared UI package: that is where the engine is a dependency, and where both shells take it from.
    const entry = createRequire(new URL("../../../../packages/ui/package.json", import.meta.url)).resolve("@tootallnate/quickjs-emscripten");
    const text = readFileSync(entry.replace(/index\.js$/, "generated/emscripten-module.WASM_RELEASE_SYNC.js"), "utf8");
    const marker = "data:application/octet-stream;base64,";
    let best = "";
    for (let from = text.indexOf(marker); from >= 0; from = text.indexOf(marker, from + 1)) {
      let end = from + marker.length;
      while (end < text.length && /[A-Za-z0-9+/=]/.test(text[end]!)) end++;
      if (end - from - marker.length > best.length) best = text.slice(from + marker.length, end);
    }
    return new Uint8Array(Buffer.from(best, "base64"));
  }

  it("is the module that was looked at: its bytes and what it imports", () => {
    vi.useRealTimers();
    const bytes = embeddedModule();
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(ENGINE_SHA256);
    const module = new WebAssembly.Module(bytes as BufferSource);
    const imports = WebAssembly.Module.imports(module);
    // Functions only — no memory, no table and no global is handed in from outside.
    expect(imports.map((entry) => entry.kind)).toEqual(Array.from({ length: ENGINE_IMPORTS }, () => "function"));
    expect(new Set(imports.map((entry) => entry.module))).toEqual(new Set(["a"]));
    // Its memory is its own.
    expect(WebAssembly.Module.exports(module).filter((entry) => entry.kind === "memory")).toHaveLength(1);
  });
});
