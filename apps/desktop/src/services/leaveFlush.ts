import { flushDrafts } from "./draftJournal";
import { flushWindowDrafts } from "./windowDraftFlush";

/**
 * The central window's way out (A7): before it closes, or the app quits — its
 * close button, Cmd+Q, "Quit" in the tray, the last window closing — the
 * native side holds the step for a moment and says so (`plainva-leaving`,
 * `src-tauri/src/leave.rs`). What every window's editors typed since the last
 * snapshot is written into the draft journal then, and the native side is told
 * it may go on (`leave_ready`). It goes on after its own deadline as well:
 * nothing here can keep the app from closing.
 *
 * Hiding into the tray is not a way out and does not come here: the window
 * and its timers live on, and its saves run as always.
 */

/** Writes what this window and every other one still buffer. Bounded by the writers' own waits. */
export async function flushAllDraftsBeforeLeaving(): Promise<void> {
  await Promise.all([
    flushDrafts().catch(() => {
      // silent: the app is going; the journal's own writes report their failures, and nobody is left to tell.
    }),
    flushWindowDrafts(null).catch(() => {
      // silent: the app is going; a window that cannot be reached cannot be helped.
    }),
  ]);
}

/** Installed once in the central window; the returned function takes the listener out. */
export async function installLeaveFlush(): Promise<() => void> {
  const [{ listen }, { invoke }] = await Promise.all([import("@tauri-apps/api/event"), import("@tauri-apps/api/core")]);
  return listen("plainva-leaving", () => {
    void flushAllDraftsBeforeLeaving()
      .finally(() => invoke("leave_ready"))
      .catch(() => {
        // silent: without the answer the native side goes on after its deadline (src-tauri/src/leave.rs).
      });
  });
}
