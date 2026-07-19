import type React from "react";
import { List as ListIcon, LayoutGrid, Table as TableIcon, Calendar as CalendarIcon, Clock, PanelRight, StickyNote, Waypoints } from "lucide-react";
import type { TFunction } from "i18next";
import { capitalizeFirst, ICON } from "@plainva/ui";

// Shared constants and helpers for the BaseViewer and its view components
// (structural split of the former single-file BaseViewer, plan C3).

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return String(bytes);
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) { value /= 1024; i++; }
  return `${value.toFixed(1)} ${units[i]}`;
}

export const EXTENDED_TYPES = ["board", "calendar", "timeline", "graph", "pinboard"];
export const ALL_VIEW_TYPES = ["table", "list", "gallery", "board", "calendar", "timeline", "graph", "pinboard"];

/**
 * The ONE list of `.base` column input types with their localized labels —
 * shared by the config panel's new-property form, the creation wizard and the
 * column editor, so no surface ever misses a type or names it differently
 * (maintainer report: Relation/Status were absent from two of the three).
 *
 * Since the Gesamtplan 2026-07-04 (P7) this is the SAME vocabulary as the
 * markdown properties panel (labels via `properties.type_*`), extended by
 * `relation` — the panel's generic `link` type is the base's relation. The
 * grouped picker in the column editor (PropertyValues.BASE_TYPE_GROUPS) must
 * cover exactly these values (regression-tested).
 */
export function baseInputTypeOptions(
  t: TFunction | ((key: string, defaultValue?: string) => string)
): { value: string; label: string }[] {
  const tr = t as (key: string, defaultValue?: string) => string;
  return [
    { value: "text", label: tr("properties.type_text", "Text") },
    { value: "number", label: tr("properties.type_number", "Zahl") },
    { value: "checkbox", label: tr("properties.type_checkbox", "Kontrollkästchen") },
    { value: "date", label: tr("properties.type_date", "Datum") },
    { value: "datetime", label: tr("properties.type_datetime", "Datum & Uhrzeit") },
    { value: "select", label: tr("properties.type_select", "Auswählen") },
    { value: "status", label: tr("properties.type_status", "Status") },
    { value: "multiselect", label: tr("properties.type_multiselect", "Mehrfachauswahl") },
    { value: "list", label: tr("properties.type_list", "Liste") },
    { value: "tags", label: tr("properties.type_tags", "Tags") },
    { value: "relation", label: tr("properties.type_relation", "Relation") },
    { value: "url", label: tr("properties.type_url", "URL") },
    { value: "email", label: tr("properties.type_email", "E-Mail") },
    { value: "phone", label: tr("properties.type_phone", "Telefon") },
  ];
}

/**
 * Human-readable, localized display label of a column (point 3): the built-in
 * file properties get proper names instead of their raw keys, note properties
 * honor an Obsidian `displayName` (kept verbatim on `_obsidian.properties`) and
 * otherwise show their bare frontmatter key.
 */
export function columnLabel(col: string, t: TFunction, dbConfig?: any): string {
  if (col === "file.name") return t("database.colFileName", "Name");
  if (col === "file.mtime") return t("database.colModified", "Geändert");
  if (col === "file.size") return t("database.colSize", "Größe");
  if (col === "file.path") return t("database.colPath", "Pfad");
  if (col.startsWith("file.")) return col.slice(5);
  const bare = col.replace(/^note\./, "");
  const displayName = dbConfig?._obsidian?.properties?.[`note.${bare}`]?.displayName
    ?? dbConfig?._obsidian?.properties?.[bare]?.displayName;
  if (typeof displayName === "string" && displayName.trim()) return displayName;
  // No Obsidian displayName: title-case the first letter of the bare frontmatter
  // key for display (maintainer 2026-07-07). Display-only — the on-disk key and
  // Obsidian stay lowercase; tables/board/graph read "Bereich", not "bereich".
  return capitalizeFirst(bare);
}

// capitalizeFirst moved to @plainva/ui (R4) — imported above, re-exported here.
export { capitalizeFirst };

export const defaultViewName = (t: TFunction, type: string): string => {
  const key = ALL_VIEW_TYPES.includes(type) ? type : "table";
  const cap = key.charAt(0).toUpperCase() + key.slice(1);
  return t(`database.view${cap}`, cap);
};

export const viewLabel = (t: TFunction, view: any): string => view?.name || defaultViewName(t, view?.type || "table");

export const viewIcon = (type: string) => {
  if (type === "list") return <ListIcon size={ICON.ui} />;
  if (type === "gallery" || type === "board") return <LayoutGrid size={ICON.ui} />;
  if (type === "calendar") return <CalendarIcon size={ICON.ui} />;
  if (type === "timeline") return <Clock size={ICON.ui} />;
  if (type === "graph") return <Waypoints size={ICON.ui} />;
  if (type === "pinboard") return <StickyNote size={ICON.ui} />;
  return <TableIcon size={ICON.ui} />;
};

/**
 * Sentinel drop-target key: dropping a card on the split zone opens the note in
 * the neighboring pane instead of writing a group/date value (Base-UX2 P5).
 * Never collides with real group keys (boards use "__UNGROUPED__"-style
 * sentinels only for the no-value bucket) or ISO dates.
 */
export const OPEN_SPLIT_TARGET = "__OPEN_SPLIT__";

/**
 * Drop zone shown at the right edge of a view while a card drag is active
 * (P5): dropping there opens the dragged note in the split. The host view
 * registers it like any other drop target under OPEN_SPLIT_TARGET.
 */
export function SplitDropZone({
  active,
  over,
  registerTarget,
  label,
}: {
  active: boolean;
  over: boolean;
  registerTarget: (el: HTMLElement | null) => void;
  label: string;
}) {
  if (!active) return null;
  return (
    <div
      ref={registerTarget}
      role="presentation"
      data-tip={label}
      style={{
        position: "absolute",
        top: 8,
        right: 8,
        bottom: 8,
        width: 64,
        zIndex: "var(--z-popover)" as unknown as number,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        borderRadius: "var(--radius-md)",
        border: `2px dashed ${over ? "var(--accent-color)" : "var(--border-color)"}`,
        background: "var(--bg-secondary)",
        color: over ? "var(--accent-color)" : "var(--text-muted)",
        opacity: 0.95,
      }}
    >
      <PanelRight size={ICON.head} />
      <span style={{ writingMode: "vertical-rl", fontSize: "var(--text-sm)", maxHeight: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
    </div>
  );
}

/**
 * Floating card preview that follows the pointer during a card drag (P2, "the
 * card sticks to the mouse"). `setEl` and `baseStyle` come from
 * useCardPointerDrag's `ghostProps` (the hook positions the element directly in
 * the DOM); the view supplies the card-like visuals via `style` and `children`.
 * Render it only while a drag is armed (`draggingPath` set).
 */
export function DragGhost({
  setEl,
  baseStyle,
  style,
  children,
}: {
  setEl: (el: HTMLElement | null) => void;
  baseStyle: React.CSSProperties;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  // The fixed/pointer-events/z-index triad lives on the shared class now (the
  // `left`/`top` offset is the only part `baseStyle` still carries — it is
  // written straight to the DOM node per pointermove, outside React).
  return (
    <div ref={setEl} aria-hidden="true" className="pv-fixed-ghost" style={{ ...baseStyle, ...style }}>
      {children}
    </div>
  );
}

// The .base `views[]` array with a guaranteed first entry; `fallbackType` seeds
// the implicit default view when the config has none yet.
export const ensureViews = (cfg: any, fallbackType: string): any[] =>
  (Array.isArray(cfg?.views) && cfg.views.length > 0 ? cfg.views : [{ type: fallbackType }]);

// Global styles for the viewer shell and all views; rendered once by BaseViewer.
export const BASE_VIEWER_STYLES = `
  .table-row-hover:hover td { background-color: var(--bg-hover); }
  .base-col-grip { opacity: 0; transition: opacity var(--dur-1) var(--ease-1); }
  th:hover .base-col-grip { opacity: 0.55; }
  .base-th-actions { opacity: 0; transition: opacity var(--dur-1) var(--ease-1); }
  th:hover .base-th-actions, .base-th-actions:focus-within { opacity: 1; }
  .base-col-grip:active { cursor: grabbing; }
  th.base-col-drop { box-shadow: inset 2px 0 0 var(--accent-color); }
  .base-col-resize { opacity: 0; }
  th:hover .base-col-resize { opacity: 1; background: linear-gradient(to right, transparent, var(--border-color)); }
  .base-col-resize:hover { background: var(--accent-color) !important; opacity: 0.5; }
  .base-inline-editor { display: flex; flex-direction: column; gap: 4px; min-width: 170px; max-width: 280px; background: var(--bg-primary); border: 1px solid var(--accent-color); border-radius: var(--radius-md); padding: 6px; box-shadow: var(--shadow-2); }
  .base-inline-chips { display: flex; flex-wrap: wrap; gap: 4px; }
  .base-inline-select, .base-inline-input { padding: 4px 6px; border: 1px solid var(--border-color); border-radius: var(--radius-xs); background: var(--bg-secondary); color: var(--text-main); font-size: var(--text-sm); outline: none; }
  .base-inline-results { display: flex; flex-direction: column; max-height: 160px; overflow-y: auto; }
  .base-inline-result { text-align: left; background: transparent; border: none; cursor: pointer; color: var(--text-main); padding: 4px 6px; border-radius: var(--radius-xs); font-size: var(--text-sm); }
  .base-inline-result:hover { background: var(--state-hover); }
  .base-inline-create { color: var(--accent-color); }
  .base-inline-create:disabled { opacity: 0.6; cursor: progress; }
  .base-subitem-toggle { display: inline-flex; align-items: center; justify-content: center; width: 19px; height: 19px; flex-shrink: 0; background: none; border: none; border-radius: var(--radius-xs); cursor: pointer; color: var(--text-muted); padding: 0; }
  .base-subitem-toggle:hover { background: var(--state-hover); color: var(--text-main); }
  .base-subitem-badge { flex-shrink: 0; font-size: var(--text-xs); color: var(--text-muted); background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: var(--radius-pill); padding: 0 6px; line-height: 1.5; }
  .base-period-toolbar { display: flex; align-items: center; gap: 0.5rem; padding: 0.5rem 1rem; border-bottom: 1px solid var(--border-color); flex-wrap: wrap; }
  .base-nav-btn { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: var(--radius-md); border: 1px solid var(--border-color); background: var(--bg-secondary); color: var(--text-main); cursor: pointer; }
  .base-nav-btn:hover { background: var(--state-hover); }
  .base-today-btn { padding: 4px 10px; border-radius: var(--radius-md); border: 1px solid var(--border-color); background: var(--bg-secondary); color: var(--text-main); cursor: pointer; font-size: var(--text-sm); }
  .base-today-btn:hover { background: var(--state-hover); }
  .base-config-panel { flex: 0 1 360px; min-width: 280px; max-width: 460px; border-left: 1px solid var(--border-color); background: var(--bg-secondary); display: flex; flex-direction: column; min-height: 0; }
  .base-cfg-head { display: flex; align-items: center; justify-content: space-between; }
  /* Config redesign 2026-07-18 (variant C, reiter panel): context strip +
     icon-only tabs at the top, one area in a scrolling body below. */
  .base-cfg-ctx { display: flex; align-items: center; gap: 6px; padding: 0.75rem 0.9rem 0.5rem; }
  .base-cfg-ctx-icon { color: var(--text-muted); display: flex; flex-shrink: 0; }
  .base-cfg-ctx-name { font-weight: 600; font-size: var(--text-md); color: var(--text-main); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .base-cfg-ctx-type { font-size: var(--text-sm); color: var(--text-muted); flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  /* Icon-only segmented control (maintainer 2026-07-18): a filled pill track,
     the active tab lifts onto the surface with a soft shadow — same look as the
     shared .pv-segmented and the mobile settings segment. One row, no wrap. */
  .base-cfg-tabs { display: flex; gap: 2px; padding: 3px; margin: 0 0.9rem 8px; background: var(--surface-container); border-radius: var(--radius-pill); }
  .base-cfg-tab { flex: 1; display: inline-flex; align-items: center; justify-content: center; height: calc(var(--control-md) - 6px); border: none; background: transparent; color: var(--text-muted); cursor: pointer; border-radius: var(--radius-pill); }
  .base-cfg-tab:hover:not(.active) { background: var(--state-hover); color: var(--text-main); }
  .base-cfg-tab.active { background: var(--surface); color: var(--accent-color); box-shadow: var(--shadow-1); }
  .base-cfg-tab.disabled { opacity: 0.4; cursor: not-allowed; }
  .base-cfg-tab.disabled:hover { background: transparent; color: var(--text-muted); }
  .base-cfg-body { flex: 1; min-height: 0; overflow-y: auto; padding: 0.7rem 0.95rem 1.1rem; display: flex; flex-direction: column; gap: 14px; }
  /* Per-area page head + named group cards (mockup treatment 2026-07-18, same
     quiet-card tokens as the settings menu). */
  .base-cfg-pagehead { display: flex; flex-direction: column; gap: 1px; }
  .base-cfg-pagetitle { font-size: var(--text-md); font-weight: 600; color: var(--text-main); }
  .base-cfg-pagedesc { font-size: var(--text-sm); color: var(--text-muted); line-height: 1.4; }
  .base-cfg-group { display: flex; flex-direction: column; gap: 6px; }
  .base-cfg-grouplabel { padding: 0 2px; font-size: var(--text-xs); font-weight: 600; letter-spacing: 0.5px; text-transform: uppercase; color: var(--text-faint); }
  .base-cfg-card { background: var(--surface-container-low); border: 1px solid var(--border-color-light); border-radius: var(--radius-lg); overflow: hidden; }
  .base-cfg-cardrow { display: flex; align-items: center; gap: 8px; padding: 10px 14px; border-bottom: 1px solid var(--border-color-light); }
  .base-cfg-card > .base-cfg-cardrow:last-child { border-bottom: none; }
  .base-cfg-cardrow--split { justify-content: space-between; }
  .base-cfg-cardrow--field { flex-direction: column; align-items: stretch; gap: 6px; }
  .base-cfg-rowlabel { flex: 1; min-width: 0; font-size: var(--text-sm); color: var(--text-main); }
  /* Label-above-control field (date-field pickers etc.). Was referenced from
     BaseConfigPanel but never defined — rendered unstyled (P0, sweep 2026-07-19). */
  .base-cfg-field { display: flex; flex-direction: column; align-items: stretch; gap: 5px; font-size: var(--text-sm); color: var(--text-main); }
  .base-cfg-typegrid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
  .base-cfg-typetile { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 5px; padding: 12px 2px; min-height: 62px; border: 1px solid var(--border-color-light); border-radius: var(--radius-lg); background: var(--surface-container-low); color: var(--text-muted); cursor: pointer; font-size: var(--text-xs); }
  .base-cfg-typetile:hover { border-color: var(--text-muted); color: var(--text-main); }
  .base-cfg-typetile.active { border-color: var(--accent-color); background: var(--bg-hover); color: var(--accent-color); }
  .base-cfg-typetile-label { line-height: 1.2; }
  .base-cfg-colname { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--text-ui); color: var(--text-main); }
  .base-cfg-typebadge { flex-shrink: 0; font-size: var(--text-xs); color: var(--text-muted); background: var(--bg-secondary); border: 1px solid var(--border-color); padding: 0 6px; border-radius: var(--radius-pill); }
  .base-cfg-filterchip { display: flex; align-items: center; gap: 8px; padding: 8px 14px; border-bottom: 1px solid var(--border-color-light); }
  .base-cfg-card > .base-cfg-filterchip:last-child { border-bottom: none; }
  .base-cfg-chipsentence { flex: 1; min-width: 0; display: flex; align-items: center; flex-wrap: wrap; gap: 5px; text-align: left; background: transparent; border: none; padding: 0; cursor: pointer; color: var(--text-main); font-size: var(--text-sm); }
  .base-cfg-chip-col { font-weight: 600; color: var(--text-main); }
  .base-cfg-chip-op { color: var(--text-muted); }
  .base-cfg-chip-val { background: var(--bg-hover); color: var(--accent-color); padding: 1px 7px; border-radius: var(--radius-pill); font-size: var(--text-xs); }
  .base-cfg-filteredit { display: flex; flex-direction: column; gap: 4px; padding: 8px 14px; border-bottom: 1px solid var(--border-color-light); }
  .base-cfg-card > .base-cfg-filteredit:last-child { border-bottom: none; }
  /* Option blocks + rows dropped into a card become label-left/control-right
     card rows with hairline separators (mockup treatment). */
  .base-cfg-card .base-cfg-field { flex-direction: row; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 14px; border-bottom: 1px solid var(--border-color-light); }
  .base-cfg-card .base-cfg-field:last-child { border-bottom: none; }
  .base-cfg-card > .base-cfg-colrow { padding: 8px 14px; border-bottom: 1px solid var(--border-color-light); }
  .base-cfg-card > .base-cfg-colrow:last-child { border-bottom: none; }
  .base-cfg-card > .base-cfg-chiprow { padding: 10px 14px; border-bottom: 1px solid var(--border-color-light); background: transparent; }
  .base-cfg-card > .base-cfg-chiprow:last-child { border-bottom: none; }
  .base-cfg-card > .base-cfg-filterrow { padding: 8px 14px; border-bottom: 1px solid var(--border-color-light); }
  .base-cfg-card > .base-cfg-filterrow:last-child { border-bottom: none; }
  .base-cfg-card > .base-cfg-filtergroup { margin: 8px; }
  .base-cfg-headtitle { font-weight: 600; font-size: var(--text-md); display: flex; align-items: center; gap: 6px; color: var(--text-main); }
  .base-cfg-close { background: none; border: none; cursor: pointer; color: var(--text-muted); display: flex; padding: 2px; border-radius: var(--radius-xs); }
  .base-cfg-close:hover { background: var(--state-hover); }
  .base-cfg-section { display: flex; flex-direction: column; gap: 4px; }
  .base-config-panel > .base-cfg-section + .base-cfg-section { border-top: 1px solid var(--border-color); padding-top: 0.9rem; }
  .base-cfg-title { font-size: var(--text-xs); font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.04em; }
  .base-cfg-newprop { display: flex; flex-direction: column; gap: 6px; border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 8px; background: var(--bg-primary); margin-top: 4px; }
  .base-cfg-subtitle { font-size: var(--text-xs); font-weight: 600; color: var(--text-muted); text-transform: uppercase; margin-top: 8px; }
  .base-cfg-check { display: flex; align-items: center; gap: 8px; padding: 3px 2px; cursor: pointer; font-size: var(--text-ui); color: var(--text-main); }
  .base-cfg-colrow { display: flex; align-items: center; gap: 6px; }
  .base-cfg-badge { font-size: var(--text-xs); color: var(--accent-color); background: var(--bg-hover); padding: 1px 5px; border-radius: var(--radius-xs); margin-left: auto; flex-shrink: 0; }
  .base-cfg-iconbtn { background: none; border: none; cursor: pointer; color: var(--text-muted); display: flex; padding: 2px; flex-shrink: 0; }
  .base-cfg-empty { font-size: var(--text-sm); color: var(--text-faint); }
  .base-cfg-chiprow { display: flex; align-items: center; justify-content: space-between; gap: 6px; background: var(--bg-primary); padding: 4px 8px; border-radius: var(--radius-xs); font-size: var(--text-sm); color: var(--text-main); }
  .base-cfg-delbtn { background: transparent; border: none; cursor: pointer; color: var(--error-text); display: flex; }
  .base-cfg-input { padding: 4px; border-radius: var(--radius-xs); background: var(--bg-primary); color: var(--text-main); border: 1px solid var(--border-color); font-size: var(--text-sm); }
  .base-cfg-addbtn { padding: 4px 8px; border-radius: var(--radius-xs); background: var(--accent-color); color: var(--accent-on); border: none; cursor: pointer; font-size: var(--text-sm); }
  .base-cfg-filterrow { display: flex; align-items: center; gap: 4px; }
  .base-cfg-row-drop { box-shadow: inset 0 2px 0 var(--accent-color); }
  .base-cfg-grip { display: flex; cursor: grab; touch-action: none; color: var(--text-muted); flex-shrink: 0; }
  .base-cfg-grip:active { cursor: grabbing; }
  .base-cfg-dirbtn { display: inline-flex; align-items: center; gap: 4px; padding: 4px 8px; border: 1px solid var(--border-color); border-radius: var(--radius-md); background: var(--bg-primary); color: var(--text-main); cursor: pointer; font-size: var(--text-xs); flex-shrink: 0; white-space: nowrap; }
  .base-cfg-dirbtn:hover { background: var(--state-hover); }
  .base-cfg-addrow { display: inline-flex; align-items: center; gap: 4px; padding: 4px 6px; background: transparent; border: none; border-radius: var(--radius-xs); color: var(--text-muted); cursor: pointer; font-size: var(--text-sm); text-align: left; align-self: flex-start; }
  .base-cfg-addrow:hover { background: var(--state-hover); color: var(--text-main); }
  .base-cfg-addrow:disabled { opacity: 0.4; cursor: default; }
  .base-cfg-seg { display: inline-flex; border: 1px solid var(--border-color); border-radius: var(--radius-md); overflow: hidden; flex-shrink: 0; }
  .base-cfg-seg button { background: transparent; border: none; padding: 2px 8px; font-size: var(--text-xs); color: var(--text-muted); cursor: pointer; }
  .base-cfg-seg button.active { background: var(--accent-container); color: var(--on-accent-container); font-weight: 600; }
  .base-cfg-field { display: flex; flex-direction: column; gap: 4px; font-size: var(--text-sm); color: var(--text-muted); }
  .base-view-tabs { display: inline-flex; align-items: center; flex-wrap: wrap; gap: 2px; margin-left: 0.25rem; padding: 3px; background: var(--surface-container); border-radius: var(--radius-pill); }
  .base-view-tab { position: relative; display: flex; align-items: center; border-radius: var(--radius-pill); }
  .base-view-tab.active { background: var(--surface); box-shadow: var(--shadow-1); }
  .base-view-tab.drop { box-shadow: inset 2px 0 0 var(--accent-color); }
  .base-view-tab-btn { display: flex; align-items: center; gap: 5px; background: transparent; border: none; cursor: pointer; color: var(--text-muted); padding: 4px 10px; border-radius: var(--radius-pill); font-size: var(--text-ui); max-width: 180px; }
  .base-view-tab:not(.active) .base-view-tab-btn:hover { color: var(--text-main); }
  .base-view-tab.active .base-view-tab-btn { color: var(--accent-color); font-weight: 600; }
  .base-view-tab-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .base-view-tab-caret { background: transparent; border: none; cursor: pointer; color: var(--accent-color); display: flex; padding: 2px 6px 2px 0; }
  .base-view-add { display: flex; align-items: center; justify-content: center; background: transparent; border: none; cursor: pointer; color: var(--text-muted); padding: 4px 8px; border-radius: var(--radius-pill); }
  .base-view-add:hover { background: var(--state-hover); color: var(--text-main); }
  .base-menu-backdrop { position: fixed; inset: 0; z-index: var(--z-popover); }
  .base-view-menu { position: absolute; top: 100%; left: 0; margin-top: 4px; z-index: var(--z-menu); background: var(--bg-primary); border: 1px solid var(--border-color); border-radius: var(--radius-md); box-shadow: var(--shadow-2); padding: 0.25rem; min-width: 160px; display: flex; flex-direction: column; }
  .base-view-menu button { display: flex; align-items: center; gap: 6px; width: 100%; text-align: left; background: transparent; border: none; cursor: pointer; color: var(--text-main); padding: 6px 8px; border-radius: var(--radius-xs); font-size: var(--text-ui); }
  .base-view-menu button:hover { background: var(--state-hover); }
  .base-view-menu button:disabled { opacity: 0.4; cursor: not-allowed; }
  .base-view-menu button.danger { color: var(--error-text); }
  .base-menu-sep { height: 1px; margin: var(--space-1) 6px; background: var(--border-color-light); }
`;
