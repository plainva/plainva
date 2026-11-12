import { applyIndexBuildState, indexBuildState, subscribeIndexBuild } from "@plainva/ui";
import type { WindowBus } from "./windowBus";

/**
 * How whole the index of a vault is, across the windows of the desktop
 * (performance plan L3, review of 11.11.). The central window runs every vault
 * (`VaultHost`) and its store holds the word; every other window that shows a
 * vault mirrors it, so that its planners refuse on the same answer.
 */

/**
 * How whole this window's index of the vault is, for every window that shows
 * the vault (performance plan L3): answered when a client opens it, and
 * broadcast on every change. Only this window runs the vault; a client never
 * guesses whether the index is whole — its planners refuse on what is said here.
 */
export async function installIndexBuildMirror(
  bus: Pick<WindowBus, "handle" | "broadcast">,
  vaultPath: string,
  scoped: { vaultPath: string },
): Promise<() => void> {
  const offHandle = await bus.handle("index-build-state", () => indexBuildState(vaultPath), scoped);
  let last = indexBuildState(vaultPath);
  const offStore = subscribeIndexBuild(() => {
    const now = indexBuildState(vaultPath);
    if (now === last) return;
    last = now;
    void bus.broadcast("index-build", { state: now }, vaultPath).catch(() => {});
  });
  return () => { offHandle(); offStore(); };
}

/**
 * Mirrors the owner's word on how whole its index of `vaultPath` is into this
 * window's store (`installIndexBuildMirror` on the owner side). An owner that
 * does not answer (an older one) leaves the vault as whole as it was before L3.
 * Stopped, the mirror forgets the vault: whoever still waits is refused.
 */
export async function mirrorOwnerIndexBuild(
  bus: Pick<WindowBus, "onBroadcast" | "request">,
  vaultPath: string,
): Promise<() => void> {
  // A change heard while the question is on its way is newer than the answer.
  let heard = false;
  const off = await bus.onBroadcast("index-build", ({ state }, _from, about) => {
    if (about !== vaultPath) return;
    heard = true;
    applyIndexBuildState(vaultPath, state);
  });
  const now = await bus.request("index-build-state", {}, { vaultPath }).catch(() => null);
  if (now && !heard) applyIndexBuildState(vaultPath, now);
  return () => {
    off();
    applyIndexBuildState(vaultPath, { kind: "closed" });
  };
}

