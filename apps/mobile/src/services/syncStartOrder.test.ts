// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parkClosingSyncPlace, resetClosingSyncPlacesForTests, sameSyncTarget, syncStateBindingFor, toast, toastStore, type CloudAccountRecord } from "@plainva/ui";
import i18n from "@plainva/ui/i18n";
import type { MobileVault } from "./vaultService";
import { detachLoadedSync } from "./loadedSync";

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
  /** The registry's entry as written, patch by patch. */
  updates: [] as string[],
  settingsOnly: [] as Array<{ running: boolean }>,
  /** The sync records confirm remote files (cleared with them). */
  confirmed: false,
  /** The registry's fact that the vault synced before. */
  syncedBefore: false,
  /** The target each file worker was built with. */
  targets: [] as Array<{ allowRootCreation?: boolean }>,
  /** Each file worker, to complete its first cycle by hand. */
  workerHooks: [] as Array<{ onFirstCycleComplete?: (outcome: { skipped: string[]; conflictCopies: string[] }) => void }>,
  /** What `.pvws/genesis.pvgen` answers in the vault's folder (R8 follow-up). */
  genesis: "none" as "none" | "found" | "error",
  /** A stored workspace status (a member) - with or without its keys. */
  wsStatus: null as null | { phase: string },
  /** What is left of a workspace whose decommission stopped midway (`mobileDecommissionUnfinished`). */
  decommissionUnfinished: false,
  /** How often the genesis was read on its own. */
  genesisReads: 0,
  /** The settings store fails for the encrypted-remote fact. */
  brokenStore: false,
  /** The addresses this phone confirmed (F57). */
  confirmedEndpoints: new Set<string>(),
  /** The vault on screen (a switch during a step moves it). */
  activeId: "v",
  /** The runtime on screen; null: the default vault's (`runtimeOnScreen`). */
  screen: null as unknown,
  /** Holds every worker's drain (a cycle that waits for a provider). */
  drainGate: null as null | Promise<void>,
  /** The vault left and opened anew when a step gave up waiting for its sync (vaultService). */
  renew: vi.fn(async (_left: { drain: Promise<void> }): Promise<unknown> => undefined),
}));

vi.mock("@plainva/core", async (original) => {
  class FakeRunning {
    running = false;
    start() { this.running = true; }
    stop() { this.running = false; }
    async stopAndDrain() { this.running = false; if (state.drainGate) await state.drainGate; }
    triggerImmediate() {}
    async pushSettingsNow() {}
  }
  class FakeWorker extends FakeRunning {
    onFirstCycleComplete?: (outcome: { skipped: string[]; conflictCopies: string[] }) => void;
    constructor(...args: unknown[]) {
      super();
      state.workers.push(this);
      state.log.push("worker");
      if (args[1] && typeof args[1] === "object") state.targets.push(args[1] as { allowRootCreation?: boolean });
      state.workerHooks.push(this);
    }
    verifyDeletionJournal() { return Promise.resolve(null); }
  }
  class FakeSettingsOnly extends FakeRunning {
    constructor() { super(); state.settingsOnly.push(this); }
  }
  return {
    ...await original<typeof import("@plainva/core")>(),
    SyncWorker: FakeWorker,
    SettingsOnlySync: FakeSettingsOnly,
    SyncEngine: class {},
    DeletionJournal: class {},
    // The folder's genesis, as the vault's own target reads it (R8).
    WebDavSyncTarget: class extends (await original<typeof import("@plainva/core")>()).WebDavSyncTarget {
      override async download(path: string): Promise<Uint8Array | null> {
        if (path.toLowerCase() !== ".pvws/genesis.pvgen") return null;
        state.genesisReads += 1;
        if (state.genesis === "error") throw new Error("HTTP 503");
        return state.genesis === "found" ? new Uint8Array([1]) : null;
      }
    },
  };
});
// The workspace worker is the same fake as the sync worker: the mocked main entry hands it over.
vi.mock("@plainva/core/workspace", async (original) => ({
  ...await original<typeof import("@plainva/core/workspace")>(),
  EncryptedWorkspaceWorker: (await import("@plainva/core")).SyncWorker,
  initializePersonalWorkspaceMigration: async () => {
    if (!state.joinGate) return;
    state.joinGate.reached = true;
    await state.joinGate.promise;
  },
  createProviderWorkspaceObjectStore: () => ({ get: async () => null }),
}));
vi.mock("@plainva/ui", async (original) => ({
  ...await original<typeof import("@plainva/ui")>(),
  // This phone's confirmed addresses (endpointConfirmation.ts), as the gates ask them.
  isEndpointConfirmedIn: async (_vault: string, endpoint: string | null) => !endpoint || state.confirmedEndpoints.has(endpoint),
  assertEndpointConfirmedIn: async (_vault: string, ...endpoints: Array<string | null>) => {
    for (const endpoint of endpoints) {
      if (endpoint && !state.confirmedEndpoints.has(endpoint)) throw Object.assign(new Error(`not confirmed on this device: ${endpoint}`), { name: "EndpointNotConfirmedError", endpoint });
    }
  },
  getPlatformServices: () => ({ credentials: {
    readSecret: async (key: string) => key === "sync_provider_mobile_v"
      ? { provider: "webdav", creds: { url: state.url, user: "u", pass: state.pass, ...(state.signedOutHere ? { signedOutHere: true } : {}) } }
      : null,
    writeSecret: async () => undefined,
    removeSecret: async () => undefined,
  },
  loadSettings: async () => ({
    get: async (key: string) => {
      if (state.brokenStore && key.startsWith("encryptedRemote_")) throw new Error("store unavailable");
      return state.settings.get(key) ?? null;
    },
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
  getActiveVaultEntry: async () => ({ id: state.activeId }),
  newVaultId: () => "added",
  addVault: async () => undefined,
  getVaultEntry: async () => ({ id: "v", provider: "webdav", pausedHere: state.pausedHere, syncedBefore: state.syncedBefore }),
  updateVault: async (_id: string, patch: { pausedHere?: boolean; syncedBefore?: boolean }) => {
    state.updates.push(JSON.stringify(patch));
    if (patch.pausedHere !== undefined) state.pausedHere = patch.pausedHere;
    if (patch.syncedBefore !== undefined) state.syncedBefore = patch.syncedBefore;
  },
}));
vi.mock("./vaultService", () => ({ getMobileVault: async () => vault, switchVault: vi.fn(), renewAfterSyncGaveUp: state.renew, runtimeOnScreen: () => state.screen ?? vault, reloadActiveMobileVault: vi.fn(async () => true), transitionsSettled: async () => {} }));
vi.mock("./flowVault", () => ({ enterMadeVault: async () => undefined }));
vi.mock("./mobileSettingsSync", () => ({
  mobileSyncDeviceId: async () => "phone",
  prepareMobileSettingsSync: async (_v: unknown, _p: unknown, raw: unknown) => ({ target: raw, runner: { run: async () => undefined } }),
}));
vi.mock("./mobileWorkspaceSecurity", () => ({ loadMobilePublicationRuntime: async () => null, getMobileWorkspaceStatus: async () => state.wsStatus, mobileDecommissionUnfinished: async () => state.decommissionUnfinished }));
vi.mock("../adapters/webdavHttp", () => ({ webdavFetch: vi.fn(), allowHttpOrigin: vi.fn() }));
vi.mock("../adapters/syncUpload", () => ({ createContentRefResolver: () => ({}), mobileSyncUploader: {} }));

const vault = {
  vaultId: "v",
  syncQueue: { clearAll: async () => { state.log.push("clear queue"); }, enqueueLocalOnlyFiles: async () => undefined },
  syncRepo: {
    clearAll: async () => { state.log.push("clear records"); state.confirmed = false; },
    // Where the start waits after it has decided: the gate holds it there.
    hasConfirmedRemoteFiles: () => {
      if (!state.gate) return Promise.resolve(state.confirmed);
      state.gate.reached = true;
      return state.gate.promise;
    },
  },
  adapter: { sandboxRoot: "" },
  files: {},
  workspaceRuntime: null,
  enableSyncEnqueue: () => undefined,
  markFirstSyncComplete: () => undefined,
  sweepOwedToRemote: () => undefined,
  reindexPaths: async () => undefined,
} as unknown as MobileVault;

import { connectProvider, detachSync, restartSync, startSyncAfterBoot, disconnectFiles, getSyncStatus, isFirstPullPending, listStoredProviderFolders, syncNow, pauseSyncHere, restartSyncIfActive, startSyncIfConfigured, stopSyncForStep, withRuntimeStep, withVaultSyncStopped } from "./syncService";

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
  state.updates.length = 0;
  state.gate = null;
  state.joinGate = null;
  state.confirmed = false;
  state.syncedBefore = false;
  state.targets.length = 0;
  state.workerHooks.length = 0;
  state.workers.length = 0;
  state.settingsOnly.length = 0;
  state.genesis = "none";
  state.wsStatus = null;
  state.decommissionUnfinished = false;
  state.genesisReads = 0;
  state.brokenStore = false;
  state.confirmedEndpoints.clear();
  state.drainGate = null;
  state.activeId = "v";
  state.screen = null;
});

afterEach(async () => {
  state.drainGate = null;
  state.gate?.release();
  state.joinGate?.release();
  await detachSync().drain();
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
    await detachSync().drain();
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

describe("a file address in the local network this phone has not confirmed (F57; review of F57, O3/O4)", () => {
  it("starts nothing and names the address to confirm, never a sign-in", async () => {
    state.url = "http://192.168.1.5/dav";
    await startSyncIfConfigured(vault);
    expect(running()).toEqual({ workers: 0, settingsOnly: 0 });
    expect(getSyncStatus()).toMatchObject({ status: "error", errorKind: "unconfirmed", confirmEndpoint: "http://192.168.1.5:80" });
  });

  it("sends the stored password nowhere, not even to list the folders", async () => {
    state.url = "http://192.168.1.5/dav";
    await expect(listStoredProviderFolders("v", "")).rejects.toMatchObject({ name: "EndpointNotConfirmedError", endpoint: "http://192.168.1.5:80" });
    expect(state.genesisReads).toBe(0);
  });

  it("starts again once the address is confirmed", async () => {
    state.url = "http://192.168.1.5/dav";
    state.confirmedEndpoints.add("http://192.168.1.5:80");
    await startSyncIfConfigured(vault);
    expect(getSyncStatus().errorKind).toBeUndefined();
  });

  it("asks the confirmation on the vault screen", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const screen = readFileSync(join(__dirname, "..", "VaultDetailScreen.tsx"), "utf8");
    expect(screen).toMatch(/status\.errorKind === "unconfirmed" && status\.confirmEndpoint && \(\s*<FilesConfirmAddress/);
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
    await detachSync().drain();
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
    state.screen = workspaceVault;
    const starting = startSyncIfConfigured(workspaceVault);
    await vi.waitFor(() => expect(state.joinGate?.reached).toBe(true));
    expect(getSyncStatus().status).toBe("syncing");

    // The vault is closed, or switched, while the join still runs.
    await detachSync().drain();
    state.joinGate.release();
    await starting;

    expect(running()).toEqual({ workers: 0, settingsOnly: 0 });
    expect(getSyncStatus().status).not.toBe("syncing");
  });
});

describe("an encrypted workspace's first cycle (3.119)", () => {
  it("lifts the deferral of new files, as the plain worker's does", async () => {
    // Until it did, a file another app put beside the app reached the
    // workspace queue only through the reconcile at the next start.
    const markFirstSyncComplete = vi.fn();
    const sweepOwedToRemote = vi.fn();
    const workspaceVault = { ...vault, workspaceRuntime: {}, workspaceState: {}, markFirstSyncComplete, sweepOwedToRemote } as unknown as MobileVault;
    state.screen = workspaceVault;
    await startSyncIfConfigured(workspaceVault);
    const encrypted = state.workerHooks[state.workerHooks.length - 1];
    expect(encrypted?.onFirstCycleComplete).toBeTypeOf("function");
    expect(markFirstSyncComplete).not.toHaveBeenCalled();
    encrypted!.onFirstCycleComplete!({ skipped: [], conflictCopies: [] });
    expect(markFirstSyncComplete).toHaveBeenCalledTimes(1);
    // And queues what the index found and an ended app never queued (R22).
    expect(sweepOwedToRemote).toHaveBeenCalledWith("workspace");
  });
});

describe("a vault that synced before stays one, whatever its records say (fifth review, finding 2)", () => {
  it("after a reset and a cycle that confirmed nothing, the next start creates no folder", async () => {
    // Synced with folder A.
    state.confirmed = true;
    await startSyncIfConfigured(vault);
    expect(state.targets[0].allowRootCreation).toBe(false);
    await detachSync().drain();
    // Connected to another folder: the reset empties the records, and the
    // first cycle there confirms nothing (the folder briefly gone).
    state.url = "https://dav.example.test/another-vault";
    await startSyncIfConfigured(vault);
    expect(state.log).toContain("clear records");
    expect(state.confirmed).toBe(false);
    await detachSync().drain();
    // The next start: no folder is created; the target says it is missing.
    await startSyncIfConfigured(vault);
    expect(state.targets[2].allowRootCreation).toBe(false);
  });

  it("a vault that never synced may create its folder, until its first cycle has run", async () => {
    await startSyncIfConfigured(vault);
    expect(state.targets[0].allowRootCreation).toBe(true);
    state.workerHooks[0].onFirstCycleComplete?.({ skipped: [], conflictCopies: [] });
    await vi.waitFor(() => expect(state.syncedBefore).toBe(true));
    await detachSync().drain();
    await startSyncIfConfigured(vault);
    expect(state.targets[1].allowRootCreation).toBe(false);
  });
});

describe("the encrypted-workspace rule on the phone (R8)", () => {
  const known = () => state.settings.set("encryptedRemote_v", { v: 2, state: "encrypted" });

  it("a vault that knows nothing starts as before - no read of the genesis, whatever the folder answers", async () => {
    for (const genesis of ["none", "found", "error"] as const) {
      state.genesis = genesis;
      await startSyncIfConfigured(vault);
      expect(running().workers).toBe(1);
      await detachSync().drain();
      state.workers.length = 0;
    }
    expect(state.genesisReads).toBe(0);
  });

  it("an update from a vault without a stored binding syncs at once", async () => {
    expect(state.settings.has("syncStateBinding_v")).toBe(false);
    await startSyncIfConfigured(vault);
    expect(running().workers).toBe(1);
  });

  it("a known workspace in the folder holds the start and says so", async () => {
    known();
    state.genesis = "found";
    await startSyncIfConfigured(vault);
    expect(running().workers).toBe(0);
    expect(getSyncStatus()).toMatchObject({ status: "error", errorKind: "pair-required" });
  });

  it("a failed read waits calmly and asks again; 'Sync now' asks at once", async () => {
    known();
    state.genesis = "error";
    await startSyncIfConfigured(vault);
    expect(running().workers).toBe(0);
    expect(getSyncStatus()).toMatchObject({ status: "retrying" });
    const before = state.genesisReads;
    state.genesis = "found";
    syncNow();
    await vi.waitFor(() => expect(state.genesisReads).toBe(before + 1));
    await vi.waitFor(() => expect(getSyncStatus()).toMatchObject({ status: "error", errorKind: "pair-required" }));
  });

  it("three clean 'not found' answers make it a normal folder again", async () => {
    known();
    state.genesis = "none";
    for (let i = 0; i < 2; i++) {
      await startSyncIfConfigured(vault);
      expect(running().workers).toBe(0);
      await detachSync().drain();
    }
    await startSyncIfConfigured(vault);
    expect(running().workers).toBe(1);
    expect(state.settings.has("encryptedRemote_v")).toBe(false);
  });

  it("the settings-only sync of a vault whose files are off is held by the same rule", async () => {
    state.filesOff = true;
    known();
    state.genesis = "found";
    await startSyncIfConfigured(vault);
    expect(running()).toEqual({ workers: 0, settingsOnly: 0 });
    expect(getSyncStatus()).toMatchObject({ errorKind: "pair-required" });
  });

  it("a member without its keys - locked, or the key gone with a reinstall - never starts the plain sync", async () => {
    state.wsStatus = { phase: "locked" };
    state.genesis = "error";
    await startSyncIfConfigured(vault);
    expect(running()).toEqual({ workers: 0, settingsOnly: 0 });
    expect(getSyncStatus()).toMatchObject({ status: "error", errorKind: "pair-required" });
    expect(state.settings.get("encryptedRemote_v")).toMatchObject({ state: "joined" });
  });

  it("a vault whose decommission stopped midway never starts the plain sync, and says why (review B2, round 8)", async () => {
    expect.hasAssertions();
    // The status went, the device key or the state did not: the vault opened without its workspace.
    state.decommissionUnfinished = true;
    state.genesis = "error";
    await startSyncIfConfigured(vault);
    expect(running()).toEqual({ workers: 0, settingsOnly: 0 });
    expect(getSyncStatus()).toMatchObject({ status: "error", errorKind: "pair-required", message: i18n.t("workspaceSecurity.decommissionUnfinished") });
  });

  it("a store that fails inside the rule does not stop the start", async () => {
    state.brokenStore = true;
    await expect(startSyncIfConfigured(vault)).resolves.toBeUndefined();
    expect(running().workers).toBe(1);
  });

  it("\"Add vault\" reads nothing from the folder: its first listing is the look", async () => {
    state.genesis = "found";
    await connectProvider(vault, { provider: "webdav", creds: { url: state.url, user: "u", pass: "p" } });
    expect(state.genesisReads).toBe(0);
    expect(state.settings.has("encryptedRemote_added")).toBe(false);
  });

  it("joining keeps the knowledge, as membership", async () => {
    known();
    const joined = { ...vault, workspaceRuntime: { memberId: "m", genesis: { kind: "genesis" } }, workspaceState: {} } as unknown as MobileVault;
    state.screen = joined;
    await startSyncIfConfigured(joined).catch(() => undefined);
    expect(state.settings.get("encryptedRemote_v")).toMatchObject({ state: "joined" });
  });
});

describe("the first pull of a vault (O8: a cloud vault arriving is not an empty one)", () => {
  it("is pending from the worker's start until its first cycle is done, and nothing without a worker", async () => {
    expect(isFirstPullPending(getSyncStatus())).toBe(false);
    // A vault opened afresh: what earlier tests' pulls of `vault` failed does not carry over.
    state.screen = { ...vault } as MobileVault;
    await startSyncIfConfigured(state.screen as MobileVault);
    expect(getSyncStatus().firstPullDone).toBe(false);
    expect(isFirstPullPending(getSyncStatus())).toBe(true);
    const plain = state.workers[state.workers.length - 1] as { onFirstCycleComplete?: (outcome: { skipped: string[]; conflictCopies: string[] }) => void };
    plain.onFirstCycleComplete!({ skipped: [], conflictCopies: [] });
    expect(getSyncStatus().firstPullDone).toBe(true);
    expect(isFirstPullPending(getSyncStatus())).toBe(false);
    await detachSync().drain();
    expect(getSyncStatus().firstPullDone).toBeNull();
  });
  it("the first failure ends \"being loaded\" for the session, a new start included (third review of O8)", async () => {
    const opened = { ...vault } as MobileVault;
    state.screen = opened;
    await startSyncIfConfigured(opened);
    expect(isFirstPullPending(getSyncStatus())).toBe(true);
    type W = { onStatusChange?: (status: "idle" | "syncing" | "retrying" | "error", message?: string, reason?: unknown, retryAt?: number) => void };
    const first = state.workers[state.workers.length - 1] as W;
    first.onStatusChange!("syncing");
    first.onStatusChange!("retrying", "offline", undefined, Date.now() + 1000);
    first.onStatusChange!("syncing");
    expect(getSyncStatus().firstPullFailed).toBe(true);
    expect(isFirstPullPending(getSyncStatus())).toBe(false);
    // The sync starts again for the same opened vault (settings, a return to the app): Home stays as it is.
    await detachSync().drain();
    await startSyncIfConfigured(opened);
    expect(getSyncStatus().firstPullDone).toBe(false);
    expect(isFirstPullPending(getSyncStatus())).toBe(false);
    // The vault opened again (a switch, a reload) is a pull of its own.
    await detachSync().drain();
    state.screen = { ...vault } as MobileVault;
    await startSyncIfConfigured(state.screen as MobileVault);
    expect(isFirstPullPending(getSyncStatus())).toBe(true);
  });
});

/**
 * A sync belongs to the runtime it started for. A close takes it off at once
 * (`detachSync`) and drains it only after its saves; a save that hangs past
 * the close's deadline used to leave the old worker in place — the next
 * vault's start found it and started nothing, and the old vault's late drain
 * then stopped whatever ran by then.
 */
describe("the sync of a vault that closes", () => {
  it("is taken off at once: the next vault's sync starts while the old one still drains, and the late drain stops only its own", async () => {
    expect.hasAssertions();
    await startSyncIfConfigured(vault);
    expect(running()).toEqual({ workers: 1, settingsOnly: 0 });
    const old = state.workers[0];

    // The close begins: the sync is taken off, its drain comes after the saves — which hang.
    let answer!: () => void;
    state.drainGate = new Promise<void>((r) => (answer = r));
    const { drain } = detachSync();
    expect(old.running, "its clock stopped at once").toBe(false);

    // The next runtime opens meanwhile and starts its sync (another runtime object; the fakes here know one registry entry).
    const next = { ...vault } as MobileVault;
    state.screen = next;
    await startSyncIfConfigured(next);
    expect(state.workers, "a worker for the next vault").toHaveLength(2);
    const mine = state.workers[1];
    expect(mine.running).toBe(true);

    // The old vault's drain, late: it reaches its own worker only.
    const drained = drain();
    answer();
    await drained;
    expect(mine.running, "the next vault's sync runs on").toBe(true);
  });
});

/**
 * Never two runtimes at one place, and the sync folder at the provider is a
 * place: two vault entries can be bound to the same folder. While one of them
 * closes with a request still open there, the other's sync waits for it — a
 * late upload of the old runtime would land over what the new one sent.
 */
describe("a sync start at a folder where another vault's runtime still closes", () => {
  afterEach(() => { resetClosingSyncPlacesForTests(); toast.clearAll(); });

  const folder = (url: string) => syncStateBindingFor({ provider: "webdav", webdav: { url, user: "u" } });

  it("waits until that runtime has ended, and starts then", async () => {
    expect.hasAssertions();
    let end!: () => void;
    parkClosingSyncPlace(folder(state.url), "Other entry", new Promise<void>((r) => (end = r)));
    const starting = startSyncIfConfigured(vault);
    await new Promise((r) => setTimeout(r, 20));
    expect(state.workers, "nothing at the folder beside the closing runtime").toHaveLength(0);
    end();
    await starting;
    expect(running()).toEqual({ workers: 1, settingsOnly: 0 });
  });

  it("stops waiting when the sync is stopped meanwhile, and its notice (text 8) goes with it", async () => {
    expect.hasAssertions();
    vi.useFakeTimers();
    try {
      parkClosingSyncPlace(folder(state.url), "Other entry", new Promise<void>(() => undefined));
      const starting = startSyncIfConfigured(vault);
      await vi.advanceTimersByTimeAsync(5_000);
      expect(toastStore.get().map((t) => t.message)).toEqual([i18n.t("closing.stillClosingSameFolder", { vault: "Other entry" })]);
      // The vault is closed while its sync still waits for the folder.
      detachSync();
      await vi.advanceTimersByTimeAsync(0);
      await starting;
      // THE DEFECT: the notice stood after the vault that waited was closed.
      expect(toastStore.get().map((t) => t.message)).toEqual([]);
      expect(state.workers).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not wait for a runtime closing at another folder", async () => {
    expect.hasAssertions();
    parkClosingSyncPlace(folder("https://dav.example.test/elsewhere"), "Other entry", new Promise<void>(() => undefined));
    await startSyncIfConfigured(vault);
    expect(running()).toEqual({ workers: 1, settingsOnly: 0 });
  });

  it("the close names the folder its sync used, so the next start there waits for this runtime", async () => {
    expect.hasAssertions();
    await startSyncIfConfigured(vault);
    const { place } = detachSync();
    expect(place && sameSyncTarget(place, folder(state.url))).toBe(true);
  });
});

/**
 * A step that stops the sync to work on the vault — the security wizard, a
 * password, files switched off — waits for its drain within the close's
 * deadline, never without end. A cycle that does not end in time is left:
 * the vault opens anew, the step goes on with the new runtime, and that
 * runtime's start after its boot puts nothing in place until the step
 * starts the sync itself.
 */
describe("a step that stops the sync", () => {
  afterEach(() => { vi.useRealTimers(); state.renew.mockReset(); });

  const otherVault = () => ({ ...vault, vaultId: "work" }) as MobileVault;
  /** The step as its caller makes it: its vault and its runtime, from the press on. */
  const step = () => ({ vaultId: "v", runtime: vault });

  it("goes on with nothing where another vault is on screen already when it is called — and stops nothing of that one", async () => {
    expect.hasAssertions();
    await startSyncIfConfigured(vault);
    // The caller had its vault; a switch (a link, a widget) came before the step's first line.
    const other = otherVault();
    state.screen = other;
    const outcome = await stopSyncForStep(step()).then(() => "went on", (e: Error) => e.name);
    // THE DEFECT (probe m5): the step read "the active vault", took that one's sync and went on with its runtime.
    expect(outcome).toBe("StepNotRunError");
    expect(running().workers, "the other vault's sync runs on").toBe(1);
    expect(state.renew).not.toHaveBeenCalled();
  });

  for (const when of ["within the deadline", "after the deadline"] as const) {
    it(`does not go on where the vault was switched away from while it waited (${when})`, async () => {
      expect.hasAssertions();
      await startSyncIfConfigured(vault);
      let answer!: () => void;
      state.drainGate = new Promise<void>((r) => (answer = r));
      vi.useFakeTimers();
      const stopping = stopSyncForStep(step()).then((v) => (v === null ? "the vault it has" : "a runtime"), (e: Error) => e.name);
      await vi.advanceTimersByTimeAsync(10_000);
      // The person switches to another vault while the step waits for its cycle.
      state.screen = otherVault();
      if (when === "within the deadline") answer();
      await vi.advanceTimersByTimeAsync(20_000);
      // THE DEFECT: the step went on — with its own, now closed runtime, or with the other vault's opened anew.
      expect(await stopping).toBe("StepNotRunError");
      expect(state.renew, "the vault on screen now is not left for the step").not.toHaveBeenCalled();
      vi.useRealTimers();
      answer();
    });
  }

  it("does not go on where the same vault was left and opened again while it waited (away and back)", async () => {
    expect.hasAssertions();
    await startSyncIfConfigured(vault);
    let answer!: () => void;
    state.drainGate = new Promise<void>((r) => (answer = r));
    const stopping = stopSyncForStep(step()).then((v) => (v === null ? "its old runtime" : "a runtime"), (e: Error) => e.name);
    await new Promise((r) => setTimeout(r, 10));
    // Away and back: the same vault, a new runtime of it.
    state.screen = { ...vault } as MobileVault;
    answer();
    // THE DEFECT (probe m6): the vault's id matched, and the step went on with its old, closed runtime.
    expect(await stopping).toBe("StepNotRunError");
  });

  it("a restart for a vault that is not on screen stops nothing of the one that is", async () => {
    expect.hasAssertions();
    await startSyncIfConfigured(vault);
    const runningWorker = state.workers[state.workers.length - 1];
    const built = state.workers.length;
    // THE DEFECT (N11): asked for "work" with "v" on screen, the restart stopped and started "v"'s sync.
    await restartSyncIfActive("work");
    expect(runningWorker?.running, "the vault on screen keeps its worker").toBe(true);
    expect(state.workers.length, "no worker built anew").toBe(built);
  });

  it("a restart in the start chain for a runtime no longer on screen starts nothing", async () => {
    expect.hasAssertions();
    // Nothing runs: the vault the restart was asked for is not on screen any more.
    const before = state.workers.length;
    state.screen = otherVault();
    // THE DEFECT (MU6): a restart whose vault was left went on as if it had found nothing to stop, and started a worker.
    await restartSync(vault);
    expect(state.workers.length, "no new worker").toBe(before);
  });

  it("goes on with the vault it has where the sync ends in time", async () => {
    expect.hasAssertions();
    await startSyncIfConfigured(vault);
    expect(await stopSyncForStep(step())).toBeNull();
    expect(state.renew).not.toHaveBeenCalled();
    expect(running()).toEqual({ workers: 0, settingsOnly: 0 });
  });

  it("leaves the vault after 30 s, goes on with its new runtime, and that runtime's sync waits for the step", async () => {
    expect.hasAssertions();
    await startSyncIfConfigured(vault);
    let answer!: () => void;
    state.drainGate = new Promise<void>((r) => (answer = r));
    const fresh = { ...vault } as MobileVault;
    state.renew.mockImplementationOnce(async () => fresh);
    vi.useFakeTimers();
    let on: MobileVault | null | undefined;
    let through!: () => void;
    const working = new Promise<void>((r) => (through = r));
    const stepping = withRuntimeStep(step(), {
      work: async (stop) => {
        on = await stop();
        await working;
      },
    });
    await vi.advanceTimersByTimeAsync(29_000);
    // THE DEFECT: the step waited for the cycle for as long as it ran — with no end where a call hung.
    expect(on, "within the deadline it still waits").toBeUndefined();
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.waitFor(() => expect(on, "the step goes on with the new runtime").toBe(fresh));
    expect(state.renew).toHaveBeenCalledTimes(1);
    vi.useRealTimers();

    // The new runtime's start after its boot: held for the step, as is a restart from elsewhere.
    state.screen = fresh;
    await startSyncAfterBoot(fresh);
    await restartSyncIfActive("v");
    expect(running()).toEqual({ workers: 0, settingsOnly: 0 });
    // The step through, its release starts the sync once.
    through();
    await stepping;
    await vi.waitFor(() => expect(running()).toEqual({ workers: 1, settingsOnly: 0 }));
    answer();
  });
});

/**
 * A step on a vault's sign-ins — a password, the broker, the files taken out
 * — belongs to the vault, not to a runtime of it (`withVaultSyncStopped`): it
 * holds the vault's sync from its first line to its end, stops what runs of
 * it then, and never says it did not run (review B2 round 5, s1/s2).
 */
describe("a step on a vault's sign-ins", () => {
  afterEach(() => { vi.useRealTimers(); state.renew.mockReset(); toast.clearAll(); });
  const otherVault = () => ({ ...vault, vaultId: "work" }) as MobileVault;

  it("stops only that vault's sync, and runs where another vault is on screen", async () => {
    expect.hasAssertions();
    await startSyncIfConfigured(vault);
    state.screen = otherVault();
    let ran = false;
    await withVaultSyncStopped("v", async () => { ran = true; });
    expect(ran).toBe(true);
    expect(running().workers, "the other vault's sync runs on").toBe(1);
  });

  for (const start of ["startSyncAfterBoot", "startSyncIfConfigured"] as const) {
    it(`leaves no sync of the vault running when it was left and opened again in the wait — files taken out (${start})`, async () => {
      expect.hasAssertions();
      await startSyncIfConfigured(vault);
      let answer!: () => void;
      state.drainGate = new Promise<void>((r) => (answer = r));
      const disconnecting = disconnectFiles("v").then(() => "done", (e: Error) => e.name);
      await new Promise((r) => setTimeout(r, 10));
      // Away and back within the wait: the new runtime of the vault starts its sync.
      state.drainGate = null;
      const fresh = { ...vault } as MobileVault;
      state.screen = fresh;
      await (start === "startSyncAfterBoot" ? startSyncAfterBoot(fresh) : startSyncIfConfigured(fresh));
      answer();
      expect(await disconnecting).toBe("done");
      // THE DEFECT (probe s1): the step compared with the runtime it began on; the new one's worker kept the sign-in.
      expect(running().workers, "no sync runs for the account's files once they are taken out").toBe(0);
    });
  }

  it("never says it did not run where its renew after the deadline meets a switch — it writes, and says nothing", async () => {
    expect.hasAssertions();
    await startSyncIfConfigured(vault);
    state.drainGate = new Promise<void>(() => undefined);
    // As vaultService does where the vault was left before the renew's turn: the step's runtime is not on screen.
    state.renew.mockImplementationOnce(async (left: { drain: Promise<void>; notRun?: () => Error }) => { throw left.notRun!(); });
    vi.useFakeTimers();
    const disconnecting = disconnectFiles("v").then(() => "done", (e: Error) => e.name);
    await vi.advanceTimersByTimeAsync(31_000);
    const outcome = await disconnecting;
    vi.useRealTimers();
    // THE DEFECT (probe s2): "Nothing was changed" was said, and then the sign-in was taken out.
    expect(outcome).toBe("done");
    expect(toastStore.get().map((t) => t.message).filter((m) => /did not run|nicht gelaufen/.test(m))).toEqual([]);
    expect(state.updates, "the files are taken out").toEqual(['{"pausedHere":false}']);
  });

  it("starts the vault's sync again where the step fails: it changed nothing", async () => {
    expect.hasAssertions();
    await startSyncIfConfigured(vault);
    await expect(withVaultSyncStopped("v", async () => { throw new Error("keychain locked"); })).rejects.toThrow("keychain locked");
    await vi.waitFor(() => expect(running().workers).toBe(1));
  });

  it("holds every start of the vault while it runs, and lets the one after it start", async () => {
    expect.hasAssertions();
    await startSyncIfConfigured(vault);
    let during = -1;
    await withVaultSyncStopped("v", async () => {
      await startSyncAfterBoot(vault);
      await startSyncIfConfigured(vault);
      during = running().workers;
    });
    expect(during, "nothing of the vault's sync starts while the step holds it").toBe(0);
    await restartSyncIfActive("v");
    expect(running().workers).toBe(1);
  });
});

describe("the sync loaded lazily (performance plan L5)", () => {
  it("is taken off at once by a close in vaultService, which never imports it at the start", async () => {
    expect.hasAssertions();
    await startSyncIfConfigured(vault);
    expect(running().workers).toBe(1);
    // As `settleBeforeClosing` does: synchronously, through what the sync registered as its module loaded.
    const taken = detachLoadedSync();
    expect(taken.running, "the close found the running sync").toBe(true);
    expect(running().workers, "and took it off before anything waited").toBe(0);
    await taken.drain();
  });
});

describe("the plain sync's first cycle (stability plan R22)", () => {
  it("queues what the index found and an ended app never queued, once the first cycle has looked — not before", async () => {
    expect.hasAssertions();
    const markFirstSyncComplete = vi.fn();
    const sweepOwedToRemote = vi.fn();
    const plainVault = { ...vault, markFirstSyncComplete, sweepOwedToRemote } as unknown as MobileVault;
    state.screen = plainVault;
    await startSyncIfConfigured(plainVault);
    const plain = state.workerHooks[state.workerHooks.length - 1];
    expect(plain?.onFirstCycleComplete).toBeTypeOf("function");
    // Before the first cycle has looked, nothing is swept: the remote base is not known yet.
    expect(sweepOwedToRemote).not.toHaveBeenCalled();
    plain!.onFirstCycleComplete!({ skipped: [], conflictCopies: [] });
    expect(sweepOwedToRemote).toHaveBeenCalledTimes(1);
    expect(sweepOwedToRemote).toHaveBeenCalledWith("plain");
  });
});
