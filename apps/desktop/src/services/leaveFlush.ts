import { settleBeforeLeaving } from "./beforeLeaving";
import { flushWindowDrafts } from "./windowDraftFlush";
import { windowsStillHoldingWork } from "./windowManager";
import { askHeldWork, holdsUnsavedWork } from "./windowCloseGuard";
import { toast } from "@plainva/ui";
import i18n from "@plainva/ui/i18n";

/**
 * The windows' part of the way out (A7, A2, A3).
 *
 * Before the central window closes or the app quits — its close button, "Quit"
 * in the tray or the macOS menu (Cmd+Q), the last window closing, a
 * termination signal — the native side holds the step and says so
 * (`plainva-leaving`, `src-tauri/src/leave.rs`). The central window then asks:
 *
 *  - does a window hold a mail or a remark not sent — this one or another?
 *    Then that window comes to the front and asks its question, as when it is
 *    closed by itself, and the app stays (`leave_ready` with `stay`). Another
 *    window that lets its work go closes; quitting again goes on from there.
 *    This window, which is the app, quits once the person let its work go;
 *  - otherwise every window leaves its field in progress, saves what its
 *    editors hold, writes its journal, and waits for its writes
 *    (`beforeLeaving.ts`), and the native side is told it may go on.
 *
 * A termination signal (`kill`, the session ending) does not ask: nobody may
 * be there to answer. The native side says so (`mayStay: false`), every window
 * writes what it holds, and the app goes.
 *
 * It goes on after its own deadline as well: nothing here can keep the app
 * from closing. It holds only while this window says it listens
 * (`leave_armed`): a start that failed or is not finished closes at once.
 *
 * Hiding into the tray is not a way out and does not come here: the window
 * and its timers live on, and its saves run as always.
 */

/**
 * How long this window's writes are waited for on the way out: inside the
 * native side's deadline (`LEAVE_WAIT`, 5 s), which also covers asking the
 * other windows (2 s at most).
 */
export const LEAVE_SETTLE_MS = 2_500;

/** Every window's part, this one's and the others'. True when every window was done in time. */
export async function settleEveryWindowBeforeLeaving(limitMs: number = LEAVE_SETTLE_MS): Promise<boolean> {
  const [own, others] = await Promise.all([
    settleBeforeLeaving(limitMs).catch(() => {
      // silent: the app is going; each write reports its own failure, and nobody is left to tell.
      return "settled" as const;
    }),
    flushWindowDrafts(null).catch(() => {
      // silent: the app is going; a window that cannot be reached cannot be helped.
      return false;
    }),
  ]);
  return own === "settled" && others;
}

/**
 * Set when the person let this window's work go for the app to quit: the way
 * out that follows at once does not ask again. Used up by that way out, whether
 * the app then goes or stays — a way out after that asks about what is there
 * then.
 */
let letGo = false;

/** Asks this window's own questions; quits once the person let the work go. */
function askHereThenQuit(): void {
  void askHeldWork()
    .then(async (mayGo) => {
      if (!mayGo) return;
      letGo = true;
      const { exit } = await import("@tauri-apps/plugin-process");
      await exit(0);
    })
    .catch(() => {
      // silent: the question failed; the app stays open, and quitting again asks again.
    });
}

/** What the central window answers the native side. */
export interface LeaveAnswer {
  /** A window asks its question: the app stays. */
  stay: boolean;
  /** The app goes although a window was not done in time: said at the next start. */
  cut: boolean;
}

/**
 * The central window's answer: the app stays when a window asks its question.
 * `mayStay` is false for a termination signal: nobody is asked.
 */
export async function leaveOrStay(mayStay = true): Promise<LeaveAnswer> {
  const askedHere = letGo;
  letGo = false;
  if (mayStay) {
    if (!askedHere && holdsUnsavedWork()) {
      askHereThenQuit();
      return { stay: true, cut: false };
    }
    if (await windowsStillHoldingWork()) return { stay: true, cut: false };
  }
  return { stay: false, cut: !(await settleEveryWindowBeforeLeaving()) };
}

/**
 * How many times this window listens. React's Strict Mode installs, takes out
 * and installs again; the native side must hear the count's last word, so
 * what it is told goes out in order and says what holds when it goes.
 */
let listening = 0;
let telling: Promise<unknown> = Promise.resolve();

function tellArmed(invoke: (cmd: string, args: Record<string, unknown>) => Promise<unknown>): void {
  telling = telling.then(() =>
    invoke("leave_armed", { armed: listening > 0 }).catch(() => {
      // silent: unarmed, the way out goes at once, as before 2026-11-16.
    }),
  );
}

/** Asked once per start: did the last way out run past its deadline? Then the person is told. */
let cutAsked = false;

function tellIfLastWayOutWasCut(invoke: (cmd: string) => Promise<unknown>): void {
  if (cutAsked) return;
  cutAsked = true;
  void invoke("leave_was_cut")
    .then((cut) => {
      if (cut === true) toast.warning(i18n.t("window.closedBeforeSaved"));
    })
    .catch(() => {
      // silent: an older native side does not know the command; nothing to tell then.
    });
}

/** Installed once in the central window; the returned function takes the listener out. */
export async function installLeaveFlush(): Promise<() => void> {
  const [{ listen }, { invoke }] = await Promise.all([import("@tauri-apps/api/event"), import("@tauri-apps/api/core")]);
  const unlisten = await listen<{ mayStay?: boolean } | null>("plainva-leaving", (event) => {
    const mayStay = event?.payload?.mayStay !== false;
    void leaveOrStay(mayStay)
      .catch((): LeaveAnswer => ({ stay: false, cut: true }))
      .then(({ stay, cut }) => invoke("leave_ready", { stay, cut }))
      .catch(() => {
        // silent: without the answer the native side goes on after its deadline (src-tauri/src/leave.rs).
      });
  });
  listening += 1;
  tellArmed(invoke);
  tellIfLastWayOutWasCut(invoke);
  let out = false;
  return () => {
    if (out) return;
    out = true;
    unlisten();
    listening -= 1;
    tellArmed(invoke);
  };
}

/** Test seam — the app never resets this. */
export function resetLeaveFlushForTest(): void {
  letGo = false;
  cutAsked = false;
  listening = 0;
  telling = Promise.resolve();
}
