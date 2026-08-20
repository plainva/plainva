/**
 * Collision detection for remote paths that only LOOK different.
 *
 * A vault path is identified byte-exactly everywhere in Plainva (index, sync_state,
 * queue). The systems we sync with do not agree with that:
 *
 *  - Google Drive resolves search queries case-INSENSITIVELY ("all matches are
 *    case-insensitive"), so `name='mobile App.md'` also returns `Mobile App.md`.
 *  - Windows (NTFS) and macOS store both names in ONE file, so two such notes
 *    collapse into one there.
 *
 * Two notes whose names differ only in letter case (or in Unicode normalization —
 * `ü` as one code point vs. `u` + combining diaeresis) therefore behave like one
 * file on the other side, which cost a user the content of one note and made the
 * other one get deleted over and over (the remote listing knows only one name, so
 * the twin looks remotely deleted).
 *
 * These helpers detect that situation so callers can REPORT it instead of guessing.
 * The folded key is deliberately NOT an identity: making path identity
 * case/normalization-insensitive would re-key sync_state and the index for every
 * existing vault and needs its own migration.
 */

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
 * Like its neighbour: a comparison key, never a path and never an identity.
 */
export function foldPathNormalization(path: string): string {
  return path.normalize("NFC");
}
