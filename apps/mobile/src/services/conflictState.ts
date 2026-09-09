/**
 * Which notes currently have a conflict copy waiting (S5).
 *
 * A conflict used to arrive as a toast — one per retry round, because the save
 * coordinator treated it as a transient failure and kept trying, writing a
 * fresh `.CONFLICT` file each time. Toasts vanish, and no surface pointed at
 * any of those files, so the one thing the user needed (their own text is over
 * there) was the one thing they could not act on.
 *
 * A conflict is an END STATE: it stays until the user resolves it, and it is
 * shown where the note is, not in a corner that fades. This store holds that
 * state outside any component, so it survives the editor being unmounted and
 * reopened — and, since the Build-91 feedback round (P1), the app being
 * closed: the `.CONFLICT` file is still on disk after a restart, so the card
 * that points at it must be too. Persisted per vault in local storage, like
 * the scroll memory; a card whose copy has meanwhile been deleted is dropped
 * by the editor when it checks the file.
 */

export interface NoteConflict {
  /** The note the user was editing. */
  path: string;
  /** The `.CONFLICT` sibling holding their version. */
  copyPath: string;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const defaultStorage = (): StorageLike | null => (typeof localStorage === "undefined" ? null : localStorage);

export const conflictsKey = (vaultKey: string) => `plainva-conflicts-${vaultKey}`;

const conflicts = new Map<string, NoteConflict>();
const listeners = new Set<() => void>();
let bound: { vaultKey: string; storage: StorageLike | null } | null = null;

function emit(): void {
  for (const l of listeners) l();
}

function persist(): void {
  if (!bound) return;
  try {
    const list = Array.from(conflicts.values());
    if (list.length === 0) bound.storage?.removeItem(conflictsKey(bound.vaultKey));
    else bound.storage?.setItem(conflictsKey(bound.vaultKey), JSON.stringify(list));
  } catch {
    /* the state simply does not persist */
  }
}

/** Reads the persisted list for a vault; malformed entries are dropped. */
export function readPersistedConflicts(vaultKey: string, storage: StorageLike | null = defaultStorage()): NoteConflict[] {
  try {
    const raw = storage?.getItem(conflictsKey(vaultKey));
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (c): c is NoteConflict =>
        !!c && typeof c === "object" && typeof (c as NoteConflict).path === "string" && typeof (c as NoteConflict).copyPath === "string",
    );
  } catch {
    return [];
  }
}

/**
 * Binds the store to a vault: loads what that vault had unresolved and
 * persists every change from now on. Called when a vault opens or the user
 * switches; the previous vault's state stays in ITS storage key.
 */
export function bindConflictStore(vaultKey: string, storage: StorageLike | null = defaultStorage()): void {
  bound = { vaultKey, storage };
  conflicts.clear();
  for (const c of readPersistedConflicts(vaultKey, storage)) conflicts.set(c.path, c);
  emit();
}

export function subscribeConflicts(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function noteConflict(path: string, copyPath: string, vaultKey = bound?.vaultKey): void {
  if (vaultKey && vaultKey !== bound?.vaultKey) {
    // A late result belongs to the vault that wrote it, even after navigation.
    const storage = bound?.storage ?? defaultStorage();
    const list = readPersistedConflicts(vaultKey, storage).filter((c) => c.path !== path);
    list.push({ path, copyPath });
    try { storage?.setItem(conflictsKey(vaultKey), JSON.stringify(list)); } catch { /* best effort */ }
    return;
  }
  const existing = conflicts.get(path);
  // A second conflict on the same note replaces the first: the newest copy is
  // the one holding the text the user last typed.
  if (existing?.copyPath === copyPath) return;
  conflicts.set(path, { path, copyPath });
  persist();
  emit();
}

export function clearConflict(path: string): void {
  if (!conflicts.delete(path)) return;
  persist();
  emit();
}

export function getConflict(path: string): NoteConflict | null {
  return conflicts.get(path) ?? null;
}

/** Every unresolved conflict — for surfaces that list rather than open one. */
export function listConflicts(): NoteConflict[] {
  return Array.from(conflicts.values());
}

/** Test seam: drops all state and the binding. */
export function resetConflicts(): void {
  conflicts.clear();
  bound = null;
  emit();
}
