/**
 * Ask before unfinished work is thrown away.
 *
 * The navigation bar sits on top of every surface, and a tap on it clears the
 * whole overlay stack. Until now that silently discarded a half-written mail,
 * entered cloud credentials, an S3 secret — and worst of all the encryption
 * wizard, which destroys its workspace draft AND zeroes its in-memory keys on
 * unmount. Nothing asked, nothing could be recovered.
 *
 * A surface with unsaved work arms a guard; every route that leaves a surface
 * (bar tap, back button, Android back) asks it first. The guard is a single
 * slot on purpose: only the topmost surface can hold unsaved input, and a stack
 * of questions would be worse than none.
 */

export interface LeaveGuard {
  /** Identifies the arming surface so it can only ever disarm its own guard. */
  id: string;
  /** Message shown in the confirmation; the surface knows what is at stake. */
  message: string;
}

let current: LeaveGuard | null = null;

/** Arms (or replaces) the guard. A surface calls this when it becomes dirty. */
export function armLeaveGuard(guard: LeaveGuard): void {
  current = guard;
}

/**
 * Disarms — but only the guard this surface armed. Without the id check a
 * screen unmounting late (React runs cleanup after the next screen mounted)
 * would disarm the guard the NEW screen just armed.
 */
export function disarmLeaveGuard(id: string): void {
  if (current?.id === id) current = null;
}

export function activeLeaveGuard(): LeaveGuard | null {
  return current;
}

/**
 * Runs the question. Returns whether leaving is allowed; a confirmed leave
 * disarms, so the next navigation does not ask twice about the same work.
 *
 * `confirm` is injected rather than imported so the decision stays testable
 * without a dialog host — and so the caller decides which dialog to use.
 */
export async function confirmLeave(
  confirm: (message: string) => Promise<boolean>,
): Promise<boolean> {
  const guard = current;
  if (!guard) return true;
  const ok = await confirm(guard.message);
  if (ok) current = null;
  return ok;
}

/** Test seam — production code arms and disarms through the pair above. */
export function resetLeaveGuard(): void {
  current = null;
}
