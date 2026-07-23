import type { LucideIcon } from "lucide-react";
import { Laptop, Layers, Share2, Users, UsersRound } from "lucide-react";

/**
 * Shared security-area catalog (Security & Sharing IA v2, P1).
 *
 * The SECOND level of "Security & Sharing" replaces the settings left column
 * with these management areas (desktop `SecurityNav`; mobile segments reuse the
 * same set). The FIRST level is the security vault page itself (the overview
 * with the protection status) and is NOT listed here — the overview is reached
 * via the settings vault nav, and "‹ Overview" returns to it.
 *
 * Two groups so a single user can ignore the sharing block: "access" (their own
 * devices / recovery) and "sharing" (members, groups, slices, publications).
 * Recovery joins the "access" group with its dedicated area in a later package
 * (P2); until then recovery stays on the overview and is not in this list.
 */
export type SecurityAreaGroup = "access" | "sharing";

export type SecurityAreaId = "devices" | "members" | "groups" | "slices" | "publications";

export interface SecurityAreaDef {
  id: SecurityAreaId;
  /** i18n key of the area label (reuses the established workspaceSecurity keys). */
  labelKey: string;
  icon: LucideIcon;
  group: SecurityAreaGroup;
}

export const SECURITY_AREAS: readonly SecurityAreaDef[] = [
  { id: "devices", labelKey: "workspaceSecurity.devicesCard", icon: Laptop, group: "access" },
  { id: "members", labelKey: "workspaceSecurity.members", icon: Users, group: "sharing" },
  { id: "groups", labelKey: "workspaceSecurity.groups", icon: UsersRound, group: "sharing" },
  { id: "slices", labelKey: "workspaceSecurity.slices", icon: Layers, group: "sharing" },
  { id: "publications", labelKey: "workspaceSecurity.publications", icon: Share2, group: "sharing" },
];

/** The two nav groups in display order, with their heading i18n keys. */
export const SECURITY_AREA_GROUPS: readonly { group: SecurityAreaGroup; labelKey: string }[] = [
  { group: "access", labelKey: "workspaceSecurity.groupAccess" },
  { group: "sharing", labelKey: "workspaceSecurity.groupSharing" },
];

/** The areas of one group, in display order. */
export function securityAreas(group: SecurityAreaGroup): SecurityAreaDef[] {
  return SECURITY_AREAS.filter((a) => a.group === group);
}

/** Catalog lookup by id (undefined for unknown ids). */
export function securityArea(id: string): SecurityAreaDef | undefined {
  return SECURITY_AREAS.find((a) => a.id === id);
}
