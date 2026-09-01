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

import {
  FakeWorkspaceObjectStore,
  MemoryWorkspaceStateStore,
  createPersonalWorkspaceBootstrap,
  emptyPublicationManifest,
  personalWorkspaceRuntime,
  serializePersonalWorkspaceRuntime,
  workspaceDocumentHash,
  type IVaultAdapter,
  type PersonalWorkspaceRuntime,
  type PublishedSliceConfig,
  type WorkspacePublicationRecord,
} from "@plainva/core";
import {
  activateMobileWorkspaceOwnerTransfer,
  activatePreparedMobileWorkspace,
  decommissionMobileWorkspace,
  discardPreparedMobileWorkspace,
  getMobileWorkspaceStatus,
  inviteMobileWorkspaceMember,
  loadMobilePublicationRuntime,
  lockMobileWorkspace,
  persistMobilePublicationRuntime,
  prepareMobileWorkspace,
  prepareMobileWorkspaceOwnerTransfer,
  revokeMobileWorkspaceDevice,
  revokeMobileWorkspaceMember,
  unlockMobileWorkspace,
  withdrawMobilePublication,
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

/** A publication runtime is its OWN workspace - never the vault's. */
async function publicationRuntime(): Promise<PersonalWorkspaceRuntime> {
  return personalWorkspaceRuntime(
    await createPersonalWorkspaceBootstrap({
      ownerDisplayName: "Owner", deviceDisplayName: "Pixel",
      platform: "android", minimumClientVersion: "0.5.0",
    }),
  );
}

/** The record the publisher keeps about one published slice (S4b). */
function publicationRecord(publicationId: string): WorkspacePublicationRecord {
  const config: PublishedSliceConfig = {
    publicationId, sliceId: `slice-${publicationId}`, name: "Quarterly review",
    mode: "sanitized", access: "read", provider: "webdav",
    propertyAllowlist: ["title"], privateProperties: ["salary"],
    createdAt: "2026-08-30T08:00:00.000Z",
  };
  return {
    publicationId, sliceId: config.sliceId, config,
    manifest: emptyPublicationManifest(publicationId),
    lastError: null, lastRefreshedAt: null, createdAt: config.createdAt,
  };
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

  /**
   * A publication carries its own keys, and the keystore cannot be listed. So
   * the ids have to be read while the state table still exists - after
   * `clearWorkspaceState` the slots are unreachable and their keys would
   * outlive the workspace they belong to. Same shape as the vault-forget sweep
   * of 2026-08-19, and the reason the read sits before the clear.
   */
  it("takes the publication keys down with the workspace", async () => {
    const state = await joined();
    await state.savePublication(publicationRecord("pub-a"));
    await state.savePublication(publicationRecord("pub-b"));
    await persistMobilePublicationRuntime("v1", "pub-a", await publicationRuntime());
    await persistMobilePublicationRuntime("v1", "pub-b", await publicationRuntime());
    expect(secrets.has("workspace_pub_mobile_v1_pub-a")).toBe(true);
    expect(secrets.has("workspace_pub_mobile_v1_pub-b")).toBe(true);

    await decommissionMobileWorkspace({ vaultId: "v1", state, stopSync: async () => {} });

    expect(secrets.has("workspace_pub_mobile_v1_pub-a")).toBe(false);
    expect(secrets.has("workspace_pub_mobile_v1_pub-b")).toBe(false);
    expect(await loadMobilePublicationRuntime("v1", "pub-a")).toBeNull();
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

/**
 * ONE SLOT PER PUBLICATION on the phone (stage B, S4b shells).
 *
 * The desktop twin lives in `publicationKeychain.test.ts`; the shape differs
 * because the platform does — Android Keystore and the iOS Keychain seal
 * natively, so there is no passphrase branch to refuse. What must hold is the
 * same: the slot name misses across vaults by construction (the keystore
 * cannot be enumerated afterwards to find a collision that already happened),
 * and locking the vault locks its publications AND drops the cached copy — the
 * publisher's bundle is the admin half, strictly more than any recipient may do.
 *
 * Mobile drops where desktop zeroes, and that is the platform speaking, not an
 * oversight: the desktop wipe is safe because every caller stops the sync
 * worker first, and mobile's lock (SecurityAreaScreen) deliberately does not —
 * zeroing key objects a running worker still signs with would corrupt what it
 * is in the middle of writing. Same guarantee for the user, different depth,
 * exactly as the vault runtime has always handled it.
 */
describe("mobile publication runtimes in the keystore", () => {
  beforeEach(async () => {
    prefs.clear(); secrets.clear(); keystoreError = null;
    await lockMobileWorkspace("v1"); await lockMobileWorkspace("v2");
  });

  /** Puts a vault runtime in place so the vault counts as set up and unlocked. */
  async function openVault(vaultId: string): Promise<void> {
    const prepared = await prepareMobileWorkspace({ vaultId, ownerDisplayName: "Marco", deviceDisplayName: "Pixel" });
    await activatePreparedMobileWorkspace({
      vaultId, draftId: prepared.draftId,
      store: new FakeWorkspaceObjectStore(), vault: vaultWith({ "Note.md": "hello" }), state: new MemoryWorkspaceStateStore(),
    });
  }

  it("round-trips a publication runtime and reports an unknown one as null", async () => {
    await openVault("v1");
    const runtime = await publicationRuntime();
    await persistMobilePublicationRuntime("v1", "pub-a", runtime);

    const read = await loadMobilePublicationRuntime("v1", "pub-a");
    expect(read?.memberId).toBe(runtime.memberId);
    expect(await loadMobilePublicationRuntime("v1", "pub-unknown")).toBeNull();
  });

  it("keys the slot by vault AND publication", async () => {
    await openVault("v1");
    await openVault("v2");
    await persistMobilePublicationRuntime("v1", "pub-a", await publicationRuntime());
    await persistMobilePublicationRuntime("v2", "pub-a", await publicationRuntime());

    // Same publication id, two vaults: two slots, never one shared bundle.
    expect(secrets.has("workspace_pub_mobile_v1_pub-a")).toBe(true);
    expect(secrets.has("workspace_pub_mobile_v2_pub-a")).toBe(true);
    const one = await loadMobilePublicationRuntime("v1", "pub-a");
    const two = await loadMobilePublicationRuntime("v2", "pub-a");
    expect(one?.memberId).not.toBe(two?.memberId);
  });

  it("locks its publications with the vault and forgets the cached copy", async () => {
    await openVault("v1");
    const before = await publicationRuntime();
    await persistMobilePublicationRuntime("v1", "pub-a", before);
    expect((await loadMobilePublicationRuntime("v1", "pub-a"))?.memberId).toBe(before.memberId);

    await lockMobileWorkspace("v1");
    expect(await loadMobilePublicationRuntime("v1", "pub-a")).toBeNull();

    // The lock also drops the in-memory copy, which is what the read guard
    // alone cannot give: something else re-persists the slot while the vault is
    // closed, and after unlocking we must serve THAT, not the stale cache.
    const after = await publicationRuntime();
    secrets.set("workspace_pub_mobile_v1_pub-a", serializePersonalWorkspaceRuntime(after));
    await unlockMobileWorkspace("v1");
    expect((await loadMobilePublicationRuntime("v1", "pub-a"))?.memberId).toBe(after.memberId);
  });
});

/**
 * Withdrawing a publication from the phone (M5).
 *
 * The property under test is not "it deletes the row" — it is that a run which
 * does NOT get through leaves the publication alive and finishable. The
 * object store is put-only and the recipients' keys stop working only once the
 * epoch moves, so a withdraw that reported success over a half-retracted folder
 * would be the one lie this surface cannot afford.
 *
 * Ordering mirrors the desktop's `removePublication`: tombstones need the
 * publication runtime, so the key slot is cleared LAST and the state row only
 * after the tombstones landed.
 */
describe("mobile publication withdrawal", () => {
  beforeEach(() => { prefs.clear(); secrets.clear(); keystoreError = null; });

  /** 16-byte lowercase hex, distinct per seed. */
  function hexId(seed: number): string {
    return seed.toString(16).padStart(2, "0").repeat(16);
  }

  /** A publication that actually holds something, so teardown has work to plan. */
  function carrying(publicationId: string, paths: readonly string[]): WorkspacePublicationRecord {
    const base = publicationRecord(publicationId);
    return {
      ...base,
      manifest: {
        ...emptyPublicationManifest(publicationId),
        // Ids are 16-byte lowercase hex by protocol - a retraction names the
        // published revision as its parent, so placeholders would be rejected
        // before the store ever sees the write.
        objects: paths.map((path, i) => ({
          sourceObjectId: hexId(0xa0 + i),
          path,
          sourceRevisionId: hexId(0xb0 + i),
          publishedRevisionId: hexId(0xc0 + i),
        })),
      },
    };
  }

  it("retracts every object, then forgets the publication and its key", async () => {
    const state = new MemoryWorkspaceStateStore();
    const store = new FakeWorkspaceObjectStore();
    const runtime = await publicationRuntime();
    await state.savePublication(carrying("pub-a", ["Notes/One.md", "Notes/Two.md"]));
    await persistMobilePublicationRuntime("v1", "pub-a", await publicationRuntime());

    const result = await withdrawMobilePublication({
      vaultId: "v1", store, state, runtime, publicationId: "pub-a",
    });

    expect(result).toEqual({ retracted: 2, error: null });
    expect(await state.getPublication("pub-a")).toBeNull();
    expect(secrets.has("workspace_pub_mobile_v1_pub-a")).toBe(false);
  });

  /**
   * The resumable half. A provider outage mid-teardown is normal; what must not
   * happen is that the row and the key disappear around objects still standing
   * in the publication, because then nothing on this device could ever finish
   * the retraction.
   */
  it("keeps the publication and its key when a retraction cannot be written", async () => {
    const state = new MemoryWorkspaceStateStore();
    const store = new FakeWorkspaceObjectStore();
    const runtime = await publicationRuntime();
    await state.savePublication(carrying("pub-a", ["Notes/One.md", "Notes/Two.md"]));
    await persistMobilePublicationRuntime("v1", "pub-a", await publicationRuntime());

    // A retraction is exactly one write - it seals no frame, only the operation
    // that tells a syncing recipient the object left. So the second object is
    // the second write, and that is where this run has to fall over.
    let writes = 0;
    const offline = new Proxy(store, {
      get(t, p, r) {
        if (p === "putImmutable") return async (...args: unknown[]) => {
          if (++writes > 1) throw new Error("network unreachable");
          return (t.putImmutable as (...a: unknown[]) => Promise<unknown>)(...args);
        };
        return Reflect.get(t, p, r) as unknown;
      },
    });

    const result = await withdrawMobilePublication({
      vaultId: "v1", store: offline, state, runtime, publicationId: "pub-a",
    });

    expect(result.error).toContain("network unreachable");
    const kept = await state.getPublication("pub-a");
    expect(kept).not.toBeNull();
    expect(kept?.lastError).toContain("network unreachable");
    // The key outlives the failed run on purpose — without it the next attempt
    // could not seal the remaining tombstones.
    expect(secrets.has("workspace_pub_mobile_v1_pub-a")).toBe(true);
  });

  /**
   * A vault runtime was handed in, so the vault is open. A missing publication
   * runtime therefore means one thing only: this device does not hold the key
   * for THIS publication — and a device that cannot seal a tombstone must not
   * pretend it withdrew anything.
   */
  it("refuses when the publication key is not on this device", async () => {
    const state = new MemoryWorkspaceStateStore();
    const runtime = await publicationRuntime();
    await state.savePublication(carrying("pub-nokey", ["Notes/One.md"]));

    await expect(withdrawMobilePublication({
      vaultId: "v-nokey", store: new FakeWorkspaceObjectStore(), state, runtime, publicationId: "pub-nokey",
    })).rejects.toThrow("publication-key-missing");

    expect(await state.getPublication("pub-nokey")).not.toBeNull();
  });
});
