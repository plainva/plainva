import { newPimCreateUid, sameStoredValue } from "@plainva/core";

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
const kept = new Map<string, { uid: string; at: number; sent: unknown[] }>();
/** A create not tried again for a day is a new one (and the map cannot grow without end). */
const KEPT_MS = 24 * 3600_000;
/** How many versions of one create are kept; more is a create the person keeps changing. */
const KEPT_VERSIONS = 8;

/**
 * The vault a note-bound create belongs to (H-F): a note path and a title are
 * only unique in one vault, so the vault's adapter is part of the key. A new
 * adapter for the same vault is a new key - a new uid, as before this change.
 */
const vaultIds = new WeakMap<object, number>();
let nextVaultId = 1;
export function createVaultKey(vault: object): string {
  let id = vaultIds.get(vault);
  if (id === undefined) {
    id = nextVaultId++;
    vaultIds.set(vault, id);
  }
  return `vault:${id}`;
}

function keyOf(scope: string, where: string, what: unknown): string {
  return `${scope}\u0000${where}\u0000${JSON.stringify(what)}`;
}

/** Without the fields of a try itself: what a try says about the event. */
function draftOf<D extends object>(draft: D): D {
  const { createAs: _a, createSent: _b, ...rest } = draft as D & { createAs?: unknown; createSent?: unknown };
  return rest as D;
}

/** `versions` with `draft` added, once, newest last. */
function withVersion<D extends object>(versions: readonly unknown[], draft: D): unknown[] {
  const version = draftOf(draft);
  return [...versions.filter((v) => !sameStoredValue(v, version)), version].slice(-KEPT_VERSIONS);
}

/**
 * The uid of this create and, on a later try, every version its earlier tries
 * sent or set out to send (`createSent`): a try that failed may still have
 * landed, so what stands at the provider can be any of them, never only the
 * last. A later try writes over the object it meets at its address only where
 * it says one of these; anything else it leaves, and creates anew
 * (`docs/engineering/Calendar_Create_Tries.md`).
 */
export function createTryFor<D extends object>(scope: string, where: string, what: unknown, draft: D, now: number = Date.now()): { createAs: string; createSent?: D[] } {
  for (const [key, entry] of kept) if (now - entry.at > KEPT_MS) kept.delete(key);
  const key = keyOf(scope, where, what);
  const entry = kept.get(key);
  if (entry) {
    const before = entry.sent as D[];
    kept.set(key, { uid: entry.uid, at: now, sent: withVersion(entry.sent, draft) });
    return { createAs: entry.uid, createSent: before };
  }
  const uid = newPimCreateUid();
  kept.set(key, { uid, at: now, sent: withVersion([], draft) });
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
 * later one ("Try again") sends it again, naming every version sent before.
 */
export function formCreateTries<D extends { createAs: string }>(draft: D): () => D & { createSent?: Omit<D, "createAs">[] } {
  let sent: unknown[] = [];
  return () => {
    const attempt = { ...draft, ...(sent.length > 0 ? { createSent: sent as Omit<D, "createAs">[] } : {}) };
    sent = withVersion(sent, draft);
    return attempt;
  };
}
