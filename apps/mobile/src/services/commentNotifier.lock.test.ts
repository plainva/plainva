// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceCommentRecord } from "@plainva/core";
import type { CommentLockState, CommentNotificationNote } from "@plainva/ui";

/**
 * The phone's notifier on a locked vault, and across a vault switch (plan
 * Befunde 24.09., E7). The shared cycle has its own test; this one runs the
 * phone's wiring — per-vault settings, the ledger, the local notification —
 * against a store that lists nothing while locked, the way the real stores do.
 * On the phone that was every return to the app while the workspace runtime
 * was still loading.
 */

const settings = vi.hoisted(() => {
  const records = new Map<string, Record<string, unknown>>();
  const fresh = () => ({ commentNotifyEnabled: true, commentNotifyLevel: "all", commentNotifyPreview: true, commentNotifyMuted: [], commentNotifySeen: [] });
  const record = (vaultId: string) => {
    if (!records.has(vaultId)) records.set(vaultId, fresh());
    return records.get(vaultId)!;
  };
  return { records, record, active: { id: "vault-a" } };
});
vi.mock("./mobileSettings", () => ({
  getVaultSettings: async (vaultId: string) => structuredClone(settings.record(vaultId)),
  applyVaultSettings: async (vaultId: string, patch: Record<string, unknown>) => { Object.assign(settings.record(vaultId), structuredClone(patch)); },
  getMobileSettings: () => structuredClone(settings.record(settings.active.id)),
  updateMobileSettings: async (patch: Record<string, unknown>) => { Object.assign(settings.record(settings.active.id), structuredClone(patch)); },
}));
const local = vi.hoisted(() => ({
  schedule: vi.fn(async () => ({})),
  checkPermissions: vi.fn(async () => ({ display: "granted" })),
  requestPermissions: vi.fn(async () => ({ display: "granted" })),
  registerActionTypes: vi.fn(async () => {}),
  addListener: vi.fn(async () => ({ remove: async () => {} })),
}));
vi.mock("@capacitor/local-notifications", () => ({ LocalNotifications: local }));

import {
  drawMobileCommentBaseline,
  releaseMobileCommentNotifierDeps,
  runMobileCommentNotifications,
  setMobileCommentNotifierDeps,
  type MobileCommentNotifierDeps,
} from "./commentNotifier";

function remark(commentId: string): WorkspaceCommentRecord {
  return {
    commentId,
    targetObjectId: "notes/Report.md",
    parentCommentId: null,
    authorMemberId: "them",
    authorDeviceId: "device-them",
    body: "The figure in paragraph three does not match",
    anchor: null,
    suggestion: null,
    createdAt: "2026-09-24T10:00:00.000Z",
    resolvedCommentId: null,
    resolvedAt: null,
  } as WorkspaceCommentRecord;
}

let lock: CommentLockState = "open";

function register(vaultId: string, comments: WorkspaceCommentRecord[]): MobileCommentNotifierDeps {
  const deps: MobileCommentNotifierDeps = {
    vaultId,
    lockState: async () => lock,
    // What a locked store answers: no remarks at all.
    listNotes: async (): Promise<CommentNotificationNote[]> => (lock === "locked" ? [] : [{ path: "notes/Report.md", comments }]),
    listNames: async () => new Map(),
    identity: async () => ({ memberId: "me", deviceId: null }),
    openComment: () => {},
    openOverview: () => {},
  };
  setMobileCommentNotifierDeps(deps);
  return deps;
}

beforeEach(() => {
  settings.records.clear();
  settings.active.id = "vault-a";
  local.schedule.mockClear();
  lock = "open";
});

describe("mobile comment notifier", () => {
  it("c1 -> locked -> c1 again announces nothing the second time", async () => {
    const deps = register("vault-a", [remark("c1")]);
    expect((await runMobileCommentNotifications())?.kind).toBe("single");
    expect(local.schedule).toHaveBeenCalledTimes(1);

    lock = "locked";
    await runMobileCommentNotifications();
    expect(settings.record("vault-a").commentNotifySeen).toEqual(["c1"]);

    lock = "open";
    expect((await runMobileCommentNotifications())?.kind).toBe("none");
    expect(local.schedule).toHaveBeenCalledTimes(1);
    releaseMobileCommentNotifierDeps(deps);
  });

  it("switching on while locked draws no baseline", async () => {
    const deps = register("vault-a", [remark("c1")]);
    await drawMobileCommentBaseline();
    lock = "locked";
    await drawMobileCommentBaseline();
    expect(settings.record("vault-a").commentNotifySeen).toEqual(["c1"]);
    releaseMobileCommentNotifierDeps(deps);
  });

  it("a cycle still running for the old vault writes into the old vault's ledger", async () => {
    const deps = register("vault-a", [remark("c1")]);
    // The phone has already switched to vault B; the answers are still A's.
    settings.active.id = "vault-b";
    await runMobileCommentNotifications();
    expect(settings.record("vault-a").commentNotifySeen).toEqual(["c1"]);
    expect(settings.record("vault-b").commentNotifySeen).toEqual([]);
    releaseMobileCommentNotifierDeps(deps);
  });

  it("the old vault's cleanup cannot remove the next vault's answers", async () => {
    const old = register("vault-a", [remark("c1")]);
    const next = register("vault-b", [remark("c2")]);
    releaseMobileCommentNotifierDeps(old);
    expect((await runMobileCommentNotifications())?.kind).toBe("single");
    releaseMobileCommentNotifierDeps(next);
    expect(await runMobileCommentNotifications()).toBeNull();
  });
});
