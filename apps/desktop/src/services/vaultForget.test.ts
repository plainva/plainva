import { describe, expect, it } from "vitest";
import { collectPerVaultLocalStorageKeys, perVaultStoreSuffix } from "./vaultForget";
import {
  backupZipDestKey,
  backupMaxAgeDaysKey,
  backupSnapshotIntervalKey,
} from "./backupPolicy";
import {
  dailyNotesFolderKey,
  defaultNoteTypeKey,
  okfPromptDismissedKey,
  syncIntervalKey,
  templateFolderKey,
} from "../contexts/VaultContext";

const VAULT = "C:/Vaults/Mein Vault";

describe("perVaultStoreSuffix", () => {
  it("matches the suffix every per-vault settings key is built with", () => {
    const suffix = perVaultStoreSuffix(VAULT);
    // Representative keys from both key families (VaultContext + backupPolicy):
    // the suffix scan must cover them all, so forgetting cannot drift when new
    // per-vault keys are added.
    for (const key of [
      syncIntervalKey(VAULT),
      dailyNotesFolderKey(VAULT),
      templateFolderKey(VAULT),
      defaultNoteTypeKey(VAULT),
      okfPromptDismissedKey(VAULT),
      backupZipDestKey(VAULT),
      backupSnapshotIntervalKey(VAULT),
      backupMaxAgeDaysKey(VAULT),
    ]) {
      expect(key.endsWith(suffix)).toBe(true);
    }
  });

  it("never matches another vault's keys or global keys", () => {
    const suffix = perVaultStoreSuffix(VAULT);
    expect(syncIntervalKey("C:/Vaults/Anderer").endsWith(suffix)).toBe(false);
    expect("autoOpenLastVault".endsWith(suffix)).toBe(false);
    expect("recentVaults".endsWith(suffix)).toBe(false);
  });
});

describe("collectPerVaultLocalStorageKeys", () => {
  it("collects exactly the vault's key families, incl. per-file variants", () => {
    const all = [
      `plainva-layout-${VAULT}`,
      `recentPaths-${VAULT}`,
      `plainva-base-active-view-${VAULT}`,
      `plainva-base-active-view-${VAULT}:Projekte.base`,
      `plainva-base-subitems-${VAULT}`,
      `plainva-prop-types::${VAULT}`,
      // Must survive: other vaults + global keys.
      "plainva-layout-C:/Vaults/Anderer",
      "plainva-calendar-show-weeks",
      "plainva-recent-emoji",
    ];
    const hit = collectPerVaultLocalStorageKeys(VAULT, all);
    expect(hit).toHaveLength(6);
    expect(hit).not.toContain("plainva-layout-C:/Vaults/Anderer");
    expect(hit).not.toContain("plainva-calendar-show-weeks");
  });
});
