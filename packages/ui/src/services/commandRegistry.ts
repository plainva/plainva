import type { LucideIcon } from "lucide-react";
import {
  Calendar, CalendarDays, Columns2, Database, Download, FileText, FilePlus, FolderOpen, FolderPlus,
  Gauge, Keyboard, ListChecks, Mail, Moon, Palette, Pencil, Printer, RefreshCw, Replace,
  Rows2, Save, Search, Settings, SquareArrowOutUpRight, Trash2, Type, Waypoints, X,
} from "lucide-react";

/**
 * Command registry (plan Designsprache 2026-07-05, P9/L11/E7). One central
 * list of app commands feeding the command palette. Titles reuse the existing
 * i18n keys of the actions they trigger — the palette introduces no parallel
 * vocabulary. Handlers are injected by the shell (deps), so commands stay
 * declarative and testable.
 *
 * Shared since S15: the phone offers the same 39 commands, minus the ones it
 * genuinely cannot serve. That is why every dep is OPTIONAL and a command
 * whose handler is missing is not built at all — a command that appears and
 * does nothing is worse than one that is honestly absent. A drift guard keeps
 * the desktop offering all of them.
 *
 * Groups and icons live here too (E6), so both shells present the same
 * vocabulary in the same order instead of each inventing one.
 */

export type CommandGroup = "create" | "open" | "note" | "view" | "vault" | "app";

/** Presentation order of the groups — the palette renders them like this. */
export const COMMAND_GROUPS: CommandGroup[] = ["create", "open", "note", "view", "vault", "app"];
export interface AppCommand {
  id: string;
  group: CommandGroup;
  icon: LucideIcon;
  /** i18n key + German fallback for the title. */
  titleKey: string;
  titleDefault: string;
  /** Shortcut hint shown right-aligned ("Mod" is localized by the palette). */
  hint?: string;
  run: () => void;
  /** Hidden when false (e.g. file-scoped commands without an active file). */
  isAvailable?: () => boolean;
}

export interface CommandDeps {
  newItem?: (kind: "file" | "folder" | "base", opts?: { fromTemplate?: boolean }) => void;
  openDailyNote?: () => void;
  openQuickSwitcher?: () => void;
  openTemplatePicker?: () => void;
  openGraph?: () => void;
  openTasks?: () => void;
  openCalendar?: () => void;
  openMail?: () => void;
  /**
   * Opens the communications window: mail beside the calendar in one auxiliary
   * window (multi-window P4, plan E4). Desktop only by construction — the
   * phone has one screen, and the mobile shell simply never passes it.
   */
  openCommsWindow?: () => void;
  /**
   * Opens a second full window: the same shell again, on another monitor
   * (multi-window stage C). Desktop only, like the one above — and it is the
   * only way in, so a missing entry here means the stage is unreachable.
   */
  openSecondWindow?: () => void;
  /**
   * Opens the vault line's menu, where another vault can be opened HERE or in
   * a window of its own (stage D). The palette is the second door to it; the
   * first is the vault line itself, which is easy to miss at the foot of a
   * sidebar that may be collapsed.
   */
  openVaultWindow?: () => void;
  /** Mail-raus (stage 6): active-note actions, gated like print/export. */
  copyNoteAsEmail?: () => void;
  sendNoteViaMailto?: () => void;
  saveNoteAsMailDraft?: () => void;
  openFindReplace?: () => void;
  split?: (direction: "vertical" | "horizontal") => void;
  toggleLeftSidebar?: () => void;
  toggleRightSidebar?: () => void;
  /** Collapses both sidebars; invoking again restores the previous layout (P7.4). */
  toggleFocusMode?: () => void;
  toggleTheme?: () => void;
  themeTogglePinned?: () => boolean;
  openSettings?: () => void;
  openShortcuts?: () => void;
  activePath?: () => string | null;
  showVersionHistory?: (path: string) => void;
  backupNow?: () => void;
  updateAllIndexes?: () => void;
  switchVault?: () => void;
  /** Prints the active pane's read view (P3.10). */
  printActive?: () => void;
  /**
   * True when the active document is a markdown note.
   *
   * Named `canPrint` until 2026-08-20, which read like a print-only flag and
   * was noted as one: on the phone it is set while `printActive` is not, so it
   * looked like a flag that could never gate anything. It gates every
   * note-scoped command in this registry — reading/editing, source mode,
   * export, save-as-template, the three mail entries — and the phone supplies
   * all of those. The name was the defect, not the flag.
   */
  hasActiveNote?: () => boolean;
  /** Exports the active note as a standalone .md copy (issue #6). */
  exportActiveMarkdown?: () => void;
  /** Creates a fresh template in the vault's template folder (issue #6). */
  createTemplate?: () => void;
  /** Copies the active note into the template folder (issue #6 follow-up). */
  saveActiveAsTemplate?: () => void;
  /** Toggles the active editor between reading and editing (Mod+E). */
  toggleReadEdit?: () => void;
  /** Toggles the active editor between live preview and Markdown source (Mod+Shift+E). */
  toggleSourceMode?: () => void;
  /** Renames the active note (F2). */
  renameActive?: () => void;
  /** Closes the active tab (Mod+W). */
  closeActiveTab?: () => void;
  /** Reopens the last closed tab (Mod+Shift+T). */
  reopenClosedTab?: () => void;
  /** Opens the PKM Import Wizard dialog. */
  openImport?: () => void;
  /** Reconciles the index with the disk (and the cloud, on a synced vault) — P1. */
  refreshVault?: () => void;
  /** Drops the index and re-parses every file, with a progress bar — P1. */
  rebuildIndex?: () => void;
}

export function buildAppCommands(d: CommandDeps): AppCommand[] {
  const p = () => d.activePath?.() ?? null;
  const note = () => d.hasActiveNote?.() === true;
  // `need` is the whole contract: a command exists only where its handler does.
  const cmds: Array<AppCommand | null> = [
    need(d.openImport, (run) => ({ id: "import-pkm", group: "vault", icon: Download, titleKey: "import.openWizard", titleDefault: "Aus anderer App importieren...", run })),
    need(d.newItem, (run) => ({ id: "new-note", group: "create", icon: FilePlus, titleKey: "common.newNote", titleDefault: "Neue Notiz", hint: "Mod+N", run: () => run("file") })),
    need(d.newItem, (run) => ({ id: "new-note-from-template", group: "create", icon: FileText, titleKey: "fileTree.newFromTemplate", titleDefault: "Neue Notiz aus Vorlage …", run: () => run("file", { fromTemplate: true }) })),
    need(d.newItem, (run) => ({ id: "new-folder", group: "create", icon: FolderPlus, titleKey: "common.newFolder", titleDefault: "Neuer Ordner", run: () => run("folder") })),
    need(d.newItem, (run) => ({ id: "new-base", group: "create", icon: Database, titleKey: "fileTree.newBaseHere", titleDefault: "Neue Datenbank (.base)", run: () => run("base") })),
    need(d.openDailyNote, (run) => ({ id: "daily-note", group: "create", icon: CalendarDays, titleKey: "sidebar.newDaily", titleDefault: "Tageseintrag", hint: "Mod+Shift+D", run })),
    need(d.openQuickSwitcher, (run) => ({ id: "open-file", group: "open", icon: Search, titleKey: "editor.openFile", titleDefault: "Datei öffnen", hint: "Mod+O", run })),
    need(d.openTemplatePicker, (run) => ({ id: "insert-template", group: "note", icon: FileText, titleKey: "shortcuts.insertTemplate", titleDefault: "Vorlage einfügen", hint: "Mod+Alt+T", run })),
    need(d.createTemplate, (run) => ({ id: "template-new", group: "create", icon: FileText, titleKey: "database.createTemplate", titleDefault: "Neue Vorlage erstellen", run })),
    need(d.saveActiveAsTemplate, (run) => ({ id: "template-from-note", group: "note", icon: Save, titleKey: "editor.saveAsTemplate", titleDefault: "Aktuelle Notiz als Vorlage speichern", run, isAvailable: note })),
    need(d.openGraph, (run) => ({ id: "open-graph", group: "open", icon: Waypoints, titleKey: "graph.open", titleDefault: "Graph öffnen", hint: "Mod+Shift+G", run })),
    need(d.openTasks, (run) => ({ id: "open-tasks", group: "open", icon: ListChecks, titleKey: "tasks.openTasks", titleDefault: "Aufgaben öffnen", run })),
    need(d.openCalendar, (run) => ({ id: "open-calendar", group: "open", icon: Calendar, titleKey: "pim.openCalendar", titleDefault: "Kalender öffnen", run })),
    need(d.openMail, (run) => ({ id: "open-mail", group: "open", icon: Mail, titleKey: "mail.openMail", titleDefault: "E-Mail öffnen", run })),
    need(d.openCommsWindow, (run) => ({ id: "open-comms-window", group: "open", icon: SquareArrowOutUpRight, titleKey: "window.openComms", titleDefault: "Kommunikations-Fenster öffnen", run })),
    need(d.openSecondWindow, (run) => ({ id: "open-second-window", group: "open", icon: SquareArrowOutUpRight, titleKey: "window.openSecond", titleDefault: "Zweites Fenster öffnen", run })),
    need(d.openVaultWindow, (run) => ({ id: "open-vault-window", group: "open", icon: FolderOpen, titleKey: "window.openVaultWindow", titleDefault: "Vault in neuem Fenster öffnen", run })),
    need(d.copyNoteAsEmail, (run) => ({ id: "mail-copy-html", group: "note", icon: Mail, titleKey: "mail.copyAsEmail", titleDefault: "Notiz als E-Mail-Text kopieren", run, isAvailable: note })),
    need(d.sendNoteViaMailto, (run) => ({ id: "mail-mailto", group: "note", icon: Mail, titleKey: "mail.sendViaMailto", titleDefault: "Notiz per E-Mail senden (mailto)", run, isAvailable: note })),
    need(d.saveNoteAsMailDraft, (run) => ({ id: "mail-draft", group: "note", icon: Mail, titleKey: "mail.saveDraft", titleDefault: "Notiz als E-Mail-Entwurf ins Postfach", run, isAvailable: note })),
    need(d.openFindReplace, (run) => ({ id: "find-replace-vault", group: "vault", icon: Replace, titleKey: "findReplace.title", titleDefault: "Im Vault suchen & ersetzen", hint: "Mod+Shift+F", run })),
    need(d.split, (run) => ({ id: "split-vertical", group: "view", icon: Columns2, titleKey: "shortcuts.splitVertical", titleDefault: "Editor rechts teilen", hint: "Mod+Alt+V", run: () => run("vertical") })),
    need(d.split, (run) => ({ id: "split-horizontal", group: "view", icon: Rows2, titleKey: "shortcuts.splitHorizontal", titleDefault: "Editor unten teilen", hint: "Mod+Alt+S", run: () => run("horizontal") })),
    need(d.toggleLeftSidebar, (run) => ({ id: "toggle-left-sidebar", group: "view", icon: Columns2, titleKey: "shortcuts.toggleLeftSidebar", titleDefault: "Linke Seitenleiste umschalten", hint: "Mod+Alt+B", run })),
    need(d.toggleRightSidebar, (run) => ({ id: "toggle-right-sidebar", group: "view", icon: Columns2, titleKey: "shortcuts.toggleRightSidebar", titleDefault: "Rechte Seitenleiste umschalten", hint: "Mod+Alt+R", run })),
    need(d.toggleFocusMode, (run) => ({ id: "focus-mode", group: "view", icon: Gauge, titleKey: "shortcuts.toggleFocusMode", titleDefault: "Fokus-Modus umschalten", run })),
    need(d.toggleReadEdit, (run) => ({ id: "toggle-read-edit", group: "note", icon: Pencil, titleKey: "shortcuts.toggleReadEdit", titleDefault: "Lesen/Bearbeiten umschalten", hint: "Mod+E", run, isAvailable: note })),
    need(d.toggleSourceMode, (run) => ({ id: "toggle-source", group: "note", icon: Type, titleKey: "shortcuts.toggleSourceMode", titleDefault: "Quelltext-Modus umschalten", hint: "Mod+Shift+E", run, isAvailable: note })),
    need(d.renameActive, (run) => ({ id: "rename-active", group: "note", icon: Pencil, titleKey: "common.rename", titleDefault: "Umbenennen", hint: "F2", run, isAvailable: () => { const a = p(); return !!a && !a.startsWith("plainva://"); } })),
    need(d.closeActiveTab, (run) => ({ id: "close-tab", group: "view", icon: X, titleKey: "shortcuts.closeTab", titleDefault: "Tab schließen", hint: "Mod+W", run })),
    need(d.reopenClosedTab, (run) => ({ id: "reopen-tab", group: "view", icon: RefreshCw, titleKey: "shortcuts.reopenTab", titleDefault: "Geschlossenen Tab öffnen", hint: "Mod+Shift+T", run })),
    need(d.toggleTheme, (run) => ({ id: "toggle-theme", group: "app", icon: Moon, titleKey: "titlebar.toggleTheme", titleDefault: "Hell/Dunkel umschalten", run, isAvailable: () => d.themeTogglePinned?.() !== true })),
    need(d.openSettings, (run) => ({ id: "open-settings", group: "app", icon: Settings, titleKey: "shortcuts.openSettings", titleDefault: "Einstellungen öffnen", hint: "Mod+,", run })),
    need(d.openShortcuts, (run) => ({ id: "show-shortcuts", group: "app", icon: Keyboard, titleKey: "shortcuts.showShortcuts", titleDefault: "Tastaturkürzel anzeigen", hint: "F1", run })),
    need(d.showVersionHistory, (run) => ({ id: "version-history", group: "note", icon: RefreshCw, titleKey: "fileTree.versionHistory", titleDefault: "Versionsverlauf…", run: () => { const a = p(); if (a) run(a); }, isAvailable: () => !!p() })),
    need(d.printActive, (run) => ({ id: "print", group: "note", icon: Printer, titleKey: "editor.print", titleDefault: "Drucken / Als PDF…", run, isAvailable: note })),
    need(d.exportActiveMarkdown, (run) => ({ id: "export-markdown", group: "note", icon: Download, titleKey: "editor.exportMarkdown", titleDefault: "Als Markdown exportieren…", run, isAvailable: note })),
    need(d.backupNow, (run) => ({ id: "backup-now", group: "vault", icon: Save, titleKey: "settings.backupNow", titleDefault: "Jetzt sichern", run })),
    need(d.refreshVault, (run) => ({ id: "refresh-vault", group: "vault", icon: RefreshCw, titleKey: "refresh.action", titleDefault: "Vault neu einlesen", hint: "F5", run })),
    need(d.rebuildIndex, (run) => ({ id: "rebuild-index", group: "vault", icon: Trash2, titleKey: "refresh.rebuildAction", titleDefault: "Index vollständig neu aufbauen", run })),
    need(d.updateAllIndexes, (run) => ({ id: "update-indexes", group: "vault", icon: RefreshCw, titleKey: "indexMd.updateAllAction", titleDefault: "Alle index.md aktualisieren", run })),
    need(d.switchVault, (run) => ({ id: "switch-vault", group: "vault", icon: Palette, titleKey: "sidebar.switchVault", titleDefault: "Vault wechseln", run })),
  ];
  return cmds.filter((c): c is AppCommand => c !== null);
}

/** Builds an entry only when the handler it needs exists. */
function need<F>(dep: F | undefined, make: (run: F) => AppCommand): AppCommand | null {
  return dep === undefined ? null : make(dep);
}

/** Case-insensitive contains-filter over the localized titles. */
export function filterCommands(
  commands: AppCommand[],
  query: string,
  title: (c: AppCommand) => string
): AppCommand[] {
  const visible = commands.filter((c) => c.isAvailable?.() !== false);
  const q = query.trim().toLowerCase();
  if (!q) return visible;
  return visible.filter((c) => title(c).toLowerCase().includes(q) || c.id.includes(q));
}
