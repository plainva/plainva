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
 * reopened.
 */

export interface NoteConflict {
  /** The note the user was editing. */
  path: string;
  /** The `.CONFLICT` sibling holding their version. */
  copyPath: string;
}

const conflicts = new Map<string, NoteConflict>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

export function subscribeConflicts(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function noteConflict(path: string, copyPath: string): void {
  const existing = conflicts.get(path);
  // A second conflict on the same note replaces the first: the newest copy is
  // the one holding the text the user last typed.
  if (existing?.copyPath === copyPath) return;
  conflicts.set(path, { path, copyPath });
  emit();
}

export function clearConflict(path: string): void {
  if (!conflicts.delete(path)) return;
  emit();
}

export function getConflict(path: string): NoteConflict | null {
  return conflicts.get(path) ?? null;
}

/** Every unresolved conflict — for surfaces that list rather than open one. */
export function listConflicts(): NoteConflict[] {
  return Array.from(conflicts.values());
}

/** Test seam: drops all state. */
export function resetConflicts(): void {
  conflicts.clear();
  emit();
}
