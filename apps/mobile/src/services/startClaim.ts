/**
 * Whether a person or the outside has navigated since the app started: a
 * `plainva://open` link, a widget, a reminder, a share, a launcher shortcut,
 * a tap on the bar. The session is restored asynchronously at a cold start,
 * and what was opened that way meanwhile wins over every branch of the
 * restore (review of issue 173, `restoreSession` in navActions).
 *
 * Deliberately a mark set by those entry points, not a look at the state: a
 * screen the APP opens at the cold start — the next step of a connect run the
 * system interrupted — is no claim. It stays on top of the restored session,
 * and the session comes back beneath it.
 */
let claimed = false;

/** Called by every entry point of a person or the outside that navigates. */
export function claimStart(): void {
  claimed = true;
}

export function startClaimed(): boolean {
  return claimed;
}

/** Tests only: a fresh process. */
export function __resetStartClaimForTest(): void {
  claimed = false;
}
