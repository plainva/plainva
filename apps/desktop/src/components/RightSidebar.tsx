import { useId, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronDown, Database, CalendarDays, Link as LinkIcon, SlidersHorizontal, List, Waypoints, ArrowUp, EyeOff, Settings as SettingsIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import * as yaml from "yaml";
import { CalendarWidget } from "./CalendarWidget";
import { BacklinksPanel } from "./BacklinksPanel";
import { PropertiesSection } from "./PropertiesSection";
import { OutlineSection } from "./OutlineSection";
import { GraphContextSection } from "./graph/GraphContextSection";
import { activeDocument, type ActiveDoc } from "../services/activeDocument";
import { parseHeadings } from "../services/outline";
import { useVault } from "../contexts/VaultContext";
import {
  ICON,
  EMPTY_NOTE_DATABASE_CONTEXT,
  hasNoteDatabaseContext,
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
  type NoteDatabaseContext,
} from "@plainva/ui";
import { NoteDatabasesSection } from "./NoteDatabasesSection";
import { loadNoteDatabaseContextCached } from "../services/noteDatabaseContextCache";
import { useSidebarStep } from "../lib/sidebarStep";
import {
  BAR_LAYOUT_CHANGED_EVENT,
  openBarSettings,
  barDef,
  loadBarLayout,
  saveBarLayout,
} from "../services/barLayout";

/** Cheap top-level frontmatter key count (regex + small YAML parse) — avoids a full
 *  markdown AST parse per keystroke so the badge stays light even when collapsed. */
function frontmatterKeyCount(content: string): number {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return 0;
  try {
    const o = yaml.parse(m[1]);
    return o && typeof o === "object" && !Array.isArray(o) ? Object.keys(o).length : 0;
  } catch {
    return 0;
  }
}

type SectionId = "calendar" | "outline" | "graph" | "databases" | "backlinks" | "properties";
const SPEC = barDef("rightSections").spec;
const openKey = (id: SectionId) => `plainva-right-panel-open-${id}`;

function readOpen(id: SectionId): boolean {
  const v = localStorage.getItem(openKey(id));
  if (v === null) return id === "calendar"; // default: only calendar open
  return v === "true";
}

interface RightSidebarProps {
  activePath: string | null;
  onOpenPath: (path: string, newTab?: boolean) => void;
  onOpenPathInSplit?: (path: string) => void;
  onSelectDate: (date: Date) => void;
  /** Opens the calendar tab focused on the given day (widget peek/menu). */
  onOpenCalendarDay?: (dayKey: string) => void;
  loadMarkedDates: (dates: Date[]) => Promise<Set<string>>;
  /** Date of the open daily note (if any), highlighted with precedence over today. */
  activeDailyDate?: Date | null;
  refreshToken: number;
}

export function RightSidebar({ activePath, onOpenPath, onOpenPathInSplit, onSelectDate, onOpenCalendarDay, loadMarkedDates, activeDailyDate, refreshToken }: RightSidebarProps) {
  const { t } = useTranslation();
  const { queryService, fileTreeVersion, vaultAdapter, vaultPath } = useVault();
  // Which sections are shown and in which order — per vault, inherited from the
  // global default until this vault is adapted (plan § 3).
  const [layout, setLayout] = useState<AreaOrder>(() => sanitizeAreaOrder(undefined, SPEC));
  const [open, setOpen] = useState<Record<SectionId, boolean>>(() => ({
    calendar: readOpen("calendar"), outline: readOpen("outline"), graph: readOpen("graph"), databases: readOpen("databases"), backlinks: readOpen("backlinks"), properties: readOpen("properties"),
  }));
  const [counts, setCounts] = useState<{ backlinks: number; properties: number; outline: number }>({ backlinks: 0, properties: 0, outline: 0 });
  const [menuAt, setMenuAt] = useState<{ id: SectionId; x: number; y: number } | null>(null);
  // Database context of the active note (plan P4). Same cached source as the
  // context line in the document head, so both always agree.
  const [dbContext, setDbContext] = useState<NoteDatabaseContext>(EMPTY_NOTE_DATABASE_CONTEXT);

  // Identifies this surface in the change event, so it does not re-read the
  // store because of its own write. useId is stable per instance and pure —
  // a random id in the render body is not (react-hooks/purity).
  const source = useId();

  useEffect(() => {
    let alive = true;
    const read = (e?: Event) => {
      if (e && (e as CustomEvent<{ source?: string }>).detail?.source === source) return;
      void loadBarLayout("rightSections", vaultPath).then((v) => {
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

  useEffect(() => {
    if (!activePath || !vaultAdapter || !queryService || !/\.md$/i.test(activePath)) {
      setDbContext(EMPTY_NOTE_DATABASE_CONTEXT);
      return;
    }
    let cancelled = false;
    void loadNoteDatabaseContextCached(vaultAdapter, queryService, activePath, fileTreeVersion).then((ctx) => {
      if (!cancelled) setDbContext(ctx);
    });
    return () => {
      cancelled = true;
    };
  }, [activePath, vaultAdapter, queryService, fileTreeVersion]);

  // How much room the panel has — drives both the cosmetic degradation (via the
  // data attribute) and the calendar's structural switch (plan P3).
  const rootRef = useRef<HTMLDivElement | null>(null);
  const step = useSidebarStep(rootRef);

  // Live DOM node per section, used to map a pointer's Y position onto a target row.
  const sectionEls = useRef<Partial<Record<SectionId, HTMLElement>>>({});
  const [overId, setOverId] = useState<SectionId | null>(null);

  const toggle = (id: SectionId) => {
    setOpen((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      localStorage.setItem(openKey(id), String(next[id]));
      return next;
    });
  };

  const persist = useCallback(
    (next: AreaOrder) => {
      setLayout(next);
      void saveBarLayout("rightSections", vaultPath, next, source);
    },
    [vaultPath, source],
  );

  const shown = useMemo(() => visibleAreas(layout) as SectionId[], [layout]);

  const sectionAtY = useCallback((clientY: number): SectionId | null => {
    for (const sid of shown) {
      const el = sectionEls.current[sid];
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (clientY >= r.top && clientY <= r.bottom) return sid;
    }
    return null;
  }, [shown]);

  // Press and hold on the header, then drag (plan E10). The handle is gone; it
  // lives on in Settings, where a list is being arranged rather than used.
  const dropRef = useRef<SectionId | null>(null);
  const { dragId, handlers, consumeDragClick } = useHoldDrag({
    onMove: (_id, ev) => {
      const target = sectionAtY(ev.clientY);
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

  const setBacklinksCount = useCallback((n: number) => setCounts((c) => (c.backlinks === n ? c : { ...c, backlinks: n })), []);

  // Header badges stay accurate even while a section is collapsed: compute the
  // counts here (cheaply) instead of relying on the body components, which only
  // mount when their section is expanded.
  useEffect(() => {
    const update = (d: ActiveDoc) => setCounts((c) => {
      const properties = d.kind === "markdown" ? frontmatterKeyCount(d.content) : 0;
      const outline = d.kind === "markdown" ? parseHeadings(d.content).length : 0;
      return c.properties === properties && c.outline === outline ? c : { ...c, properties, outline };
    });
    update(activeDocument.get());
    return activeDocument.subscribe(update);
  }, []);

  useEffect(() => {
    let alive = true;
    if (queryService && activePath && /\.md$/i.test(activePath)) {
      queryService.getBacklinks(activePath)
        .then((l) => { if (alive) setBacklinksCount(l.length); })
        .catch(() => { if (alive) setBacklinksCount(0); });
    } else {
      setBacklinksCount(0);
    }
    return () => { alive = false; };
  }, [activePath, queryService, fileTreeVersion, setBacklinksCount]);

  const meta: Record<SectionId, { title: string; icon: ReactNode; count?: number; pad: boolean }> = {
    calendar: { title: t("rightPanel.calendar", { defaultValue: "Kalender" }), icon: <CalendarDays size={ICON.ui} />, pad: false },
    outline: { title: t("rightPanel.outline", { defaultValue: "Gliederung" }), icon: <List size={ICON.ui} />, count: counts.outline, pad: true },
    graph: { title: t("rightPanel.graph", { defaultValue: "Graph" }), icon: <Waypoints size={ICON.ui} />, pad: true },
    databases: { title: t("rightPanel.databases", { defaultValue: "Datenbanken" }), icon: <Database size={ICON.ui} />, pad: true },
    backlinks: { title: t("rightPanel.backlinks", { defaultValue: "Backlinks" }), icon: <LinkIcon size={ICON.ui} />, count: counts.backlinks, pad: true },
    properties: { title: t("rightPanel.properties", { defaultValue: "Eigenschaften" }), icon: <SlidersHorizontal size={ICON.ui} />, count: counts.properties, pad: true },
  };

  const renderBody = (id: SectionId) => {
    if (id === "calendar") return <CalendarWidget weekRow={step === "minimal"} onOpenDaily={onSelectDate} onOpenCalendarDay={onOpenCalendarDay} onOpenNote={(p) => onOpenPath(p)} loadMarkedDates={loadMarkedDates} activeDate={activeDailyDate} refreshToken={refreshToken} />;
    if (id === "outline") return <OutlineSection />;
    if (id === "graph") return <GraphContextSection activePath={activePath} onOpenPath={onOpenPath} onOpenPathInSplit={onOpenPathInSplit} />;
    if (id === "databases") return <NoteDatabasesSection context={dbContext} activePath={activePath} onOpenPath={onOpenPath} />;
    if (id === "backlinks") return <BacklinksPanel activePath={activePath} onOpenPath={onOpenPath} embedded />;
    return <PropertiesSection onOpenPath={onOpenPath} />;
  };

  /** A section with nothing to show disappears entirely (plan E6) — it used to
   *  keep a greyed-out header, which is why the panel felt cluttered with dead
   *  rows on notes that have no properties, backlinks or database membership. */
  const hasContent = (id: SectionId): boolean =>
    id === "calendar"
    || (id === "graph" && Boolean(activePath && /\.md$/i.test(activePath)))
    || (id === "databases" && hasNoteDatabaseContext(dbContext))
    || (id === "outline" && counts.outline > 0)
    || (id === "backlinks" && counts.backlinks > 0)
    || (id === "properties" && counts.properties > 0);

  return (
    <div
      ref={rootRef}
      className="custom-scrollbar pv-side-right"
      data-side-step={step}
      style={{ width: "100%", height: "100%", background: "var(--bg-secondary)", display: "flex", flexDirection: "column", minHeight: 0, overflowY: "auto" }}
    >
      {shown.filter(hasContent).map((id) => {
        const m = meta[id];
        const drag = handlers(id);
        const isOpen = open[id];
        const isOver = overId === id && dragId !== null && dragId !== id;
        return (
          <section
            key={id}
            className="pv-side-section"
            ref={(el) => { if (el) sectionEls.current[id] = el; else delete sectionEls.current[id]; }}
            style={{ borderBottom: "1px solid var(--border-color-light)", borderTop: isOver ? "2px solid var(--accent-color)" : "2px solid transparent", opacity: dragId === id ? 0.6 : undefined }}
          >
            <div style={{ display: "flex", alignItems: "center", position: "relative" }}>
              <button
                {...drag}
                onClick={() => { if (consumeDragClick()) return; toggle(id); }}
                onContextMenu={(e) => {
                  // A right-click means "menu", so the pending hold is dropped.
                  drag.onContextMenu();
                  e.preventDefault();
                  setMenuAt({ id, x: e.clientX, y: e.clientY });
                }}
                aria-expanded={isOpen}
                className="pv-side-section-header"
                style={{ cursor: dragId === id ? "grabbing" : undefined }}
              >
                <ChevronDown size={ICON.ui} className="pv-side-section-glyph" style={{ transition: "transform var(--dur-2) var(--ease-1)", transform: isOpen ? "none" : "rotate(-90deg)", flexShrink: 0 }} />
                <span className="pv-side-section-glyph">{m.icon}</span>
                <span style={{ flex: 1, textAlign: "left", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.title}</span>
                {m.count !== undefined && m.count > 0 && (
                  <span className="pv-badge pv-badge--accent">
                    {m.count}
                  </span>
                )}
              </button>
            </div>
            {isOpen && <div style={{ padding: m.pad ? "0 0.75rem 0.85rem" : 0 }}>{renderBody(id)}</div>}
          </section>
        );
      })}

      {menuAt && (
        <MenuSurface
          open
          onClose={() => setMenuAt(null)}
          at={{ x: menuAt.x, y: menuAt.y }}
          minWidth={188}
          ariaLabel={meta[menuAt.id].title}
        >
          <MenuLabel>{meta[menuAt.id].title}</MenuLabel>
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
    </div>
  );
}
