/**
 * Virtual tab paths (D1): the vault map lives in the normal tab/pane system
 * under a pseudo path. Anything that treats tab paths as vault FILES (save,
 * index-driven icons, reveal, rename) must guard with isVirtualPath().
 * Surfaces that RENDER a tab path (title-bar/pane tab strips, the recents
 * strip, the quick switcher) show the localized label and dedicated icon from
 * virtualTabMeta() instead of the raw pseudo path. Virtual paths never reach
 * the index, so index-driven surfaces (search, tree) can never produce them
 * by themselves.
 */

import type { LucideIcon } from "lucide-react";
import { ListChecks, Waypoints } from "lucide-react";

export const GRAPH_TAB_PATH = "plainva://graph";
export const TASKS_TAB_PATH = "plainva://tasks";

export function isVirtualPath(path: string | null | undefined): boolean {
  return typeof path === "string" && path.startsWith("plainva://");
}

export interface VirtualTabMeta {
  /** i18n key for the view name (resolved by the consumer's `t`). */
  labelKey: string;
  /** Fallback when the key is missing — mirrors the tab strips. */
  defaultLabel: string;
  /** Dedicated icon; the same one the ribbon uses to open the view. */
  icon: LucideIcon;
}

const VIRTUAL_TAB_META: Record<string, VirtualTabMeta> = {
  [GRAPH_TAB_PATH]: { labelKey: "rightPanel.graph", defaultLabel: "Graph", icon: Waypoints },
  [TASKS_TAB_PATH]: { labelKey: "tasks.title", defaultLabel: "Aufgaben", icon: ListChecks },
};

/** Localized label key + icon for a virtual tab path; null for vault files. */
export function virtualTabMeta(path: string | null | undefined): VirtualTabMeta | null {
  if (!path) return null;
  return VIRTUAL_TAB_META[path] ?? null;
}
