import type { SandboxEnd, SandboxJob, SandboxKill, SandboxLogLevel, SandboxUsage } from "@plainva/core";

/**
 * What the app and the script worker say to each other (plan KI-Harness
 * P5.5). One worker runs one job and is ended afterwards — a `run` or a
 * `check`, whichever comes first; anything after it but a `result` is not
 * listened to.
 */

export type ToScriptWorker =
  | { type: "run"; job: SandboxJob }
  | { type: "check"; code: string }
  /** The answer to a `call` of this id: JSON of what the tool handed back. */
  | { type: "result"; id: number; json: string };

export type FromScriptWorker =
  /** The engine is loaded; from here on only the script's own work takes time. */
  | { type: "ready" }
  /** The engine starts or stops working — the watchdog's clock runs only in between. */
  | { type: "working"; busy: boolean; usage: SandboxUsage }
  | { type: "call"; id: number; tool: string; args: string }
  | { type: "log"; level: SandboxLogLevel; text: string }
  | { type: "end"; end: SandboxEnd }
  | { type: "checked"; result: { ok: true } | { ok: false; message: string } };

const KILLS: readonly SandboxKill[] = ["time", "fuel", "memory", "output", "stopped", "crashed"];
const isCount = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;

export function readUsage(raw: unknown): SandboxUsage {
  const usage = (raw ?? {}) as { ms?: unknown; fuel?: unknown };
  return { ms: isCount(usage.ms) ? usage.ms : 0, fuel: isCount(usage.fuel) ? usage.fuel : 0 };
}

/** An end as the worker reported it, read field by field; what does not read is an engine that gave way. */
export function readSandboxEnd(raw: unknown): SandboxEnd {
  const end = (raw ?? {}) as { kind?: unknown; json?: unknown; message?: unknown; why?: unknown; usage?: unknown };
  const usage = readUsage(end.usage);
  if (end.kind === "done" && typeof end.json === "string") return { kind: "done", json: end.json, usage };
  if (end.kind === "error" && typeof end.message === "string") return { kind: "error", message: end.message, usage };
  const why = KILLS.find((known) => known === end.why);
  return { kind: "killed", why: end.kind === "killed" && why ? why : "crashed", usage };
}
