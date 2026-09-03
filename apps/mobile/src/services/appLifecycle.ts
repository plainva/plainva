import { foregroundSync } from "./syncService";
import { pimForegroundSync } from "./pim/pimService";

/**
 * What the app does when it changes hands with the operating system.
 *
 * This lives outside `App.tsx` because it is a list that keeps growing: a phone
 * runs no timers in the background, so every cycle that would otherwise tick on
 * its own has to be caught up here. Each addition is one more line in a shell
 * file that is already at its structure budget — and, more to the point, each is
 * a behaviour worth naming rather than a detail of how the listener is wired.
 */

/**
 * Coming back to the front.
 *
 * Everything here answers the same question — what went stale while we were
 * away? — and every entry was added because something quietly did NOT happen:
 *
 * - the file sync, because remote files only arrive through a listing (2026-08-10);
 * - the PIM cycle, because it feeds the task mirror, which feeds the reminders,
 *   which is why a task created in Google Tasks took very long to show up and
 *   its reminder never arrived at all (finding D1, 2026-08-24);
 * - the scheduled archive, which is a CATCH-UP and not a clock (S36);
 * - the share target, because a warm share foregrounds the app (package J).
 */
export function onAppForeground(): void {
  foregroundSync();
  // Stufe F: the second of the phone's two moments. A remark that arrived while
  // the app was away is noticed on return - the parity catalogue says so
  // plainly rather than promising the desktop's near-immediacy.
  void import("./commentNotifier").then((m) => m.runMobileCommentNotifications()).catch(() => {});
  pimForegroundSync();
  // External vault folder (P5): somebody else may have written into the folder
  // while the app was away — the index is brought up to date on return.
  void import("./vaultService").then((m) => m.rescanExternalVaultOnResume()).catch(() => {});
  window.dispatchEvent(new CustomEvent("m-backup-due"));
  window.dispatchEvent(new CustomEvent("m-poll-share"));
}

/**
 * Going away.
 *
 * Android may kill the process without any further callback (M1), so both of
 * these are best-effort and must not depend on each other: pending editor saves
 * are flushed NOW, and pooled IMAP sessions are dropped because the OS suspends
 * their sockets — a resumed connection is dead without saying so, and reusing it
 * would hang the next mail action instead of failing fast (P7.3).
 */
export function onAppBackground(): void {
  void import("./vaultService")
    .then(({ noteSaver }) => noteSaver.flushAll())
    .catch(() => {});
  void import("@plainva/ui/mail")
    .then(({ releaseMailSessions }) => releaseMailSessions())
    .catch(() => {});
}
