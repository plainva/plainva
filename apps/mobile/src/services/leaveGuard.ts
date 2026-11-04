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
 * (bar tap, back button, Android back) asks it first.
 *
 * The guards are a short stack, not one slot (finding 2026-10-22, § 3.139
 * Nr. 3). Only the topmost SCREEN is rendered, so one screen holds input at a
 * time — but a sheet over it holds its own: a journal entry typed over a
 * database, the IMAP form in its sheet over the mail accounts. With one slot
 * the sheet replaced the screen's guard and, closed, took it along; the
 * screen's input then went without a word. A step that takes the screen off
 * takes all of it, so it asks about all of it at once, in one question.
 */

export interface LeaveGuard {
  /** Identifies the arming surface so it can only ever disarm its own guard. */
  id: string;
  /** Message shown in the confirmation; the surface knows what is at stake. */
  message: string;
}

let guards: LeaveGuard[] = [];
const listeners = new Set<() => void>();
const changed = () => {
  for (const listener of [...listeners]) listener();
};

/** Arms (or re-words) this surface's guard. A surface calls this when it becomes dirty. */
export function armLeaveGuard(guard: LeaveGuard): void {
  const at = guards.findIndex((g) => g.id === guard.id);
  guards = at >= 0 ? guards.map((g, i) => (i === at ? guard : g)) : [...guards, guard];
  changed();
}

/**
 * Disarms — but only the guard this surface armed. Without the id check a
 * screen unmounting late (React runs cleanup after the next screen mounted)
 * would disarm the guard the NEW screen just armed.
 */
export function disarmLeaveGuard(id: string): void {
  if (!guards.some((g) => g.id === id)) return;
  guards = guards.filter((g) => g.id !== id);
  changed();
}

/** The guard armed last — the surface on top —, or null when nothing is at stake. */
export function activeLeaveGuard(): LeaveGuard | null {
  return guards[guards.length - 1] ?? null;
}

/** Every armed guard, the topmost last. */
export function armedLeaveGuards(): readonly LeaveGuard[] {
  return guards;
}

/** Whether this surface's guard is armed right now. */
export function isLeaveGuardArmed(id: string): boolean {
  return guards.some((g) => g.id === id);
}

/**
 * Whether something holds unsaved input that is not `own`'s — what a step the
 * PROGRAM takes would put at stake. `own` names the guards of the surfaces the
 * step itself belongs to (the form a flow was started from).
 */
export function foreignInputArmed(own?: string | readonly string[]): boolean {
  const mine: readonly string[] = own === undefined ? [] : typeof own === "string" ? [own] : own;
  return guards.some((g) => !mine.includes(g.id));
}

/** Calls `listener` whenever a guard is armed or disarmed. Returns the unsubscribe. */
export function onLeaveGuardChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Runs the question. Returns whether leaving is allowed; a confirmed leave
 * disarms, so the next navigation does not ask twice about the same work.
 *
 * `confirm` is injected rather than imported so the decision stays testable
 * without a dialog host — and so the caller decides which dialog to use.
 * Several guards are one question: each says once what it would lose.
 *
 * `keepArmed` is for a step that may turn out not to leave after all (finding
 * 2026-10-09): "new database" asks for a name next, and that prompt can be
 * cancelled. "Discard" is consent to the step, not a statement that the work
 * is gone — the surface is still on screen then, still holds its input, and
 * the next way out has to ask again. With `keepArmed` the guard is left to the
 * one thing that knows: the surface disarms it itself when it really goes
 * (`useLeaveGuard`'s cleanup).
 */
export async function confirmLeave(
  confirm: (message: string) => Promise<boolean>,
  keepArmed = false,
): Promise<boolean> {
  if (guards.length === 0) return true;
  const asked = guards;
  const ok = await confirm([...new Set(asked.map((g) => g.message))].join(" "));
  if (ok && !keepArmed) {
    guards = guards.filter((g) => !asked.includes(g));
    changed();
  }
  return ok;
}

/** Test seam — production code arms and disarms through the pair above. */
export function resetLeaveGuard(): void {
  guards = [];
  listeners.clear();
}
