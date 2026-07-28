/**
 * Pure per-vault / app-wide partition logic for the mobile settings (package A
 * vault isolation, 2026-07-24). No platform/DOM imports, so it is unit-testable
 * in the node vitest env; mobileSettings.ts wires it to the real store.
 *
 * Fields listed here live in `mobile-vault-<id>` (one record per vault, like
 * the desktop's `*_<b64(path)>` keys); everything else in MobileSettings is
 * app-wide and stays in the global `mobile-settings` blob.
 */

/** Lower bound for the sync cycle, identical to the desktop's constant (H2a). */
export const MIN_SYNC_INTERVAL_SECONDS = 5;

export interface VaultScopedSettings {
  dailyFolder: string;
  /** ＋-capture target when no folder is open (R3.6). */
  inboxFolder: string;
  /**
   * Where a photo or a picked file lands (S17). Empty = beside the note, which
   * is what both shells did before this setting existed.
   */
  attachmentFolder: string;
  /** Where "insert template" / "new from template" look for .md templates
   *  (R3.4; same default as the desktop's per-vault setting). */
  templateFolder: string;
  /** Template file name (inside templateFolder) seeding new daily notes;
   *  empty = plain skeleton. */
  dailyTemplate: string;
  /**
   * Date format of a daily note's file name, in the desktop's spelling
   * (`YYYY-MM-DD`). The phone used to hard-code ISO, so a vault set to another
   * format got a SECOND daily note for the same day as soon as the phone
   * touched it — two files, same day, neither complete (S14).
   */
  dailyFormat: string;
  /**
   * OKF `type` written into new notes and new daily notes. Hard-coded before,
   * so the same vault ended up with notes of different types depending on which
   * device created them.
   */
  defaultNoteType: string;
  dailyNoteType: string;
  /** Snapshot retention (package G): min seconds between snapshots (0 = every
   *  write), max per file, max age in days (0 = unlimited). Applied to the
   *  active vault via updatePolicy. */
  backupIntervalSeconds: number;
  backupMaxPerFile: number;
  backupMaxAgeDays: number;
  /** Seconds between sync cycles (H2a) — was hard-coded to 30 in syncService.
   *  Per vault and syncable, mirroring the desktop's `syncIntervalSeconds`. */
  syncIntervalSeconds: number;
  /** Vault folder captured e-mails land in (mail G1) — same key and default
   *  as the desktop, so the setting travels with the settings sync. */
  mailFolder: string;
  /** Load remote images in mail bodies. Default OFF: a remote image is a
   *  tracking beacon. Mirrors the desktop's per-vault opt-in. */
  mailRemoteImages: boolean;
  /**
   * Last mailbox the user was looking at: account id + folder name (device
   * report B1, 2026-07-26). Both were component state, so opening a message
   * unmounted the list and going back landed in the first account's inbox.
   *
   * Per vault and NOT part of the settings-sync profile (the profile port
   * names its fields explicitly): which folder this phone last had open is a
   * device fact, not a setting worth carrying to another device.
   */
  mailAccountId: string;
  mailMailbox: string;
}

export const VAULT_KEYS: readonly (keyof VaultScopedSettings)[] = [
  "dailyFolder",
  "inboxFolder",
  "attachmentFolder",
  "templateFolder",
  "dailyTemplate",
  "dailyFormat",
  "defaultNoteType",
  "dailyNoteType",
  "backupIntervalSeconds",
  "backupMaxPerFile",
  "backupMaxAgeDays",
  "syncIntervalSeconds",
  "mailFolder",
  "mailRemoteImages",
  "mailAccountId",
  "mailMailbox",
];

/** Single source of the per-vault defaults (mobileSettings.DEFAULTS spreads these). */
export const VAULT_DEFAULTS: VaultScopedSettings = {
  dailyFolder: "Daily",
  inboxFolder: "Inbox",
  attachmentFolder: "Attachments",
  templateFolder: "Templates",
  dailyTemplate: "",
  dailyFormat: "YYYY-MM-DD",
  defaultNoteType: "Note",
  dailyNoteType: "Daily Note",
  backupIntervalSeconds: 120,
  backupMaxPerFile: 100,
  backupMaxAgeDays: 90,
  syncIntervalSeconds: 30,
  mailFolder: "Mail",
  mailRemoteImages: false,
  mailAccountId: "",
  mailMailbox: "",
};

/** Extracts the per-vault fields, filling any gap from the defaults. */
export function pickVault(src: Partial<VaultScopedSettings>): VaultScopedSettings {
  return {
    dailyFolder: src.dailyFolder ?? VAULT_DEFAULTS.dailyFolder,
    inboxFolder: src.inboxFolder ?? VAULT_DEFAULTS.inboxFolder,
    attachmentFolder: src.attachmentFolder ?? VAULT_DEFAULTS.attachmentFolder,
    templateFolder: src.templateFolder ?? VAULT_DEFAULTS.templateFolder,
    dailyTemplate: src.dailyTemplate ?? VAULT_DEFAULTS.dailyTemplate,
    dailyFormat: src.dailyFormat ?? VAULT_DEFAULTS.dailyFormat,
    defaultNoteType: src.defaultNoteType ?? VAULT_DEFAULTS.defaultNoteType,
    dailyNoteType: src.dailyNoteType ?? VAULT_DEFAULTS.dailyNoteType,
    backupIntervalSeconds: src.backupIntervalSeconds ?? VAULT_DEFAULTS.backupIntervalSeconds,
    backupMaxPerFile: src.backupMaxPerFile ?? VAULT_DEFAULTS.backupMaxPerFile,
    backupMaxAgeDays: src.backupMaxAgeDays ?? VAULT_DEFAULTS.backupMaxAgeDays,
    syncIntervalSeconds: src.syncIntervalSeconds ?? VAULT_DEFAULTS.syncIntervalSeconds,
    mailFolder: src.mailFolder ?? VAULT_DEFAULTS.mailFolder,
    mailRemoteImages: src.mailRemoteImages ?? VAULT_DEFAULTS.mailRemoteImages,
    mailAccountId: src.mailAccountId ?? VAULT_DEFAULTS.mailAccountId,
    mailMailbox: src.mailMailbox ?? VAULT_DEFAULTS.mailMailbox,
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
