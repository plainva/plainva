/**
 * Taking a message back out of Trash (S30).
 *
 * A move does not preserve the message's id: IMAP assigns a new uid in the
 * destination folder, and `moveMessage` does not report it back. So "undo"
 * cannot address the old id — it has to find the message again by what did NOT
 * change, among the newest arrivals in Trash, where it must now be.
 *
 * The match is strict on subject, date and sender together, and ambiguity is a
 * refusal: two candidates mean we do not know which one the user meant, and
 * moving the wrong message back is worse than saying we could not. That is the
 * whole reason this is a function with a test rather than three lines in a
 * click handler.
 */

export interface UndoRef {
  subject: string;
  dateTs: number;
  from: string;
}

export interface UndoDeps<T extends UndoRef & { id: string }> {
  /** Newest-first envelopes of a mailbox, capped. */
  listNewest(mailbox: string, limit: number): Promise<T[]>;
  moveMessage(from: string, id: string, to: string): Promise<void>;
}

export type UndoOutcome = "ok" | "notFound" | "ambiguous";

/** How far into Trash to look. The message was just moved: it is at the top. */
export const UNDO_SCAN = 20;

export function findMoved<T extends UndoRef & { id: string }>(candidates: readonly T[], ref: UndoRef): T | "notFound" | "ambiguous" {
  const hits = candidates.filter(
    (m) => m.subject === ref.subject && m.dateTs === ref.dateTs && m.from === ref.from,
  );
  if (hits.length === 0) return "notFound";
  if (hits.length > 1) return "ambiguous";
  return hits[0];
}

export async function undoMoveToTrash<T extends UndoRef & { id: string }>(
  deps: UndoDeps<T>,
  ref: UndoRef,
  trash: string,
  back: string,
): Promise<UndoOutcome> {
  const found = findMoved(await deps.listNewest(trash, UNDO_SCAN), ref);
  if (found === "notFound" || found === "ambiguous") return found;
  await deps.moveMessage(trash, found.id, back);
  return "ok";
}
