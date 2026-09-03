import type { Dispatch, SetStateAction } from "react";
import { popTop, pushEntry, replaceTop, type NavEntry, type NavState } from "../navigation";
import { askBeforeLeaving } from "./leaveQuestion";
import { recallLastOpen, rememberLastOpen } from "@plainva/ui";
import type { MobileVault } from "./vaultService";

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
  setNav: Dispatch<SetStateAction<NavState>>
): Promise<void> {
  const last = recallLastOpen(vault.vaultId);
  if (!last) return;
  try {
    if (await vault.files.exists(last)) setNav((st) => pushEntry(st, { kind: "note", path: last }));
    else rememberLastOpen(vault.vaultId, null);
  } catch {
    /* the note stays where it is; nothing to restore */
  }
}
