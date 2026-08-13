import { FatalSyncProtocolError } from "../settingsSync/errors.js";

/**
 * Is a failure worth waiting out, or is it an answer? (mobile round 3.)
 *
 * Lives on its own since N1/S2, because the PIM worker needs the same
 * question. It used to sit inside `SyncWorker`, and the calendar side had no
 * classification at all: every throw became a string beside the account, so a
 * revoked sign-in and a dropped request looked identical — and a dead account
 * kept spending a network round every cycle, forever. Two classifiers would
 * have drifted; one is the point of this file.
 *
 * `SyncWorker` re-exports both symbols, so every existing import keeps working.
 */

/** Never let an empty WebView/native rejection degrade into a blank dialog. */
export function syncErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (typeof error === "string" && error.trim()) return error.trim();
  if (error && typeof error === "object") {
    const code = String((error as { code?: unknown }).code ?? "").trim();
    const message = String((error as { message?: unknown }).message ?? "").trim();
    if (code && message) return `${code}: ${message}`;
    if (message || code) return message || code;
  }
  return "Sync failed without error details; Plainva will retry automatically.";
}

/** A failure that the next attempt can plausibly survive, or one that needs a
 * human. See `classifySyncError`. */
export type SyncErrorKind = "transient" | "fatal";

/**
 * Is this failure worth waiting out, or is it an answer?
 *
 * Until round 3 of the mobile rework the worker had no such question: EVERY
 * throw became the state `error` with the raw provider string beside it. A
 * phone changes network constantly, so a dropped request, a 503 or a token
 * refresh caught mid-rotation produced the same red message as a revoked
 * account — and because the backoff retries within five minutes, the message
 * was usually gone by the time anyone looked. What the maintainer reported was
 * not a Drive fault; it was Plainva treating the first failed attempt as a
 * final result.
 *
 * Deliberately conservative: anything not recognised as temporary counts as
 * fatal, so a genuinely broken connection is never hidden behind "retrying".
 * The one thing this must never do is stay quiet about a revoked access.
 */
export function classifySyncError(error: unknown): SyncErrorKind {
  // A protocol/manifest refusal is the definition of "needs a human".
  if (error instanceof FatalSyncProtocolError) return "fatal";

  const name = error instanceof Error ? error.name : "";
  const text = syncErrorMessage(error).toLowerCase();

  // Authentication is fatal even when it arrives wrapped in a 5xx-looking
  // sentence: `invalid_grant` means the refresh token is gone for good.
  if (/invalid[_ -]?grant|token.*(?:revoked|expired)|unauthori[sz]ed/.test(text)) return "fatal";

  // An explicit status wins over any wording. `status` is what a thrown
  // Response-like error carries; the providers also put the code in the text.
  const status =
    typeof (error as { status?: unknown })?.status === "number"
      ? ((error as { status: number }).status)
      : Number(/\b(4\d\d|5\d\d)\b/.exec(text)?.[1] ?? NaN);
  if (Number.isFinite(status)) {
    if (status === 408 || status === 429 || (status >= 500 && status <= 599)) return "transient";
    return "fatal";
  }

  if (name === "AbortError" || name === "TimeoutError") return "transient";
  return /timed out|timeout|abort|network|offline|failed to fetch|load failed|connection|socket|dns|econn|enotfound|etimedout|eai_again|temporarily/.test(
    text,
  )
    ? "transient"
    : "fatal";
}

/**
 * Consecutive temporary failures before the worker stops calling it temporary
 * (maintainer decision E4, round 3): roughly ten minutes of quiet self-healing
 * on the mobile backoff before anyone is bothered.
 */
