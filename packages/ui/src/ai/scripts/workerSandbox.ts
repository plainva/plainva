import type { SandboxEnd, SandboxKill, SandboxLogLevel, SandboxUsage, ScriptSandbox } from "@plainva/core";
import { guestEngineAvailable } from "./engine";
import { readSandboxEnd, readUsage, type FromScriptWorker, type ToScriptWorker } from "./protocol";

/**
 * The script sandbox the app uses (ADR 0020 decision 6, plan KI-Harness
 * P5.5): every run gets a worker of its own, and the worker is ended when
 * the run is over — however it ended.
 *
 * The engine inside the worker counts the script's steps and its time and
 * stops it itself (`guest.ts`). This side is the watchdog for what the
 * engine cannot stop: one long step inside a built-in function, where the
 * interpreter does not ask back. When the script's time is up and the worker
 * has not said so, the worker is ended — there is no asking it to stop.
 */

/** A worker as this file needs it; the browser's `Worker` is one. */
export interface SandboxWorker {
  postMessage(message: ToScriptWorker): void;
  terminate(): void;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

export interface WorkerSandboxOptions {
  /** How long the engine may take to load, before the script's own clock starts. */
  bootMs?: number;
  /** How long past the script's time limit the worker gets to say that it stopped. */
  graceMs?: number;
  /** Whether this device can run a worker with the engine; the default asks for WebAssembly and `Worker`. */
  available?: () => boolean;
}

const LEVELS: readonly SandboxLogLevel[] = ["log", "info", "warn", "error", "debug"];
const LOST = JSON.stringify({ ok: false, error: "The call was lost." });

export function createWorkerSandbox(spawn: () => SandboxWorker, options: WorkerSandboxOptions = {}): ScriptSandbox {
  const bootMs = options.bootMs ?? 20_000;
  const graceMs = options.graceMs ?? 750;
  const available = options.available ?? (() => guestEngineAvailable() && typeof Worker === "function");

  return {
    available,

    run(job, host, signal) {
      return new Promise<SandboxEnd>((resolve) => {
        let worker: SandboxWorker | null = null;
        let over = false;
        let timer: ReturnType<typeof setTimeout> | null = null;
        let usage: SandboxUsage = { ms: 0, fuel: 0 };
        const disarm = (): void => {
          if (timer !== null) clearTimeout(timer);
          timer = null;
        };
        const finish = (end: SandboxEnd): void => {
          if (over) return;
          over = true;
          disarm();
          signal?.removeEventListener("abort", onAbort);
          // Ended whatever it is doing: a worker that finished and one that never would are ended alike.
          try {
            worker?.terminate();
          } catch {
            // A worker that is gone already is what was wanted.
          }
          resolve(end);
        };
        const killed = (why: SandboxKill, used: SandboxUsage = usage): void => finish({ kind: "killed", why, usage: used });
        const arm = (ms: number, why: SandboxKill, used?: () => SandboxUsage): void => {
          disarm();
          timer = setTimeout(() => killed(why, used?.()), ms);
        };
        const onAbort = (): void => killed("stopped");

        if (!available()) return killed("crashed");
        if (signal?.aborted) return killed("stopped");
        try {
          worker = spawn();
        } catch {
          return killed("crashed");
        }
        signal?.addEventListener("abort", onAbort, { once: true });
        const running = worker;
        arm(bootMs, "crashed");
        running.onerror = () => killed("crashed");
        running.onmessage = (event) => {
          if (over) return;
          const message = event.data as FromScriptWorker | null;
          if (!message || typeof message !== "object") return;
          switch (message.type) {
            case "ready":
              disarm();
              break;
            case "working":
              usage = readUsage(message.usage);
              // Its clock runs while the engine works: what is left of its time, and a moment to say so itself.
              if (message.busy) arm(Math.max(0, job.limits.seconds * 1000 - usage.ms) + graceMs, "time", () => ({ ms: job.limits.seconds * 1000, fuel: usage.fuel }));
              else disarm();
              break;
            case "call": {
              const id = message.id;
              const answer = (json: string): void => {
                if (!over) running.postMessage({ type: "result", id, json });
              };
              host.call(String(message.tool), String(message.args)).then(
                (json) => answer(typeof json === "string" ? json : LOST),
                () => answer(LOST),
              );
              break;
            }
            case "log":
              host.log?.(LEVELS.find((known) => known === message.level) ?? "log", String(message.text));
              break;
            case "end":
              finish(readSandboxEnd(message.end));
              break;
            default:
              break;
          }
        };
        try {
          running.postMessage({ type: "run", job });
        } catch {
          killed("crashed");
        }
      });
    },

    check(code) {
      return new Promise((resolve) => {
        let worker: SandboxWorker | null = null;
        let over = false;
        const finish = (result: { ok: true } | { ok: false; message: string }): void => {
          if (over) return;
          over = true;
          clearTimeout(timer);
          try {
            worker?.terminate();
          } catch {
            // Gone already.
          }
          resolve(result);
        };
        const failed = (): void => finish({ ok: false, message: "The engine could not start." });
        const timer = setTimeout(failed, bootMs);
        if (!available()) return failed();
        try {
          worker = spawn();
          worker.onerror = failed;
          worker.onmessage = (event) => {
            const message = event.data as FromScriptWorker | null;
            if (message?.type !== "checked") return;
            const result = message.result as { ok?: unknown; message?: unknown } | null;
            finish(result?.ok === true ? { ok: true } : { ok: false, message: typeof result?.message === "string" ? result.message : "The code could not be read." });
          };
          worker.postMessage({ type: "check", code });
        } catch {
          failed();
        }
      });
    },
  };
}
