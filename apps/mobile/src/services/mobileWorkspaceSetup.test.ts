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

import { FakeWorkspaceObjectStore, MemoryWorkspaceStateStore, type IVaultAdapter } from "@plainva/core";
import {
  activatePreparedMobileWorkspace,
  decommissionMobileWorkspace,
  discardPreparedMobileWorkspace,
  getMobileWorkspaceStatus,
  prepareMobileWorkspace,
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
