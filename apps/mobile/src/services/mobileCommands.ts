import { buildAppCommands, type AiSkillId, type AppCommand, type CommandDeps } from "@plainva/ui";

/**
 * What the phone can actually do, expressed as command deps (S15).
 *
 * The registry is the desktop's, shared since S15 — the phone does not get a
 * second list, it gets the same one with the handlers it can serve. Everything
 * it cannot serve is simply absent: `split` needs two panes, the sidebar
 * toggles need sidebars, tabs need a tab strip. A command that appears and
 * does nothing is worse than one that is honestly not offered, and the drift
 * guard beside this module (mobileCommands.test.ts) makes sure the absence
 * stays deliberate.
 *
 * This module is the ONE place that says what the phone leaves out
 * (`MOBILE_ABSENT_COMMANDS`, with the catalog entry that gives the reason) —
 * instead of the answer being spread over a palette component, a shortcut
 * table and a menu.
 */
export interface MobileCommandHost {
  newNote: () => void;
  newFromTemplate: () => void;
  newFolder: () => void;
  newDatabase: () => void;
  openDaily: () => void;
  /** A term and a task from anywhere (Design-Runde E4): the shell opens the view and parks the request. */
  newEvent?: () => void;
  newTask?: () => void;
  /** The capture sheet on its journal kind, and the journal screen (plan Journal, J4/J5). */
  newJournalEntry?: () => void;
  openJournal?: () => void;
  /** The KI sheet (plan KI-Harness P1a); absent while the per-device switch is off. */
  openAi?: () => void;
  /** A core skill in a new conversation, on the KI sheet over the open note (plan P1.5). */
  runAiSkill?: (id: AiSkillId) => void;
  openSearch: () => void;
  openFindReplace: () => void;
  openGraph: () => void;
  openTasks: () => void;
  openCalendar: () => void;
  openMail: () => void;
  openSettings: () => void;
  switchVault: () => void;
  refreshVault: () => void;
  /** The open note, or null — gates the note-scoped commands. */
  activeNote: () => string | null;
  /**
   * The note-scoped actions. Each defaults to the window event the open note
   * already listens for, so the shell does not carry a second copy of the
   * event names — they are not app state, they are this module's contract with
   * the note screen.
   */
  renameActive?: () => void;
  toggleReadEdit?: () => void;
  exportActive?: () => void;
}

/** Fires the event the open note listens for. */
const noteEvent = (name: string) => () => window.dispatchEvent(new CustomEvent(name));

export function buildMobileCommands(h: MobileCommandHost): AppCommand[] {
  const deps: CommandDeps = {
    newItem: (kind, opts) => {
      if (kind === "folder") h.newFolder();
      else if (kind === "base") h.newDatabase();
      else if (opts?.fromTemplate) h.newFromTemplate();
      else h.newNote();
    },
    openDailyNote: h.openDaily,
    newEvent: h.newEvent,
    newTask: h.newTask,
    newJournalEntry: h.newJournalEntry,
    openJournal: h.openJournal,
    openAi: h.openAi,
    runAiSkill: h.runAiSkill,
    // The phone's file opener IS the search surface (S16 gives it the
    // quick-switcher behaviour); one door, not two.
    openQuickSwitcher: h.openSearch,
    openFindReplace: h.openFindReplace,
    openGraph: h.openGraph,
    openTasks: h.openTasks,
    openCalendar: h.openCalendar,
    openMail: h.openMail,
    openSettings: h.openSettings,
    switchVault: h.switchVault,
    refreshVault: h.refreshVault,
    renameActive: h.renameActive ?? noteEvent("m-note-rename"),
    toggleReadEdit: h.toggleReadEdit ?? noteEvent("m-note-toggle-edit"),
    // Points at the FILE export, not at sharing the text (fixed 2026-08-20 —
    // it mapped to shareActive, so the command named "export as Markdown"
    // handed out plain text that cannot be reopened as the note).
    exportActiveMarkdown: h.exportActive ?? noteEvent("m-note-export"),
    activePath: h.activeNote,
    // Gates every note-scoped command, not just print (renamed 2026-08-20 —
    // as `canPrint` it read like a print flag on a shell that cannot print,
    // and was written down as dead. Read/edit and the Markdown export hang
    // off it here).
    hasActiveNote: () => h.activeNote() !== null,
    // Everything else is absent on purpose, and MOBILE_ABSENT_COMMANDS below
    // names each command with the catalog entry that says why. (Sharing the
    // note as text was supplied here once and never read — the note screen
    // has its own share action; removed 2026-08-21.)
  };
  return buildAppCommands(deps);
}

/**
 * Every registry command the phone leaves out, and the parity-catalog entry
 * (packages/ui/src/lib/featureParity.ts) that says why. The reason lives in
 * the catalog, once, next to every other asymmetry — not here as well.
 *
 * mobileCommands.test.ts holds this table against the registry and against
 * the wiring in App.tsx, both ways: a command the registry gains is offered
 * on the phone or named here, and a command named here that the phone starts
 * to offer loses its line. Until 2026-09-24 the answer was a comment that
 * named 14 of the 26 and a test that pinned five.
 */
export const MOBILE_ABSENT_COMMANDS: Readonly<Record<string, string>> = {
  // The desktop's window furniture: panes, sidebars, tabs, OS windows.
  "split-vertical": "split-editor",
  "split-horizontal": "split-editor",
  "toggle-left-sidebar": "side-panels",
  "toggle-right-sidebar": "side-panels",
  "focus-mode": "reader-chrome-auto-hide",
  "close-tab": "editor-tabs",
  "reopen-tab": "editor-tabs",
  "open-comms-window": "multi-window",
  "open-second-window": "multi-window",
  "open-vault-window": "multi-vault",
  // The phone's own way: the share sheet prints, the note menu hands a note
  // straight to mail, Appearance owns the theme, touch has no shortcut layer.
  "print": "print-note",
  "mail-copy-html": "note-copy-as-email",
  "toggle-theme": "theme-quick-toggle",
  "show-shortcuts": "keyboard-shortcuts",
  // Served on a screen of its own, but not from the palette yet — a gap.
  "template-new": "palette-command-reach",
  "open-comments": "palette-command-reach",
  "import-pkm": "palette-command-reach",
  "backup-now": "palette-command-reach",
  "rebuild-index": "palette-command-reach",
  "update-indexes": "palette-command-reach",
  "version-history": "palette-command-reach",
  "insert-template": "palette-command-reach",
  "template-from-note": "palette-command-reach",
  "toggle-source": "palette-command-reach",
  "mail-mailto": "palette-command-reach",
  "mail-draft": "palette-command-reach",
};
