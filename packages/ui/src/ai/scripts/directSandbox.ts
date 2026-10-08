import type { ScriptSandbox } from "@plainva/core";
import { guestEngineAvailable, loadGuestEngine } from "./engine";
import { checkGuest, runGuest, type GuestEngine } from "./guest";

/**
 * The script sandbox without a worker: the engine runs on the thread that
 * called it. The script is held by the same engine and the same limits as in
 * the app — its steps, its time, its memory —, but nothing can end it from
 * outside while it computes: one long step inside a built-in function blocks
 * the caller until it is through.
 *
 * That is why the app never uses this one (it runs scripts in a worker,
 * `workerSandbox.ts`). It exists for what has no worker: the unit tests of
 * both shells, which run the real engine through it.
 */
export function createDirectSandbox(load: () => Promise<GuestEngine> = loadGuestEngine): ScriptSandbox {
  return {
    available: guestEngineAvailable,
    async run(job, host, signal) {
      let engine: GuestEngine;
      try {
        engine = await load();
      } catch {
        return { kind: "killed", why: "crashed", usage: { ms: 0, fuel: 0 } };
      }
      return runGuest(job, { call: (tool, args) => host.call(tool, args), log: (level, text) => host.log?.(level, text) }, engine, { signal });
    },
    async check(code) {
      try {
        return checkGuest(code, await load());
      } catch {
        return { ok: false, message: "The engine could not start." };
      }
    },
  };
}
