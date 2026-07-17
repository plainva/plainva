/**
 * Command registry (plan Designsprache 2026-07-05, P9/L11/E7). One central
 * list of app commands feeding the CommandPalette (Mod+P). Titles reuse the
 * existing i18n keys of the actions they trigger — the palette introduces no
 * parallel vocabulary. Handlers are injected by App (deps), so commands stay
 * declarative and testable.
 */
export interface AppCommand {
  id: string;
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
  newItem: (kind: "file" | "folder" | "base") => void;
  openDailyNote: () => void;
  openQuickSwitcher: () => void;
  openTemplatePicker: () => void;
  openGraph: () => void;
  openTasks: () => void;
  openCalendar: () => void;
  openMail: () => void;
  openFindReplace: () => void;
  split: (direction: "vertical" | "horizontal") => void;
  toggleLeftSidebar: () => void;
  toggleRightSidebar: () => void;
  /** Collapses both sidebars; invoking again restores the previous layout (P7.4). */
  toggleFocusMode: () => void;
  toggleTheme: () => void;
  themeTogglePinned: () => boolean;
  openSettings: () => void;
  openShortcuts: () => void;
  activePath: () => string | null;
  showVersionHistory: (path: string) => void;
  backupNow: () => void;
  updateAllIndexes: () => void;
  switchVault: () => void;
  /** Prints the active pane's read view (P3.10). */
  printActive: () => void;
  /** True when the active document is a markdown note (print target). */
  canPrint: () => boolean;
  /** Exports the active note as a standalone .md copy (issue #6). */
  exportActiveMarkdown: () => void;
  /** Creates a fresh template in the vault's template folder (issue #6). */
  createTemplate: () => void;
  /** Copies the active note into the template folder (issue #6 follow-up). */
  saveActiveAsTemplate: () => void;
  /** Toggles the active editor between reading and editing (Mod+E). */
  toggleReadEdit: () => void;
  /** Toggles the active editor between live preview and Markdown source (Mod+Shift+E). */
  toggleSourceMode: () => void;
  /** Renames the active note (F2). */
  renameActive: () => void;
  /** Closes the active tab (Mod+W). */
  closeActiveTab: () => void;
  /** Reopens the last closed tab (Mod+Shift+T). */
  reopenClosedTab: () => void;
}

export function buildAppCommands(d: CommandDeps): AppCommand[] {
  return [
    { id: "new-note", titleKey: "common.newNote", titleDefault: "Neue Notiz", hint: "Mod+N", run: () => d.newItem("file") },
    { id: "new-folder", titleKey: "common.newFolder", titleDefault: "Neuer Ordner", run: () => d.newItem("folder") },
    { id: "new-base", titleKey: "fileTree.newBaseHere", titleDefault: "Neue Datenbank (.base)", run: () => d.newItem("base") },
    { id: "daily-note", titleKey: "sidebar.newDaily", titleDefault: "Tageseintrag", hint: "Mod+Shift+D", run: d.openDailyNote },
    { id: "open-file", titleKey: "editor.openFile", titleDefault: "Datei öffnen", hint: "Mod+O", run: d.openQuickSwitcher },
    { id: "insert-template", titleKey: "shortcuts.insertTemplate", titleDefault: "Vorlage einfügen", hint: "Mod+Alt+T", run: d.openTemplatePicker },
    { id: "template-new", titleKey: "database.createTemplate", titleDefault: "Neue Vorlage erstellen", run: d.createTemplate },
    { id: "template-from-note", titleKey: "editor.saveAsTemplate", titleDefault: "Aktuelle Notiz als Vorlage speichern", run: d.saveActiveAsTemplate, isAvailable: () => d.canPrint() },
    { id: "open-graph", titleKey: "graph.open", titleDefault: "Graph öffnen", hint: "Mod+Shift+G", run: d.openGraph },
    { id: "open-tasks", titleKey: "tasks.openTasks", titleDefault: "Aufgaben öffnen", run: d.openTasks },
    { id: "open-calendar", titleKey: "pim.openCalendar", titleDefault: "Kalender öffnen", run: d.openCalendar },
    { id: "open-mail", titleKey: "mail.openMail", titleDefault: "E-Mail öffnen", run: d.openMail },
    { id: "find-replace-vault", titleKey: "findReplace.title", titleDefault: "Im Vault suchen & ersetzen", hint: "Mod+Shift+F", run: d.openFindReplace },
    { id: "split-vertical", titleKey: "shortcuts.splitVertical", titleDefault: "Editor rechts teilen", hint: "Mod+Alt+V", run: () => d.split("vertical") },
    { id: "split-horizontal", titleKey: "shortcuts.splitHorizontal", titleDefault: "Editor unten teilen", hint: "Mod+Alt+S", run: () => d.split("horizontal") },
    { id: "toggle-left-sidebar", titleKey: "shortcuts.toggleLeftSidebar", titleDefault: "Linke Seitenleiste umschalten", hint: "Mod+Alt+B", run: d.toggleLeftSidebar },
    { id: "toggle-right-sidebar", titleKey: "shortcuts.toggleRightSidebar", titleDefault: "Rechte Seitenleiste umschalten", hint: "Mod+Alt+R", run: d.toggleRightSidebar },
    { id: "focus-mode", titleKey: "shortcuts.toggleFocusMode", titleDefault: "Fokus-Modus umschalten", run: d.toggleFocusMode },
    { id: "toggle-read-edit", titleKey: "shortcuts.toggleReadEdit", titleDefault: "Lesen/Bearbeiten umschalten", hint: "Mod+E", run: d.toggleReadEdit, isAvailable: () => d.canPrint() },
    { id: "toggle-source", titleKey: "shortcuts.toggleSourceMode", titleDefault: "Quelltext-Modus umschalten", hint: "Mod+Shift+E", run: d.toggleSourceMode, isAvailable: () => d.canPrint() },
    { id: "rename-active", titleKey: "common.rename", titleDefault: "Umbenennen", hint: "F2", run: d.renameActive, isAvailable: () => { const p = d.activePath(); return !!p && !p.startsWith("plainva://"); } },
    { id: "close-tab", titleKey: "shortcuts.closeTab", titleDefault: "Tab schließen", hint: "Mod+W", run: d.closeActiveTab },
    { id: "reopen-tab", titleKey: "shortcuts.reopenTab", titleDefault: "Geschlossenen Tab öffnen", hint: "Mod+Shift+T", run: d.reopenClosedTab },
    { id: "toggle-theme", titleKey: "titlebar.toggleTheme", titleDefault: "Hell/Dunkel umschalten", run: d.toggleTheme, isAvailable: () => !d.themeTogglePinned() },
    { id: "open-settings", titleKey: "shortcuts.openSettings", titleDefault: "Einstellungen öffnen", hint: "Mod+,", run: d.openSettings },
    { id: "show-shortcuts", titleKey: "shortcuts.showShortcuts", titleDefault: "Tastaturkürzel anzeigen", hint: "F1", run: d.openShortcuts },
    {
      id: "version-history",
      titleKey: "fileTree.versionHistory",
      titleDefault: "Versionsverlauf…",
      run: () => { const p = d.activePath(); if (p) d.showVersionHistory(p); },
      isAvailable: () => !!d.activePath(),
    },
    { id: "print", titleKey: "editor.print", titleDefault: "Drucken / Als PDF…", run: d.printActive, isAvailable: () => d.canPrint() },
    { id: "export-markdown", titleKey: "editor.exportMarkdown", titleDefault: "Als Markdown exportieren…", run: d.exportActiveMarkdown, isAvailable: () => d.canPrint() },
    { id: "backup-now", titleKey: "settings.backupNow", titleDefault: "Jetzt sichern", run: d.backupNow },
    { id: "update-indexes", titleKey: "indexMd.updateAllAction", titleDefault: "Alle index.md aktualisieren", run: d.updateAllIndexes },
    { id: "switch-vault", titleKey: "sidebar.switchVault", titleDefault: "Vault wechseln", run: d.switchVault },
  ];
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
