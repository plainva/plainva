import type { LucideIcon } from "lucide-react";
import {
  Archive,
  CalendarDays,
  Cloud,
  FolderTree,
  Info,
  Mail,
  Palette,
  Pencil,
  RefreshCw,
  Rocket,
  ShieldCheck,
  Users,
  Wrench,
} from "lucide-react";

/**
 * Shared settings-area catalog (settings redesign 2026-07-18, P1).
 *
 * ONE source for the order, labels, descriptions and icons of every settings
 * area, rendered by BOTH shells: the desktop modal shows one page per area
 * (variant "quiet cards"), the mobile settings screen lists the same areas as
 * a master list with pushed detail screens. Keeping the catalog here
 * guarantees the two stay congruent.
 *
 * The area id doubles as the page key; it is UI state only and never
 * persisted, so ids may be renamed freely. The desktop `section` contract
 * (GENERAL vs. vault path — which WORLD is shown) is a separate axis and
 * stays untouched by this catalog.
 */
export type SettingsWorld = "app" | "vault";

export interface SettingsAreaDef {
  /** Stable area id — the desktop page key / mobile detail-screen key. */
  id: string;
  world: SettingsWorld;
  /** i18n key of the area title (the established two-worlds keys). */
  labelKey: string;
  /** i18n key of the one-line page description shown under the title. */
  descKey: string;
  icon: LucideIcon;
}

export const SETTINGS_AREAS: readonly SettingsAreaDef[] = [
  { id: "appearance", world: "app", labelKey: "settings.sectionAppearance", descKey: "settings.pageDescAppearance", icon: Palette },
  { id: "editor", world: "app", labelKey: "settings.sectionEditor", descKey: "settings.pageDescEditor", icon: Pencil },
  { id: "behavior", world: "app", labelKey: "settings.sectionBehavior", descKey: "settings.pageDescBehavior", icon: Rocket },
  { id: "updates", world: "app", labelKey: "settings.updates", descKey: "settings.pageDescUpdates", icon: RefreshCw },
  { id: "about", world: "app", labelKey: "settings.about", descKey: "settings.pageDescAbout", icon: Info },
  { id: "cloudAccounts", world: "vault", labelKey: "settings.sectionCloudAccounts", descKey: "settings.pageDescCloudAccounts", icon: Users },
  { id: "sync", world: "vault", labelKey: "settings.syncSection", descKey: "settings.pageDescSync", icon: Cloud },
  { id: "security", world: "vault", labelKey: "settings.sectionSecurity", descKey: "settings.pageDescSecurity", icon: ShieldCheck },
  { id: "pim", world: "vault", labelKey: "settings.sectionPim", descKey: "settings.pageDescPim", icon: CalendarDays },
  { id: "mail", world: "vault", labelKey: "settings.sectionMail", descKey: "settings.pageDescMail", icon: Mail },
  { id: "content", world: "vault", labelKey: "settings.sectionContent", descKey: "settings.pageDescContent", icon: FolderTree },
  { id: "backup", world: "vault", labelKey: "settings.backupSection", descKey: "settings.pageDescBackup", icon: Archive },
  { id: "maintenance", world: "vault", labelKey: "settings.sectionMaintenance", descKey: "settings.pageDescMaintenance", icon: Wrench },
];

/** The areas of one world, in display order. */
export function settingsAreas(world: SettingsWorld): SettingsAreaDef[] {
  return SETTINGS_AREAS.filter((a) => a.world === world);
}

/** Catalog lookup by id (undefined for unknown ids). */
export function settingsArea(id: string): SettingsAreaDef | undefined {
  return SETTINGS_AREAS.find((a) => a.id === id);
}

/** The world's landing page — the first area in display order. */
export function firstSettingsArea(world: SettingsWorld): SettingsAreaDef {
  const first = SETTINGS_AREAS.find((a) => a.world === world);
  /* istanbul ignore next -- the catalog always carries both worlds */
  if (!first) throw new Error(`settings catalog has no areas for world "${world}"`);
  return first;
}
