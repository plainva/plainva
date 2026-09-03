import { describe, expect, it } from "vitest";
import {
  CHAIN_BLOCKED_MESSAGE,
  CHAIN_GAP_MESSAGE,
  MemoryWorkspaceStateStore,
  QUARANTINE_REASON_FAMILIES,
  WorkspaceProtocolError,
  WorkspaceQuarantineService,
  quarantineReasonCode,
  quarantineReasonFamily,
  quarantineReasonFamilyOf,
  splitDeviceChains,
  type WorkspaceQuarantineRecord,
} from "../src/index.js";

/**
 * The quarantine list as a person reads it (finding 2026-09-03).
 *
 * Twelve rows "operation · pending" with an English protocol sentence, a
 * retry that changed nothing visible, and no path that ever closed an entry.
 * What these pin: every diagnostic sentence has a stable cause; a broken
 * chain is ONE gap plus what waits behind it; a successful pull resolves what
 * it validated; and "check again" answers with what is still open.
 */

function record(over: Partial<WorkspaceQuarantineRecord> & { quarantineId: string }): WorkspaceQuarantineRecord {
  return {
    artifactKind: "operation", remoteKey: `.pvws/operations/${over.quarantineId}.pvop`, artifactBase64: "AA==", artifactSha256: "00",
    errorCode: "integrity", reasonCode: "operation.chainGap", reason: CHAIN_GAP_MESSAGE, details: null,
    firstSeenAt: "2026-09-03T10:00:00.000Z", lastTriedAt: "2026-09-03T10:00:00.000Z", status: "pending", resolvedAt: null, ...over,
  };
}

describe("quarantine reason codes", () => {
  it("maps every diagnostic sentence of the worker onto a family", () => {
    const sentences: Array<[string, string]> = [
      ["policy workspace binding mismatch", "binding"],
      ["recovery anchor path hash mismatch", "pathHash"],
      ["operation signature verification failed", "signature"],
      ["catalog signature is invalid", "signature"],
      ["policy is not on the accepted successor chain", "policyChain"],
      ["operation uses an unaccepted policy", "policyUnaccepted"],
      ["operation author is not an active policy device", "authorNotActive"],
      ["operation capability is not granted", "capability"],
      ["operation graph contains missing revision parents", "missingParents"],
      [CHAIN_GAP_MESSAGE, "chainGap"],
      [CHAIN_BLOCKED_MESSAGE, "chainBlocked"],
      ["operation payload object is missing or changed", "payloadMissing"],
      ["workspace head checkpoint is missing or changed", "checkpointMissing"],
      ["content operation is missing payload references", "envelope"],
      ["PVO1 operation binding mismatch", "envelope"],
      ["remote workspace head rolled back below the locally observed sequence", "rollback"],
    ];
    for (const [message, family] of sentences) {
      expect(quarantineReasonFamily(new WorkspaceProtocolError("integrity", message)), message).toBe(family);
      expect(QUARANTINE_REASON_FAMILIES).toContain(family);
    }
  });

  it("calls a parser failure unreadable and anything else unknown", () => {
    expect(quarantineReasonFamily(new SyntaxError("Unexpected token"))).toBe("unreadable");
    expect(quarantineReasonFamily(new WorkspaceProtocolError("format", "document header is malformed"))).toBe("unreadable");
    expect(quarantineReasonFamily(new WorkspaceProtocolError("integrity", "something new"))).toBe("unknown");
    expect(quarantineReasonFamily("not an error")).toBe("unknown");
  });

  it("writes <kind>.<family> and reads it back, tolerating a legacy row without one", () => {
    expect(quarantineReasonCode("operation", new WorkspaceProtocolError("authorization", "operation uses an unaccepted policy"))).toBe("operation.policyUnaccepted");
    expect(quarantineReasonFamilyOf("operation.chainGap")).toBe("chainGap");
    expect(quarantineReasonFamilyOf("unknown")).toBe("unknown");
    expect(quarantineReasonFamilyOf(null)).toBe("unknown");
    expect(quarantineReasonFamilyOf("head.made-up")).toBe("unknown");
  });
});

describe("a broken device chain is one gap and what waits behind it", () => {
  const item = (deviceId: string, sequence: number, previous: string | null, hash: string) => ({ document: { payload: { deviceId, sequence, previousDeviceOperationHash: previous } }, hash, key: `op-${deviceId}-${sequence}` });
  const naming = { deviceName: (id: string) => (id === "dev-a" ? "ASUS-Windows" : null), quarantineId: (it: { key: string }) => `q:${it.key}` };

  it("keeps an intact chain and names nothing", () => {
    const { valid, broken } = splitDeviceChains([item("dev-a", 2, "h1", "h2"), item("dev-a", 1, null, "h1")], naming);
    expect(valid.map((v) => v.key)).toEqual(["op-dev-a-1", "op-dev-a-2"]);
    expect(broken).toEqual([]);
  });

  it("records the first break with expected and found, and everything after as blocked by it", () => {
    const { valid, broken } = splitDeviceChains([item("dev-a", 1, null, "h1"), item("dev-a", 3, "h2", "h3"), item("dev-a", 4, "h3", "h4")], naming);
    expect(valid.map((v) => v.key)).toEqual(["op-dev-a-1"]);
    expect(broken.map((b) => b.reason)).toEqual([CHAIN_GAP_MESSAGE, CHAIN_BLOCKED_MESSAGE]);
    expect(broken[0].details).toMatchObject({ deviceId: "dev-a", deviceName: "ASUS-Windows", expectedSequence: 2, foundSequence: 3 });
    expect(broken[1].details).toMatchObject({ deviceId: "dev-a", deviceName: "ASUS-Windows", sequence: 4, blockedBy: "q:op-dev-a-3" });
  });

  it("treats devices independently", () => {
    const { valid, broken } = splitDeviceChains([item("dev-a", 1, null, "h1"), item("dev-b", 1, "wrong", "k1"), item("dev-b", 2, "k1", "k2")], naming);
    expect(valid.map((v) => v.key)).toEqual(["op-dev-a-1"]);
    expect(broken.map((b) => b.item.key)).toEqual(["op-dev-b-1", "op-dev-b-2"]);
    expect(broken[0].details).toMatchObject({ deviceName: null, predecessorMatches: false });
  });
});

describe("the store closes what validated and keeps what was ignored", () => {
  it("resolves the open entries of one remote artifact and leaves the rest", async () => {
    const store = new MemoryWorkspaceStateStore();
    await store.saveQuarantine(record({ quarantineId: "a", remoteKey: "k1" }));
    await store.saveQuarantine(record({ quarantineId: "b", remoteKey: "k2" }));
    await store.saveQuarantine(record({ quarantineId: "c", remoteKey: "k1", status: "ignored" }));
    expect(await store.resolveQuarantine("operation", "k1", "2026-09-03T11:00:00.000Z")).toEqual(["a"]);
    const all = await store.listQuarantine();
    expect(all.find((e) => e.quarantineId === "a")).toMatchObject({ status: "resolved", resolvedAt: "2026-09-03T11:00:00.000Z" });
    expect(all.find((e) => e.quarantineId === "b")?.status).toBe("pending");
    expect(all.find((e) => e.quarantineId === "c")?.status).toBe("ignored");
  });

  it("reopens a re-quarantined entry unless it was ignored, and a retry clears the resolution", async () => {
    const store = new MemoryWorkspaceStateStore();
    await store.saveQuarantine(record({ quarantineId: "a", remoteKey: "k1" }));
    await store.resolveQuarantine("operation", "k1", "2026-09-03T11:00:00.000Z");
    await store.saveQuarantine(record({ quarantineId: "a", remoteKey: "k1", lastTriedAt: "2026-09-03T12:00:00.000Z" }));
    expect((await store.listQuarantine("pending")).map((e) => e.quarantineId)).toEqual(["a"]);
    await store.setQuarantineStatus("a", "ignored");
    await store.saveQuarantine(record({ quarantineId: "a", remoteKey: "k1" }));
    expect((await store.listQuarantine("ignored")).map((e) => e.quarantineId)).toEqual(["a"]);
    await store.setQuarantineStatus("a", "pending");
    expect((await store.listQuarantine("pending"))[0]?.resolvedAt).toBeNull();
  });
});

describe("check again answers with what is still open", () => {
  it("runs the cycle, then counts the asked entries that stayed pending", async () => {
    const store = new MemoryWorkspaceStateStore();
    await store.saveQuarantine(record({ quarantineId: "a", remoteKey: "k1" }));
    await store.saveQuarantine(record({ quarantineId: "b", remoteKey: "k2" }));
    const service = new WorkspaceQuarantineService(store, {
      trigger: () => {},
      // The cycle validates k1 - as the worker would when the artifact reads fine now.
      runNow: async () => { await store.resolveQuarantine("operation", "k1", "2026-09-03T11:00:00.000Z"); },
    });
    expect(await service.retry(["a", "b"])).toEqual({ open: 1, total: 2, checked: true });
  });

  it("says it only queued when the sync cannot promise a cycle", async () => {
    const store = new MemoryWorkspaceStateStore();
    await store.saveQuarantine(record({ quarantineId: "a", remoteKey: "k1" }));
    let triggered = 0;
    const service = new WorkspaceQuarantineService(store, () => { triggered += 1; });
    expect(await service.retry("a")).toEqual({ open: 1, total: 1, checked: false });
    expect(triggered).toBe(1);
  });

  it("ignores and repairs a whole group, and exports a diagnosis without the ciphertext", async () => {
    const store = new MemoryWorkspaceStateStore();
    await store.saveQuarantine(record({ quarantineId: "a", remoteKey: "k1", details: { deviceName: "ASUS-Windows", expectedSequence: 14, foundSequence: 16 } }));
    await store.saveQuarantine(record({ quarantineId: "b", remoteKey: "k2", reasonCode: "operation.chainBlocked", reason: CHAIN_BLOCKED_MESSAGE }));
    await store.saveQuarantine(record({ quarantineId: "c", remoteKey: "k3", artifactKind: "policy", reasonCode: "policy.pathHash" }));
    const service = new WorkspaceQuarantineService(store, () => {});
    await service.ignore(["a", "b"]);
    expect((await store.listQuarantine("ignored")).map((e) => e.quarantineId).sort()).toEqual(["a", "b"]);
    await service.markRepaired("c");
    expect((await store.listQuarantine("repaired")).map((e) => e.quarantineId)).toEqual(["c"]);
    const json = JSON.parse(await service.exportDiagnostics(["a", "b"], { workspaceId: "ws-1" })) as { format: string; workspaceId: string; entries: Array<Record<string, unknown>> };
    expect(json.format).toBe("plainva-quarantine-diagnostics/1");
    expect(json.workspaceId).toBe("ws-1");
    expect(json.entries.map((e) => e.quarantineId).sort()).toEqual(["a", "b"]);
    expect(json.entries[0]).not.toHaveProperty("artifactBase64");
    expect(json.entries.find((e) => e.quarantineId === "a")?.details).toMatchObject({ expectedSequence: 14, foundSequence: 16 });
  });
});
