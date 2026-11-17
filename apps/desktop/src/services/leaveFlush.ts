import { settleBeforeLeaving } from "./beforeLeaving";
import { flushWindowDrafts } from "./windowDraftFlush";
import { windowsStillHoldingWork } from "./windowManager";

/**
 * The windows' part of the way out (A7, A2, A3).
 *
 * Before the central window closes or the app quits — its close button, "Quit"
 * in the tray or the macOS menu (Cmd+Q), the last window closing, a
 * termination signal — the native side holds the step and says so
 * (`plainva-leaving`, `src-tauri/src/leave.rs`). The central window then asks:
 *
 *  - does a window hold a mail or a remark not sent? Then that window comes to
 *    the front and asks its question, as when it is closed by itself, and the
 *    app stays (`leave_ready` with `stay`); quitting again goes on from there;
 *  - otherwise every window leaves its field in progress, saves what its
 *    editors hold, writes its journal, and waits for its writes
 *    (`beforeLeaving.ts`), and the native side is told it may go on.
 *
 * It goes on after its own deadline as well: nothing here can keep the app
 * from closing. It holds only once this window said it listens
 * (`leave_armed`): a start that failed or is not finished closes at once.
 *
 * Hiding into the tray is not a way out and does not come here: the window
 * and its timers live on, and its saves run as always.
 */

/** Every window's part, this one's and the others'. Bounded by the windows' own waits. */
export async function settleEveryWindowBeforeLeaving(): Promise<void> {
  await Promise.all([
    settleBeforeLeaving().catch(() => {
      // silent: the app is going; each write reports its own failure, and nobody is left to tell.
    }),
    flushWindowDrafts(null).catch(() => {
      // silent: the app is going; a window that cannot be reached cannot be helped.
    }),
  ]);
}

/** The central window's answer: true when the app stays, because a window asks its question. */
export async function leaveOrStay(): Promise<boolean> {
  if (await windowsStillHoldingWork()) return true;
  await settleEveryWindowBeforeLeaving();
  return false;
}

/** Installed once in the central window; the returned function takes the listener out. */
export async function installLeaveFlush(): Promise<() => void> {
  const [{ listen }, { invoke }] = await Promise.all([import("@tauri-apps/api/event"), import("@tauri-apps/api/core")]);
  const unlisten = await listen("plainva-leaving", () => {
    void leaveOrStay()
      .catch(() => false)
      .then((stay) => invoke("leave_ready", { stay }))
      .catch(() => {
        // silent: without the answer the native side goes on after its deadline (src-tauri/src/leave.rs).
      });
  });
  await invoke("leave_armed", { armed: true }).catch(() => {
    // silent: unarmed, the way out goes at once, as before 2026-11-16.
  });
  return () => {
    unlisten();
    void invoke("leave_armed", { armed: false }).catch(() => {
      // silent: the page is going; the native side disarms when the next one loads.
    });
  };
}
