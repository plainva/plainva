/**
 * A counter of the open vault's changes, for surfaces that live outside the
 * screen tree — the ```tasks blocks inside the editor (plan Tasks-Abfragen,
 * T6) are React roots of their own and do not get the app's `bump`. It counts
 * what the app counts: every `m-vault-changed` (an index pass, a pull, a
 * write a screen announces) and every vault switch. All blocks read the same
 * number, so they share one load of the tasks per state (E3).
 */
let version = 0;
const listeners = new Set<() => void>();
let attached = false;

function attach(): void {
  if (attached || typeof window === "undefined") return;
  attached = true;
  const bump = () => {
    version++;
    for (const listener of listeners) listener();
  };
  window.addEventListener("m-vault-changed", bump);
  window.addEventListener("m-vault-switched", bump);
}

export function subscribeVaultVersion(listener: () => void): () => void {
  attach();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getVaultVersion(): number {
  return version;
}
