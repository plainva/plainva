import { parseUnifiedId, type MailEnvelope } from "@plainva/ui/mail";

/**
 * The rules behind the mail list's selection mode (mail feinplan G3a).
 *
 * Pure on purpose: what a bulk action means, and what it does when one message
 * of twenty fails, is the part worth pinning in tests. The screen only supplies
 * the actual client calls.
 *
 * A bulk run is SEQUENTIAL. Twenty parallel requests are exactly what made
 * Graph answer 429 during the 0.5.4 device test; a mailbox action is also not
 * something to fire twenty of at once at any IMAP server.
 */

export type Selection = ReadonlySet<string>;

export function toggleSelected(selection: Selection, id: string): Set<string> {
  const next = new Set(selection);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/** The messages of the current page that are selected, in list order. */
export function selectedRows(rows: readonly MailEnvelope[], selection: Selection): MailEnvelope[] {
  return rows.filter((r) => selection.has(r.id));
}

/**
 * Whether "mark as read" or "mark as unread" is the useful offer: if anything
 * in the selection is still unread, reading them is what the user means.
 */
export function bulkSeenTarget(rows: readonly MailEnvelope[], selection: Selection): boolean {
  return selectedRows(rows, selection).some((r) => !r.seen);
}

export interface BulkOutcome {
  /** Ids the action completed for — the caller applies them to its list. */
  done: string[];
  /** Ids the server refused; the first error message is kept for the toast. */
  failed: string[];
  error?: string;
}

/**
 * Runs `action` over the ids one after another and keeps going past a single
 * failure: with twenty messages selected, one rejected id must not silently
 * abandon the other nineteen — but it must be reported, not swallowed.
 */
export async function runBulk(
  ids: readonly string[],
  action: (id: string, index: number) => Promise<void>,
): Promise<BulkOutcome> {
  const done: string[] = [];
  const failed: string[] = [];
  let error: string | undefined;
  for (const [i, id] of ids.entries()) {
    try {
      await action(id, i);
      done.push(id);
    } catch (e) {
      failed.push(id);
      error ??= e instanceof Error ? e.message : String(e);
    }
  }
  return { done, failed, error };
}

/**
 * Where a bulk action has to reach for each selected id.
 *
 * In the flat list an id is a bare uid and the open folder IS its origin. In
 * the conversation view a thread mixes folders — a reply lives in Sent — so the
 * id carries its origin and the action follows it there. Acting on the screen's
 * folder instead would use a uid that means something ELSE in that folder.
 */
export function bulkTargets(
  ids: readonly string[],
  fallbackBox: string,
): Array<{ box: string; uid: string }> {
  return ids.map((id) => {
    const origin = parseUnifiedId(id);
    return { box: origin?.mailbox || fallbackBox, uid: origin?.uid ?? id };
  });
}
