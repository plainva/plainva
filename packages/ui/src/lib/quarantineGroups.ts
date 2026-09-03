import { quarantineReasonFamilyOf, QUARANTINE_HINTED_FAMILIES, type QuarantineReasonFamily, type WorkspaceQuarantineRecord } from "@plainva/core";

/**
 * The quarantine list as groups (finding 2026-09-03), for both shells.
 *
 * One entry per remote artifact is the right record and the wrong list: a
 * broken device chain put twelve identical rows in front of the reader, each
 * with the same English sentence and four buttons. A GROUP is what the reader
 * can act on - one cause on one device, with a count, the time it started,
 * and the one explanation that fits all of its entries. Entries blocked behind
 * a gap belong to the gap's group: they are its consequence, not a second
 * problem.
 *
 * Pure, so the desktop card and the phone's screen share it and a test can
 * pin it without a renderer.
 */
export interface QuarantineGroup {
  key: string;
  artifactKind: WorkspaceQuarantineRecord["artifactKind"];
  /** The family the group's texts come from. */
  family: QuarantineReasonFamily;
  deviceId: string | null;
  deviceName: string | null;
  entries: WorkspaceQuarantineRecord[];
  /** Counts by status; a group is OPEN while `pending` is above zero. */
  pending: number;
  ignored: number;
  repaired: number;
  resolved: number;
  firstSeenAt: string;
  lastTriedAt: string;
  /** The latest resolution, for a group that closed itself. */
  resolvedAt: string | null;
  /** What the leading entry knew - sequence numbers, policy hashes. */
  details: Record<string, unknown> | null;
  /** The raw sentence of the leading entry, the fallback for an unknown cause. */
  reason: string;
}

/** The family a group is filed under: what waits behind a gap files with the gap. */
function groupFamily(record: WorkspaceQuarantineRecord): QuarantineReasonFamily {
  const family = quarantineReasonFamilyOf(record.reasonCode);
  return family === "chainBlocked" ? "chainGap" : family;
}

function deviceOf(record: WorkspaceQuarantineRecord): { deviceId: string | null; deviceName: string | null } {
  const details = record.details ?? {};
  return {
    deviceId: typeof details.deviceId === "string" ? details.deviceId : null,
    deviceName: typeof details.deviceName === "string" ? details.deviceName : null,
  };
}

export function groupQuarantine(records: readonly WorkspaceQuarantineRecord[]): QuarantineGroup[] {
  const groups = new Map<string, QuarantineGroup>();
  for (const record of records) {
    const family = groupFamily(record);
    const device = deviceOf(record);
    const key = `${record.artifactKind}|${family}|${device.deviceId ?? ""}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        key, artifactKind: record.artifactKind, family, deviceId: device.deviceId, deviceName: device.deviceName,
        entries: [], pending: 0, ignored: 0, repaired: 0, resolved: 0,
        firstSeenAt: record.firstSeenAt, lastTriedAt: record.lastTriedAt, resolvedAt: null, details: null, reason: record.reason,
      };
      groups.set(key, group);
    }
    group.entries.push(record);
    group[record.status] += 1;
    if (record.firstSeenAt < group.firstSeenAt) group.firstSeenAt = record.firstSeenAt;
    if (record.lastTriedAt > group.lastTriedAt) group.lastTriedAt = record.lastTriedAt;
    if (record.resolvedAt && (!group.resolvedAt || record.resolvedAt > group.resolvedAt)) group.resolvedAt = record.resolvedAt;
    if (!group.deviceName && device.deviceName) group.deviceName = device.deviceName;
    // The gap entry explains the group; a blocked entry only says it waits.
    const leads = quarantineReasonFamilyOf(record.reasonCode) !== "chainBlocked";
    if (leads && (group.details === null || group.entries.length === 1)) { group.details = record.details; group.reason = record.reason; }
  }
  const out = [...groups.values()];
  for (const group of out) group.entries.sort((a, b) => a.firstSeenAt.localeCompare(b.firstSeenAt) || a.remoteKey.localeCompare(b.remoteKey));
  // Open groups first, the newest of each first.
  out.sort((a, b) => Number(isQuarantineGroupOpen(b)) - Number(isQuarantineGroupOpen(a)) || b.firstSeenAt.localeCompare(a.firstSeenAt));
  return out;
}

export function isQuarantineGroupOpen(group: QuarantineGroup): boolean {
  return group.pending > 0;
}

/** The ids a group action (check again, ignore, repaired) touches: its open entries, or all when none is open. */
export function quarantineGroupActionIds(group: QuarantineGroup): string[] {
  const open = group.entries.filter((entry) => entry.status === "pending").map((entry) => entry.quarantineId);
  return open.length > 0 ? open : group.entries.map((entry) => entry.quarantineId);
}

/**
 * The i18n keys of a group's texts. `hint` is null for a family that has no
 * advice beyond its explanation - the screen then shows none rather than a
 * sentence that says nothing.
 */
export function quarantineReasonKeys(family: QuarantineReasonFamily): { title: string; explain: string; hint: string | null } {
  return {
    title: `workspaceSecurity.quarantineReason.${family}.title`,
    explain: `workspaceSecurity.quarantineReason.${family}.explain`,
    hint: QUARANTINE_HINTED_FAMILIES.includes(family) ? `workspaceSecurity.quarantineReason.${family}.hint` : null,
  };
}

export function quarantineKindKey(kind: WorkspaceQuarantineRecord["artifactKind"]): string {
  return `workspaceSecurity.quarantineKind.${kind}`;
}

/**
 * The placeholders a group's explanation may name. Missing numbers read as
 * "?" rather than as the literal placeholder - a legacy entry has no details.
 */
export function quarantineTextVars(group: QuarantineGroup, unknownDevice: string): Record<string, string | number> {
  const details = group.details ?? {};
  const num = (value: unknown): string | number => (typeof value === "number" ? value : "?");
  const str = (value: unknown): string => (typeof value === "string" && value.length > 0 ? value : "?");
  return {
    device: group.deviceName ?? unknownDevice,
    count: group.entries.length,
    expected: num(details.expectedSequence),
    found: num(details.foundSequence),
    policy: str(details.policyHash),
    accepted: str(details.acceptedPolicyHash),
  };
}
