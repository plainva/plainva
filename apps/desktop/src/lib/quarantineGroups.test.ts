import { describe, expect, it } from "vitest";
import { groupQuarantine, isQuarantineGroupOpen, quarantineGroupActionIds, quarantineReasonKeys, quarantineTextVars } from "@plainva/ui";
import type { WorkspaceQuarantineRecord } from "@plainva/core";

/**
 * The quarantine list as groups (finding 2026-09-03): one cause on one
 * device is one group, a gap and what waits behind it are one group, and a
 * legacy row without a cause still has a place.
 */
function record(over: Partial<WorkspaceQuarantineRecord> & { quarantineId: string }): WorkspaceQuarantineRecord {
  return {
    artifactKind: "operation", remoteKey: `.pvws/operations/${over.quarantineId}.pvop`, artifactBase64: "AA==", artifactSha256: "00",
    errorCode: "integrity", reasonCode: "operation.chainGap", reason: "device operation chain has a gap or predecessor mismatch", details: null,
    firstSeenAt: "2026-09-03T10:00:00.000Z", lastTriedAt: "2026-09-03T10:00:00.000Z", status: "pending", resolvedAt: null, ...over,
  };
}

describe("groupQuarantine", () => {
  it("files a gap and everything blocked behind it as one group, explained by the gap", () => {
    const groups = groupQuarantine([
      record({ quarantineId: "b1", reasonCode: "operation.chainBlocked", reason: "blocked", details: { deviceId: "d1", deviceName: "ASUS", sequence: 15, blockedBy: "g" }, firstSeenAt: "2026-09-03T10:00:01.000Z" }),
      record({ quarantineId: "g", details: { deviceId: "d1", deviceName: "ASUS", expectedSequence: 14, foundSequence: 16 } }),
      record({ quarantineId: "b2", reasonCode: "operation.chainBlocked", reason: "blocked", details: { deviceId: "d1", deviceName: "ASUS", sequence: 16, blockedBy: "g" }, firstSeenAt: "2026-09-03T10:00:02.000Z", lastTriedAt: "2026-09-03T12:00:00.000Z" }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ family: "chainGap", deviceName: "ASUS", pending: 3, firstSeenAt: "2026-09-03T10:00:00.000Z", lastTriedAt: "2026-09-03T12:00:00.000Z" });
    expect(groups[0].details).toMatchObject({ expectedSequence: 14, foundSequence: 16 });
    expect(quarantineTextVars(groups[0], "?")).toMatchObject({ device: "ASUS", count: 3, expected: 14, found: 16 });
  });

  it("separates causes, devices and artifact kinds, and puts open groups first", () => {
    const groups = groupQuarantine([
      record({ quarantineId: "p", artifactKind: "policy", reasonCode: "policy.pathHash", status: "resolved", resolvedAt: "2026-09-03T11:00:00.000Z", firstSeenAt: "2026-09-03T09:00:00.000Z" }),
      record({ quarantineId: "u1", reasonCode: "operation.policyUnaccepted", details: { deviceId: "d1", deviceName: "ASUS", policyHash: "abc", acceptedPolicyHash: "def" } }),
      record({ quarantineId: "u2", reasonCode: "operation.policyUnaccepted", details: { deviceId: "d2", deviceName: "Pixel" } }),
      record({ quarantineId: "g", details: { deviceId: "d1", deviceName: "ASUS" }, firstSeenAt: "2026-09-03T10:30:00.000Z" }),
    ]);
    expect(groups.map((g) => `${g.artifactKind}.${g.family}@${g.deviceName ?? "-"}`)).toEqual(["operation.chainGap@ASUS", "operation.policyUnaccepted@ASUS", "operation.policyUnaccepted@Pixel", "policy.pathHash@-"]);
    expect(isQuarantineGroupOpen(groups[3])).toBe(false);
    expect(groups[3].resolvedAt).toBe("2026-09-03T11:00:00.000Z");
    expect(quarantineTextVars(groups[1], "?")).toMatchObject({ policy: "abc", accepted: "def" });
  });

  it("gives a legacy row without a cause the unknown family and its raw sentence", () => {
    const groups = groupQuarantine([record({ quarantineId: "old", reasonCode: "unknown", reason: "some old sentence" })]);
    expect(groups[0].family).toBe("unknown");
    expect(groups[0].reason).toBe("some old sentence");
    expect(quarantineReasonKeys("unknown")).toEqual({ title: "workspaceSecurity.quarantineReason.unknown.title", explain: "workspaceSecurity.quarantineReason.unknown.explain", hint: "workspaceSecurity.quarantineReason.unknown.hint" });
    expect(quarantineReasonKeys("binding").hint).toBeNull();
  });

  it("acts on the open entries of a group, or on all when none is open", () => {
    const open = groupQuarantine([record({ quarantineId: "a" }), record({ quarantineId: "b", status: "ignored" })]);
    expect(quarantineGroupActionIds(open[0])).toEqual(["a"]);
    const settled = groupQuarantine([record({ quarantineId: "c", status: "ignored" }), record({ quarantineId: "d", status: "ignored" })]);
    expect(quarantineGroupActionIds(settled[0]).sort()).toEqual(["c", "d"]);
  });
});
