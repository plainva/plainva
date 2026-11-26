// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Wave 2, § 3.2, rounds 10 and 11 of the review: closed for an app means not open on this device — locked, or no key
 * here — told by the keys this device holds, never by a status saved before. Real key material in a credential store
 * kept in memory, as in `publicationKeychain.test.ts`.
 */

const secrets = new Map<string, unknown>();
let keychainStatus: "native" | "unavailable" = "native";

vi.mock("../CredentialManager", () => ({
  credentialManager: {
    readSecret: async (key: string) => secrets.get(key) ?? null,
    writeSecret: async (key: string, value: unknown) => {
      secrets.set(key, value);
    },
    removeSecret: async (key: string) => {
      secrets.delete(key);
    },
    checkKeychainStatus: async () => keychainStatus,
  },
}));
vi.mock("../settingsStore", () => ({
  getSettingsStore: async () => ({
    get: async () => undefined,
    set: async () => {},
    delete: async () => {},
    save: async () => {},
  }),
}));

import { createPersonalWorkspaceBootstrap, personalWorkspaceRuntime } from "@plainva/core/workspace";
import * as keychain from "./workspaceKeychain";
import { lockWorkspaceRuntime, persistWorkspaceRuntime, readWorkspaceRuntime, unlockWorkspaceRuntime, type WorkspaceSecurityPublicStatus } from "./workspaceKeychain";
import * as closedHere from "./workspaceClosed";
import { workspaceClosedHere } from "./workspaceClosed";

const VAULT = "/vault-closed";
const status = (phase: WorkspaceSecurityPublicStatus["phase"], lastError: string | null = null): WorkspaceSecurityPublicStatus => ({
  version: 1,
  workspaceId: "w",
  fingerprint: "ff".repeat(16),
  phase,
  recoveryConfirmedAt: "2026-11-18T08:00:00.000Z",
  keyStorage: keychainStatus === "native" ? "native" : "passphrase",
  deviceName: "Desk",
  lastError,
});

async function setUp(passphrase?: string) {
  const bootstrap = await createPersonalWorkspaceBootstrap({ ownerDisplayName: "Owner", deviceDisplayName: "Desk", platform: "desktop", minimumClientVersion: "0.5.0" });
  await persistWorkspaceRuntime({ vaultPath: VAULT, runtime: personalWorkspaceRuntime(bootstrap), fingerprint: "ff".repeat(16), recoveryConfirmedAt: "2026-11-18T08:00:00.000Z", fallbackPassphrase: passphrase });
}

// Real key material is sealed and unsealed in here (see `publicationKeychain.test.ts` for the budget).
describe("workspaceClosedHere", () => {
  beforeEach(() => {
    secrets.clear();
    keychainStatus = "native";
    // Whatever an earlier case left in memory: its keys dropped.
    lockWorkspaceRuntime(VAULT);
  });

  it("(a) a start that failed before the workspace was reached leaves any error in the status: without a key here it is no-key, never open", async () => {
    // The start found no key bundle, then the sync start threw with its own words (`VaultContext`, its catch).
    expect((await readWorkspaceRuntime(VAULT)).state).toBe("absent");
    expect(workspaceClosedHere(VAULT, status("error", "WebDAV answered 503"))).toBe("no-key");
    expect(workspaceClosedHere(VAULT, status("active"))).toBe("no-key");
  }, 15_000);

  it("(b) a vault without a sync target keeps the status saved last: with its keys not unlocked here it is locked, whatever that says", async () => {
    keychainStatus = "unavailable";
    await setUp("a passphrase of length");
    lockWorkspaceRuntime(VAULT);
    // The next start: the bundle is sealed with a passphrase, and nobody gave it yet.
    expect((await readWorkspaceRuntime(VAULT)).state).toBe("locked");
    expect(workspaceClosedHere(VAULT, status("active"))).toBe("locked");
    expect(workspaceClosedHere(VAULT, status("error", "WebDAV answered 503"))).toBe("locked");
    await unlockWorkspaceRuntime(VAULT, "a passphrase of length");
    expect(workspaceClosedHere(VAULT, status("locked"))).toBeNull();
  }, 15_000);

  it("(c) the lock closes the moment it begins, while the sync drains, and every watcher is told at once", async () => {
    await setUp();
    let told = 0;
    const stop = closedHere.onWorkspaceClosedChange(() => told++);
    try {
      expect(workspaceClosedHere(VAULT, status("active"))).toBeNull();
      const lock = keychain.beginWorkspaceLock(VAULT);
      // The keys are still in memory (the sync drains with them), the saved status still says active.
      expect(workspaceClosedHere(VAULT, status("active"))).toBe("locked");
      expect(told).toBe(1);
      lockWorkspaceRuntime(VAULT);
      expect(workspaceClosedHere(VAULT, status("active"))).toBe("locked");
      expect(told).toBe(2);
      // A lock that did not go through opens nothing that is locked.
      lock.undo();
      expect(workspaceClosedHere(VAULT, status("active"))).toBe("locked");
      await unlockWorkspaceRuntime(VAULT);
      expect(workspaceClosedHere(VAULT, status("locked"))).toBeNull();
      // A lock that is undone, before the keys fell, opens again.
      const again = keychain.beginWorkspaceLock(VAULT);
      expect(workspaceClosedHere(VAULT, status("active"))).toBe("locked");
      again.undo();
      expect(workspaceClosedHere(VAULT, status("active"))).toBeNull();
    } finally {
      stop();
    }
  }, 15_000);

  it("is open where the keys are unlocked here: a sync error, one being prepared or converted; and a vault that is no workspace is never closed", async () => {
    await setUp();
    for (const phase of ["active", "preparing", "migrating", "error", "locked"] as const) expect(workspaceClosedHere(VAULT, status(phase, phase === "error" ? "WebDAV answered 503" : null))).toBeNull();
    expect(workspaceClosedHere(VAULT, null)).toBeNull();
    expect(workspaceClosedHere(null, status("active"))).toBeNull();
    // Not looked at yet on this device: without a sign that it is open, it is locked.
    expect(workspaceClosedHere("/never-opened", status("active"))).toBe("locked");
  }, 15_000);
});
