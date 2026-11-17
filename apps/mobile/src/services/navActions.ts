import type { Dispatch, SetStateAction } from "react";
import { initialNavState, navTop, popTop, pushEntry, replaceTop, type NavEntry, type NavState, type TabScreenId } from "../navigation";
import { askBeforeLeaving } from "./leaveQuestion";
import { recallLastOpen, rememberLastOpen } from "@plainva/ui";
import { getMobileSettings } from "./mobileSettings";
import type { MobileVault } from "./vaultService";
import { markSessionReady, readNavState, restoreNavState } from "./sessionState";
import { loadMobileBar, shownBarTabs } from "./mobileBar";
import { getWindowClass, isRailClass } from "./windowClass";

/**
 * The ways a screen changes, in one place.
 *
 * They lived in the shell as three loose consts, which is how the mistake
 * behind #47 became possible: `pop` is the only one of them that is
 * ASYNCHRONOUS — it asks about unsaved input before it moves — and a caller
 * that wrote `pop(); push(...)` got the push first and the pop afterwards, so
 * the screen it had just opened was closed again. Standing next to each other,
 * with `replace` between them, the asymmetry is visible at the point where
 * someone would otherwise reinvent it.
 *
 * `push` and `replace` never ask: they move FORWARD, and a chooser has nothing
 * to discard. `pop` leaves a surface, so `pop` asks.
 *
 * `done` leaves too and does not ask (finding 2026-10-09): it is the exit a
 * surface takes ITSELF once its work is sent or saved. The mail composer used
 * to leave through `pop` after a send, with everything typed still standing in
 * its fields — so the shell asked whether to discard a message that was already
 * on its way, and "cancel" kept a composer open whose mail went out regardless.
 * The guard cannot tell the two leaves apart. The surface can, so it says which
 * one it means.
 */
export interface NavActions {
  /** Open a screen on top of the current one. */
  push: (entry: NavEntry) => void;
  /** Leave the current screen — asks first if it holds unsaved input. */
  pop: () => void;
  /**
   * Leave `entry` because its work is finished — never asks. Only that screen
   * goes (finding 2026-10-22, § 3.139): the exit comes after a send or a key
   * derivation, and by then something else may be on top — a message begun
   * meanwhile, which a plain pop took without a word. A screen that is no
   * longer on top stays where it is.
   */
  done: (entry: NavEntry) => void;
  /** Forward step that drops the current screen (a chooser hands over). */
  replace: (entry: NavEntry) => void;
}

export function createNavActions(
  setNav: Dispatch<SetStateAction<NavState>>,
  setBump: Dispatch<SetStateAction<number>>,
): NavActions {
  const leave = (entry?: NavEntry) => {
    setNav((s) => (entry === undefined || navTop(s) === entry ? popTop(s) : s));
    setBump((n) => n + 1);
  };
  return {
    push: (entry) => setNav((s) => pushEntry(s, entry)),
    replace: (entry) => setNav((s) => replaceTop(s, entry)),
    pop: () => {
      void askBeforeLeaving().then((ok) => {
        if (ok) leave();
      });
    },
    done: (entry) => leave(entry),
  };
}

/**
 * The restored session, with what was opened while it was read laid over it
 * (review of issue 173). The restore runs asynchronously at a cold start, and
 * whoever opened something meanwhile — a `plainva://open` link, a widget, a
 * reminder, a share, Siri, a comment notification, a tap in a list or on the
 * bar — keeps it where it was opened, on top of what comes back beneath it.
 * What the app laid on top by itself (an overlay, such as the next step of a
 * connect run the system interrupted) stays on top. One rule at the root, so
 * no entry point has to remember anything, and a new one cannot forget it.
 *
 * `start` is the navigation when the restore began, `visible` the bar's tabs.
 * A tab switched to meanwhile stays the active tab, as it was left. The bar
 * adoption beside the restore may move the tab off one the bar no longer
 * shows; that move is the app's, not a choice, and the restored tab wins.
 */
export function withOpenedMeanwhile(restored: NavState, current: NavState, start: NavState, visible: readonly TabScreenId[]): NavState {
  const forced = !visible.includes(start.activeTab) && current.activeTab === visible[0];
  const switched = current.activeTab !== start.activeTab && !forced;
  const openedIn = (tab: TabScreenId) => current.stacks[tab].filter((entry) => !start.stacks[tab].includes(entry));
  const stacks = { ...restored.stacks };
  for (const tab of Object.keys(current.stacks) as TabScreenId[]) {
    if (switched && tab === current.activeTab) stacks[tab] = current.stacks[tab];
    else if (openedIn(tab).length > 0) stacks[tab] = [...restored.stacks[tab], ...openedIn(tab)];
  }
  const activeTab = switched || openedIn(current.activeTab).length > 0 ? current.activeTab : restored.activeTab;
  return { activeTab, stacks, overlay: [...restored.overlay, ...current.overlay] };
}

/**
 * Pick up where you stopped (feedback round 2026-09-01, T6): the note that
 * was open when the app was left comes back on top of the home tab at the
 * next cold start — provided it still exists. A vault switch deliberately
 * starts at the top; only the boot calls this. Lives with the other
 * navigation actions because App.tsx sits under a structural ratchet: the
 * shell routes, it does not remember.
 */
export async function restoreLastOpenNote(
  vault: MobileVault,
  setNav: Dispatch<SetStateAction<NavState>>,
  start: NavState,
  visible: readonly TabScreenId[],
): Promise<void> {
  const last = recallLastOpen(vault.vaultId);
  if (!last) return;
  try {
    // A database is remembered too since P6 — it opens as what it is.
    const kind = /\.base$/i.test(last) ? "base" : "note";
    if (await vault.files.exists(last)) {
      const restored = pushEntry(initialNavState(start.activeTab), { kind, path: last });
      setNav((st) => withOpenedMeanwhile(restored, st, start, visible));
    }
    else rememberLastOpen(vault.vaultId, null);
  } catch {
    /* the note stays where it is; nothing to restore */
  }
}

/**
 * Boots into the navigation the user left (Build-91 feedback, P6): the stored
 * stacks, minus surfaces that carry unfinished input and entries whose file
 * is gone, with the active tab kept inside the bar — the bar is read here,
 * from the vault's own record, so the restore neither closes over the shell's
 * state nor races the bar adoption that runs beside it. A stored session
 * from which nothing survives (left on Home, the note is gone) starts on
 * Home; only without any stored session — a first start — is the last-note
 * memory (T6) the fallback (issue 173). Marks the session ready first, so the boot's initial state
 * never overwrites what is about to be restored.
 */
export async function restoreSession(
  vault: MobileVault,
  setNav: Dispatch<SetStateAction<NavState>>,
  start: NavState,
): Promise<void> {
  const stored = readNavState(vault.vaultId);
  markSessionReady(vault.vaultId);
  const visible: TabScreenId[] = shownBarTabs(await loadMobileBar(vault.vaultId), isRailClass(getWindowClass()));
  // "On start: Home" (plan 2026-11-05, P10): nothing comes back, the app opens
  // on Home. The session is still marked ready above, so it keeps being saved
  // and "As you left it" finds what was open when the app was last left.
  if (getMobileSettings().startView === "fresh") {
    if (visible.includes("notes")) setNav((s) => withOpenedMeanwhile(initialNavState("notes"), s, start, visible));
    return;
  }
  if (stored) {
    const next = await restoreNavState(stored, { exists: (p) => vault.files.exists(p), visible }).catch(() => /* silent: a reading; the start screen is the default below */ null);
    // A stored session is what was left, even when nothing of it needs
    // restoring: left on Home, or the note left open is gone. It then starts
    // on this vault's Home — never on the note opened last (issue 173).
    const restored = next ?? initialNavState(visible[0] ?? "notes");
    setNav((s) => withOpenedMeanwhile(restored, s, start, visible));
    return;
  }
  // No session stored at all (a first start, or a build before P6): the
  // last-note memory (T6) is the only trace of where the app was left.
  await restoreLastOpenNote(vault, setNav, start, visible);
}
