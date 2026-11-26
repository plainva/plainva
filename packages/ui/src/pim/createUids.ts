import { newPimCreateUid } from "@plainva/core";

/**
 * The uid of one create of the person, kept across its tries (issue 119).
 *
 * Every create names the uid of the event it makes (`PimEventCreate`,
 * `PimTaskCreate`). A provider that lets the client name it (CalDAV) then
 * finds what an earlier try left - an answer that never arrived, a server that
 * shows its writes late - instead of making a second event. So a try of the
 * SAME create must send the SAME uid. The forms make one when they are saved
 * and keep it in their "Try again". The creates that are not a form - a time
 * block, an appointment from a note, a task sent to a list, a blocker, the
 * copy a move makes - are named here by what they create and where: the same
 * create tried again finds the same uid; once it has landed (`forgetCreateUid`)
 * the next one is new.
 */
const kept = new Map<string, { uid: string; at: number; sent: unknown }>();
/** A create not tried again for a day is a new one (and the map cannot grow without end). */
const KEPT_MS = 24 * 3600_000;

function keyOf(scope: string, where: string, what: unknown): string {
  return `${scope}\u0000${where}\u0000${JSON.stringify(what)}`;
}

/** Without the fields of a try itself: what a try says about the event. */
function draftOf<D extends object>(draft: D): D {
  const { createAs: _a, createBefore: _b, ...rest } = draft as D & { createAs?: unknown; createBefore?: unknown };
  return rest as D;
}

/**
 * The uid of this create and, on a later try, what the try before it sent
 * (`createBefore`). A later try compares the object it meets at its address
 * with that, and writes over it only where nobody changed it since
 * (`docs/engineering/Calendar_Create_Tries.md`).
 */
export function createTryFor<D extends object>(scope: string, where: string, what: unknown, draft: D, now: number = Date.now()): { createAs: string; createBefore?: D } {
  for (const [key, entry] of kept) if (now - entry.at > KEPT_MS) kept.delete(key);
  const key = keyOf(scope, where, what);
  const entry = kept.get(key);
  if (entry) {
    const before = entry.sent as D;
    kept.set(key, { uid: entry.uid, at: now, sent: draftOf(draft) });
    return { createAs: entry.uid, createBefore: before };
  }
  const uid = newPimCreateUid();
  kept.set(key, { uid, at: now, sent: draftOf(draft) });
  return { createAs: uid };
}

/** The uid alone, for a caller that does not need to know (see `createTryFor`). */
export function createUidFor(scope: string, where: string, what: unknown, now: number = Date.now()): string {
  return createTryFor(scope, where, what, {}, now).createAs;
}

/** The create landed: the next create of the same thing is a new one. */
export function forgetCreateUid(scope: string, where: string, what: unknown): void {
  kept.delete(keyOf(scope, where, what));
}

/**
 * The tries of one saved form (issue 119): the first sends the draft; every
 * later one ("Try again") sends it again, naming what the try before it sent.
 */
export function formCreateTries<D extends { createAs: string }>(draft: D): () => D & { createBefore?: Omit<D, "createAs"> } {
  let sent: Omit<D, "createAs"> | null = null;
  return () => {
    const attempt = { ...draft, ...(sent ? { createBefore: sent } : {}) };
    sent = draftOf(draft);
    return attempt;
  };
}
