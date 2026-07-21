import { describe, it, expect } from "vitest";
import {
  PROFILE_SYNC_PATH,
  parseProfile,
  reconcileProfile,
  serializeProfile,
  SettingsSyncStep,
  stableStringify,
  type ProfileDoc,
  type ProfileSettingsPort,
} from "../src/index.js";
import type { ISyncTarget, SyncOperation, PushResult, PullResult } from "../src/index.js";
import type { IVaultAdapter } from "../src/index.js";

function doc(rev: number, deviceId: string, updatedAt: string, values: Record<string, unknown>): ProfileDoc {
  return { format: "plainva-profile", version: 1, rev, updatedAt, deviceId, values };
}

describe("profileFile", () => {
  it("stableStringify is order-independent", () => {
    expect(stableStringify({ a: 1, b: [3, { y: 2, x: 1 }] })).toBe(stableStringify({ b: [3, { x: 1, y: 2 }], a: 1 }));
    expect(stableStringify({ a: 1 })).not.toBe(stableStringify({ a: 2 }));
  });

  it("serialize/parse round-trips and rejects malformed", () => {
    const d = doc(2, "dev1", "2026-07-21T00:00:00Z", { theme: "dark" });
    expect(parseProfile(serializeProfile(d))).toEqual(d);
    expect(parseProfile(null)).toBeNull();
    expect(parseProfile("{not json")).toBeNull();
    expect(parseProfile(JSON.stringify({ format: "other" }))).toBeNull();
    expect(parseProfile(JSON.stringify({ format: "plainva-profile", version: 1 }))).toBeNull();
  });
});

describe("reconcileProfile", () => {
  const now = "2026-07-21T12:00:00Z";

  it("first participation with a remote adopts the shared settings (no clobber)", () => {
    const remote = doc(5, "phone", "2026-07-20T00:00:00Z", { dailyFolder: "Journal" });
    const d = reconcileProfile({ current: { dailyFolder: "Daily" }, local: null, remote, deviceId: "laptop", now });
    expect(d.applyToStore).toEqual({ dailyFolder: "Journal" });
    expect(d.writeLocal).toEqual(remote);
    expect(d.adoptedFrom).toBe("phone");
    expect(d.upload).toBeUndefined();
  });

  it("first participation without a remote publishes the local values as rev 0", () => {
    const d = reconcileProfile({ current: { theme: "nord" }, local: null, remote: null, deviceId: "laptop", now });
    expect(d.upload?.rev).toBe(0);
    expect(d.upload?.values).toEqual({ theme: "nord" });
    expect(d.applyToStore).toBeUndefined();
  });

  it("does nothing on first participation with empty current + no remote", () => {
    expect(reconcileProfile({ current: {}, local: null, remote: null, deviceId: "l", now })).toEqual({});
  });

  it("a local edit bumps rev above both and uploads", () => {
    const local = doc(3, "laptop", "old", { theme: "dark" });
    const remote = doc(4, "phone", "old", { theme: "dark" });
    const d = reconcileProfile({ current: { theme: "light" }, local, remote, deviceId: "laptop", now });
    expect(d.upload?.rev).toBe(5); // max(3,4)+1
    expect(d.upload?.values).toEqual({ theme: "light" });
    expect(d.writeLocal?.rev).toBe(5);
    expect(d.applyToStore).toBeUndefined();
  });

  it("a strictly newer remote (higher rev) is applied", () => {
    const local = doc(3, "laptop", "old", { theme: "dark" });
    const remote = doc(7, "phone", "new", { theme: "light" });
    const d = reconcileProfile({ current: { theme: "dark" }, local, remote, deviceId: "laptop", now });
    expect(d.applyToStore).toEqual({ theme: "light" });
    expect(d.writeLocal).toEqual(remote);
    expect(d.upload).toBeUndefined();
  });

  it("converged (equal rev + equal values) is a no-op", () => {
    const local = doc(3, "laptop", "t", { theme: "dark" });
    const remote = doc(3, "phone", "t", { theme: "dark" });
    expect(reconcileProfile({ current: { theme: "dark" }, local, remote, deviceId: "laptop", now })).toEqual({});
  });

  it("same rev + different values: updatedAt decides", () => {
    const local = doc(3, "laptop", "2026-07-21T09:00:00Z", { theme: "dark" });
    const remoteNewer = doc(3, "phone", "2026-07-21T10:00:00Z", { theme: "light" });
    const applied = reconcileProfile({ current: { theme: "dark" }, local, remote: remoteNewer, deviceId: "laptop", now });
    expect(applied.applyToStore).toEqual({ theme: "light" });

    const remoteOlder = doc(3, "phone", "2026-07-21T08:00:00Z", { theme: "light" });
    const kept = reconcileProfile({ current: { theme: "dark" }, local, remote: remoteOlder, deviceId: "laptop", now });
    expect(kept.upload?.values).toEqual({ theme: "dark" });
  });

  it("same rev + same updatedAt: deterministic deviceId tiebreak (both devices agree)", () => {
    const l = doc(3, "aaa", "t", { theme: "dark" });
    const r = doc(3, "zzz", "t", { theme: "light" });
    // From aaa's view: remote zzz has the higher deviceId -> remote wins.
    const fromA = reconcileProfile({ current: { theme: "dark" }, local: l, remote: r, deviceId: "aaa", now });
    expect(fromA.applyToStore).toEqual({ theme: "light" });
    // From zzz's view: mine (zzz) wins -> upload zzz's values. Same winner on both sides.
    const fromZ = reconcileProfile({ current: { theme: "light" }, local: doc(3, "zzz", "t", { theme: "light" }), remote: doc(3, "aaa", "t", { theme: "dark" }), deviceId: "zzz", now });
    expect(fromZ.upload?.values).toEqual({ theme: "light" });
  });
});

// --- SettingsSyncStep against in-memory fakes ---

class FakeVault implements Partial<IVaultAdapter> {
  files = new Map<string, string>();
  async exists(path: string) {
    return this.files.has(path);
  }
  async readTextFile(path: string) {
    const v = this.files.get(path);
    if (v === undefined) throw new Error("not found");
    return v;
  }
  async writeTextFile(path: string, content: string) {
    this.files.set(path, content);
  }
}

class FakeTarget implements Partial<ISyncTarget> {
  remote = new Map<string, Uint8Array>();
  async download(path: string): Promise<Uint8Array | null> {
    return this.remote.get(path) ?? null;
  }
  async push(op: SyncOperation): Promise<PushResult | void> {
    if (op.operation === "write" && op.content) this.remote.set(op.file_path, op.content);
  }
  async pull(): Promise<PullResult> {
    return { etagMap: new Map() };
  }
}

function makePort(store: { values: Record<string, unknown>; applied: Record<string, unknown>[] }): ProfileSettingsPort {
  return {
    async exportValues() {
      return { ...store.values };
    },
    async applyValues(values) {
      store.values = { ...values };
      store.applied.push({ ...values });
    },
  };
}

describe("SettingsSyncStep.run", () => {
  const dev = { deviceId: "laptop", now: () => "2026-07-21T12:00:00Z" };

  it("publishes local settings to an empty remote", async () => {
    const vault = new FakeVault();
    const target = new FakeTarget();
    const store = { values: { theme: "nord" }, applied: [] as Record<string, unknown>[] };
    const step = new SettingsSyncStep({ port: makePort(store), ...dev });
    await step.run(target as unknown as ISyncTarget, vault as unknown as IVaultAdapter);

    const uploaded = parseProfile(new TextDecoder().decode(target.remote.get(PROFILE_SYNC_PATH)!));
    expect(uploaded?.values).toEqual({ theme: "nord" });
    expect(parseProfile(vault.files.get(PROFILE_SYNC_PATH)!)?.rev).toBe(0);
    expect(store.applied).toHaveLength(0);
  });

  it("imports settings from a newer remote on a fresh device", async () => {
    const vault = new FakeVault();
    const target = new FakeTarget();
    target.remote.set(PROFILE_SYNC_PATH, new TextEncoder().encode(serializeProfile(doc(9, "phone", "2026-07-20", { dailyFolder: "Journal" }))));
    const store = { values: { dailyFolder: "Daily" }, applied: [] as Record<string, unknown>[] };
    const adopted: string[] = [];
    const step = new SettingsSyncStep({ port: makePort(store), ...dev, onAdopted: (d) => adopted.push(d) });
    await step.run(target as unknown as ISyncTarget, vault as unknown as IVaultAdapter);

    expect(store.values).toEqual({ dailyFolder: "Journal" });
    expect(adopted).toEqual(["phone"]);
    // Local file adopts the remote doc; a second run is a converged no-op.
    await step.run(target as unknown as ISyncTarget, vault as unknown as IVaultAdapter);
    expect(store.applied).toHaveLength(1);
  });

  it("uploads a local edit and does not re-apply its own upload next cycle", async () => {
    const vault = new FakeVault();
    const target = new FakeTarget();
    const store = { values: { theme: "dark" }, applied: [] as Record<string, unknown>[] };
    const step = new SettingsSyncStep({ port: makePort(store), ...dev });
    await step.run(target as unknown as ISyncTarget, vault as unknown as IVaultAdapter); // publish rev 0

    store.values = { theme: "light" }; // user edits
    await step.run(target as unknown as ISyncTarget, vault as unknown as IVaultAdapter);
    expect(parseProfile(new TextDecoder().decode(target.remote.get(PROFILE_SYNC_PATH)!))?.values).toEqual({ theme: "light" });

    // No further change -> no apply, no rev churn.
    await step.run(target as unknown as ISyncTarget, vault as unknown as IVaultAdapter);
    expect(store.applied).toHaveLength(0);
    expect(parseProfile(vault.files.get(PROFILE_SYNC_PATH)!)?.rev).toBe(1);
  });
});
