import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { filesRunState } from "@plainva/ui";

const settings = vi.hoisted(() => new Map<string, unknown>());
vi.mock("./settingsStore", () => ({
  getSettingsStore: async () => ({
    get: async (key: string) => settings.get(key),
    set: async (key: string, value: unknown) => { settings.set(key, value); },
    delete: async (key: string) => settings.delete(key),
    save: async () => undefined,
  }),
}));
vi.mock("./cloudAccounts", () => ({ loadCloudAccounts: async () => [] }));

import { requestClearSyncState, takeClearSyncStateRequest } from "./filesSwitch";

/**
 * Second review of plan "Verbinden", B3 and B4b, the rules both shells share.
 */
describe("how a vault's file sync runs on this device (B3)", () => {
  it("keeps the settings travelling while files are off for the vault", () => {
    expect(filesRunState({ filesOff: true, pausedHere: false, signedOut: false })).toBe("settingsOnly");
    expect(filesRunState({ filesOff: false, pausedHere: false, signedOut: false })).toBe("running");
  });

  it("stops everything, settings included, where the person paused it or signed out", () => {
    expect(filesRunState({ filesOff: true, pausedHere: true, signedOut: false })).toBe("stopped");
    expect(filesRunState({ filesOff: false, pausedHere: false, signedOut: true })).toBe("stopped");
  });

  it("is what the desktop opens a vault with, and a switch arriving with the profile reopens it", () => {
    const vault = readFileSync(join(__dirname, "..", "contexts", "VaultContext.tsx"), "utf8");
    expect(vault).toMatch(/filesRunState\(\{ filesOff: filesOffHere, pausedHere: await isSyncPausedHere\(path\), signedOut: !!fileAccess\.signedOut \}\)/);
    expect(vault).toMatch(/new SettingsOnlySync\(runner, target, backupVaultAdapter, intervalMs\)/);
    expect(vault).toMatch(/window\.addEventListener\(CLOUD_ACCOUNTS_EVENT, handleFilesSwitch\)/);
  });
});

describe("the files of a removed account leave nothing to push (B4b)", () => {
  it("asks once for the vault's queue and records to be cleared at its next open", async () => {
    expect(await takeClearSyncStateRequest("/v")).toBe(false);
    await requestClearSyncState("/v");
    expect(await takeClearSyncStateRequest("/v")).toBe(true);
    expect(await takeClearSyncStateRequest("/v")).toBe(false);
  });

  it("is taken when the vault opens, before a worker can run", () => {
    const vault = readFileSync(join(__dirname, "..", "contexts", "VaultContext.tsx"), "utf8");
    expect(vault).toMatch(/if \(await takeClearSyncStateRequest\(path\)\) \{\s*await syncQueue\.clearAll\(\);\s*await syncRepo\.clearAll\(\);/);
    const actions = readFileSync(join(__dirname, "cloudAccountsActions.ts"), "utf8");
    expect(actions).toMatch(/await requestClearSyncState\(vaultPath\);/);
  });
});
