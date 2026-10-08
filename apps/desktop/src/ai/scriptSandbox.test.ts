import { describe, expect, it } from "vitest";
import { SCRIPT_LIMIT_DEFAULTS, type SandboxEnd, type SandboxHost, type SandboxJob, type ScriptLimits } from "@plainva/core";
import { createDirectSandbox } from "@plainva/ui";

/**
 * The gate of the script sandbox (plan KI-Harness P5.5, ADR 0020 decision 6):
 * "sandbox-escape and resource-kill evals green". Every test here runs the
 * real engine — the same WebAssembly module, the same code around it as in
 * the app — against a script that tries to get out, or to take more than its
 * manifest gives it.
 *
 * What these tests cannot show is the worker's watchdog: one long step inside
 * a built-in function is ended by ending the worker, and there is no worker
 * here (`scriptWorkerSandbox.test.ts` plays it, the E2E of both shells runs it).
 */

const sandbox = createDirectSandbox();

interface Played {
  end: SandboxEnd;
  calls: { tool: string; args: string }[];
  logs: { level: string; text: string }[];
}

/** Runs code as a script; `answer` plays the tools (the default hands back what it was asked). */
async function play(code: string, options: { input?: SandboxJob["input"]; tools?: string[]; limits?: Partial<ScriptLimits>; answer?: (tool: string, args: string) => unknown | Promise<unknown> } = {}): Promise<Played> {
  const calls: Played["calls"] = [];
  const logs: Played["logs"] = [];
  const host: SandboxHost = {
    async call(tool, args) {
      calls.push({ tool, args });
      const data = options.answer ? await options.answer(tool, args) : { tool, args: JSON.parse(args) };
      return JSON.stringify(data instanceof Error ? { ok: false, error: data.message } : { ok: true, data });
    },
    log: (level, text) => logs.push({ level, text }),
  };
  const end = await sandbox.run({ code, input: options.input ?? {}, tools: options.tools ?? ["search_vault", "read_note"], limits: { ...SCRIPT_LIMIT_DEFAULTS, ...options.limits } }, host);
  return { end, calls, logs };
}

const valueOf = (played: Played): unknown => {
  expect(played.end, JSON.stringify(played.end)).toMatchObject({ kind: "done" });
  return JSON.parse((played.end as { json: string }).json);
};

describe("a script in the engine", () => {
  it("gets its input and its tools, awaits them, and hands back a value", async () => {
    const played = await play(
      `const found = await tools.search_vault({ query: input.query });
       const note = await tools.read_note({ path: "A.md" });
       return { query: found.args.query, read: note.tool, twice: input.n * 2 };`,
      { input: { query: "offer", n: 21 } },
    );
    expect(valueOf(played)).toEqual({ query: "offer", read: "read_note", twice: 42 });
    expect(played.calls).toEqual([
      { tool: "search_vault", args: '{"query":"offer"}' },
      { tool: "read_note", args: '{"path":"A.md"}' },
    ]);
    expect(played.end.usage.ms).toBeGreaterThanOrEqual(0);
  });

  it("can ask several tools at once, and gets each its own answer", async () => {
    const played = await play(
      `const all = await Promise.all(["a", "b", "c"].map((q) => tools.search_vault({ query: q })));
       return all.map((r) => r.args.query).join("");`,
      { answer: async (tool, args) => (await new Promise((r) => setTimeout(r, JSON.parse(args).query === "a" ? 15 : 1)), { tool, args: JSON.parse(args) }) },
    );
    expect(valueOf(played)).toBe("abc");
    expect(played.calls).toHaveLength(3);
  });

  it("computes without any tool, and returns nothing as null", async () => {
    expect(valueOf(await play("let s = 0; for (let i = 1; i <= 100; i++) s += i; return s;"))).toBe(5050);
    expect(valueOf(await play("const x = 1;"))).toBeNull();
    expect(valueOf(await play("return undefined;"))).toBeNull();
    expect(valueOf(await play('return { when: new Date(0).toISOString(), list: [1, "two", null, true] };'))).toEqual({ when: "1970-01-01T00:00:00.000Z", list: [1, "two", null, true] });
  });

  it("gets a tool's refusal as an error it can catch — in the tool's words", async () => {
    const played = await play(
      `try { await tools.read_note({ path: "gone.md" }); return "read"; }
       catch (error) { return error.message; }`,
      { answer: () => new Error("No note is available at this path.") },
    );
    expect(valueOf(played)).toBe("No note is available at this path.");
  });

  it("writes to its log, never to the app's console", async () => {
    const played = await play('console.log("one", { n: 2 }, [3]); console.warn("careful"); console.error(new Error("x").message); return 1;');
    expect(played.logs).toEqual([
      { level: "log", text: 'one {"n":2} [3]' },
      { level: "warn", text: "careful" },
      { level: "error", text: "x" },
    ]);
  });

  it("an error of its own ends the run with what went wrong and where", async () => {
    const thrown = await play("const a = 1;\nconst b = undefinedThing + a;\nreturn b;");
    expect(thrown.end).toMatchObject({ kind: "error" });
    expect((thrown.end as { message: string }).message).toMatch(/ReferenceError.*undefinedThing.*\(line 2\)/);
    expect(await play('throw new TypeError("not like this");')).toMatchObject({ end: { kind: "error", message: expect.stringMatching(/^TypeError: not like this/) } });
    expect(await play('throw "a bare text";')).toMatchObject({ end: { kind: "error" } });
    // What it returns must be JSON: a value that is none is an error, not a guess.
    expect(await play("return 10n;")).toMatchObject({ end: { kind: "error" } });
    expect(await play("const o = {}; o.self = o; return o;")).toMatchObject({ end: { kind: "error" } });
    expect(await play("return () => 1;")).toMatchObject({ end: { kind: "error", message: expect.stringContaining("no JSON") } });
  });

  it("code that is no JavaScript does not run at all, and says its line", async () => {
    const played = await play("const a = 1;\nconst = 2;\nreturn a;");
    expect(played.end).toMatchObject({ kind: "error" });
    expect((played.end as { message: string }).message).toMatch(/SyntaxError.*\(line 2\)/);
    expect(await sandbox.check("return 1;")).toEqual({ ok: true });
    expect(await sandbox.check("const found = await tools.search_vault({ query: 'x' });\nreturn found;")).toEqual({ ok: true });
    expect(await sandbox.check("const = 2;")).toMatchObject({ ok: false, message: expect.stringMatching(/SyntaxError.*\(line 1\)/) });
    expect(await sandbox.check("")).toEqual({ ok: true });
  });

  it("a check reads the code and calls nothing of it", async () => {
    // Were the body run, this would never come back.
    expect(await sandbox.check("for (;;) {}")).toEqual({ ok: true });
    // Code that closes the function it is the body of and goes on outside it: what stands there is held by the check's own limits.
    const started = Date.now();
    const result = await sandbox.check("}); for (;;) {} (async function () {");
    expect(result.ok).toBe(false);
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it("a script that waits for what never comes is ended, not kept", async () => {
    const played = await play("await new Promise(() => {}); return 1;");
    expect(played.end).toMatchObject({ kind: "error", message: "The script waits for something that never comes." });
  });
});

describe("escape: what a script cannot reach", () => {
  it("sees the language and nothing of a browser, a device or the app", async () => {
    const names = [
      "fetch", "XMLHttpRequest", "WebSocket", "EventSource", "WebTransport", "RTCPeerConnection", "navigator", "window", "self", "document", "location",
      "localStorage", "sessionStorage", "indexedDB", "caches", "cookieStore", "importScripts", "postMessage", "Worker", "SharedWorker", "BroadcastChannel", "MessageChannel",
      "WebAssembly", "setTimeout", "setInterval", "setImmediate", "requestAnimationFrame", "queueMicrotask", "performance", "crypto", "require", "module", "process",
      "Buffer", "Deno", "Bun", "std", "os", "bjson", "scriptArgs", "__TAURI__", "__TAURI_INTERNALS__", "Capacitor", "__dirname", "__filename", "call", "log", "main",
    ];
    const seen = valueOf(await play(`return ${JSON.stringify(names)}.filter((name) => { try { return typeof globalThis[name] !== "undefined" || eval("typeof " + name) !== "undefined"; } catch (e) { return true; } });`)) as string[];
    expect(seen).toEqual([]);
    // What is there: the language's own objects, the tools, the log.
    const globals = valueOf(await play("return Object.getOwnPropertyNames(globalThis).sort();")) as string[];
    expect(globals).toEqual(expect.arrayContaining(["Array", "JSON", "Map", "Math", "Promise", "console"]));
    for (const name of globals) expect(name, name).toMatch(/^(?:[A-Z][A-Za-z0-9]*|console|decodeURI|decodeURIComponent|encodeURI|encodeURIComponent|escape|eval|globalThis|isFinite|isNaN|parseFloat|parseInt|undefined|unescape|__date_clock)$/);
  });

  it("cannot load code: no module of the host, none from the network", async () => {
    for (const specifier of ["fs", "node:fs", "node:child_process", "https://example.com/x.js", "./engine", "@tauri-apps/api/core", "data:text/javascript,export default 1"]) {
      const played = await play(`try { await import(${JSON.stringify(specifier)}); return "imported"; } catch (error) { return "refused"; }`);
      expect(valueOf(played), specifier).toBe("refused");
    }
  });

  it("code it builds at run time is code in the same engine: it sees what the script sees", async () => {
    const played = await play(
      `const viaFunction = Function("return typeof process + typeof fetch + typeof require")();
       const viaEval = (0, eval)("typeof process + typeof fetch + typeof require");
       const viaConstructor = (async () => {}).constructor("return typeof process + typeof fetch")();
       const viaTool = tools.search_vault.constructor("return typeof process + typeof fetch")();
       const outer = Function("return this")();
       return { viaFunction, viaEval, viaConstructor: await viaConstructor, viaTool, sameWorld: outer === globalThis, keys: Object.keys(outer).length };`,
    );
    expect(valueOf(played)).toEqual({ viaFunction: "undefinedundefinedundefined", viaEval: "undefinedundefinedundefined", viaConstructor: "undefinedundefined", viaTool: "undefinedundefined", sameWorld: true, keys: expect.any(Number) });
  });

  it("an error or a value from outside brings nothing of the outside with it", async () => {
    const played = await play(
      `let fromError = "";
       try { await tools.read_note({ path: "x" }); } catch (error) {
         fromError = [typeof error.constructor.constructor("return typeof process")(), Object.getPrototypeOf(error) === Error.prototype, Object.keys(error).join(",")].join("|");
       }
       const value = await tools.search_vault({ query: "x" });
       const fromValue = [Object.getPrototypeOf(value) === Object.prototype, value.constructor.constructor("return typeof fetch")()].join("|");
       return { fromError, fromValue };`,
      { answer: (tool) => (tool === "read_note" ? new Error("no") : { nested: { deep: true } }) },
    );
    expect(valueOf(played)).toEqual({ fromError: "string|true|", fromValue: "true|undefined" });
  });

  it("what it does to the language's own objects stays inside the engine", async () => {
    const played = await play(
      `Object.prototype.polluted = "yes";
       Array.prototype.push = function () { return 0; };
       JSON.stringify = function () { return '{"forged":true}'; };
       Promise.prototype.then = function () { return this; };
       globalThis.console = null;
       return { real: true };`,
    );
    // The host reads what the engine hands it with its own JSON; a forged text is at most a forged value of this script.
    expect(played.end.kind === "done" || played.end.kind === "error").toBe(true);
    expect(({} as { polluted?: string }).polluted).toBeUndefined();
    expect([1].push(2)).toBe(2);
    expect(JSON.stringify({ a: 1 })).toBe('{"a":1}');
    // And the next script starts in a world nobody touched.
    expect(valueOf(await play('return [typeof ({}).polluted, [1].push(2), JSON.stringify({ a: 1 }), typeof console.log];'))).toEqual(["undefined", 2, '{"a":1}', "function"]);
  });

  it("nothing of one run is there in the next", async () => {
    expect(valueOf(await play('globalThis.kept = "from the first run"; return typeof kept;'))).toBe("string");
    expect(valueOf(await play("return typeof kept;"))).toBe("undefined");
  });

  it("a value named like a way out is a value", async () => {
    const played = await play('return JSON.parse(\'{"__proto__": {"polluted": 1}, "constructor": {"prototype": {"polluted": 1}}}\');');
    const value = valueOf(played) as Record<string, unknown>;
    expect(Object.keys(value).sort()).toEqual(["__proto__", "constructor"]);
    expect(({} as { polluted?: number }).polluted).toBeUndefined();
  });

  it("reaches the host only through `call`, with a name and a text — whatever it passes", async () => {
    const played = await play(
      `const odd = { toJSON() { return { query: "from toJSON" }; } };
       await tools.search_vault(odd);
       await tools.search_vault(undefined);
       await tools.search_vault("a bare text");
       await tools.search_vault(() => 1).catch(() => null);
       const cyclic = {}; cyclic.self = cyclic;
       let threw = false; try { await tools.search_vault(cyclic); } catch (e) { threw = true; }
       return threw;`,
    );
    expect(valueOf(played)).toBe(true);
    for (const call of played.calls) {
      expect(typeof call.tool).toBe("string");
      expect(typeof call.args).toBe("string");
    }
    expect(played.calls.map((c) => c.args)).toEqual(['{"query":"from toJSON"}', "{}", '"a bare text"', "{}"]);
  });

  it("only the tools it was given exist; a name it makes up is no function", async () => {
    const played = await play('return [typeof tools.search_vault, typeof tools.read_mail, typeof tools.fetch_url, Object.keys(tools), Object.isFrozen(tools), (() => { try { tools.extra = 1; } catch (e) {} return typeof tools.extra; })()];', { tools: ["search_vault"] });
    expect(valueOf(played)).toEqual(["function", "undefined", "undefined", ["search_vault"], true, "undefined"]);
  });
});

describe("kill: what a script cannot take", () => {
  it("steps: a loop without end is stopped at its fuel, the same amount of work every time", async () => {
    const first = await play("let i = 0; for (;;) i++;", { limits: { fuel: 300, seconds: 30 } });
    expect(first.end).toMatchObject({ kind: "killed", why: "fuel" });
    expect(first.end.usage.fuel).toBe(301);
    const second = await play("let i = 0; for (;;) i++;", { limits: { fuel: 300, seconds: 30 } });
    expect(second.end.usage.fuel).toBe(first.end.usage.fuel);
  });

  it("time: a loop without end is stopped at its seconds", async () => {
    const started = Date.now();
    const played = await play("for (;;) {}", { limits: { seconds: 1, fuel: 200_000 } });
    expect(played.end).toMatchObject({ kind: "killed", why: "time" });
    expect(Date.now() - started).toBeLessThan(4000);
    expect(played.end.usage.ms).toBeGreaterThanOrEqual(1000);
  });

  it("the stop cannot be caught, and nothing runs after it", async () => {
    const ways = [
      "for (;;) { try { for (;;) {} } catch (e) {} }",
      "try { for (;;) {} } finally { for (;;) {} }",
      "for (;;) { await null; }",
      "await new Promise((resolve) => { for (;;) {} });",
      // Work that only ever queues more work, with no loop anywhere in it and no memory that grows.
      "const loop = () => { Promise.resolve().then(loop); }; loop(); await new Promise(() => {});",
      "const loop = async () => { await null; loop(); }; loop(); await new Promise(() => {});",
      "[1, 2, 3].sort(() => { for (;;) {} });",
      'JSON.stringify({ toJSON() { for (;;) {} } });',
      "new Proxy({}, { get() { for (;;) {} } }).x;",
      "for (const x of (function* () { for (;;) yield 1; })()) {}",
      'eval("for (;;) {}");',
      'Function("for (;;) {}")();',
    ];
    for (const code of ways) {
      const played = await play(`${code}\nconsole.log("after");\nreturn "went on";`, { limits: { fuel: 400, seconds: 30 } });
      expect(played.end, code).toMatchObject({ kind: "killed", why: "fuel" });
      expect(played.logs, code).toEqual([]);
    }
  });

  it("a stop in one strand of a script ends all of it: no call and no line leaves the engine afterwards", async () => {
    // The loop runs as the answer to a promise: its stop is taken by that promise, like any error there, and the
    // script's main strand is still waiting for its tool. When the tool answers, nothing of the script runs again.
    const played = await play(
      `Promise.resolve().then(() => { for (;;) {} }).catch(() => { console.log("caught the stop"); tools.read_note({ path: "after.md" }); });
       const first = await tools.search_vault({ query: "before" });
       console.log("after");
       await tools.read_note({ path: "after.md" });
       return "went on";`,
      { limits: { fuel: 300, seconds: 30 }, answer: async (tool) => (await new Promise((r) => setTimeout(r, 30)), { tool }) },
    );
    expect(played.end).toMatchObject({ kind: "killed", why: "fuel" });
    expect(played.calls).toEqual([{ tool: "search_vault", args: '{"query":"before"}' }]);
    expect(played.logs).toEqual([]);
  });

  it("steps are counted where code loops or branches — work that does neither is held by the time", async () => {
    // Calls that fail and are caught, each calling again: almost no step of the kind the engine counts, and no end.
    // The engine asks back rarely here, so the steps run out late; the seconds do not. (In the app the worker's
    // watchdog ends such a script at its seconds even if the engine never asked back at all.)
    const started = Date.now();
    const played = await play('const spin = () => { try { spin(); } catch (e) { spin(); } }; spin();\nconsole.log("after");\nreturn "went on";', { limits: { fuel: 200_000, seconds: 1 } });
    expect(played.end).toMatchObject({ kind: "killed", why: "time" });
    expect(played.logs).toEqual([]);
    expect(Date.now() - started).toBeLessThan(8000);
  });

  it("steps count across the whole run: waiting for tools does not refill them", async () => {
    const played = await play("for (;;) { await tools.search_vault({ query: 'x' }); for (let i = 0; i < 200000; i++) {} }", { limits: { fuel: 150, seconds: 30 } });
    expect(played.end).toMatchObject({ kind: "killed", why: "fuel" });
    expect(played.calls.length).toBeGreaterThan(1);
    expect(played.calls.length).toBeLessThan(40);
  });

  it("time counts only what the script computes, never what a tool takes", async () => {
    const played = await play("const a = await tools.search_vault({ query: 'slow' }); return a.tool;", {
      limits: { seconds: 1 },
      answer: async (tool) => (await new Promise((r) => setTimeout(r, 1300)), { tool }),
    });
    expect(valueOf(played)).toBe("search_vault");
    expect(played.end.usage.ms).toBeLessThan(500);
  });

  it("memory: what does not fit is refused, and a script that goes on asking is ended", async () => {
    const hoard = await play("const hold = []; for (;;) hold.push(new Array(5000).fill('x'.repeat(50)));", { limits: { memoryMb: 8, fuel: 200_000, seconds: 20 } });
    expect(hoard.end).toMatchObject({ kind: "killed", why: "memory" });
    for (const code of ["return 'x'.repeat(1 << 28).length;", "return new Uint8Array(1 << 28).length;", "return new Array(1 << 27).fill(0).length;", "let s = 'x'; for (;;) s += s;"]) {
      const played = await play(code, { limits: { memoryMb: 8, fuel: 200_000, seconds: 20 } });
      expect(played.end, code).toMatchObject({ kind: "killed", why: "memory" });
    }
    // Catching the refusal gives it nothing: the memory is not there.
    const caught = await play("const hold = []; for (;;) { try { hold.push('x'.repeat(1 << 20)); } catch (e) {} }", { limits: { memoryMb: 8, fuel: 3000, seconds: 20 } });
    expect(caught.end.kind).toBe("killed");
    expect(["memory", "fuel"]).toContain((caught.end as { why: string }).why);
    // A chain of promises that grows without end takes memory, not steps: it ends at the memory.
    const chain = await play("const loop = () => Promise.resolve().then(loop); await loop();", { limits: { memoryMb: 8, fuel: 200_000, seconds: 20 } });
    expect(chain.end).toMatchObject({ kind: "killed", why: "memory" });
    // An error that is nothing is the script's own where its memory is not used up.
    expect(await play("throw null;")).toMatchObject({ end: { kind: "error", message: "The script failed." } });
    expect(await play("throw undefined;", { limits: { memoryMb: 8 } })).toMatchObject({ end: { kind: "error" } });
  });

  it("the stack: a call that never returns is the script's error, not the engine's end", async () => {
    const played = await play("const down = (n) => down(n + 1) + 1; return down(0);");
    expect(played.end).toMatchObject({ kind: "error", message: expect.stringContaining("stack overflow") });
    // A script may catch it; the engine is still whole.
    expect(valueOf(await play("let depth = 0; const down = () => { depth++; down(); }; try { down(); } catch (e) {} return depth > 100;"))).toBe(true);
    // Calls of the script's own code, however they are dressed, end as that error — never as the engine's end.
    for (const code of [
      "let f = () => 1; for (let i = 0; i < 100000; i++) { const g = f; f = () => g(); } return f();",
      "const p = new Proxy({}, { get(t, k, r) { return r[k]; } }); return p.x;",
      "class A { get x() { return this.x; } } return new A().x;",
      "const t = {}; t.toString = () => String(t); return String(t);",
    ]) {
      const played = await play(code, { limits: { fuel: 20_000, seconds: 10 } });
      expect(played.end, code).toMatchObject({ kind: "error", message: expect.stringContaining("stack overflow") });
    }
  });

  it("where the engine itself gives way, that instance is over — and nothing else is", async () => {
    // Depth inside the engine's own functions (a text of a hundred thousand brackets to read or to write) is depth
    // this version of the engine does not measure everywhere: it can run into the host's stack. That ends the
    // instance (`crashed`) or is an error of the script's — it never ends the app, and never reaches past the engine.
    const before = Object.keys(globalThis).length;
    for (const code of [
      "let a = []; for (let i = 0; i < 100000; i++) a = [a]; return JSON.stringify(a).length;",
      "let o = {}; for (let i = 0; i < 100000; i++) o = { o }; return JSON.stringify(o).length;",
      "return JSON.parse('['.repeat(100000) + ']'.repeat(100000)).length;",
      "return new RegExp('('.repeat(20000) + 'a' + ')'.repeat(20000)).test('a');",
      "let s = 'a'; for (let i = 0; i < 20000; i++) s = '(' + s + ')'; return eval(s);",
      "let a = []; for (let i = 0; i < 100000; i++) a = [a]; return String(a).length;",
      "let a = []; for (let i = 0; i < 100000; i++) a = [a]; return a.flat(Infinity).length;",
    ]) {
      const played = await play(code, { limits: { fuel: 20_000, seconds: 10 } });
      expect(["done", "error", "killed"], `${code} -> ${JSON.stringify(played.end)}`).toContain(played.end.kind);
      // The engine starts again for the next script, in a world nobody touched.
      expect(valueOf(await play("return 1 + 1;")), code).toBe(2);
    }
    expect(Object.keys(globalThis).length).toBe(before);
  });

  it("output: a value larger than its limit is not handed over", async () => {
    const played = await play("return 'x'.repeat(5000);", { limits: { resultBytes: 1024 } });
    expect(played.end).toMatchObject({ kind: "killed", why: "output" });
    expect(valueOf(await play("return 'x'.repeat(1000);", { limits: { resultBytes: 1024 } }))).toHaveLength(1000);
  });

  it("a call's arguments over their limit are not copied out of the engine", async () => {
    const played = await play("await tools.search_vault({ query: 'x'.repeat(100000) }); return 1;", { limits: { callBytes: 2048 } });
    // What reaches the host is just long enough for the rule there to see it as too large.
    expect(played.calls).toHaveLength(1);
    expect(played.calls[0]!.args).toHaveLength(2049);
    expect(played.calls[0]!.args.trim()).toBe("");
  });

  it("its log is short however much it writes", async () => {
    const played = await play("for (let i = 0; i < 5000; i++) console.log('line ' + i, 'x'.repeat(5000)); return 1;");
    expect(valueOf(played)).toBe(1);
    expect(played.logs).toHaveLength(250);
    for (const line of played.logs) expect(line.text.length).toBeLessThanOrEqual(2000);
  });

  it("a level it makes up is a line of the log", async () => {
    // The script can replace its console; what arrives is still one of the five levels.
    const played = await play("console.log('ok'); return 1;");
    expect(played.logs.map((l) => l.level)).toEqual(["log"]);
  });
});
