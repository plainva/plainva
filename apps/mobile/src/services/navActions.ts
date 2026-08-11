import type { Dispatch, SetStateAction } from "react";
import { popTop, pushEntry, replaceTop, type NavEntry, type NavState } from "../navigation";
import { askBeforeLeaving } from "./leaveQuestion";

/**
 * The three ways a screen changes, in one place.
 *
 * They lived in the shell as three loose consts, which is how the mistake
 * behind #47 became possible: `pop` is the only one of the three that is
 * ASYNCHRONOUS — it asks about unsaved input before it moves — and a caller
 * that wrote `pop(); push(...)` got the push first and the pop afterwards, so
 * the screen it had just opened was closed again. Standing next to each other,
 * with `replace` between them, the asymmetry is visible at the point where
 * someone would otherwise reinvent it.
 *
 * `push` and `replace` never ask: they move FORWARD, and a chooser has nothing
 * to discard. Only `pop` leaves a surface, so only `pop` asks.
 */
export interface NavActions {
  /** Open a screen on top of the current one. */
  push: (entry: NavEntry) => void;
  /** Leave the current screen — asks first if it holds unsaved input. */
  pop: () => void;
  /** Forward step that drops the current screen (a chooser hands over). */
  replace: (entry: NavEntry) => void;
}

export function createNavActions(
  setNav: Dispatch<SetStateAction<NavState>>,
  setBump: Dispatch<SetStateAction<number>>,
): NavActions {
  return {
    push: (entry) => setNav((s) => pushEntry(s, entry)),
    replace: (entry) => setNav((s) => replaceTop(s, entry)),
    pop: () => {
      void askBeforeLeaving().then((ok) => {
        if (!ok) return;
        setNav(popTop);
        setBump((n) => n + 1);
      });
    },
  };
}
