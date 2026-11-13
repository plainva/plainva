import { applyIndexBuildState, indexBuildState, subscribeIndexBuild } from "@plainva/ui";
import type { WindowBus } from "./windowBus";

/**
 * How whole the index of a vault is, across the windows of the desktop
 * (performance plan L3, reviews of 11.11.). The central window runs every vault
 * (`VaultHost`) and its store holds the word; every other window that shows a
 * vault mirrors it, so that its reader refuses on the same answer.
 *
 * Unknown is not whole (second review of 11.11.): a window that has not heard
 * the owner yet holds the vault as being built — never as whole. Every window
 * is the same build, so there is no owner that cannot answer; one that has not
 * set up its answer yet (the first hold of a vault, windows restored at start)
 * is asked again until it answers, and says its state itself as soon as it can.
 */

/**
 * The owner's side: answers a client that asks, and says its state to every
 * window — at once when it is installed (a client that asked before the
 * handler existed hears it then; an index that failed already is said too)
 * and on every change.
 */
export async function installIndexBuildMirror(
  bus: Pick<WindowBus, "handle" | "broadcast">,
  vaultPath: string,
  scoped: { vaultPath: string },
): Promise<() => void> {
  const offHandle = await bus.handle("index-build-state", () => indexBuildState(vaultPath), scoped);
  let last = indexBuildState(vaultPath);
  const say = () => void bus.broadcast("index-build", { state: last }, vaultPath).catch(() => {});
  const offStore = subscribeIndexBuild(() => {
    const now = indexBuildState(vaultPath);
    if (now === last) return;
    last = now;
    say();
  });
  say();
  return () => { offHandle(); offStore(); };
}

/** How long a client waits before it asks again, after a question that failed (ms, growing to the last). */
export const MIRROR_RETRY_MS = [250, 500, 1000, 2000, 4000] as const;

/**
 * The client's side: mirrors the owner's word on how whole its index of
 * `vaultPath` is into this window's store. Returns at once — the question
 * goes out in the background, and until an answer or a broadcast arrives the
 * vault is held as being built. A question that fails is asked again.
 * Stopped, the mirror forgets the vault: whoever still waits is refused.
 */
export async function mirrorOwnerIndexBuild(
  bus: Pick<WindowBus, "onBroadcast" | "request">,
  vaultPath: string,
  timers: { setTimeout: (fn: () => void, ms: number) => unknown; clearTimeout: (handle: unknown) => void } = {
    setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
  },
): Promise<() => void> {
  let stopped = false;
  // A word heard from the owner is newer than an answer still on its way.
  let heard = false;
  applyIndexBuildState(vaultPath, { kind: "building", done: 0, total: 0 });
  const off = await bus.onBroadcast("index-build", ({ state }, _from, about) => {
    if (about !== vaultPath || stopped) return;
    heard = true;
    applyIndexBuildState(vaultPath, state);
  });
  let attempt = 0;
  let retry: unknown = null;
  const ask = () => {
    retry = null;
    if (stopped || heard) return;
    void bus.request("index-build-state", {}, { vaultPath }).then(
      (state) => {
        if (stopped || heard) return;
        heard = true;
        applyIndexBuildState(vaultPath, state);
      },
      () => {
        if (stopped || heard) return;
        retry = timers.setTimeout(ask, MIRROR_RETRY_MS[Math.min(attempt++, MIRROR_RETRY_MS.length - 1)]);
      },
    );
  };
  ask();
  return () => {
    stopped = true;
    if (retry !== null) timers.clearTimeout(retry);
    off();
    applyIndexBuildState(vaultPath, { kind: "closed" });
  };
}
