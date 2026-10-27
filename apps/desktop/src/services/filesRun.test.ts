import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { filesRunState, filesStoppedStatus } from "@plainva/ui";

/**
 * Reviews of plan "Verbinden" (second B3, third finding 3), the rules both shells share.
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
    expect(vault).toMatch(/filesRunState\(\{ filesOff: filesOffHere, pausedHere, signedOut: !!fileAccess\.signedOut \}\)/);
    expect(vault).toMatch(/new SettingsOnlySync\(runner, target, backupVaultAdapter, intervalMs\)/);
    expect(vault).toMatch(/window\.addEventListener\(CLOUD_ACCOUNTS_EVENT, handleFilesSwitch\)/);
  });
});

describe("a vault standing still says why, as on the phone (third review, finding 3)", () => {
  it("reads as off where the person paused it, and as a sign-in needed where it is signed out", () => {
    expect(filesStoppedStatus({ pausedHere: true, signedOut: false })).toEqual({ status: "off", messageKey: null, signInNeeded: false });
    expect(filesStoppedStatus({ pausedHere: true, signedOut: true })).toEqual({ status: "off", messageKey: null, signInNeeded: false });
    expect(filesStoppedStatus({ pausedHere: false, signedOut: true })).toEqual({ status: "error", messageKey: "deviceSignIn.needed", signInNeeded: true });
  });

  it("is what the desktop sets when a vault signed out here opens, with the account to sign in", () => {
    const vault = readFileSync(join(__dirname, "..", "contexts", "VaultContext.tsx"), "utf8");
    expect(vault).toMatch(/filesStoppedStatus\(\{ pausedHere, signedOut: !!fileAccess\.signedOut \}\)/);
    expect(vault).toMatch(/if \(!syncWorker && stoppedStatus\?\.signInNeeded\) \{\s*syncStatusStore\.set\(path, \{\s*status: stoppedStatus\.status,\s*message: i18n\.t\(stoppedStatus\.messageKey\),[\s\S]{0,120}signInAccountId,/);
  });
});
