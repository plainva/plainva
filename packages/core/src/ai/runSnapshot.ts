import { sha256Hex, utf8Encode } from "../workspace/encoding.js";

/**
 * A run's snapshot (plan KI-Harness P9-2, ADR 0034): what made an answer —
 * its request, its sources with the version that went, its skill, model,
 * tools, rules and result — kept as paths and hashes, never as text.
 *
 * A source's version is the SHA-256 of the note's text as the run read it;
 * whether it changed since is asked when the snapshot is looked at, against
 * the note as it is then.
 */

/** The hash a run keeps of a note's text: SHA-256 over its UTF-8, as hex. */
export const noteHash = (text: string): string => sha256Hex(utf8Encode(text));

/** What a stored hash looks like; anything else read back from a record is dropped. */
export const NOTE_HASH = /^[0-9a-f]{64}$/;

/** How a source reads now against the version a run used: the same, changed since, or no longer there. */
export type SnapshotState = "same" | "changed" | "gone";

/** A source's state now: `now` is its text as it is, null where the note is gone (or cannot be read). */
export function snapshotState(hash: string, now: string | null): SnapshotState {
  if (now === null) return "gone";
  return noteHash(now) === hash ? "same" : "changed";
}

/** A hash as the snapshot shows it: its first seven characters, like a short commit. */
export const shortHash = (hash: string): string => hash.slice(0, 7);
