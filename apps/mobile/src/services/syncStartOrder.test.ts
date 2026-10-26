// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CloudAccountRecord } from "@plainva/ui";
import type { MobileVault } from "./vaultService";

/**
 * Third review of plan "Verbinden", finding 4: a restart stopped what ran
 * OUTSIDE the serialised start. A start that had already decided "files on"
 * and was still building its worker was not there yet to be stopped; the
 * restart's own start then found the new worker and left it - files kept
 * syncing although they had just been switched off. Stop, decision and start
 * are one step now; a plain stop makes a start begun before it put nothing in
 * place. These run the real `syncService` with fake workers.
 */

const state = vi.hoisted(() => ({
  filesOff: false,
  pausedHere: false,
  gate: null as null | { reached: boolean; release: () => void; promise: Promise<boolean> },
  /** Holds an encrypted workspace's join, where the start shows "syncing". */
  joinGate: null as null | { reached: boolean; release: () => void; promise: Promise<boolean> },
  workers: [] as Array<{ running: boolean }>,
  pass: "p",
  signedOutHere: false,
  url: "https://dav.example.test/vault",
  settings: new Map<string, unknown>(),
  /** What happened, in order: a reset of the sync state, a worker built. */
  log: [] as string[],
  settingsOnly: [] as Array<{ running: boolean }>,
}));

vi.mock("@plainva/core", async (original) => {
  class FakeRunning {
    running = false;
    start() { this.running = true; }
    stop() { this.running = false; }
    async stopAndDrain() { this.running = false; }
    triggerImmediate() {}
    async pushSettingsNow() {}
  }
  class FakeWorker extends FakeRunning {
    constructor() { super(); state.workers.push(this); state.log.push("worker"); }
    verifyDeletionJournal() { return Promise.resolve(null); }
  }
  class FakeSettingsOnly extends FakeRunning {
    constructor() { super(); state.settingsOnly.push(this); }
  }
  return {
    ...await original<typeof import("@plainva/core")>(),
    SyncWorker: FakeWorker,
    EncryptedWorkspaceWorker: FakeWorker,
    initializePersonalWorkspaceMigration: async () => {
      if (!state.joinGate) return;
      state.joinGate.reached = true;
      await state.joinGate.promise;
    },
    SettingsOnlySync: FakeSettingsOnly,
    SyncEngine: class {},
    DeletionJournal: class {},
    probeRemoteGenesis: async () => ({ encryptedGenesisFound: false }),
    createProviderWorkspaceObjectStore: () => ({ get: async () => null }),
  };
});
vi.mock("@plainva/ui", async (original) => ({
  ...await original<typeof import("@plainva/ui")>(),
  getPlatformServices: () => ({ credentials: {
    readSecret: async (key: string) => key === "sync_provider_mobile_v"
      ? { provider: "webdav", creds: { url: state.url, user: "u", pass: state.pass, ...(state.signedOutHere ? { signedOutHere: true } : {}) } }
      : null,
    writeSecret: async () => undefined,
    removeSecret: async () => undefined,
  },
  loadSettings: async () => ({
    get: async (key: string) => state.settings.get(key) ?? null,
    set: async (key: string, value: unknown) => { state.settings.set(key, structuredClone(value)); },
    delete: async (key: string) => state.settings.delete(key),
    save: async () => undefined,
  }) }),
}));
vi.mock("./cloudAccountsStore", () => ({
  CLOUD_ACCOUNTS_EVENT: "test-cloud-accounts-changed",
  loadCloudAccounts: async (): Promise<CloudAccountRecord[]> => [{
    id: "acct", family: "webdav", label: "Server", services: { files: { provider: "webdav" } },
    ...(state.filesOff ? { off: ["files"] } : {}),
  } as CloudAccountRecord],
}));
vi.mock("./vaultRegistry", async (original) => ({
  ...await original<typeof import("./vaultRegistry")>(),
  getActiveVaultEntry: async () => ({ id: "v" }),
  getVaultEntry: async () => ({ id: "v", provider: "webdav", pausedHere: state.pausedHere }),
  updateVault: async (_id: string, patch: { pausedHere?: boolean }) => {
    if (patch.pausedHere !== undefined) state.pausedHere = patch.pausedHere;
  },
}));
vi.mock("./vaultService", () => ({ getMobileVault: async () => vault, switchVault: vi.fn() }));
vi.mock("./mobileSettingsSync", () => ({
  mobileSyncDeviceId: async () => "phone",
  prepareMobileSettingsSync: async (_v: unknown, _p: unknown, raw: unknown) => ({ target: raw, runner: { run: async () => undefined } }),
}));
vi.mock("./mobileWorkspaceSecurity", () => ({ loadMobilePublicationRuntime: async () => null }));
vi.mock("../adapters/webdavHttp", () => ({ webdavFetch: vi.fn(), allowHttpOrigin: vi.fn() }));
vi.mock("../adapters/syncUpload", () => ({ createContentRefResolver: () => ({}), mobileSyncUploader: {} }));

const vault = {
  vaultId: "v",
  syncQueue: { clearAll: async () => { state.log.push("clear queue"); } },
  syncRepo: {
    clearAll: async () => { state.log.push("clear records"); },
    // Where the start waits after it has decided: the gate holds it there.
    hasConfirmedRemoteFiles: () => {
      if (!state.gate) return Promise.resolve(false);
      state.gate.reached = true;
      return state.gate.promise;
    },
  },
  adapter: { sandboxRoot: "" },
  files: {},
  workspaceRuntime: null,
  enableSyncEnqueue: () => undefined,
  markFirstSyncComplete: () => undefined,
  reindexPaths: async () => undefined,
} as unknown as MobileVault;

import { disconnectFiles, getSyncStatus, pauseSyncHere, restartSyncIfActive, startSyncIfConfigured, stopSyncAndDrain } from "./syncService";

function holdTheStart(): void {
  let release = () => {};
  const promise = new Promise<boolean>((resolve) => { release = () => resolve(false); });
  state.gate = { reached: false, release, promise };
}

const running = () => ({
  workers: state.workers.filter((w) => w.running).length,
  settingsOnly: state.settingsOnly.filter((s) => s.running).length,
});

beforeEach(() => {
  state.filesOff = false;
  state.pausedHere = false;
  state.pass = "p";
  state.signedOutHere = false;
  state.url = "https://dav.example.test/vault";
  state.settings.clear();
  state.log.length = 0;
  state.gate = null;
  state.joinGate = null;
  state.workers.length = 0;
  state.settingsOnly.length = 0;
});

afterEach(async () => {
  state.gate?.release();
  state.joinGate?.release();
  await stopSyncAndDrain();
});

describe("a start still building its worker (third review, finding 4)", () => {
  it("is followed by a restart for files switched off, not left running", async () => {
    holdTheStart();
    const starting = startSyncIfConfigured(vault);
    await vi.waitFor(() => expect(state.gate?.reached).toBe(true));

    state.filesOff = true;
    const restarting = restartSyncIfActive("v");
    state.gate!.release();
    await Promise.all([starting, restarting]);

    expect(running()).toEqual({ workers: 0, settingsOnly: 1 });
  });

  it("is followed by the switch arriving from the settings profile", async () => {
    // A first start installs the listener for the switch.
    await startSyncIfConfigured(vault);
    await stopSyncAndDrain();
    await vi.waitFor(() => expect(running()).toEqual({ workers: 0, settingsOnly: 0 }));

    holdTheStart();
    const starting = startSyncIfConfigured(vault);
    await vi.waitFor(() => expect(state.gate?.reached).toBe(true));

    state.filesOff = true;
    window.dispatchEvent(new Event("test-cloud-accounts-changed"));
    state.gate!.release();
    await starting;
    // The switch is a step of its own in the same order; a start queued after it waits for it.
    await vi.waitFor(async () => {
      await startSyncIfConfigured(vault);
      expect(running()).toEqual({ workers: 0, settingsOnly: 1 });
    });
  });

  it("puts nothing in place after the person paused the sync", async () => {
    holdTheStart();
    const starting = startSyncIfConfigured(vault);
    await vi.waitFor(() => expect(state.gate?.reached).toBe(true));

    await pauseSyncHere("v");
    state.gate!.release();
    await starting;

    expect(running()).toEqual({ workers: 0, settingsOnly: 0 });
  });
});

describe("a vault signed out on this phone (third review, finding 3)", () => {
  it("says it needs a sign-in and marks the way there, as the desktop does", async () => {
    state.pass = "";
    state.signedOutHere = true;
    await startSyncIfConfigured(vault);
    expect(running()).toEqual({ workers: 0, settingsOnly: 0 });
    expect(getSyncStatus()).toMatchObject({ status: "error", errorKind: "signed-out" });
    expect(getSyncStatus().message).toBeTruthy();
  });

  it("reads as off when the person paused it, signed out or not", async () => {
    state.pass = "";
    state.signedOutHere = true;
    state.pausedHere = true;
    await startSyncIfConfigured(vault);
    expect(getSyncStatus()).toMatchObject({ status: "off" });
    expect(getSyncStatus().errorKind).toBeUndefined();
  });

  it("offers the sign-in on the vault screen", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const screen = readFileSync(join(__dirname, "..", "VaultDetailScreen.tsx"), "utf8");
    expect(screen).toMatch(/status\.errorKind === "signed-out" && \(\s*<Button[^>]*onClick=\{onOpenFilesAccount\}/);
  });
});

describe("the sync state belongs to the folder, not the account (third review, finding 1)", () => {
  it("taking the files out clears nothing, and the same folder again keeps queue and records", async () => {
    await startSyncIfConfigured(vault);
    await disconnectFiles("v");
    // Connected again with the same folder, before or after the vault reopens.
    await startSyncIfConfigured(vault);
    expect(state.log).toEqual(["worker", "worker"]);
  });

  it("another folder drops queue and records before the worker is built", async () => {
    await startSyncIfConfigured(vault);
    await stopSyncAndDrain();
    state.url = "https://dav.example.test/another-vault";
    await startSyncIfConfigured(vault);
    expect(state.log).toEqual(["worker", "clear queue", "clear records", "worker"]);
  });
});

describe("an encrypted workspace's start that a stop overtakes (fourth review, finding 3)", () => {
  it("does not leave the status on syncing", async () => {
    let release = () => {};
    const promise = new Promise<boolean>((resolve) => { release = () => resolve(false); });
    state.joinGate = { reached: false, release, promise };
    const workspaceVault = { ...vault, workspaceRuntime: {}, workspaceState: {} } as unknown as MobileVault;
    const starting = startSyncIfConfigured(workspaceVault);
    await vi.waitFor(() => expect(state.joinGate?.reached).toBe(true));
    expect(getSyncStatus().status).toBe("syncing");

    // The vault is closed, or switched, while the join still runs.
    await stopSyncAndDrain();
    state.joinGate.release();
    await starting;

    expect(running()).toEqual({ workers: 0, settingsOnly: 0 });
    expect(getSyncStatus().status).not.toBe("syncing");
  });
});
