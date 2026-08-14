import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * First setup on the phone (2026-07-25): the draft lifecycle and the activation
 * hand-off. Guards the two properties that matter for data safety —
 *   1. nothing is persisted before the user confirmed the recovery backup, and
 *      an abandoned draft is unusable afterwards (keys zeroed);
 *   2. activation publishes genesis + owner policy and queues every local file,
 *      with the device runtime in the keystore.
 * Runs the REAL core crypto against core's in-memory object/state stores.
 */

const prefs = new Map<string, string>();
vi.mock("@capacitor/preferences", () => ({
  Preferences: {
    get: async ({ key }: { key: string }) => ({ value: prefs.get(key) ?? null }),
    set: async ({ key, value }: { key: string; value: string }) => { prefs.set(key, value); },
    remove: async ({ key }: { key: string }) => { prefs.delete(key); },
  },
}));
vi.mock("@capacitor/core", () => ({
  Capacitor: { getPlatform: () => "android", isNativePlatform: () => true },
  registerPlugin: () => ({}),
}));

const secrets = new Map<string, unknown>();
/** Set by the decommission tests to play a locked keystore. */
let keystoreError: Error | null = null;
vi.mock("../platform/secureStore", () => ({
  secureCredentialStore: {
    readSecret: async (key: string) => { if (keystoreError) throw keystoreError; return secrets.get(key) ?? null; },
    writeSecret: async (key: string, value: unknown) => { if (keystoreError) throw keystoreError; secrets.set(key, value); },
    removeSecret: async (key: string) => { if (keystoreError) throw keystoreError; secrets.delete(key); },
  },
}));

import { FakeWorkspaceObjectStore, MemoryWorkspaceStateStore, workspaceDocumentHash, type IVaultAdapter } from "@plainva/core";
import {
  activateMobileWorkspaceOwnerTransfer,
  activatePreparedMobileWorkspace,
  decommissionMobileWorkspace,
  discardPreparedMobileWorkspace,
  getMobileWorkspaceStatus,
  inviteMobileWorkspaceMember,
  prepareMobileWorkspace,
  prepareMobileWorkspaceOwnerTransfer,
  revokeMobileWorkspaceDevice,
  revokeMobileWorkspaceMember,
} from "./mobileWorkspaceSecurity";

/** Minimal adapter surface the migration sweep touches (listDir + read). */
function vaultWith(files: Record<string, string>): IVaultAdapter {
  const encoder = new TextEncoder();
  return {
    listDir: async () => Object.keys(files).map((path) => ({ path, name: path.split("/").pop()!, isDirectory: false, mtime: 1, size: files[path].length })),
    readBinaryFile: async (path: string) => encoder.encode(files[path] ?? ""),
    readTextFile: async (path: string) => files[path] ?? "",
  } as unknown as IVaultAdapter;
}

describe("mobile encrypted-workspace first setup", () => {
  beforeEach(() => { prefs.clear(); secrets.clear(); });

  it("prepares a readable recovery code without persisting anything", async () => {
    const prepared = await prepareMobileWorkspace({ vaultId: "v1", ownerDisplayName: "Marco", deviceDisplayName: "Pixel" });
    const groups = prepared.recoveryCode.split("-");
    expect(groups[0]).toBe("PVR1");
    expect(groups.length).toBeGreaterThan(2);
    expect(prepared.recoveryPackage.byteLength).toBeGreaterThan(0);
    expect(prepared.fingerprint).toMatch(/^[0-9a-f]{16,}$/);
    // The point of the draft: the keystore and the status stay untouched until
    // the user confirmed the backup.
    expect(secrets.size).toBe(0);
    expect(await getMobileWorkspaceStatus("v1")).toBeNull();
    discardPreparedMobileWorkspace(prepared.draftId);
  });

  it("refuses a discarded or foreign draft", async () => {
    const prepared = await prepareMobileWorkspace({ vaultId: "v1", ownerDisplayName: "Marco", deviceDisplayName: "Pixel" });
    const activate = (vaultId: string, draftId: string) => activatePreparedMobileWorkspace({
      vaultId, draftId,
      store: new FakeWorkspaceObjectStore(),
      vault: vaultWith({ "Note.md": "# Note" }),
      state: new MemoryWorkspaceStateStore(),
    });
    // Another vault must never activate this vault's draft.
    await expect(activate("other", prepared.draftId)).rejects.toThrow("workspace-draft-expired");
    discardPreparedMobileWorkspace(prepared.draftId);
    await expect(activate("v1", prepared.draftId)).rejects.toThrow("workspace-draft-expired");
    expect(secrets.size).toBe(0);
  });

  it("activation publishes the workspace and queues the local files", async () => {
    const prepared = await prepareMobileWorkspace({ vaultId: "v1", ownerDisplayName: "Marco", deviceDisplayName: "Pixel" });
    const store = new FakeWorkspaceObjectStore();
    const state = new MemoryWorkspaceStateStore();
    const progress: Array<[number, number]> = [];
    const result = await activatePreparedMobileWorkspace({
      vaultId: "v1",
      draftId: prepared.draftId,
      store,
      vault: vaultWith({ "Note.md": "# Note", "Inbox/Second.md": "second" }),
      state,
      onProgress: (done, total) => progress.push([done, total]),
    });
    expect(result.total).toBe(2);
    expect(result.queued).toBe(2);
    expect(progress[progress.length - 1]).toEqual([2, 2]);
    expect(await store.get(".pvws/genesis.pvgen")).not.toBeNull();
    // The device keys live in the keystore, and the status says the workspace
    // is this device's (phase active — the sweep continues in the worker).
    expect(secrets.has("workspace_runtime_mobile_v1")).toBe(true);
    const status = await getMobileWorkspaceStatus("v1");
    expect(status?.phase).toBe("active");
    expect(status?.workspaceId).toBe(result.runtime.workspaceId);
    expect(status?.deviceName).toBe("Pixel");
    // A spent draft cannot be replayed.
    await expect(activatePreparedMobileWorkspace({ vaultId: "v1", draftId: prepared.draftId, store, vault: vaultWith({}), state })).rejects.toThrow("workspace-draft-expired");
  });
});

/**
 * Decommission on the phone (S9, C14).
 *
 * The three properties below are the ones a mis-step here would cost, and each
 * has a red counter-check that fails if the ordering in
 * `decommissionMobileWorkspace` is undone:
 *   1. it never reaches the network — the cloud copy is deliberately left
 *      alone, so a phone with no signal can still stop being a workspace;
 *   2. a locked keystore REFUSES with everything still in place, rather than
 *      tearing down the state around a device key it cannot remove;
 *   3. the sync worker is stopped and drained BEFORE the first thing is
 *      cleared — a cycle mid-flight writes into the state being cleared.
 */
describe("mobile encrypted-workspace decommission", () => {
  beforeEach(() => { prefs.clear(); secrets.clear(); keystoreError = null; });

  /** A joined workspace as it looks on disk: status, device key, state rows. */
  async function joined(): Promise<MemoryWorkspaceStateStore> {
    const prepared = await prepareMobileWorkspace({ vaultId: "v1", ownerDisplayName: "Marco", deviceDisplayName: "Pixel" });
    const state = new MemoryWorkspaceStateStore();
    await activatePreparedMobileWorkspace({
      vaultId: "v1", draftId: prepared.draftId,
      store: new FakeWorkspaceObjectStore(), vault: vaultWith({ "Note.md": "hello" }), state,
    });
    expect(await getMobileWorkspaceStatus("v1")).not.toBeNull();
    expect(secrets.has("workspace_runtime_mobile_v1")).toBe(true);
    // The meta is what a later re-enable trips over ("belongs to another
    // workspace"), so it is what the teardown has to remove.
    expect(await state.loadMeta()).not.toBeNull();
    return state;
  }

  it("stops being a workspace without touching the network", async () => {
    const state = await joined();
    // Any remote call would go through fetch; nothing here may need it.
    const realFetch = globalThis.fetch;
    globalThis.fetch = (() => { throw new Error("decommission must not reach the network"); }) as typeof fetch;
    try {
      await decommissionMobileWorkspace({ vaultId: "v1", state, stopSync: async () => {} });
    } finally { globalThis.fetch = realFetch; }

    expect(await getMobileWorkspaceStatus("v1")).toBeNull();
    expect(secrets.has("workspace_runtime_mobile_v1")).toBe(false);
    expect(await state.loadMeta()).toBeNull();
  });

  it("refuses on a locked keystore and leaves everything in place", async () => {
    const state = await joined();
    keystoreError = new Error("keystore locked");
    let stopped = false;

    await expect(decommissionMobileWorkspace({ vaultId: "v1", state, stopSync: async () => { stopped = true; } }))
      .rejects.toThrow("keystore locked");

    // Nothing moved — not even the sync worker: the refusal comes first.
    expect(stopped).toBe(false);
    keystoreError = null;
    expect(await getMobileWorkspaceStatus("v1")).not.toBeNull();
    expect(secrets.has("workspace_runtime_mobile_v1")).toBe(true);
    expect(await state.loadMeta()).not.toBeNull();
  });

  /**
   * The row is only offered where a workspace exists, but the service is the
   * thing that must hold: a vault that is not a workspace HERE has nothing to
   * tear down, and saying so beats clearing state that belongs to someone else.
   */
  it("refuses a vault that is not a workspace on this device", async () => {
    const state = new MemoryWorkspaceStateStore();
    let stopped = false;
    await expect(decommissionMobileWorkspace({ vaultId: "never-joined", state, stopSync: async () => { stopped = true; } }))
      .rejects.toThrow("not an encrypted workspace");
    expect(stopped).toBe(false);
  });

  it("drains the sync worker before the first thing is cleared", async () => {
    const state = await joined();
    const order: string[] = [];
    // The state store records when it is cleared; the stop records when it ran.
    const watched = new Proxy(state, {
      get(target, prop, receiver) {
        if (prop === "clearWorkspaceState") return async () => { order.push("clear"); await target.clearWorkspaceState(); };
        return Reflect.get(target, prop, receiver) as unknown;
      },
    });

    await decommissionMobileWorkspace({
      vaultId: "v1", state: watched,
      stopSync: async () => {
        order.push("stop");
        // Whatever is still on disk when the worker stops is what the teardown
        // may find — the status must still be here, or a cycle could have run
        // against a half-cleared vault.
        expect(await getMobileWorkspaceStatus("v1")).not.toBeNull();
      },
    });

    expect(order).toEqual(["stop", "clear"]);
  });
});

/**
 * Handing the workspace to someone else (S10, C14).
 *
 * The property is an ORDER, not a call: ownership and the recovery set move
 * together, and the replacement package has to exist and be readable before
 * this device stops being owner. A transfer that publishes the policy first
 * would leave a workspace nobody can recover once the new owner loses their
 * devices — which is the failure this test exists to make loud.
 */
describe("mobile encrypted-workspace owner transfer", () => {
  beforeEach(() => { prefs.clear(); secrets.clear(); keystoreError = null; });

  it("prepares a working replacement recovery set and publishes nothing yet", async () => {
    const prepared = await prepareMobileWorkspace({ vaultId: "v1", ownerDisplayName: "Marco", deviceDisplayName: "Pixel" });
    const store = new FakeWorkspaceObjectStore();
    const state = new MemoryWorkspaceStateStore();
    const { runtime } = await activatePreparedMobileWorkspace({
      vaultId: "v1", draftId: prepared.draftId, store, vault: vaultWith({ "Note.md": "hello" }), state,
    });
    const owner = runtime.ownerMemberId;
    const target = await inviteMobileWorkspaceMember({ vaultId: "v1", store, runtime, displayName: "Ada", role: "Admin" });

    const transfer = await prepareMobileWorkspaceOwnerTransfer({
      store, runtime, targetMemberId: target,
      bytes: prepared.recoveryPackage, code: prepared.recoveryCode,
    });
    // Until activation this device still owns the workspace…
    expect(runtime.ownerMemberId).toBe(owner);
    // …and the replacement set is real, not a placeholder.
    expect(transfer.recoveryCode).not.toBe(prepared.recoveryCode);
    expect(transfer.bytes.byteLength).toBeGreaterThan(0);

    await activateMobileWorkspaceOwnerTransfer({ vaultId: "v1", store, runtime, activation: transfer.activation });
    expect(runtime.ownerMemberId).toBe(target);
    // The switch survives a restart: the keystore carries the new owner.
    const stored = secrets.get("workspace_runtime_mobile_v1") as { ownerMemberId?: string } | undefined;
    expect(stored?.ownerMemberId).toBe(target);
  });

  it("refuses a target that cannot own the workspace", async () => {
    const prepared = await prepareMobileWorkspace({ vaultId: "v1", ownerDisplayName: "Marco", deviceDisplayName: "Pixel" });
    const store = new FakeWorkspaceObjectStore();
    const { runtime } = await activatePreparedMobileWorkspace({
      vaultId: "v1", draftId: prepared.draftId, store, vault: vaultWith({}), state: new MemoryWorkspaceStateStore(),
    });
    const owner = runtime.ownerMemberId;
    const attempt = (targetMemberId: string) => prepareMobileWorkspaceOwnerTransfer({
      store, runtime, targetMemberId, bytes: prepared.recoveryPackage, code: prepared.recoveryCode,
    });
    // Someone who is not a member, and the current owner: both are refused
    // BEFORE anything is built, so a mis-picked row cannot half-transfer.
    await expect(attempt("not-a-member")).rejects.toThrow();
    await expect(attempt(owner)).rejects.toThrow();
    expect(runtime.ownerMemberId).toBe(owner);
  });

  /**
   * The phone is the device most likely to lose its connection mid-action, so
   * "the upload failed" has to be a refusal and not a half state.
   */
  it("stays the owner when the new policy cannot be published", async () => {
    const prepared = await prepareMobileWorkspace({ vaultId: "v1", ownerDisplayName: "Marco", deviceDisplayName: "Pixel" });
    const store = new FakeWorkspaceObjectStore();
    const { runtime } = await activatePreparedMobileWorkspace({
      vaultId: "v1", draftId: prepared.draftId, store, vault: vaultWith({}), state: new MemoryWorkspaceStateStore(),
    });
    const owner = runtime.ownerMemberId;
    const target = await inviteMobileWorkspaceMember({ vaultId: "v1", store, runtime, displayName: "Ada", role: "Admin" });
    const transfer = await prepareMobileWorkspaceOwnerTransfer({
      store, runtime, targetMemberId: target, bytes: prepared.recoveryPackage, code: prepared.recoveryCode,
    });

    // The anchor goes up first and the policy second; kill the second one.
    let uploads = 0;
    const offline = new Proxy(store, {
      get(t, p, r) {
        if (p === "putImmutable") return async (...args: unknown[]) => {
          if (++uploads > 1) throw new Error("network unreachable");
          return (t.putImmutable as (...a: unknown[]) => Promise<unknown>)(...args);
        };
        return Reflect.get(t, p, r) as unknown;
      },
    });

    await expect(activateMobileWorkspaceOwnerTransfer({ vaultId: "v1", store: offline, runtime, activation: transfer.activation }))
      .rejects.toThrow("network unreachable");

    // Still ours — in memory and on disk. Retrying the whole activation is
    // what the caller does; a half-transferred workspace is what it must not.
    expect(runtime.ownerMemberId).toBe(owner);
    const stored = secrets.get("workspace_runtime_mobile_v1") as { ownerMemberId?: string } | undefined;
    expect(stored?.ownerMemberId).toBe(owner);
  });

  /**
   * The deliberate consequence of putting the local copy LAST: if the keystore
   * refuses at the very end, the workspace HAS a new owner (that is published
   * and true for everyone) and only this device is out of date. Stale is
   * recoverable — it re-reads the policy; ownerless is not, which is what the
   * reverse order would risk.
   */
  it("leaves a stale device rather than an ownerless workspace when the keystore locks", async () => {
    const prepared = await prepareMobileWorkspace({ vaultId: "v1", ownerDisplayName: "Marco", deviceDisplayName: "Pixel" });
    const store = new FakeWorkspaceObjectStore();
    const { runtime } = await activatePreparedMobileWorkspace({
      vaultId: "v1", draftId: prepared.draftId, store, vault: vaultWith({}), state: new MemoryWorkspaceStateStore(),
    });
    const target = await inviteMobileWorkspaceMember({ vaultId: "v1", store, runtime, displayName: "Ada", role: "Admin" });
    const transfer = await prepareMobileWorkspaceOwnerTransfer({
      store, runtime, targetMemberId: target, bytes: prepared.recoveryPackage, code: prepared.recoveryCode,
    });

    keystoreError = new Error("keystore locked");
    await expect(activateMobileWorkspaceOwnerTransfer({ vaultId: "v1", store, runtime, activation: transfer.activation }))
      .rejects.toThrow("keystore locked");
    keystoreError = null;

    // The handover IS published — the exact policy document sits in the store,
    // addressed by its own hash. Everyone else reads the new owner; only this
    // device's copy stayed behind, and that is the recoverable half.
    const hash = workspaceDocumentHash(transfer.activation.update.policy);
    const policies = await store.list(".pvws/policies/");
    expect(policies.items.some((item) => item.key.endsWith(`${hash}.pvpol`))).toBe(true);
    expect(transfer.activation.ownerMemberId).toBe(target);
  });
});

/**
 * Taking access away again (S11, C14).
 *
 * Two steps that are deliberately not one: the revoking policy is committed
 * first and the rewrite is queued second. The test that matters is what
 * happens when the second step fails — the revocation has to stand anyway,
 * because a device that keeps its keys because a long rewrite broke is the
 * failure this ordering exists to prevent.
 */
describe("mobile encrypted-workspace revocation", () => {
  beforeEach(() => { prefs.clear(); secrets.clear(); keystoreError = null; });

  async function workspace() {
    const prepared = await prepareMobileWorkspace({ vaultId: "v1", ownerDisplayName: "Marco", deviceDisplayName: "Pixel" });
    const store = new FakeWorkspaceObjectStore();
    const state = new MemoryWorkspaceStateStore();
    const { runtime } = await activatePreparedMobileWorkspace({
      vaultId: "v1", draftId: prepared.draftId, store, vault: vaultWith({ "Note.md": "hello" }), state,
    });
    return { store, state, runtime };
  }

  it("never lets this device revoke itself", async () => {
    const { store, state, runtime } = await workspace();
    await expect(revokeMobileWorkspaceDevice({
      vaultId: "v1", store, runtime, state,
      deviceId: runtime.device.publicIdentity.deviceId, reason: "test", mode: "future",
    })).rejects.toThrow("workspace-cannot-revoke-current-device");
    await expect(revokeMobileWorkspaceMember({
      vaultId: "v1", store, runtime, state,
      memberId: runtime.memberId, reason: "test", mode: "future",
    })).rejects.toThrow("workspace-cannot-revoke-current-member");
    // Refused before anything moved: this device is still active in the policy.
    const self = runtime.policy.payload.devices.find((d) => d.deviceId === runtime.device.publicIdentity.deviceId);
    expect(self?.state).toBe("active");
  });

  /**
   * The mirror of the test below. There the SECOND step fails and the
   * revocation must stand; here the FIRST one fails and nothing may have
   * happened — no local policy change, no rewrite queued for a device that
   * still has its keys. Together the two pin the order from both ends.
   */
  it("leaves the member active when the new policy cannot be published", async () => {
    const { store, state, runtime } = await workspace();
    const target = await inviteMobileWorkspaceMember({ vaultId: "v1", store, runtime, displayName: "Ada", role: "Editor" });
    const offline = new Proxy(store, {
      get(t, p, r) {
        if (p === "putImmutable") return async () => { throw new Error("network unreachable"); };
        return Reflect.get(t, p, r) as unknown;
      },
    });

    await expect(revokeMobileWorkspaceMember({
      vaultId: "v1", store: offline, runtime, state, memberId: target, reason: "test", mode: "full",
    })).rejects.toThrow("network unreachable");

    // Still a member — and no rewrite was queued for keys nobody lost.
    expect(runtime.policy.payload.members.find((m) => m.memberId === target)?.state).toBe("active");
    expect((await state.loadMeta())?.rekeyJob ?? null).toBeNull();
  });

  it("keeps the revocation even when queueing the rewrite fails", async () => {
    const { store, state, runtime } = await workspace();
    const target = await inviteMobileWorkspaceMember({ vaultId: "v1", store, runtime, displayName: "Ada", role: "Editor" });
    // The rewrite is queued through the state store; make that step fail.
    const broken = new Proxy(state, {
      get(t, p, r) {
        if (p === "saveMeta") return async () => { throw new Error("state write failed"); };
        return Reflect.get(t, p, r) as unknown;
      },
    });
    await expect(revokeMobileWorkspaceMember({
      vaultId: "v1", store, runtime, state: broken, memberId: target, reason: "test", mode: "full",
    })).rejects.toThrow("state write failed");
    // …and the member is revoked regardless, which is the whole point of the
    // order. A retry only has to redo the rewrite.
    const member = runtime.policy.payload.members.find((m) => m.memberId === target);
    expect(member?.state).not.toBe("active");
  });
});
