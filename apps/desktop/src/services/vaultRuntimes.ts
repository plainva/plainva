/**
 * Which vaults are open, and who is looking at them (multi-window stage D).
 *
 * Until stage C the answer was a single string: one process, one open vault.
 * With two windows able to show different vaults that string becomes a set —
 * and the set needs an owner, because a vault is not free to hold open. Behind
 * every held vault sit a sync worker on a timer, a file watcher, an open SQLite
 * connection and two schedulers. "Open until the app quits" would mean the vault
 * somebody glanced at once keeps polling a cloud for the rest of the day.
 *
 * So this is a refcount, and the thing being counted is WINDOWS. A vault lives
 * while at least one window shows it; when the last one looks away, its runtime
 * is torn down. The central window is a holder like any other — it just happens
 * to be the one that is always there.
 *
 * Deliberately NOT in here: the runtime itself. React already owns the runtime
 * (one `VaultProvider` per held vault in the central window), and moving the
 * seven-hundred-line load path out of it would have been a rewrite where a split
 * was enough. This module answers exactly one question — *which* vaults are held
 * and by whom — so the answer can be tested without mounting anything, and so
 * the window layer and the runtime layer never have to agree on a shape.
 */

export type VaultHolder = string;

interface Holding {
  readonly path: string;
  readonly holders: Set<VaultHolder>;
}

/**
 * Insertion-ordered on purpose: the central window renders one provider per held
 * vault, and a set that reorders itself would remount runtimes for no reason.
 */
const holdings = new Map<string, Holding>();
const listeners = new Set<() => void>();

/** Cached so `useSyncExternalStore` sees a stable value between changes. */
let snapshot: readonly string[] = [];

function recompute(): void {
  snapshot = [...holdings.keys()];
  for (const fn of [...listeners]) {
    try {
      fn();
    } catch (e) {
      console.warn("[vaultRuntimes] a listener threw", e);
    }
  }
}

/**
 * Marks a vault as shown by `holder`. Idempotent: a window that reports the same
 * vault twice does not hold it twice, because a window can only look at one
 * thing at a time and a refcount that outlives the truth never drops to zero.
 */
export function acquireVault(path: string, holder: VaultHolder): void {
  const existing = holdings.get(path);
  if (existing) {
    if (existing.holders.has(holder)) return;
    existing.holders.add(holder);
    // No structural change: the vault was already held, so nothing re-renders.
    return;
  }
  holdings.set(path, { path, holders: new Set([holder]) });
  recompute();
}

/** Drops one holder. The vault disappears from `heldVaults()` with the last one. */
export function releaseVault(path: string, holder: VaultHolder): void {
  const existing = holdings.get(path);
  if (!existing) return;
  // A release from a window that never held it is a no-op on the set, so the
  // count can only fall for a real holder.
  existing.holders.delete(holder);
  if (existing.holders.size > 0) return;
  holdings.delete(path);
  recompute();
}

/**
 * A window went away. Called with its label, so a closed window can never leave
 * a vault pinned open — the failure mode would be invisible (a sync worker
 * polling for a window nobody can see).
 */
export function releaseHolder(holder: VaultHolder): void {
  let changed = false;
  for (const [path, holding] of [...holdings]) {
    if (!holding.holders.delete(holder)) continue;
    if (holding.holders.size === 0) {
      holdings.delete(path);
      changed = true;
    }
  }
  if (changed) recompute();
}

/** Moves a holder from whatever it held to `path` (null = it shows no vault). */
export function setHolderVault(path: string | null, holder: VaultHolder): void {
  for (const [held, holding] of [...holdings]) {
    if (held === path) continue;
    if (holding.holders.delete(holder) && holding.holders.size === 0) {
      holdings.delete(held);
    }
  }
  if (path) {
    const existing = holdings.get(path);
    if (existing) existing.holders.add(holder);
    else holdings.set(path, { path, holders: new Set([holder]) });
  }
  recompute();
}

/** Every vault a window is currently showing, in the order they were opened. */
export function heldVaults(): readonly string[] {
  return snapshot;
}

export function holdersOf(path: string): readonly VaultHolder[] {
  return [...(holdings.get(path)?.holders ?? [])];
}

export function isHeld(path: string): boolean {
  return holdings.has(path);
}

export function subscribeVaultRuntimes(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Tests only. */
export function resetVaultRuntimes(): void {
  holdings.clear();
  snapshot = [];
  listeners.clear();
}
