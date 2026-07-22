import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, GripVertical, CalendarDays, Link as LinkIcon, SlidersHorizontal, List, Waypoints } from "lucide-react";
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
import { ICON } from "@plainva/ui";

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

type SectionId = "calendar" | "outline" | "graph" | "backlinks" | "properties";
const ALL: SectionId[] = ["calendar", "outline", "graph", "backlinks", "properties"];
const ORDER_KEY = "plainva-right-panels-order";
const openKey = (id: SectionId) => `plainva-right-panel-open-${id}`;

function readOrder(): SectionId[] {
  try {
    const raw = JSON.parse(localStorage.getItem(ORDER_KEY) || "[]") as SectionId[];
    const valid = raw.filter((id) => ALL.includes(id));
    for (const id of ALL) if (!valid.includes(id)) valid.push(id);
    return valid.length === ALL.length ? valid : [...ALL];
  } catch {
    return [...ALL];
  }
}

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
  const { queryService, fileTreeVersion } = useVault();
  const [order, setOrder] = useState<SectionId[]>(() => readOrder());
  const [open, setOpen] = useState<Record<SectionId, boolean>>(() => ({
    calendar: readOpen("calendar"), outline: readOpen("outline"), graph: readOpen("graph"), backlinks: readOpen("backlinks"), properties: readOpen("properties"),
  }));
  const [counts, setCounts] = useState<{ backlinks: number; properties: number; outline: number }>({ backlinks: 0, properties: 0, outline: 0 });
  const [dragId, setDragId] = useState<SectionId | null>(null);
  const [overId, setOverId] = useState<SectionId | null>(null);
  // Synchronous mirror of the active drag so pointer handlers don't read stale state.
  const dragIdRef = useRef<SectionId | null>(null);
  // Live DOM node per section, used to map a pointer's Y position onto a target row.
  const sectionEls = useRef<Partial<Record<SectionId, HTMLElement>>>({});

  const toggle = (id: SectionId) => {
    setOpen((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      localStorage.setItem(openKey(id), String(next[id]));
      return next;
    });
  };

  const reorder = useCallback((from: SectionId, to: SectionId) => {
    if (from === to) return;
    setOrder((prev) => {
      const next = prev.filter((x) => x !== from);
      const idx = next.indexOf(to);
      next.splice(idx, 0, from);
      localStorage.setItem(ORDER_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  // Pointer-based reordering. HTML5 drag-and-drop is swallowed by Tauri's native
  // drag-drop handler (dragDropEnabled defaults to true) and is unreliable on
  // WebKitGTK, so we drive the reorder with pointer events instead — engine- and
  // Tauri-config-independent.
  const sectionAtY = (clientY: number): SectionId | null => {
    for (const sid of order) {
      const el = sectionEls.current[sid];
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (clientY >= r.top && clientY <= r.bottom) return sid;
    }
    return null;
  };

  const beginDrag = (id: SectionId, e: React.PointerEvent) => {
    e.preventDefault();
    // Capture so move/up keep firing on the grip even as the pointer leaves it.
    try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch { /* not supported */ }
    dragIdRef.current = id;
    setDragId(id);
    setOverId(id);
  };

  const onGripMove = (e: React.PointerEvent) => {
    if (!dragIdRef.current) return;
    const target = sectionAtY(e.clientY);
    if (target) setOverId(target);
  };

  const endDrag = (e: React.PointerEvent) => {
    const from = dragIdRef.current;
    dragIdRef.current = null;
    try { (e.currentTarget as Element).releasePointerCapture(e.pointerId); } catch { /* not supported */ }
    const to = sectionAtY(e.clientY); // computed fresh, never from stale state
    if (from && to && from !== to) reorder(from, to);
    setDragId(null);
    setOverId(null);
  };

  const cancelDrag = () => {
    dragIdRef.current = null;
    setDragId(null);
    setOverId(null);
  };

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
    backlinks: { title: t("rightPanel.backlinks", { defaultValue: "Backlinks" }), icon: <LinkIcon size={ICON.ui} />, count: counts.backlinks, pad: true },
    properties: { title: t("rightPanel.properties", { defaultValue: "Eigenschaften" }), icon: <SlidersHorizontal size={ICON.ui} />, count: counts.properties, pad: true },
  };

  const renderBody = (id: SectionId) => {
    if (id === "calendar") return <CalendarWidget onOpenDaily={onSelectDate} onOpenCalendarDay={onOpenCalendarDay} onOpenNote={(p) => onOpenPath(p)} loadMarkedDates={loadMarkedDates} activeDate={activeDailyDate} refreshToken={refreshToken} />;
    if (id === "outline") return <OutlineSection />;
    if (id === "graph") return <GraphContextSection activePath={activePath} onOpenPath={onOpenPath} onOpenPathInSplit={onOpenPathInSplit} />;
    if (id === "backlinks") return <BacklinksPanel activePath={activePath} onOpenPath={onOpenPath} embedded />;
    return <PropertiesSection onOpenPath={onOpenPath} />;
  };

  return (
    <div
      className="custom-scrollbar"
      style={{ width: "100%", height: "100%", background: "var(--bg-secondary)", display: "flex", flexDirection: "column", minHeight: 0, overflowY: "auto" }}
    >
      {order.map((id) => {
        const m = meta[id];
        // Empty note-context sections close only EFFECTIVELY. Their persisted
        // global preference remains untouched and returns as soon as the next
        // note has content again (no "No properties for this file" panel).
        const hasContent = id === "calendar"
          || (id === "graph" && Boolean(activePath && /\.md$/i.test(activePath)))
          || (id === "outline" && counts.outline > 0)
          || (id === "backlinks" && counts.backlinks > 0)
          || (id === "properties" && counts.properties > 0);
        const isOpen = hasContent && open[id];
        const isOver = overId === id && dragId !== null && dragId !== id;
        return (
          <section
            key={id}
            className="pv-side-section"
            ref={(el) => { if (el) sectionEls.current[id] = el; else delete sectionEls.current[id]; }}
            style={{ borderBottom: "1px solid var(--border-color-light)", borderTop: isOver ? "2px solid var(--accent-color)" : "2px solid transparent" }}
          >
            <div style={{ display: "flex", alignItems: "center", position: "relative" }}>
              <span
                className="pv-side-grip"
                onPointerDown={(e) => { if (e.button === 0) beginDrag(id, e); }}
                onPointerMove={onGripMove}
                onPointerUp={endDrag}
                onPointerCancel={cancelDrag}
                role="button"
                aria-label={t("rightPanel.reorder", { defaultValue: "Abschnitt verschieben" })}
                data-tip={t("rightPanel.reorder", { defaultValue: "Abschnitt verschieben" })}
                style={{ position: "absolute", left: 0, top: 0, bottom: 0, display: "flex", alignItems: "center", padding: "0 2px", color: "var(--text-faint)", cursor: dragId ? "grabbing" : "grab", touchAction: "none", opacity: dragId ? 1 : undefined }}
              >
                <GripVertical size={ICON.ui} />
              </span>
              <button
                onClick={() => { if (hasContent) toggle(id); }}
                aria-expanded={isOpen}
                aria-disabled={!hasContent}
                className="pv-side-section-header"
              >
                <ChevronDown size={ICON.ui} className="pv-side-section-glyph" style={{ transition: "transform var(--dur-2) var(--ease-1)", transform: isOpen ? "none" : "rotate(-90deg)", flexShrink: 0 }} />
                <span className="pv-side-section-glyph">{m.icon}</span>
                <span style={{ flex: 1, textAlign: "left" }}>{m.title}</span>
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
    </div>
  );
}
