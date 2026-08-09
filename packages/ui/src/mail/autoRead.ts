/**
 * "Auto-mark-read": a message left open for a few seconds becomes read on its
 * own, like every mail client — with one exception that used to be broken.
 *
 * Marking an OPEN message as unread by hand is a deliberate act ("come back to
 * this"). The desktop effect kept `seen` in its dependency list, so that very
 * click re-ran the effect, restarted the timer, and three seconds later the
 * message was read again: the user was fighting a timer they had triggered
 * themselves. The phone had the opposite gap — it marked a message read the
 * instant it opened, with no delay and no way to hold it back.
 *
 * Both shells now share this rule, so "read" cannot mean two different things
 * on two devices:
 *
 *   A message held unread by hand stays unread for as long as it is open.
 *   Leaving it and opening it again clears the hold.
 *
 * The hold is a set rather than a single id because a bulk action in the list
 * can turn the currently open message unread alongside others.
 */

/** How long an open message must stay open before it counts as read. */
export const AUTO_READ_DELAY_MS = 3000;

export interface AutoReadInput {
  /** Id of the message currently open, or null when none is. */
  openId: string | null;
  /** The body has arrived — a spinner is not "reading". */
  hasBody: boolean;
  /** Current read state of the open message. */
  seen: boolean;
  /** Messages the user turned unread by hand while they were open. */
  heldUnread: ReadonlySet<string>;
}

/** Whether an auto-read timer may run for the open message. Pure. */
export function shouldScheduleAutoRead({ openId, hasBody, seen, heldUnread }: AutoReadInput): boolean {
  if (openId == null || !hasBody || seen) return false;
  return !heldUnread.has(openId);
}

/**
 * The hold after a MANUAL read-state change. Turning a message unread holds it;
 * turning it read releases it again, so the next visit behaves normally.
 *
 * Call this synchronously in the click handler, BEFORE the (async) write to the
 * server: the hold has to be in place by the time `seen` flips, otherwise the
 * effect sees "unread and not held" for one render and starts the very timer
 * this function exists to prevent.
 */
export function applyManualSeen(
  heldUnread: ReadonlySet<string>,
  ids: readonly string[],
  seen: boolean
): Set<string> {
  const next = new Set(heldUnread);
  for (const id of ids) {
    if (seen) next.delete(id);
    else next.add(id);
  }
  return next;
}

/**
 * Leaving a message releases its hold. Keeps only the message that is open now,
 * so switching away and back clears it. Idempotent — calling it repeatedly for
 * the same open message changes nothing.
 */
export function retainOnlyOpen(heldUnread: ReadonlySet<string>, openId: string | null): Set<string> {
  const next = new Set<string>();
  if (openId != null && heldUnread.has(openId)) next.add(openId);
  return next;
}
