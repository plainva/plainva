/**
 * What a shell shows when the app starts (plan Rückmeldungen 2026-11-05, P10;
 * TestFlight wish of 2026-11-01). A per-device choice in both shells:
 *
 * - `restore` — as you left it (the behaviour until now, and the default):
 *   the desktop reopens its tabs, the phone its area and note.
 * - `fresh` — the desktop starts with an empty workspace (window size and
 *   sidebars stay), the phone on Home.
 *
 * It only decides WHAT opens, never how the start runs: the vault opens the
 * same way either way, and what is open keeps being saved, so switching back
 * to `restore` reopens what was open when the app was last left.
 */
export type StartView = "restore" | "fresh";

export const START_VIEWS: readonly StartView[] = ["restore", "fresh"];

/** Anything stored that is not a known value reads as the default. */
export function parseStartView(value: unknown): StartView {
  return value === "fresh" ? "fresh" : "restore";
}

/** The label key of a choice in a shell: the phone says Home, the desktop an empty workspace. */
export function startViewLabelKey(view: StartView, shell: "desktop" | "mobile"): string {
  if (view === "restore") return "settings.startViewRestore";
  return shell === "mobile" ? "mobile.tabHome" : "settings.startViewEmpty";
}
