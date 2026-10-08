import type { SandboxWorker } from "./workerSandbox";

/**
 * Starts the script worker — as a file of the app, never from a blob: the
 * worker is the app's own code under the app's own origin. Both shells
 * bundle it from here.
 */
export function spawnScriptWorker(): SandboxWorker {
  return new Worker(new URL("./scriptWorker.ts", import.meta.url), { type: "module", name: "plainva-script" }) as unknown as SandboxWorker;
}
