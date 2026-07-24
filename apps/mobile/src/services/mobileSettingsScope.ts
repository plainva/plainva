/**
 * Pure per-vault / app-wide partition logic for the mobile settings (package A
 * vault isolation, 2026-07-24). No platform/DOM imports, so it is unit-testable
 * in the node vitest env; mobileSettings.ts wires it to the real store.
 *
 * Fields listed here live in `mobile-vault-<id>` (one record per vault, like
 * the desktop's `*_<b64(path)>` keys); everything else in MobileSettings is
 * app-wide and stays in the global `mobile-settings` blob.
 */

export interface VaultScopedSettings {
  dailyFolder: string;
  inboxFolder: string;
  templateFolder: string;
  dailyTemplate: string;
  backupIntervalSeconds: number;
  backupMaxPerFile: number;
  backupMaxAgeDays: number;
}

export const VAULT_KEYS: readonly (keyof VaultScopedSettings)[] = [
  "dailyFolder",
  "inboxFolder",
  "templateFolder",
  "dailyTemplate",
  "backupIntervalSeconds",
  "backupMaxPerFile",
  "backupMaxAgeDays",
];

/** Single source of the per-vault defaults (mobileSettings.DEFAULTS spreads these). */
export const VAULT_DEFAULTS: VaultScopedSettings = {
  dailyFolder: "Daily",
  inboxFolder: "Inbox",
  templateFolder: "Templates",
  dailyTemplate: "",
  backupIntervalSeconds: 120,
  backupMaxPerFile: 100,
  backupMaxAgeDays: 90,
};

/** Extracts the per-vault fields, filling any gap from the defaults. */
export function pickVault(src: Partial<VaultScopedSettings>): VaultScopedSettings {
  return {
    dailyFolder: src.dailyFolder ?? VAULT_DEFAULTS.dailyFolder,
    inboxFolder: src.inboxFolder ?? VAULT_DEFAULTS.inboxFolder,
    templateFolder: src.templateFolder ?? VAULT_DEFAULTS.templateFolder,
    dailyTemplate: src.dailyTemplate ?? VAULT_DEFAULTS.dailyTemplate,
    backupIntervalSeconds: src.backupIntervalSeconds ?? VAULT_DEFAULTS.backupIntervalSeconds,
    backupMaxPerFile: src.backupMaxPerFile ?? VAULT_DEFAULTS.backupMaxPerFile,
    backupMaxAgeDays: src.backupMaxAgeDays ?? VAULT_DEFAULTS.backupMaxAgeDays,
  };
}

/** The app-wide slice (everything that is NOT per vault) for the global blob. */
export function stripVaultKeys<T extends object>(src: T): Partial<T> {
  const out = { ...src } as Partial<T>;
  const rec = out as unknown as Record<string, unknown>;
  for (const k of VAULT_KEYS) delete rec[k];
  return out;
}

/**
 * One-time migration decision: which vault records to CREATE so that no vault
 * loses its folder/retention settings when the shared pre-package-A blob is
 * split. Every vault that has no record yet is seeded from the old shared
 * values (non-destructive — existing records are left untouched, and vaults
 * connected after migration simply get the defaults via pickVault).
 */
export function vaultRecordsToSeed(
  oldBlob: Partial<VaultScopedSettings> | null,
  vaultIds: string[],
  hasRecord: (id: string) => boolean,
): Array<{ id: string; record: VaultScopedSettings }> {
  const seed = pickVault(oldBlob ?? {});
  return vaultIds.filter((id) => !hasRecord(id)).map((id) => ({ id, record: { ...seed } }));
}
