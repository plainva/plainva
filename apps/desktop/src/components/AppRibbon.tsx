import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Sunrise, CalendarRange, Command, FilePlus, HelpCircle, ListChecks, Mail, Search, Settings, Waypoints } from "lucide-react";

/**
 * App ribbon (maintainer report #3): the slim vertical action rail left of
 * the sidebar, Obsidian-style. It carries VAULT-WIDE actions that otherwise
 * hide behind shortcuts — top: new note, quick switcher, daily note, graph,
 * command palette; bottom: shortcuts help and settings. Buttons are plain
 * pv-iconbtns inside a `pv-ribbon` hook so themes (LCARS!) can restyle the
 * rail like every other chrome surface.
 */

export interface AppRibbonProps {
  onNewNote: () => void;
  onQuickSwitcher: () => void;
  onDailyNote: () => void;
  onOpenGraph: () => void;
  onOpenTasks: () => void;
  onOpenCalendar: () => void;
  onOpenMail: () => void;
  onCommandPalette: () => void;
  onShortcuts: () => void;
  onSettings: () => void;
}

interface RibbonAction {
  key: string;
  label: string;
  icon: ReactNode;
  run: () => void;
  testId?: string;
}

export function AppRibbon(props: AppRibbonProps) {
  const { t } = useTranslation();
  const top: RibbonAction[] = [
    { key: "new", label: t("common.newNote", { defaultValue: "Neue Notiz" }), icon: <FilePlus size={17} />, run: props.onNewNote },
    { key: "open", label: t("editor.openFile", { defaultValue: "Datei öffnen" }), icon: <Search size={17} />, run: props.onQuickSwitcher },
    { key: "daily", label: t("sidebar.newDaily", { defaultValue: "Tageseintrag" }), icon: <Sunrise size={17} />, run: props.onDailyNote },
    { key: "graph", label: t("graph.open", { defaultValue: "Graph öffnen" }), icon: <Waypoints size={17} />, run: props.onOpenGraph, testId: "ribbon-graph" },
    { key: "tasks", label: t("tasks.openTasks", { defaultValue: "Aufgaben öffnen" }), icon: <ListChecks size={17} />, run: props.onOpenTasks, testId: "ribbon-tasks" },
    { key: "calendar", label: t("pim.openCalendar", { defaultValue: "Kalender öffnen" }), icon: <CalendarRange size={17} />, run: props.onOpenCalendar, testId: "ribbon-calendar" },
    { key: "mail", label: t("mail.openMail", { defaultValue: "E-Mail öffnen" }), icon: <Mail size={17} />, run: props.onOpenMail, testId: "ribbon-mail" },
    { key: "palette", label: t("palette.title", { defaultValue: "Befehls-Palette" }), icon: <Command size={17} />, run: props.onCommandPalette },
  ];
  const bottom: RibbonAction[] = [
    { key: "help", label: t("shortcuts.showShortcuts", { defaultValue: "Tastaturkürzel anzeigen" }), icon: <HelpCircle size={17} />, run: props.onShortcuts },
    { key: "settings", label: t("shortcuts.openSettings", { defaultValue: "Einstellungen öffnen" }), icon: <Settings size={17} />, run: props.onSettings },
  ];

  const renderAction = (a: RibbonAction) => (
    <button
      key={a.key}
      className="pv-iconbtn"
      aria-label={a.label}
      data-tip={a.label}
      data-testid={a.testId}
      onClick={a.run}
      style={{ width: 30, height: 30 }}
    >
      {a.icon}
    </button>
  );

  return (
    <nav
      className="pv-ribbon"
      aria-label={t("ribbon.aria", { defaultValue: "Aktionsleiste" })}
      style={{
        width: 42,
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "var(--space-1)",
        padding: "var(--space-2) 0",
        background: "var(--bg-secondary)",
        borderRight: "1px solid var(--border-color-light)",
      }}
    >
      {top.map(renderAction)}
      <span style={{ flex: 1 }} />
      {bottom.map(renderAction)}
    </nav>
  );
}
