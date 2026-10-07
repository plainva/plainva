import type { PimBlockRef } from "./types.js";

/**
 * The reverse half of the blocker linkage (K3, plan Befunde 2026-10-06).
 *
 * A blocker has always known its event (`blockOf`). The event knew nothing:
 * the app derived "this event has blockers" from whatever rows happened to be
 * loaded, so a blocker in a calendar that is not shown — whose rows are not in
 * the cache at all — did not exist as far as the event was concerned, and a
 * moved event left it standing.
 *
 * So the event carries the list of its blockers itself, at the provider, the
 * same way `blockOf` travels: a private extended property at Google, a
 * single-value extended property at Microsoft, an `X-` property in iCalendar.
 * This file is the one text form all three store.
 *
 * The list is a hint that makes blockers findable, never the truth about them:
 * a blocker deleted elsewhere answers 404 and is skipped, one detached from its
 * event no longer points back and is skipped as well.
 */

/** Short keys: Google caps a private property at 1024 characters, key included. */
interface StoredBlockRef {
  a: string;
  c: string;
  u: string;
  h?: string;
  m?: "b" | "d";
}

function toStored(ref: PimBlockRef): StoredBlockRef {
  return {
    a: ref.accountId,
    c: ref.calendarId,
    u: ref.uid,
    ...(ref.href ? { h: ref.href } : {}),
    ...(ref.mode ? { m: ref.mode === "details" ? ("d" as const) : ("b" as const) } : {}),
  };
}

function fromStored(value: unknown): PimBlockRef | null {
  if (!value || typeof value !== "object") return null;
  const stored = value as Record<string, unknown>;
  if (typeof stored.a !== "string" || typeof stored.c !== "string" || typeof stored.u !== "string") return null;
  if (!stored.a || !stored.c || !stored.u) return null;
  return {
    accountId: stored.a,
    calendarId: stored.c,
    uid: stored.u,
    ...(typeof stored.h === "string" && stored.h ? { href: stored.h } : {}),
    ...(stored.m === "d" ? { mode: "details" as const } : stored.m === "b" ? { mode: "busy" as const } : {}),
  };
}

export const sameBlockRef = (
  a: Pick<PimBlockRef, "accountId" | "calendarId" | "uid">,
  b: Pick<PimBlockRef, "accountId" | "calendarId" | "uid">,
): boolean => a.accountId === b.accountId && a.calendarId === b.calendarId && a.uid === b.uid;

/** The list without repeats; a later entry for the same blocker wins. */
export function uniqueBlockRefs(refs: readonly PimBlockRef[]): PimBlockRef[] {
  const out: PimBlockRef[] = [];
  for (const ref of refs) {
    const at = out.findIndex((known) => sameBlockRef(known, ref));
    if (at >= 0) out[at] = ref;
    else out.push(ref);
  }
  return out;
}

/** One blocker as text (Google stores one per property). */
export function encodeBlockRef(ref: PimBlockRef): string {
  return JSON.stringify(toStored(ref));
}

export function decodeBlockRef(text: string | null | undefined): PimBlockRef | null {
  if (!text) return null;
  try {
    return fromStored(JSON.parse(text));
  } catch {
    return null;
  }
}

/** The whole list as one text (Microsoft, CalDAV, the cache column). */
export function encodeBlockRefs(refs: readonly PimBlockRef[]): string {
  return JSON.stringify(uniqueBlockRefs(refs).map(toStored));
}

/**
 * Reads a stored list. Anything that is not one — another client's value under
 * the same name, a truncated string — is "no blockers known", never an error:
 * a pull must not fail over a property only Plainva reads.
 */
export function decodeBlockRefs(text: string | null | undefined): PimBlockRef[] | undefined {
  if (!text) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed)) return undefined;
  const refs = parsed.map(fromStored).filter((ref): ref is PimBlockRef => ref !== null);
  return refs.length > 0 ? uniqueBlockRefs(refs) : undefined;
}
