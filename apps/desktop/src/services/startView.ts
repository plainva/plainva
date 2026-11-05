import { parseStartView, type StartView } from "@plainva/ui";

/**
 * "On start" on the desktop (plan 2026-11-05, P10): as you left it, or an
 * empty workspace. Device-local, so it lives in this machine's storage, and
 * read synchronously, because the pane layout asks it while it hydrates.
 */
export const START_VIEW_KEY = "plainva-start-view";

export function getStartView(): StartView {
  try {
    return parseStartView(localStorage.getItem(START_VIEW_KEY));
  } catch {
    return "restore";
  }
}

export function setStartView(view: StartView): void {
  try {
    localStorage.setItem(START_VIEW_KEY, view);
  } catch {
    /* quota — the choice stays for this run only */
  }
}

/*
 * The empty workspace belongs to the START, not to every vault the window
 * opens later: switching vaults keeps reopening that vault's tabs. So the main
 * window skips its restore until its first hydrate has gone through once.
 */
let firstHydrateDone = false;

/** Whether this hydrate of the main window starts without its stored tabs. */
export function startsEmpty(scope: string | null | undefined): boolean {
  if (scope) return false;
  return !firstHydrateDone && getStartView() === "fresh";
}

/** Called once the main window's first hydrate has landed (not when it was cancelled). */
export function markFirstHydrate(scope: string | null | undefined): void {
  if (!scope) firstHydrateDone = true;
}

/** Test seam: a new app start. */
export function resetStartForTests(): void {
  firstHydrateDone = false;
}
