import { buildAppCommands, resolveOpenAction, type SkillView, type AppCommand, type CommandDeps } from "@plainva/ui";
import { requestNoteCommand, type NoteCommand } from "./noteCommands";

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
  /** The skills a person can start now (plan KI-Harness P3). */
  aiSkills?: readonly SkillView[];
  /** A skill in a new conversation bound to it, on the KI sheet over the open note. */
  runAiSkill?: (id: string) => void;
  openSearch: () => void;
  openFindReplace: () => void;
  openGraph: () => void;
  openTasks: () => void;
  openCalendar: () => void;
  openMail: () => void;
  openSettings: () => void;
  switchVault: () => void;
  refreshVault: () => void;
  /**
   * What the phone serves on a screen of its own and the palette now reaches
   * too (parity gap palette-command-reach, closed 2026-10-06). Each one leads
   * to the surface or runs the function that surface runs — never a second
   * implementation: the template prompt, the comments area, the import
   * wizard, the vault archive, the index rebuild, the overviews list.
   */
  newTemplate?: () => void;
  openComments?: () => void;
  openImport?: () => void;
  backupNow?: () => void;
  rebuildIndex?: () => void;
  updateIndexes?: () => void;
  /**
   * The note a command acts on, or null — gates the note-scoped commands. The
   * palette covers the note it was opened over, so this is that note, not
   * "the top of the stack" (which is the palette itself).
   */
  activeNote: () => string | null;
  /**
   * The note-scoped actions. Each defaults to a request the note screen takes
   * (services/noteCommands), so the shell does not carry a second copy of the
   * names — they are not app state, they are this module's contract with the
   * note screen.
   */
  renameActive?: () => void;
  toggleReadEdit?: () => void;
  exportActive?: () => void;
  toggleSource?: () => void;
  insertTemplate?: () => void;
  saveAsTemplate?: () => void;
  sendViaMailto?: () => void;
  composeMail?: () => void;
  showVersionHistory?: () => void;
}

export function buildMobileCommands(h: MobileCommandHost): AppCommand[] {
  /** Asks the note the palette was opened over; the note screen carries it out. */
  const ask = (command: NoteCommand) => () => requestNoteCommand(h.activeNote(), command);
  const hasNote = () => h.activeNote() !== null;
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
    aiSkills: h.aiSkills,
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
    createTemplate: h.newTemplate,
    openComments: h.openComments,
    openImport: h.openImport,
    backupNow: h.backupNow,
    rebuildIndex: h.rebuildIndex,
    // The desktop's command refreshes every managed index.md in one go; the
    // phone's surface for that is the overviews list, folder by folder, so
    // the command leads there instead of growing a bulk run of its own.
    updateAllIndexes: h.updateIndexes,
    renameActive: h.renameActive ?? ask("rename"),
    toggleReadEdit: h.toggleReadEdit ?? ask("toggle-edit"),
    // Points at the FILE export, not at sharing the text (fixed 2026-08-20 —
    // it mapped to shareActive, so the command named "export as Markdown"
    // handed out plain text that cannot be reopened as the note).
    exportActiveMarkdown: h.exportActive ?? ask("export"),
    toggleSourceMode: h.toggleSource ?? ask("toggle-source"),
    openTemplatePicker: h.insertTemplate ?? ask("insert-template"),
    saveActiveAsTemplate: h.saveAsTemplate ?? ask("save-as-template"),
    sendNoteViaMailto: h.sendViaMailto ?? ask("mailto"),
    // The desktop asks for the account and files the draft; the phone's way
    // is its composer with the note already in it, which picks the account and
    // files the message in that account's drafts folder (S29) — the note
    // menu's "send via email" entry, and the same one here.
    saveNoteAsMailDraft: h.composeMail ?? ask("compose-mail"),
    // The registry hands over the path; the request carries it already.
    showVersionHistory: h.showVersionHistory ?? ask("history"),
    activePath: h.activeNote,
    // Gates every note-scoped command, not just print (renamed 2026-08-20 —
    // as `canPrint` it read like a print flag on a shell that cannot print,
    // and was written down as dead. Read/edit and the Markdown export hang
    // off it here).
    hasActiveNote: hasNote,
    // Everything else is absent on purpose, and MOBILE_ABSENT_COMMANDS below
    // names each command with the catalog entry that says why. (Sharing the
    // note as text was supplied here once and never read — the note screen
    // has its own share action; removed 2026-08-21.)
  };
  // Two gates the shared registry does not carry, because the desktop does not
  // need them: its template picker is a modal of the shell and opens without a
  // note, the phone's belongs to the open editor; and a plain-text file
  // (`.csv`, `.txt`) is opened by the note screen but has one mode only, which
  // is why the note menu leaves "Markdown source" out for it as well.
  const gates: Record<string, () => boolean> = {
    "insert-template": hasNote,
    "toggle-source": () => {
      const path = h.activeNote();
      return path !== null && resolveOpenAction(path) !== "text";
    },
  };
  return buildAppCommands(deps).map((c) => (gates[c.id] ? { ...c, isAvailable: gates[c.id] } : c));
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
};
