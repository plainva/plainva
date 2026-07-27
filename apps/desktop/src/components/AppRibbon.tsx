import { useId, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Sun, CalendarRange, Command, FilePlus, HelpCircle, ListChecks, Mail, Search, Settings, Waypoints, ArrowUp, EyeOff, Settings as SettingsIcon } from "lucide-react";
import {
  ICON,
  MenuSurface,
  MenuItem,
  MenuSeparator,
  MenuLabel,
  useHoldDrag,
  visibleAreas,
  moveArea,
  setAreaVisible,
  sanitizeAreaOrder,
  type AreaOrder,
} from "@plainva/ui";
import { useVault } from "../contexts/VaultContext";
import {
  BAR_LAYOUT_CHANGED_EVENT,
  openBarSettings,
  barDef,
  loadBarLayout,
  saveBarLayout,
} from "../services/barLayout";

/**
 * App ribbon: the slim vertical action rail left of the sidebar, Obsidian-style.
 * It carries VAULT-WIDE actions that otherwise hide behind shortcuts.
 *
 * Since 2026-07-27 (plan § 2) the rail shares ONE model with both sidebars:
 * a single ordered list with a visible line, per vault, inherited from the
 * global default. Press and hold (~400 ms) lifts a button; a short click stays
 * a click; right-click carries the same actions without holding.
 *
 * The bottom group (help, settings) is deliberately outside that model — not a
 * runtime check but a structural fact, which is what keeps Settings and the
 * command palette reachable no matter what the user hides (E3). Hidden actions
 * stay available through the command palette.
 */

type RibbonId = "new" | "open" | "daily" | "graph" | "tasks" | "calendar" | "mail" | "palette";
const SPEC = barDef("ribbon").spec;

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

export function AppRibbon(props: AppRibbonProps) {
  const { t } = useTranslation();
  const { vaultPath } = useVault();
  const [layout, setLayout] = useState<AreaOrder>(() => sanitizeAreaOrder(undefined, SPEC));
  const [overId, setOverId] = useState<RibbonId | null>(null);
  const [menuAt, setMenuAt] = useState<{ id: RibbonId; x: number; y: number } | null>(null);
  const railRef = useRef<HTMLElement | null>(null);

  // Identifies this surface in the change event, so it does not re-read the
  // store because of its own write. useId is stable per instance and pure —
  // a random id in the render body is not (react-hooks/purity).
  const source = useId();

  useEffect(() => {
    let alive = true;
    const read = (e?: Event) => {
      if (e && (e as CustomEvent<{ source?: string }>).detail?.source === source) return;
      void loadBarLayout("ribbon", vaultPath).then((v) => {
        if (alive) setLayout(v);
      });
    };
    read();
    window.addEventListener(BAR_LAYOUT_CHANGED_EVENT, read);
    return () => {
      alive = false;
      window.removeEventListener(BAR_LAYOUT_CHANGED_EVENT, read);
    };
  }, [vaultPath, source]);

  const persist = useCallback(
    (next: AreaOrder) => {
      setLayout(next);
      void saveBarLayout("ribbon", vaultPath, next, source);
    },
    [vaultPath, source],
  );

  /** Every action the rail COULD carry, keyed by id. Gated services are absent
   *  entirely — they cannot be arranged into a rail that has no such account. */
  const catalog: Partial<Record<RibbonId, RibbonAction>> = {
    new: { key: "new", label: t("common.newNote", { defaultValue: "Neue Notiz" }), icon: <FilePlus size={ICON.head} />, run: props.onNewNote },
    open: { key: "open", label: t("editor.openFile", { defaultValue: "Datei öffnen" }), icon: <Search size={ICON.head} />, run: props.onQuickSwitcher },
    daily: { key: "daily", label: t("sidebar.newDaily", { defaultValue: "Tageseintrag" }), icon: <Sun size={ICON.head} />, run: props.onDailyNote },
    graph: { key: "graph", label: t("graph.open", { defaultValue: "Graph öffnen" }), icon: <Waypoints size={ICON.head} />, run: props.onOpenGraph, testId: "ribbon-graph" },
    tasks: { key: "tasks", label: t("tasks.openTasks", { defaultValue: "Aufgaben öffnen" }), icon: <ListChecks size={ICON.head} />, run: props.onOpenTasks, testId: "ribbon-tasks" },
    ...(props.onOpenCalendar
      ? { calendar: { key: "calendar", label: t("pim.openCalendar", { defaultValue: "Kalender öffnen" }), icon: <CalendarRange size={ICON.head} />, run: props.onOpenCalendar, testId: "ribbon-calendar" } }
      : {}),
    ...(props.onOpenMail
      ? { mail: { key: "mail", label: t("mail.openMail", { defaultValue: "E-Mail öffnen" }), icon: <Mail size={ICON.head} />, run: props.onOpenMail, testId: "ribbon-mail" } }
      : {}),
    palette: { key: "palette", label: t("palette.title", { defaultValue: "Befehls-Palette" }), icon: <Command size={ICON.head} />, run: props.onCommandPalette },
  };

  const bottom: RibbonAction[] = [
    { key: "help", label: t("shortcuts.showShortcuts", { defaultValue: "Tastaturkürzel anzeigen" }), icon: <HelpCircle size={ICON.head} />, run: props.onShortcuts },
    { key: "settings", label: t("shortcuts.openSettings", { defaultValue: "Einstellungen öffnen" }), icon: <Settings size={ICON.head} />, run: props.onSettings },
  ];

  const shown = useMemo(
    () => (visibleAreas(layout) as RibbonId[]).filter((id) => catalog[id] !== undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [layout, props.onOpenCalendar, props.onOpenMail],
  );

  /** Which slot the pointer currently sits over (the rail is vertical). */
  const slotAt = useCallback((clientY: number): RibbonId | null => {
    const rail = railRef.current;
    if (!rail) return null;
    const buttons = Array.from(rail.querySelectorAll<HTMLElement>("[data-ribbon-key]"));
    for (const b of buttons) {
      const r = b.getBoundingClientRect();
      if (clientY >= r.top && clientY <= r.bottom) return (b.dataset.ribbonKey as RibbonId) ?? null;
    }
    return null;
  }, []);

  const dropRef = useRef<RibbonId | null>(null);
  const { dragId, handlers, consumeDragClick } = useHoldDrag({
    onMove: (_id, ev) => {
      const target = slotAt(ev.clientY);
      dropRef.current = target;
      setOverId(target);
    },
    onDrop: (id) => {
      const to = dropRef.current;
      dropRef.current = null;
      setOverId(null);
      if (!to || to === id) return;
      const target = layout.order.indexOf(to);
      if (target >= 0) persist(moveArea(layout, id, target, SPEC));
    },
    onCancel: () => {
      dropRef.current = null;
      setOverId(null);
    },
  });

  const renderAction = (a: RibbonAction, sortable: boolean) => {
    const drag = sortable ? handlers(a.key) : null;
    const lifted = dragId === a.key;
    const isOver = sortable && overId === a.key && dragId !== null && dragId !== a.key;
    return (
      <button
        key={a.key}
        data-ribbon-key={sortable ? a.key : undefined}
        className="pv-iconbtn"
        aria-label={a.label}
        data-tip={a.label}
        data-testid={a.testId}
        {...(drag ?? {})}
        onClick={() => {
          if (sortable && consumeDragClick()) return;
          a.run();
        }}
        onContextMenu={
          sortable
            ? (e) => {
                drag?.onContextMenu();
                e.preventDefault();
                setMenuAt({ id: a.key as RibbonId, x: e.clientX, y: e.clientY });
              }
            : undefined
        }
        style={{
          width: 30,
          height: 30,
          opacity: lifted ? 0.85 : 1,
          boxShadow: lifted ? "var(--shadow-2)" : undefined,
          background: lifted ? "var(--bg-primary)" : undefined,
          borderTop: isOver ? "2px solid var(--accent-color)" : "2px solid transparent",
          touchAction: "none",
        }}
      >
        {a.icon}
      </button>
    );
  };

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
      {shown.map((id) => renderAction(catalog[id] as RibbonAction, true))}
      <span style={{ flex: 1 }} />
      {bottom.map((a) => renderAction(a, false))}

      {menuAt && (
        <MenuSurface
          open
          onClose={() => setMenuAt(null)}
          at={{ x: menuAt.x, y: menuAt.y }}
          minWidth={188}
          ariaLabel={catalog[menuAt.id]?.label ?? ""}
        >
          <MenuLabel>{catalog[menuAt.id]?.label ?? ""}</MenuLabel>
          <MenuItem
            icon={<ArrowUp size={ICON.ui} />}
            onClick={() => {
              persist(moveArea(layout, menuAt.id, 0, SPEC));
              setMenuAt(null);
            }}
          >
            {t("bars.moveUp", { defaultValue: "Nach oben" })}
          </MenuItem>
          <MenuItem
            icon={<EyeOff size={ICON.ui} />}
            onClick={() => {
              persist(setAreaVisible(layout, menuAt.id, false, SPEC));
              setMenuAt(null);
            }}
          >
            {t("bars.hide", { defaultValue: "Ausblenden" })}
          </MenuItem>
          <MenuSeparator />
          <MenuItem
            icon={<SettingsIcon size={ICON.ui} />}
            onClick={() => {
              openBarSettings();
              setMenuAt(null);
            }}
          >
            {t("bars.customize", { defaultValue: "Leisten anpassen…" })}
          </MenuItem>
        </MenuSurface>
      )}
    </nav>
  );
}
