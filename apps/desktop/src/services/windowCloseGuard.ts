import { getWindowBus } from "./windowBus";
import { currentWindowParams, isOwnerWindow } from "./windowContext";

/**
 * Unsaved work that a closing window would take with it (finding 2026-10-09).
 *
 * The message composer asks before a changed draft is discarded — on Escape, on
 * its close button, on "Cancel". A composer in a window of its own has a fourth
 * way out, and so has every other client window that holds a floating one: the
 * window itself is closed, by its frame, Alt+F4 or Cmd/Ctrl+W. That close is
 * not this window's to decide. The central window created it and is the one
 * that destroys it (`openAuxWindow`), so a surface that holds unsaved work says
 * so HERE, and this module keeps the central window informed:
 *
 *  - while something is held, the central window knows (`window-close-hold`);
 *  - when a close is asked for, the central window asks back
 *    (`close-requested`) and this window answers with what is true right now,
 *    then puts the question to the person;
 *  - "discard" lets the window go and closes it; "cancel" leaves it open with
 *    everything in it.
 *
 * Two things this deliberately does not promise. A window that never said it
 * holds anything closes exactly as before — the central window does not ask
 * it, so a window that is still loading, or whose report has not arrived, goes
 * the old way. And a window that said so and then does not answer — it hung,
 * or it is gone — is closed after a short wait, so nothing here can leave a
 * window that cannot be closed.
 *
 * The central window itself is not covered. Nobody created it and nobody is
 * asked when it closes: that is the app's own way out (or, with a tray icon, a
 * hide that loses nothing), and that way has no question on the phone either.
 */

/** Puts the question to the person. Resolves true once the work may go. */
export type CloseQuestion = () => Promise<boolean>;

/** How long a window that is closing itself waits for the central window to hear that it let go. */
const LET_GO_WAIT_MS = 1_000;

const held = new Set<CloseQuestion>();
/** Set once the window may go for good: its work was sent, filed or given up. */
let released = false;
let asking = false;
let listener: Promise<void> | null = null;

const holdsWork = () => !released && held.size > 0;

/**
 * Tells the central window what is true NOW. Reports are sent as they are
 * made and in that order — not one after the other's answer: a draft that goes
 * back to untouched and is changed again within the time the central window
 * needs to answer must not be known there by its older state.
 */
function report(): Promise<void> {
  if (!currentWindowParams().label) return Promise.resolve();
  const now = holdsWork();
  return (async () => {
    try {
      const bus = await getWindowBus();
      await bus.request("window-close-hold", { held: now });
    } catch {
      // No central window listening: this window then closes as it always has.
    }
  })();
}

async function closeThisWindow(): Promise<void> {
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().close();
  } catch {
    /* browser/test: there is no OS window to close */
  }
}

/** A close was asked for while this window had said it holds unsaved work. */
async function onCloseRequested(): Promise<void> {
  // The answer first: the central window waits for it before it decides.
  void report();
  if (!holdsWork() || asking) return;
  asking = true;
  try {
    for (const question of [...held]) {
      if (!(await question())) return;
    }
  } finally {
    asking = false;
  }
  released = true;
  // Heard first, closed second: the close then meets a central window that
  // knows, and goes through without another round. Not waited for longer than
  // a moment — if the answer is slow, the close asks back and gets "let go".
  await Promise.race([report(), new Promise((resolve) => setTimeout(resolve, LET_GO_WAIT_MS))]);
  await closeThisWindow();
}

function ensureListener(label: string): void {
  listener ??= (async () => {
    try {
      const bus = await getWindowBus();
      await bus.onBroadcast("close-requested", (payload) => {
        if (payload.label === label) void onCloseRequested();
      });
    } catch {
      // No bus (browser, test): nobody will ask, and nobody needs an answer.
      listener = null;
    }
  })();
}

/**
 * Declares that this window holds work a close would lose, for as long as the
 * returned function has not been called. `question` is what the person is asked
 * when the window is about to close.
 *
 * Follows the phone's leave guard in spirit: a surface arms it while its work
 * is unsaved and disarms it the moment it is not — so an untouched surface
 * never asks.
 */
export function holdWindowClose(question: CloseQuestion): () => void {
  // The central window is never asked (see the head of this file).
  if (isOwnerWindow()) return () => {};
  const label = currentWindowParams().label;
  if (!label) return () => {};
  ensureListener(label);
  held.add(question);
  if (held.size === 1) void report();
  return () => {
    if (held.delete(question) && held.size === 0) void report();
  };
}

/**
 * The window is done with its work — the message was sent or filed, or the
 * person said to discard it — and closes next. From here on it does not ask
 * again: a sent message would otherwise be asked about as a discarded one, with
 * everything typed still standing in its fields.
 */
export function releaseWindowClose(): void {
  if (released) return;
  released = true;
  if (held.size > 0) void report();
}

/** Test seam — the app never resets this. */
export function resetWindowCloseGuardForTest(): void {
  held.clear();
  released = false;
  asking = false;
  listener = null;
}
