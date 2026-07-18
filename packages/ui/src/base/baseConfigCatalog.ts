import type { LucideIcon } from "lucide-react";
import {
  ArrowUpDown,
  CalendarDays,
  Columns3,
  Database,
  Filter,
  GanttChartSquare,
  Images,
  Kanban,
  LayoutDashboard,
  List,
  StickyNote,
  Table2,
  Waypoints,
} from "lucide-react";

/**
 * Shared `.base` configuration catalog (config redesign 2026-07-18, P1).
 *
 * ONE source for the order, labels, icons and scope of every configuration
 * AREA and every view TYPE, rendered by BOTH shells: the desktop config panel
 * shows one area per tab (variant "reiter panel"), the mobile config sheet
 * lists the same areas as a master list with pushed detail screens. Keeping the
 * catalog here guarantees the two stay congruent.
 *
 * The area id is UI state only (never persisted). All mutations still run
 * through the existing shared helpers (filterExpr / baseFormat / propertyModel
 * / …) — this catalog is presentation metadata, not a new data model.
 */

export type BaseConfigAreaId = "view" | "columns" | "filter" | "sort" | "source";

/**
 * Primary scope of an area — makes the per-view vs. database-wide distinction
 * visible (the panel's #1 clarity problem). A few controls inside "view" and
 * "columns" are database-wide (date format, the property schema); those carry
 * their own inline note where they appear.
 */
export type BaseConfigScope = "view" | "database";

export interface BaseConfigAreaDef {
  id: BaseConfigAreaId;
  /** i18n key of the area label (established `database.*` section keys). */
  labelKey: string;
  scope: BaseConfigScope;
  icon: LucideIcon;
}

export const BASE_CONFIG_AREAS: readonly BaseConfigAreaDef[] = [
  { id: "view", labelKey: "database.sectionView", scope: "view", icon: LayoutDashboard },
  { id: "columns", labelKey: "database.properties", scope: "view", icon: Columns3 },
  { id: "filter", labelKey: "database.filter", scope: "view", icon: Filter },
  { id: "sort", labelKey: "database.sort", scope: "view", icon: ArrowUpDown },
  { id: "source", labelKey: "database.sourceConfig", scope: "database", icon: Database },
];

/** Catalog lookup by id (undefined for unknown ids). */
export function baseConfigArea(id: string): BaseConfigAreaDef | undefined {
  return BASE_CONFIG_AREAS.find((a) => a.id === id);
}

/** The landing area — the first in display order ("view"). */
export function firstBaseConfigArea(): BaseConfigAreaDef {
  return BASE_CONFIG_AREAS[0];
}

/**
 * Distinct display metadata per `.base` view type — used by the desktop
 * view-type tile grid and the mobile view-type chips. `type` is the Plainva
 * render type (baseFormat.ts); `extended` marks the Plainva-only types that
 * are gated behind the "advanced databases" vault setting.
 */
export interface BaseViewTypeMeta {
  type: string;
  /** i18n key `database.view<Cap>` (matches the existing view-type labels). */
  labelKey: string;
  icon: LucideIcon;
  /** Plainva-only type (board/calendar/timeline/graph/pinboard). */
  extended: boolean;
}

export const BASE_VIEW_TYPES: readonly BaseViewTypeMeta[] = [
  { type: "table", labelKey: "database.viewTable", icon: Table2, extended: false },
  { type: "list", labelKey: "database.viewList", icon: List, extended: false },
  { type: "gallery", labelKey: "database.viewGallery", icon: Images, extended: false },
  { type: "board", labelKey: "database.viewBoard", icon: Kanban, extended: true },
  { type: "calendar", labelKey: "database.viewCalendar", icon: CalendarDays, extended: true },
  { type: "timeline", labelKey: "database.viewTimeline", icon: GanttChartSquare, extended: true },
  { type: "graph", labelKey: "database.viewGraph", icon: Waypoints, extended: true },
  { type: "pinboard", labelKey: "database.viewPinboard", icon: StickyNote, extended: true },
];

/** View-type metadata lookup (falls back to table for unknown types). */
export function baseViewTypeMeta(type: string): BaseViewTypeMeta {
  return BASE_VIEW_TYPES.find((v) => v.type === type) ?? BASE_VIEW_TYPES[0];
}
