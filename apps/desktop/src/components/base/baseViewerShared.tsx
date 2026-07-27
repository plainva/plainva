import type React from "react";
import { List as ListIcon, LayoutGrid, Table as TableIcon, Calendar as CalendarIcon, Clock, PanelRight, StickyNote, Waypoints } from "lucide-react";
import type { TFunction } from "i18next";
import { capitalizeFirst, ICON } from "@plainva/ui";
// Co-located with the module that owns the base-*/base-cfg-* classes, so every
// surface using them is styled — including the create wizard, which opens
// without a BaseViewer (and therefore without the old inline <style>) anywhere.
import "./base.css";

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

