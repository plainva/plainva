/**
 * Path identity and collision detection (ADR 0016).
 *
 * A vault path is identified by its Unicode NFC form everywhere in Plainva:
 * the index, sync_state and the offline queue. The spelling a file system or
 * a provider actually stores — macOS and iOS decompose accents, a WebDAV
 * server keeps whatever bytes it was sent — is resolved at each access
 * (`PathSpellings`) and never renamed. Until 2026-09-30 the identity was the
 * byte sequence, which made one folder written in Finder (decomposed) and the
 * same folder on the server (composed) two different paths: the index saw a
 * new file and a vanished one, and the sync created a second, identical-looking
 * folder on the server (issue #112).
 *
 * A path whose identity is NOT NFC is a twin: a second spelling that exists
 * next to its composed form in the same folder (a byte-exact file system or
 * server holding both). It keeps its own bytes as its identity, stays out of
 * the sync and is reported, never merged.
 *
 * Letter case is not part of the identity. The systems we sync with still
 * disagree about it:
 *
 *  - Google Drive resolves search queries case-INSENSITIVELY ("all matches are
 *    case-insensitive"), so `name='mobile App.md'` also returns `Mobile App.md`.
 *  - Windows (NTFS) and macOS store both names in ONE file, so two such notes
 *    collapse into one there.
 *
 * Two notes whose names differ only in letter case therefore behave like one
 * file on the other side, which cost a user the content of one note and made the
 * other one get deleted over and over (the remote listing knows only one name, so
 * the twin looks remotely deleted). The helpers below detect that situation so
 * callers can REPORT it instead of guessing.
 */

/** The identity of a path: its NFC form (ADR 0016). */
export function toPathIdentity(path: string): string {
  return path.normalize("NFC");
}

/**
 * True for a twin identity: a spelling that is not NFC, which the path layer
 * only hands out for the second of two spellings that really exist side by
 * side (ADR 0016). Such a path is reported, never synced.
 */
export function isTwinSpelling(path: string): boolean {
  return path !== path.normalize("NFC");
}

/**
 * Whether `text` can be spelled in more than one Unicode normalization form at
 * all. Plain ASCII and scripts without composed characters cannot, so paths
 * like that never need a spelling lookup — the cheap test in front of every
 * resolution.
 */
export function hasSpellingVariants(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) > 0x7f) return text.normalize("NFD") !== text.normalize("NFC");
  }
  return false;
}

/** Folded key for collision lookups — never use this as a path or an identity. */
export function foldPathForCollision(path: string): string {
  return path.normalize("NFC").toLowerCase();
}

/**
 * Returns the first candidate that collides with `path` without being equal to it
 * — i.e. a name the remote (or a case-insensitive file system) cannot tell apart.
 */
export function findCollidingPath(path: string, candidates: Iterable<string>): string | null {
  const folded = foldPathForCollision(path);
  for (const candidate of candidates) {
    if (candidate === path) continue;
    if (foldPathForCollision(candidate) === folded) return candidate;
  }
  return null;
}

/**
 * Unicode-folded path for comparing two names a HUMAN cannot tell apart (C23).
 *
 * Narrower than foldPathForCollision on purpose: this folds normalization
 * only, not case. `Bücher` written NFC and the same word written NFD are one
 * name on every file system — macOS stores the decomposed form and shows the
 * same word — so treating them as different makes "+ Entry" offer to create a
 * folder that already exists, one keystroke away from a second, visually
 * identical folder.
 *
 * Case is a different question and deliberately left alone: `Bücher` and
 * `bücher` LOOK different, and on a case-sensitive file system they are two
 * folders. Folding case here would make a write land in the wrong one, which
 * is worse than one unnecessary question.
 *
 * Like its neighbour a comparison key. Since ADR 0016 it computes the same
 * value as `toPathIdentity`; callers that compare names keep using this one.
 */
export function foldPathNormalization(path: string): string {
  return path.normalize("NFC");
}

/**
 * Two paths the remote cannot tell apart — reported, never resolved by the core.
 *
 * This used to leave here as one English sentence built with string
 * concatenation, which the shells rendered unchanged: German users got English,
 * and neither shell could offer an action because it had nothing but prose
 * (finding 2026-08-21). The core has no language; it has facts.
 *
 * `path` is the file this device knows, `twin` the other spelling: the one the
 * remote lists (pull side), the one on this device's disk when a queued remote
 * DELETE of `path` was held back (push side, issue #112), or — for a twin
 * identity kept out of the sync (ADR 0016) — its composed form.
 * Deliberately no size or date: the core holds neither for the twin, and a
 * number it would have to fetch is a number it should not promise.
 */
export interface NameCollision {
  path: string;
  twin: string;
}
