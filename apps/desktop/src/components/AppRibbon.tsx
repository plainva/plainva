import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Sun, CalendarRange, Command, FilePlus, HelpCircle, ListChecks, Mail, Search, Settings, Waypoints } from "lucide-react";
import { ICON } from "@plainva/ui";
import {
  applyRibbonOrder,
  DEFAULT_RIBBON_ORDER,
  getStoredRibbonOrder,
  moveRibbonAction,
  setStoredRibbonOrder,
  type RibbonGroup,
  type RibbonOrder,
} from "../services/ribbonOrder";

/**
 * App ribbon (maintainer report #3): the slim vertical action rail left of
 * the sidebar, Obsidian-style. It carries VAULT-WIDE actions that otherwise
 * hide behind shortcuts — top: new note, quick switcher, daily note, graph,
 * command palette; bottom: shortcuts help and settings. Buttons are plain
 * pv-iconbtns inside a `pv-ribbon` hook so themes (LCARS!) can restyle the
 * rail like every other chrome surface.
 *
 * Since 2026-07-25 (plan P3) the order is the user's: a LONG PRESS (~400 ms,
 * the maintainer's explicit choice over a drag handle — the rail is too narrow
 * for one) lifts a button into drag mode; a short click stays a click. Only
 * sorting, and only within a group: nothing can be hidden and Settings stays
 * where the user can always reach it.
 */

const LONG_PRESS_MS = 400;

export interface AppRibbonProps {
  onNewNote: () => void;
  onQuickSwitcher: () => void;
  onDailyNote: () => void;
  onOpenGraph: () => void;
  onOpenTasks: () => void;
  /** Absent while no cloud account carries the service (gating, mockup 6). */
  onOpenCalendar?: () => void;
  onOpenMail?: () => void;
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

/** Drag state: which button is lifted, and where it would land. */
interface DragState {
  group: RibbonGroup;
  key: string;
  overIndex: number;
}

export function AppRibbon(props: AppRibbonProps) {
  const { t } = useTranslation();
  const [order, setOrder] = useState<RibbonOrder>(DEFAULT_RIBBON_ORDER);
  const [drag, setDrag] = useState<DragState | null>(null);
  const pressTimer = useRef<number | null>(null);
  const railRef = useRef<HTMLElement | null>(null);
  /** Set once a long press fires, so the following click is swallowed. */
  const draggedRef = useRef(false);

  useEffect(() => {
    void getStoredRibbonOrder().then(setOrder);
  }, []);

  const rawTop: RibbonAction[] = [
    { key: "new", label: t("common.newNote", { defaultValue: "Neue Notiz" }), icon: <FilePlus size={ICON.head} />, run: props.onNewNote },
    { key: "open", label: t("editor.openFile", { defaultValue: "Datei öffnen" }), icon: <Search size={ICON.head} />, run: props.onQuickSwitcher },
    { key: "daily", label: t("sidebar.newDaily", { defaultValue: "Tageseintrag" }), icon: <Sun size={ICON.head} />, run: props.onDailyNote },
    { key: "graph", label: t("graph.open", { defaultValue: "Graph öffnen" }), icon: <Waypoints size={ICON.head} />, run: props.onOpenGraph, testId: "ribbon-graph" },
    { key: "tasks", label: t("tasks.openTasks", { defaultValue: "Aufgaben öffnen" }), icon: <ListChecks size={ICON.head} />, run: props.onOpenTasks, testId: "ribbon-tasks" },
    ...(props.onOpenCalendar
      ? [{ key: "calendar", label: t("pim.openCalendar", { defaultValue: "Kalender öffnen" }), icon: <CalendarRange size={ICON.head} />, run: props.onOpenCalendar, testId: "ribbon-calendar" }]
      : []),
    ...(props.onOpenMail
      ? [{ key: "mail", label: t("mail.openMail", { defaultValue: "E-Mail öffnen" }), icon: <Mail size={ICON.head} />, run: props.onOpenMail, testId: "ribbon-mail" }]
      : []),
    { key: "palette", label: t("palette.title", { defaultValue: "Befehls-Palette" }), icon: <Command size={ICON.head} />, run: props.onCommandPalette },
  ];
  const rawBottom: RibbonAction[] = [
    { key: "help", label: t("shortcuts.showShortcuts", { defaultValue: "Tastaturkürzel anzeigen" }), icon: <HelpCircle size={ICON.head} />, run: props.onShortcuts },
    { key: "settings", label: t("shortcuts.openSettings", { defaultValue: "Einstellungen öffnen" }), icon: <Settings size={ICON.head} />, run: props.onSettings },
  ];

  const top = applyRibbonOrder(rawTop, order.top);
  const bottom = applyRibbonOrder(rawBottom, order.bottom);

  const cancelPress = () => {
    if (pressTimer.current !== null) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  };

  const commit = (state: DragState) => {
    const group = state.group;
    const next: RibbonOrder = {
      ...order,
      [group]: moveRibbonAction(order[group], state.key, state.overIndex),
    };
    setOrder(next);
    void setStoredRibbonOrder(next).catch((e) => console.error("[AppRibbon] saving the order failed", e));
  };

  /** Which slot of `group` the pointer currently sits over (rail is vertical). */
  const slotAt = (group: RibbonGroup, clientY: number): number => {
    const rail = railRef.current;
    if (!rail) return 0;
    const buttons = Array.from(rail.querySelectorAll<HTMLElement>(`[data-ribbon-group="${group}"]`));
    for (let i = 0; i < buttons.length; i++) {
      const r = buttons[i].getBoundingClientRect();
      if (clientY < r.top + r.height / 2) return i;
    }
    return buttons.length;
  };

  const renderAction = (a: RibbonAction, group: RibbonGroup) => {
    const lifted = drag?.key === a.key;
    return (
      <button
        key={a.key}
        data-ribbon-group={group}
        data-ribbon-key={a.key}
        className="pv-iconbtn"
        aria-label={a.label}
        data-tip={a.label}
        data-testid={a.testId}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          draggedRef.current = false;
          const target = e.currentTarget;
          const pointerId = e.pointerId;
          cancelPress();
          pressTimer.current = window.setTimeout(() => {
            draggedRef.current = true;
            target.setPointerCapture(pointerId);
            setDrag({ group, key: a.key, overIndex: (group === "top" ? top : bottom).findIndex((x) => x.key === a.key) });
          }, LONG_PRESS_MS);
        }}
        onPointerMove={(e) => {
          if (!drag || drag.key !== a.key) return;
          const overIndex = slotAt(group, e.clientY);
          if (overIndex !== drag.overIndex) setDrag({ ...drag, overIndex });
        }}
        onPointerUp={(e) => {
          cancelPress();
          if (drag && drag.key === a.key) {
            e.currentTarget.releasePointerCapture?.(e.pointerId);
            commit(drag);
            setDrag(null);
          }
        }}
        onPointerCancel={() => {
          cancelPress();
          setDrag(null);
        }}
        onPointerLeave={cancelPress}
        onClick={() => {
          // A long press already did its job — do not also fire the action.
          if (draggedRef.current) {
            draggedRef.current = false;
            return;
          }
          a.run();
        }}
        style={{
          width: 30,
          height: 30,
          opacity: lifted ? 0.85 : 1,
          boxShadow: lifted ? "var(--shadow-2)" : undefined,
          background: lifted ? "var(--bg-primary)" : undefined,
          touchAction: "none",
        }}
      >
        {a.icon}
      </button>
    );
  };

  // Escape abandons a drag without reordering (the mockup's "release outside
  // cancels" sibling).
  useEffect(() => {
    if (!drag) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        cancelPress();
        setDrag(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drag]);

  return (
    <nav
      ref={railRef}
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
      {top.map((a) => renderAction(a, "top"))}
      <span style={{ flex: 1 }} />
      {bottom.map((a) => renderAction(a, "bottom"))}
    </nav>
  );
}
