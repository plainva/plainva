import { buildAppCommands, type AppCommand, type CommandDeps } from "@plainva/ui";

/**
 * What the phone can actually do, expressed as command deps (S15).
 *
 * The registry is the desktop's, shared since S15 — the phone does not get a
 * second list, it gets the same one with the handlers it can serve. Everything
 * it cannot serve is simply absent: `split` needs two panes, the sidebar
 * toggles need sidebars, tabs need a tab strip. A command that appears and
 * does nothing is worse than one that is honestly not offered, and the drift
 * guard on the desktop side makes sure the absence stays deliberate.
 *
 * This module is the ONE place that says what the phone leaves out, with the
 * reason next to it — instead of the answer being spread over a palette
 * component, a shortcut table and a menu.
 */
export interface MobileCommandHost {
  newNote: () => void;
  newFromTemplate: () => void;
  newFolder: () => void;
  newDatabase: () => void;
  openDaily: () => void;
  openSearch: () => void;
  openGraph: () => void;
  openTasks: () => void;
  openCalendar: () => void;
  openMail: () => void;
  openSettings: () => void;
  switchVault: () => void;
  refreshVault: () => void;
  /** The open note, or null — gates the note-scoped commands. */
  activeNote: () => string | null;
  renameActive: () => void;
  toggleReadEdit: () => void;
  shareActive: () => void;
}

export function buildMobileCommands(h: MobileCommandHost): AppCommand[] {
  const deps: CommandDeps = {
    newItem: (kind, opts) => {
      if (kind === "folder") h.newFolder();
      else if (kind === "base") h.newDatabase();
      else if (opts?.fromTemplate) h.newFromTemplate();
      else h.newNote();
    },
    openDailyNote: h.openDaily,
    // The phone's file opener IS the search surface (S16 gives it the
    // quick-switcher behaviour); one door, not two.
    openQuickSwitcher: h.openSearch,
    openGraph: h.openGraph,
    openTasks: h.openTasks,
    openCalendar: h.openCalendar,
    openMail: h.openMail,
    openSettings: h.openSettings,
    switchVault: h.switchVault,
    refreshVault: h.refreshVault,
    renameActive: h.renameActive,
    toggleReadEdit: h.toggleReadEdit,
    // Sharing is the phone's export: the OS sheet reaches every app.
    exportActiveMarkdown: h.shareActive,
    activePath: h.activeNote,
    canPrint: () => h.activeNote() !== null,
    // Deliberately absent, each for a structural reason:
    //   split / sidebar toggles / focus mode — no panes, no sidebars.
    //   close+reopen tab — no tab strip.
    //   print — no print dialog in the WebView (share carries the note out).
    //   theme toggle — Appearance owns it; a second switch would drift.
    //   version history, backup, index maintenance, find & replace, import —
    //     these have surfaces of their own and come with P4/P8/P10.
  };
  return buildAppCommands(deps);
}
