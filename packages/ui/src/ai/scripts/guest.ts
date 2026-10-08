import type { SandboxEnd, SandboxJob, SandboxKill, SandboxLogLevel, SandboxUsage } from "@plainva/core";
import type { QuickJSContext, QuickJSDeferredPromise, QuickJSHandle, QuickJSRuntime, QuickJSWASMModule } from "@tootallnate/quickjs-emscripten";

/**
 * A script inside the engine (ADR 0020 decision 6, plan KI-Harness P5.5).
 *
 * The engine is QuickJS, compiled to WebAssembly: an interpreter whose whole
 * world is the memory of one module. What it can reach outside is the
 * module's list of imports — the time, text on its output, more memory, and
 * the two functions this file gives it: `call` (one tool call, answered
 * later) and `log`. There is no file, no network and no timer among them.
 *
 * Three limits hold a script, and none of them relies on the script:
 *
 * - **steps** (the manifest's `fuel`): the interpreter asks back every ten
 *   thousand jumps — at every turn of a loop, every branch; that count is
 *   the same on every device;
 * - **time**: the same question compares the clock — only the time the
 *   script itself computes counts, never the time a tool takes;
 * - **memory**: the engine's allocator refuses beyond the limit, and the
 *   module's own heap is watched on top of that.
 *
 * The interpreter asks back only where code jumps. One long step inside a
 * built-in function, or calls that fail and call again without ever
 * looping, pass with few questions or none — the steps run out late there,
 * and the time is noticed late. That is what the worker's watchdog is for
 * (`workerSandbox.ts`): when the script's time is up it ends the whole
 * worker, asked back or not. The limits in here are the engine's manners;
 * the watchdog is the guarantee.
 *
 * One instance of the engine runs one script and is thrown away. Whatever
 * the engine throws ends the instance (`crashed`) — depth inside its own
 * functions can run into the host's stack, for one —: nothing is cleaned
 * up, and nothing is reused.
 */

/** One instance of the engine, and the size of its heap right now. */
export interface GuestEngine {
  quickjs: QuickJSWASMModule;
  heapBytes(): number;
}

/** The way out of a script: one tool call, one line of its log. */
export interface GuestPort {
  call(tool: string, args: string): Promise<string>;
  log(level: SandboxLogLevel, text: string): void;
  /**
   * The engine starts or stops working. Said from outside the script, so
   * whoever watches the run knows when its clock runs — a script that waits
   * for a tool is not computing.
   */
  working?(busy: boolean, usage: SandboxUsage): void;
}

/** Deep enough for a recursive walk, and far below where the host's own stack would give way first. */
const GUEST_STACK_BYTES = 64 * 1024;
/** What the module's heap may hold beyond the script's limit: the engine itself and its bookkeeping. */
const HEAP_SLACK_BYTES = 32 * 1024 * 1024;
/** How much waiting work the engine does before this file asks whether the script's limits still hold. */
const JOB_SLICE = 2_000;
const LOG_LINES_MAX = 250;
const LOG_TEXT_MAX = 2_000;
const MESSAGE_MAX = 400;
const LEVELS: readonly SandboxLogLevel[] = ["log", "info", "warn", "error", "debug"];
export const SCRIPT_FILE_NAME = "main.js";

/**
 * What runs before the script, inside the engine: it gives the script its
 * `tools` and its `console`. Nothing here is a rule — the script could
 * rewrite all of it. The rules are outside, where every call is checked.
 */
const BOOT = [
  "(function (call, log, main, inputJson, toolNames) {",
  '  "use strict";',
  "  var tools = {};",
  "  var names = JSON.parse(toolNames);",
  "  names.forEach(function (name) {",
  "    tools[name] = function (args) {",
  "      var json = JSON.stringify(args === undefined ? {} : args);",
  '      return call(name, typeof json === "string" ? json : "{}").then(function (text) {',
  "        var result = JSON.parse(text);",
  "        if (!result.ok) throw new Error(result.error);",
  "        return result.data;",
  "      });",
  "    };",
  "  });",
  "  Object.freeze(tools);",
  "  var show = function (value) {",
  '    if (typeof value === "string") return value;',
  "    try { var json = JSON.stringify(value); return json === undefined ? String(value) : json; } catch (e) { return String(value); }",
  "  };",
  "  var say = function (level) {",
  "    return function () {",
  "      var parts = [];",
  "      for (var i = 0; i < arguments.length; i++) parts.push(show(arguments[i]));",
  `      log(level, parts.join(" ").slice(0, ${LOG_TEXT_MAX}));`,
  "    };",
  "  };",
  '  globalThis.console = Object.freeze({ log: say("log"), info: say("info"), warn: say("warn"), error: say("error"), debug: say("debug") });',
  "  return main(JSON.parse(inputJson), tools).then(function (value) {",
  "    var json = JSON.stringify(value === undefined ? null : value);",
  '    if (typeof json !== "string") throw new TypeError("The script returned what is no JSON.");',
  "    return json;",
  "  });",
  "})",
].join("\n");

/** The script's code as the function it is the body of. The first line of the code stays the first line. */
const asFunction = (code: string): string => `(async function (input, tools) {${code}\n})`;

const oneLine = (text: string): string => text.replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/\s+/g, " ").trim();

interface GuestState {
  runtime: QuickJSRuntime;
  vm: QuickJSContext;
  ticks: number;
  computed: number;
  burstStart: number;
  inBurst: boolean;
  kill: SandboxKill | null;
  working?: GuestPort["working"];
}

/**
 * The question the interpreter asks back, and this file asks itself between
 * slices of waiting work: one more unit of steps is used — is anything used up?
 */
function tick(state: GuestState, engine: GuestEngine, limits: SandboxJob["limits"], now: () => number): boolean {
  state.ticks += 1;
  if (state.kill) return true;
  if (state.ticks > limits.fuel) state.kill = "fuel";
  else if (state.computed + (now() - state.burstStart) > limits.seconds * 1000) state.kill = "time";
  else if (engine.heapBytes() > limits.memoryMb * 1024 * 1024 + HEAP_SLACK_BYTES) state.kill = "memory";
  return state.kill !== null;
}

/** A fresh runtime with the script's limits on it; null when the engine gives way already here. */
function startGuest(engine: GuestEngine, limits: SandboxJob["limits"], now: () => number): GuestState | null {
  try {
    const runtime = engine.quickjs.newRuntime();
    const state: GuestState = { runtime, vm: null as unknown as QuickJSContext, ticks: 0, computed: 0, burstStart: 0, inBurst: false, kill: null };
    runtime.setMemoryLimit(limits.memoryMb * 1024 * 1024);
    runtime.setMaxStackSize(GUEST_STACK_BYTES);
    runtime.setInterruptHandler(() => tick(state, engine, limits, now));
    state.vm = runtime.newContext();
    return state;
  } catch {
    return null;
  }
}

const usageOf = (state: GuestState | null, now: () => number): SandboxUsage => ({
  ms: state ? Math.round(state.computed + (state.inBurst ? now() - state.burstStart : 0)) : 0,
  fuel: state ? state.ticks : 0,
});

/** One stretch of the engine working; its time is the script's. */
function burst<T>(state: GuestState, now: () => number, work: () => T): T {
  // A stretch inside a stretch (reading an error while one runs) is part of the outer one.
  if (state.inBurst) return work();
  state.burstStart = now();
  state.inBurst = true;
  state.working?.(true, usageOf(state, now));
  try {
    return work();
  } finally {
    state.computed += now() - state.burstStart;
    state.inBurst = false;
    state.working?.(false, usageOf(state, now));
  }
}

/** What an error inside the engine says, for the person who wrote the script: its kind, its words, its line. */
function describeError(state: GuestState, now: () => number, handle: QuickJSHandle): { name: string; message: string; text: string; unreadable: boolean } {
  const dumped = burst(state, now, () => state.vm.dump(handle)) as unknown;
  const record = dumped && typeof dumped === "object" ? (dumped as { name?: unknown; message?: unknown; stack?: unknown }) : {};
  const name = typeof record.name === "string" ? record.name : "Error";
  const message = typeof record.message === "string" ? record.message : typeof dumped === "string" ? dumped : "";
  const line = typeof record.stack === "string" ? /main\.js:(\d+)/.exec(record.stack)?.[1] : undefined;
  const text = oneLine(`${name}${message ? `: ${message}` : ""}${line ? ` (line ${line})` : ""}`).slice(0, MESSAGE_MAX);
  return { name, message, text, unreadable: dumped === null || dumped === undefined };
}

/**
 * How a failure inside the engine ends the run: by the limit that caused it,
 * or as the script's own error. Where the memory ran out there may have been
 * none left to say so — the error is then nothing at all; with the script's
 * memory at its limit, that is what it means.
 */
function failureEnd(state: GuestState, limits: SandboxJob["limits"], now: () => number, handle: QuickJSHandle): SandboxEnd {
  const killed = (why: SandboxKill): SandboxEnd => ({ kind: "killed", why, usage: usageOf(state, now) });
  if (state.kill) return killed(state.kill);
  // Room to read the error with: the run is over, the limit has done its work.
  state.runtime.setMemoryLimit(-1);
  const used = usedBytes(state, now);
  const error = describeError(state, now, handle);
  if (state.kill) return killed(state.kill);
  const full = used >= limits.memoryMb * 1024 * 1024 * 0.9;
  if ((error.name === "InternalError" && error.message === "out of memory") || (error.unreadable && full)) return killed("memory");
  return { kind: "error", message: error.unreadable ? "The script failed." : error.text || "The script failed.", usage: usageOf(state, now) };
}

/** What the engine has handed out to the script, in bytes; 0 where it cannot say. */
function usedBytes(state: GuestState, now: () => number): number {
  try {
    const handle = state.runtime.computeMemoryUsage();
    const usage = burst(state, now, () => state.vm.dump(handle)) as { malloc_size?: unknown } | null;
    handle.dispose();
    return typeof usage?.malloc_size === "number" ? usage.malloc_size : 0;
  } catch {
    return 0;
  }
}

/** The script's code as a function inside the engine, or why it is none. */
function compile(state: GuestState, limits: SandboxJob["limits"], now: () => number, code: string): { main: QuickJSHandle } | { end: SandboxEnd } {
  const compiled = burst(state, now, () => state.vm.evalCode(asFunction(code), SCRIPT_FILE_NAME));
  if (compiled.error) return { end: failureEnd(state, limits, now, compiled.error) };
  if (state.vm.typeof(compiled.value) !== "function") return { end: { kind: "error", message: "The code is not the body of one function.", usage: usageOf(state, now) } };
  return { main: compiled.value };
}

/**
 * Runs one script to its end. Never rejects: whatever happens is an end.
 * `signal`: stops a run that is waiting for a tool; one that is computing is
 * stopped by its limits — or, in a worker, by ending the worker.
 */
export function runGuest(job: SandboxJob, port: GuestPort, engine: GuestEngine, options: { now?: () => number; signal?: AbortSignal } = {}): Promise<SandboxEnd> {
  const now = options.now ?? (() => performance.now());
  return new Promise<SandboxEnd>((resolve) => {
    const state = startGuest(engine, job.limits, now);
    let ended = false;
    let waiting = 0;
    let lines = 0;
    const finish = (end: SandboxEnd): void => {
      if (ended) return;
      ended = true;
      options.signal?.removeEventListener("abort", onAbort);
      resolve(end);
    };
    const crashed = (): void => finish({ kind: "killed", why: "crashed", usage: usageOf(state, now) });
    const onAbort = (): void => {
      if (state) state.kill ??= "stopped";
      if (!state?.inBurst) finish({ kind: "killed", why: "stopped", usage: usageOf(state, now) });
    };
    if (!state) return crashed();
    if (options.signal?.aborted) return onAbort();
    options.signal?.addEventListener("abort", onAbort, { once: true });
    const { vm, runtime } = state;
    if (port.working) state.working = (busy, usage) => port.working?.(busy, usage);

    /**
     * Lets the engine work off what became ready; then looks whether anything
     * is still to come. In slices: work that only ever queues more work — a
     * chain of promises without a loop in it — passes without the
     * interpreter asking back, so the question is asked here after each slice.
     */
    const pump = (): void => {
      if (ended) return;
      // Once a limit is used up nothing of the script runs again — not even what was only waiting for a tool.
      if (state.kill) return finish({ kind: "killed", why: state.kill, usage: usageOf(state, now) });
      try {
        const over = burst(state, now, (): SandboxEnd | null => {
          for (;;) {
            const jobs = runtime.executePendingJobs(JOB_SLICE);
            if (jobs.error) return failureEnd(state, job.limits, now, jobs.error);
            // A stop inside waiting work is taken by the promise it ran for, like any error there: the work ends
            // quietly, and only the mark it left says why.
            if (state.kill) return { kind: "killed", why: state.kill, usage: usageOf(state, now) };
            if (jobs.value < JOB_SLICE) return null;
            if (tick(state, engine, job.limits, now)) return { kind: "killed", why: state.kill ?? "fuel", usage: usageOf(state, now) };
          }
        });
        if (over) return finish(over);
      } catch {
        return crashed();
      }
      // The script's own end arrives a moment later, through a callback of the host. Only after that is "nothing left" true.
      setTimeout(() => {
        if (ended || waiting > 0) return;
        try {
          if (runtime.hasPendingJob()) return pump();
        } catch {
          return crashed();
        }
        finish({ kind: "error", message: "The script waits for something that never comes.", usage: usageOf(state, now) });
      }, 0);
    };

    const settle = (deferred: QuickJSDeferredPromise, json: string): void => {
      waiting -= 1;
      if (ended) return;
      if (state.kill) return pump();
      try {
        const value = vm.newString(json);
        deferred.resolve(value);
        value.dispose();
        deferred.dispose();
      } catch {
        return crashed();
      }
      pump();
    };

    try {
      const lengthOf = (handle: QuickJSHandle): number => {
        const length = vm.getProp(handle, "length");
        const value = vm.getNumber(length);
        length.dispose();
        return value;
      };
      const callFn = vm.newFunction("call", (nameHandle, argsHandle) => {
        // A stop inside one strand of the script can leave another strand a few steps to go; none of them reaches outside.
        if (state.kill || ended) return vm.undefined;
        const name = vm.typeof(nameHandle) === "string" ? vm.getString(nameHandle).slice(0, 80) : "";
        // Only a name and a text ever leave the engine. Arguments over the limit are not even copied out: what goes
        // on is enough for the rule outside to see them as too large.
        const args = vm.typeof(argsHandle) !== "string" ? "{}" : lengthOf(argsHandle) > job.limits.callBytes ? " ".repeat(job.limits.callBytes + 1) : vm.getString(argsHandle);
        const deferred = vm.newPromise();
        waiting += 1;
        const lost = JSON.stringify({ ok: false, error: "The call was lost." });
        port.call(name, args).then(
          (json) => settle(deferred, typeof json === "string" ? json : lost),
          () => settle(deferred, lost),
        );
        return deferred.handle;
      });
      const logFn = vm.newFunction("log", (levelHandle, textHandle) => {
        if (state.kill || ended || lines >= LOG_LINES_MAX) return;
        lines += 1;
        const level = vm.typeof(levelHandle) === "string" ? vm.getString(levelHandle) : "log";
        const text = vm.typeof(textHandle) !== "string" ? "" : lengthOf(textHandle) > LOG_TEXT_MAX * 2 ? "[a line that was too long]" : vm.getString(textHandle);
        port.log(LEVELS.find((known) => known === level) ?? "log", text.slice(0, LOG_TEXT_MAX));
      });

      const compiled = compile(state, job.limits, now, job.code);
      if ("end" in compiled) return finish(compiled.end);
      const boot = burst(state, now, () => vm.evalCode(BOOT, "boot.js"));
      if (boot.error) return crashed();
      const input = vm.newString(JSON.stringify(job.input));
      const names = vm.newString(JSON.stringify(job.tools));
      const started = burst(state, now, () => vm.callFunction(boot.value, vm.undefined, callFn, logFn, compiled.main, input, names));
      if (started.error) return finish(failureEnd(state, job.limits, now, started.error));

      vm.resolvePromise(started.value).then((result) => {
        if (ended) return;
        try {
          if (result.error) return finish(failureEnd(state, job.limits, now, result.error));
          if (state.kill) return finish({ kind: "killed", why: state.kill, usage: usageOf(state, now) });
          if (vm.typeof(result.value) !== "string") return finish({ kind: "error", message: "The script returned what is no JSON.", usage: usageOf(state, now) });
          // A text has at least as many bytes as characters: one that is too long is not copied out at all.
          if (lengthOf(result.value) > job.limits.resultBytes) return finish({ kind: "killed", why: "output", usage: usageOf(state, now) });
          finish({ kind: "done", json: vm.getString(result.value), usage: usageOf(state, now) });
        } catch {
          crashed();
        }
      }, crashed);
      pump();
    } catch {
      crashed();
    }
  });
}

/** The steps and the time a check gets: enough to read any script, nothing to run one with. */
const CHECK_LIMITS: SandboxJob["limits"] = { seconds: 1, memoryMb: 16, fuel: 500, calls: 0, callBytes: 1024, resultBytes: 256 };

/** Whether the code is JavaScript the engine reads as the body of one function. Nothing of it is called. */
export function checkGuest(code: string, engine: GuestEngine, now: () => number = () => performance.now()): { ok: true } | { ok: false; message: string } {
  const state = startGuest(engine, CHECK_LIMITS, now);
  if (!state) return { ok: false, message: "The engine could not start." };
  try {
    const compiled = compile(state, CHECK_LIMITS, now, code);
    if ("main" in compiled) return { ok: true };
    return { ok: false, message: compiled.end.kind === "error" ? compiled.end.message : "The code could not be read." };
  } catch {
    return { ok: false, message: "The code could not be read." };
  }
}
