import type { LucideIcon } from "lucide-react";
import { KeyRound, Laptop, Layers, Share2, Users, UsersRound } from "lucide-react";

/**
 * Shared security-area catalog (Security & Sharing IA v2, P1/P2).
 *
 * The SECOND level of "Security & Sharing" replaces the settings left column
 * with these management areas (desktop `SecurityNav`; mobile segments reuse the
 * same set). The FIRST level is the security vault page itself (the overview
 * with the protection status, the "finish migration" and the "disconnect from
 * the encrypted cloud" actions) and is reached via the settings vault nav;
 * "‹ Overview" returns to it.
 *
 * Two groups so a single user can ignore the sharing block: "access" (their own
 * devices and recovery) and "sharing" (members, groups, slices, publications).
 */
export type SecurityAreaGroup = "access" | "sharing";

export type SecurityAreaId = "devices" | "recovery" | "members" | "groups" | "slices" | "publications";

export interface SecurityAreaDef {
  id: SecurityAreaId;
  /** i18n key of the area label (reuses the established workspaceSecurity keys). */
  labelKey: string;
  icon: LucideIcon;
  group: SecurityAreaGroup;
}

export const SECURITY_AREAS: readonly SecurityAreaDef[] = [
  { id: "devices", labelKey: "workspaceSecurity.devicesCard", icon: Laptop, group: "access" },
  { id: "recovery", labelKey: "workspaceSecurity.recoveryCard", icon: KeyRound, group: "access" },
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
