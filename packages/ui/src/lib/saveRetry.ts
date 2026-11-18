/**
 * When a failed note save is tried again — one rule for both shells.
 *
 * The phone's saver (`saveCoordinator.ts`) and the desktop's editor
 * (`apps/desktop/src/services/saveRetryTimer.ts`) both try a save that failed
 * again by themselves, at growing intervals: a network drive that was gone for
 * a moment, a file another program held (a virus scanner, a cloud client, an
 * office program — on Windows that one says "Access is denied"), a full disk
 * that was cleared. Until 2026-11-17 the desktop did not: the status said
 * "Save failed!" until the next keystroke or Ctrl+S.
 *
 * A list of error texts cannot tell a passing failure from a lasting one —
 * "Access is denied" is a held file as often as a missing right. So only what
 * is surely final, and where a retry could do harm, ends the retrying at once;
 * everything else is tried again, but not for ever: after about five minutes
 * the saver rests, the status says why the note is not saved, and the next try
 * comes with the person's next step (typing, Ctrl+S, coming back to the
 * window or the app). The text stays in the editor and the draft journal all
 * along.
 */

/** The first retry waits this long; every further one twice as long as the one before. */
export const SAVE_RETRY_BASE_MS = 1_000;
/** No retry waits longer. */
export const SAVE_RETRY_MAX_MS = 30_000;
/**
 * How many times a failed save is tried again before the saver rests:
 * 1 + 2 + 4 + 8 + 16 seconds, then nine times 30 — about five minutes.
 */
export const SAVE_RETRY_LIMIT = 14;

/** How long to wait before retry number `attempt` (1 for the first failure). */
export function saveRetryDelay(attempt: number, baseMs = SAVE_RETRY_BASE_MS, maxMs = SAVE_RETRY_MAX_MS): number {
  return Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1));
}

/** Error codes that end the retrying at once. */
const FINAL_CODES = new Set(["FILE_NOT_FOUND", "NOT_TEXT_FILE", "KEEP_BESIDE_FAILED"]);
const FINAL_NAMES = new Set(["ConflictError", "VaultFileNotFoundError", "NotTextFileError", "KeepBesideFailedError"]);

/**
 * The same said in words, for an error that lost its class on the way: a
 * client window's save comes over the window bus as a message.
 */
const FINAL_WORDS = [
  /^File or directory not found: /,
  /^The unsaved text could not be kept beside the file that is no text\b/,
  // ConflictAwareVaultAdapter's conflicts, as a client window hears them.
  /^Cannot automatically merge /,
  /\bconflict working copy\b/,
  /^Resolve the open conflict\b/,
];

/**
 * True when a retry must not come by itself:
 *  - a conflict: the text is already kept in a conflict copy, and every retry
 *    would write another one;
 *  - the file is gone while the vault's folder is there (moved or deleted
 *    outside Plainva): a retry would make it again at its old place. A vault
 *    folder that cannot be reached is no such case (`VaultUnreachableError`);
 *  - the file is no text any more, and no copy beside it could be written.
 */
export function isSaveFailureFinal(error: unknown): boolean {
  if (error === null || typeof error !== "object") return typeof error === "string" && FINAL_WORDS.some((words) => words.test(error));
  const known = error as { name?: unknown; code?: unknown; message?: unknown };
  if (typeof known.name === "string" && FINAL_NAMES.has(known.name)) return true;
  if (typeof known.code === "string" && FINAL_CODES.has(known.code)) return true;
  const message = typeof known.message === "string" ? known.message : "";
  return FINAL_WORDS.some((words) => words.test(message));
}

/**
 * True when a save failed because the file is gone while the vault's folder is
 * there — the one failure that starts the search for a moved or deleted note.
 * A vault folder out of reach (`VaultUnreachableError`) is not it, nor is any
 * other failure (review 2026-11-18).
 */
export function isVanishedFileFailure(error: unknown): boolean {
  const known = (error ?? {}) as { name?: unknown; code?: unknown; message?: unknown };
  if (known.name === "VaultFileNotFoundError" || known.code === "FILE_NOT_FOUND") return true;
  const message = typeof error === "string" ? error : typeof known.message === "string" ? known.message : "";
  return /^File or directory not found: /.test(message);
}

/**
 * When the next try comes after failure number `attempt` (1 for the first):
 * the delay in milliseconds, or null when none comes by itself — the failure
 * is final, or the saver rests after `SAVE_RETRY_LIMIT` retries.
 */
export function saveRetryAfter(error: unknown, attempt: number, baseMs = SAVE_RETRY_BASE_MS, maxMs = SAVE_RETRY_MAX_MS, limit = SAVE_RETRY_LIMIT): number | null {
  if (isSaveFailureFinal(error) || attempt > limit) return null;
  return saveRetryDelay(attempt, baseMs, maxMs);
}

/** The words of a failure, for "Not saved: …". */
export function saveFailureReason(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  const message = (error as { message?: unknown } | null)?.message;
  return typeof message === "string" && message ? message : String(error);
}

/**
 * What a save that keeps failing tells the person, and when (review
 * 2026-11-18): a run of failures speaks once. Typing starts the retries at one
 * second again; it does not make the same failure news again. A new word comes
 * when the reason changes, when the saver goes to rest (that it stopped trying
 * by itself, once), and after a save went through in between.
 */
export interface SaveFailureTeller {
  /** A save of `key` failed: what to say now — "retrying", "resting", or nothing. */
  failed(key: string, error: unknown, retryIn: number | null): "retrying" | "resting" | null;
  /** A save of `key` went through: the next failure is news again. */
  saved(key: string): void;
}

export function createSaveFailureTeller(): SaveFailureTeller {
  const told = new Map<string, { reason: string; resting: boolean }>();
  return {
    failed(key, error, retryIn) {
      const reason = saveFailureReason(error);
      const before = told.get(key);
      const same = before?.reason === reason;
      if (retryIn === null) {
        told.set(key, { reason, resting: true });
        return same && before.resting ? null : "resting";
      }
      told.set(key, { reason, resting: same ? before.resting : false });
      return same ? null : "retrying";
    },
    saved(key) {
      told.delete(key);
    },
  };
}
