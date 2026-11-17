/**
 * When a failed note save is tried again — one rule for both shells.
 *
 * The phone's saver (`saveCoordinator.ts`) and the desktop's editor
 * (`apps/desktop/src/services/saveRetryTimer.ts`) both try a save that failed
 * again by themselves, at growing intervals: a network drive that was gone for
 * a moment, a file another program held locked, a full disk that was cleared.
 * Until 2026-11-17 the desktop did not: the status said "Save failed!" until
 * the next keystroke or Ctrl+S.
 *
 * Some failures are not of that kind: trying again does nothing, or does harm.
 * Those end the retrying; the text stays in the editor and in the draft
 * journal, and the person's next keystroke or Ctrl+S tries once more.
 */

/** The first retry waits this long; every further one twice as long as the one before. */
export const SAVE_RETRY_BASE_MS = 1_000;
/** No retry waits longer. */
export const SAVE_RETRY_MAX_MS = 30_000;

/** How long to wait before retry number `attempt` (1 for the first failure). */
export function saveRetryDelay(attempt: number, baseMs = SAVE_RETRY_BASE_MS, maxMs = SAVE_RETRY_MAX_MS): number {
  return Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1));
}

/** Error codes no retry gets past. */
const FINAL_CODES = new Set(["FILE_NOT_FOUND", "NOT_TEXT_FILE", "KEEP_BESIDE_FAILED", "EACCES", "EPERM", "EROFS"]);
const FINAL_NAMES = new Set(["ConflictError", "VaultFileNotFoundError", "NotTextFileError", "KeepBesideFailedError"]);

/**
 * The same said in words, for an error that lost its class on the way — a
 * client window's save comes over the window bus as a message, a native write
 * as the operating system's text: "Permission denied (os error 13)" (Linux,
 * macOS), "Access is denied. (os error 5)" (Windows), "Read-only file system
 * (os error 30)".
 */
const FINAL_WORDS = [
  /\bpermission denied\b/i,
  /\baccess is denied\b/i,
  /\bread-only file system\b/i,
  /\boperation not permitted\b/i,
  /\(os error (?:1|5|13|30)\)/,
  /^File or directory not found: /,
  // ConflictAwareVaultAdapter's conflicts, as a client window hears them.
  /^Cannot automatically merge /,
  /\bconflict working copy\b/,
  /^Resolve the open conflict\b/,
];

/**
 * True when trying the save again cannot help:
 *  - a conflict: the text is already kept in a conflict copy, and every retry
 *    would write another one;
 *  - the file is gone (moved or deleted outside Plainva): a retry would make
 *    it again at its old place;
 *  - the file is no text any more, and no copy beside it could be written;
 *  - no right to write there, or a drive that is read-only: only the person
 *    can change that, so only their next keystroke or Ctrl+S tries again.
 */
export function isSaveFailureFinal(error: unknown): boolean {
  if (error === null || typeof error !== "object") return typeof error === "string" && FINAL_WORDS.some((words) => words.test(error));
  const known = error as { name?: unknown; code?: unknown; message?: unknown };
  if (typeof known.name === "string" && FINAL_NAMES.has(known.name)) return true;
  if (typeof known.code === "string" && FINAL_CODES.has(known.code)) return true;
  const message = typeof known.message === "string" ? known.message : "";
  return FINAL_WORDS.some((words) => words.test(message));
}
