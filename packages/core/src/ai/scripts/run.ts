import { utf8Encode } from "../../crypto/cryptoPrimitives.js";
import type { ToolOutcome } from "../orchestrator.js";
import { parseToolInput, toolByName, type ToolManifest } from "../tools.js";
import { parseScriptInput, SCRIPT_TOOL_NAMES, type ScriptDefinition, type ScriptInput, type ScriptLimits } from "./manifest.js";

/**
 * One run of a script (ADR 0020 decision 6, plan KI-Harness P5.5): the rules
 * around the engine. The engine (`ScriptSandbox`) keeps the script in: it
 * gives it time, steps and memory and nothing to reach but `host.call`. This
 * file decides what such a call may be — a tool the manifest names, a tool
 * open to scripts, within the manifest's count and size — and hands it to
 * the caller's executor, behind whose gates every result already is.
 *
 * A script that asks for what it may not is stopped, not answered: a run
 * that tried is not a run to go on with.
 */

/** What the engine is asked to run. */
export interface SandboxJob {
  /** The script's code: the body of an async function of `input` and `tools`. */
  code: string;
  input: ScriptInput;
  /** The names `tools` carries. */
  tools: readonly string[];
  limits: ScriptLimits;
}

export type SandboxLogLevel = "log" | "info" | "warn" | "error" | "debug";

export interface SandboxHost {
  /** One tool call of the script: the tool's name and its arguments as JSON. Answers with JSON of a `ScriptCallResult`. */
  call(tool: string, args: string): Promise<string>;
  /** A line the script wrote with `console`. */
  log?(level: SandboxLogLevel, text: string): void;
}

export interface SandboxUsage {
  /** Milliseconds the script itself computed. */
  ms: number;
  /** Steps of the engine, in the manifest's unit. */
  fuel: number;
}

/**
 * Why the engine ended a run on its own: its time, its steps or its memory
 * were used up, what it returned was too large, the user stopped it — or the
 * engine itself gave way (`crashed`), which ends that instance for good.
 */
export type SandboxKill = "time" | "fuel" | "memory" | "output" | "stopped" | "crashed";

export type SandboxEnd =
  /** The script returned; `json` is its value as JSON. */
  | { kind: "done"; json: string; usage: SandboxUsage }
  /** The script threw, or returned what is no JSON. */
  | { kind: "error"; message: string; usage: SandboxUsage }
  | { kind: "killed"; why: SandboxKill; usage: SandboxUsage };

export interface ScriptSandbox {
  /** False where this device cannot run the engine at all. */
  available(): boolean;
  run(job: SandboxJob, host: SandboxHost, signal?: AbortSignal): Promise<SandboxEnd>;
  /** Whether the code is JavaScript the engine reads; nothing of it runs. */
  check(code: string): Promise<{ ok: true } | { ok: false; message: string }>;
}

/** What a tool call hands a script: the tool's values, or its refusal in the tool's own words. */
export type ScriptCallResult = { ok: true; data: unknown } | { ok: false; error: string };

export interface ScriptCallRecord {
  tool: string;
  /** The arguments as JSON, cut for reading. */
  args: string;
  ok: boolean;
  /** `not-run`: a dry run does not carry out what shows or changes something. `too-large`: the result was over the limit for one call. */
  note?: "not-run" | "too-large";
  ms: number;
  /** Bytes handed to the script. */
  bytes: number;
}

export interface ScriptLogLine {
  level: SandboxLogLevel;
  text: string;
}

/**
 * Why a run did not end with a value. The engine's own reasons, and the
 * rules': `tool` — the script called a tool its manifest does not name, or
 * one no script may call; `calls` — more calls than its manifest allows;
 * `size` — a call's arguments were larger than its limit; `input` — it was
 * started with something its parameters do not describe; `unavailable` — no
 * engine on this device.
 */
export type ScriptFailure = SandboxKill | "error" | "tool" | "calls" | "size" | "input" | "unavailable";

export type ScriptOutcome =
  | { kind: "done"; value: unknown; json: string; calls: ScriptCallRecord[]; logs: ScriptLogLine[]; logsCut: boolean; usage: SandboxUsage }
  | { kind: "failed"; reason: ScriptFailure; message?: string; calls: ScriptCallRecord[]; logs: ScriptLogLine[]; logsCut: boolean; usage: SandboxUsage };

export const SCRIPT_LOG_LINES_MAX = 200;
export const SCRIPT_LOG_LINE_MAX = 500;
export const SCRIPT_MESSAGE_MAX = 500;
const RECORDED_ARGS_MAX = 600;
const TOOL_ERROR_MAX = 2_000;

const byteLength = (text: string): number => utf8Encode(text).length;

/** Whether a tool is one a script may call at all — whatever its manifest says. */
export function isScriptCallable(tool: ToolManifest | undefined): tool is ToolManifest {
  return Boolean(tool) && SCRIPT_TOOL_NAMES.includes(tool!.name);
}

export interface ScriptRunInput {
  script: ScriptDefinition;
  /** The script's code, as approved. */
  code: string;
  /** What the caller hands it; held against the script's parameters before anything runs. */
  input: unknown;
  sandbox: ScriptSandbox;
  /** Carries out one tool call — the caller's executor, with the caller's gates. `args` are validated. */
  execute(tool: ToolManifest, args: unknown, signal: AbortSignal): Promise<ToolOutcome>;
  /**
   * A dry run: the tools that read are called, the others are not — the
   * record says what the script would have shown or laid down.
   */
  dry?: boolean;
  signal?: AbortSignal;
  onCall?(record: ScriptCallRecord): void;
  now?(): number;
}

/** A tool's answer as a script gets it: its values where it has any, its text otherwise. */
export function scriptCallResult(outcome: ToolOutcome): ScriptCallResult {
  if (outcome.isError) return { ok: false, error: outcome.content.slice(0, TOOL_ERROR_MAX) };
  return { ok: true, data: outcome.data !== undefined ? outcome.data : { text: outcome.content } };
}

export async function runScript(input: ScriptRunInput): Promise<ScriptOutcome> {
  const { script, sandbox } = input;
  const now = input.now ?? (() => Date.now());
  const calls: ScriptCallRecord[] = [];
  const logs: ScriptLogLine[] = [];
  let logsCut = false;
  const idle: SandboxUsage = { ms: 0, fuel: 0 };
  const failed = (reason: ScriptFailure, usage: SandboxUsage, message?: string): ScriptOutcome => ({
    kind: "failed",
    reason,
    ...(message ? { message: message.slice(0, SCRIPT_MESSAGE_MAX) } : {}),
    calls,
    logs,
    logsCut,
    usage,
  });

  if (!sandbox.available()) return failed("unavailable", idle);
  const parsed = parseScriptInput(script.parameters, input.input);
  if (!parsed.ok) return failed("input", idle, parsed.error);

  // What ends a run from here: the caller's stop, or a call the script may not make.
  const stopper = new AbortController();
  let violation: { reason: ScriptFailure; message: string } | null = null;
  const stop = (reason: ScriptFailure, message: string): string => {
    violation ??= { reason, message };
    stopper.abort();
    return JSON.stringify({ ok: false, error: message } satisfies ScriptCallResult);
  };
  const onAbort = () => stopper.abort();
  if (input.signal?.aborted) return failed("stopped", idle);
  input.signal?.addEventListener("abort", onAbort, { once: true });

  const record = (entry: ScriptCallRecord): void => {
    calls.push(entry);
    input.onCall?.(entry);
  };
  const answer = (result: ScriptCallResult): string => JSON.stringify(result);

  const host = {
    async call(name: string, args: string): Promise<string> {
      if (violation) return answer({ ok: false, error: violation.message });
      const shown = args.length > RECORDED_ARGS_MAX ? `${args.slice(0, RECORDED_ARGS_MAX)}…` : args;
      const tool = toolByName(name);
      if (!isScriptCallable(tool) || !script.tools.includes(name)) return stop("tool", `This script may not call ${name.slice(0, 80)}.`);
      if (calls.length >= script.limits.calls) return stop("calls", `This script may call tools ${script.limits.calls} times in one run.`);
      if (byteLength(args) > script.limits.callBytes) return stop("size", `The arguments of one call may be ${script.limits.callBytes} bytes at most.`);
      let raw: unknown;
      try {
        raw = JSON.parse(args);
      } catch {
        raw = undefined;
      }
      const checked = parseToolInput(tool, raw);
      if (!checked.ok) {
        const text = answer({ ok: false, error: `Invalid arguments for ${name}: ${checked.error}` });
        record({ tool: name, args: shown, ok: false, ms: 0, bytes: byteLength(text) });
        return text;
      }
      // A dry run carries out what reads; what shows or changes something is only written down.
      if (input.dry && tool.risk !== "read") {
        const text = answer({ ok: true, data: { dryRun: true } });
        record({ tool: name, args: shown, ok: true, note: "not-run", ms: 0, bytes: byteLength(text) });
        return text;
      }
      const started = now();
      let result: ScriptCallResult;
      try {
        result = scriptCallResult(await input.execute(tool, checked.value, stopper.signal));
      } catch (error) {
        result = { ok: false, error: `The tool failed: ${error instanceof Error ? error.message : String(error)}`.slice(0, TOOL_ERROR_MAX) };
      }
      let text: string;
      try {
        text = answer(result);
      } catch {
        text = answer({ ok: false, error: `${name} returned what cannot be handed to a script.` });
        result = { ok: false, error: "" };
      }
      const bytes = byteLength(text);
      if (bytes > script.limits.callBytes) {
        const tooLarge = answer({ ok: false, error: `The result of ${name} is larger than this script's limit for one call (${script.limits.callBytes} bytes). Ask for less.` });
        record({ tool: name, args: shown, ok: false, note: "too-large", ms: now() - started, bytes });
        return tooLarge;
      }
      record({ tool: name, args: shown, ok: result.ok, ms: now() - started, bytes });
      return text;
    },
    log(level: SandboxLogLevel, text: string): void {
      if (logs.length >= SCRIPT_LOG_LINES_MAX) {
        logsCut = true;
        return;
      }
      logs.push({ level, text: text.length > SCRIPT_LOG_LINE_MAX ? `${text.slice(0, SCRIPT_LOG_LINE_MAX)}…` : text });
    },
  };

  let end: SandboxEnd;
  try {
    end = await sandbox.run({ code: input.code, input: parsed.value, tools: script.tools, limits: script.limits }, host, stopper.signal);
  } catch {
    // An engine that throws instead of ending is one that gave way.
    end = { kind: "killed", why: "crashed", usage: idle };
  } finally {
    input.signal?.removeEventListener("abort", onAbort);
  }

  // A call the script may not make ends the run, whatever the script made of the refusal.
  const broken = violation as { reason: ScriptFailure; message: string } | null;
  if (broken) return failed(broken.reason, end.usage, broken.message);
  if (end.kind === "killed") return failed(end.why, end.usage);
  if (end.kind === "error") return failed("error", end.usage, end.message);
  if (byteLength(end.json) > script.limits.resultBytes) return failed("output", end.usage);
  let value: unknown;
  try {
    value = JSON.parse(end.json);
  } catch {
    return failed("error", end.usage, "The script returned what is no JSON.");
  }
  return { kind: "done", value, json: end.json, calls, logs, logsCut, usage: end.usage };
}

/**
 * What a model is told about a run that did not end with a value: what
 * happened, in the app's words — never the script's own, which stay with the
 * user in the workshop.
 */
export function scriptFailureText(name: string, reason: ScriptFailure, limits: ScriptLimits): string {
  const head = `The script ${name} did not finish`;
  switch (reason) {
    case "time":
      return `${head}: it computed longer than its limit of ${limits.seconds} s.`;
    case "fuel":
      return `${head}: it used up the steps its manifest allows.`;
    case "memory":
      return `${head}: it needed more memory than its limit of ${limits.memoryMb} MB.`;
    case "output":
      return `${head}: what it returned is larger than its limit of ${limits.resultBytes} bytes.`;
    case "stopped":
      return `${head}: the run was stopped.`;
    case "crashed":
      return `${head}: the engine gave way.`;
    case "tool":
      return `${head}: it called a tool it may not call.`;
    case "calls":
      return `${head}: it called tools more often than its limit of ${limits.calls}.`;
    case "size":
      return `${head}: a call's arguments were larger than its limit of ${limits.callBytes} bytes.`;
    case "input":
      return `${head}: it was started with something its parameters do not describe.`;
    case "unavailable":
      return "Scripts cannot run on this device.";
    case "error":
      return `${head}: its code failed.`;
  }
}
