import { keychainSlotName, migrateKeychainSlots, type ICredentialStore, type SlotMigration } from "@plainva/ui";
import { legacyMailSecretKey, mailSecretKey } from "@plainva/ui/mail";
import { getSettingsStore } from "./settingsStore";

/**
 * Every keychain slot the desktop owns, in both its shapes — the legacy one and
 * the readable one (plan P6, E1).
 *
 * The point of putting them together is drift. A rename is only half the work:
 * the other half is that every renamed family must also be MIGRATED, and those
 * two lists living apart is exactly how a family gets renamed and forgotten —
 * the app would then look for a name nothing ever wrote and the user would be
 * asked to sign in again for a credential that is sitting right there.
 *
 * So the names and the migration pairs are derived from the same enumeration,
 * and a test asserts that every readable builder appears as the target of a
 * migration. Adding a family without its migration fails that test.
 */

const b64 = (p: string) => btoa(unescape(encodeURIComponent(p)));

export const SYNC_PROVIDERS = ["webdav", "drive", "s3", "onedrive", "dropbox"] as const;
export type SyncProvider = (typeof SYNC_PROVIDERS)[number];

/** What Plainva wrote before P6. Kept because migration needs a source. */
export const legacySlot = {
  files: (vaultPath: string, provider: SyncProvider) => `${provider}_credentials_${b64(vaultPath)}`,
  account: (vaultPath: string, accountId: string) => `account_${accountId}_${b64(vaultPath)}`,
  calendar: (vaultPath: string, accountId: string) => `pim_${accountId}_${b64(vaultPath)}`,
  mail: legacyMailSecretKey,
  encryption: (vaultPath: string) => `mkcache_${b64(vaultPath)}`,
  repair: (vaultPath: string) => `account_repair_backup_${b64(vaultPath)}`,
} as const;

/** What Plainva writes now. `mail` goes through the shared builder on purpose:
 * the shared mail module writes with it, so anything else here could drift. */
export const slot = {
  files: (vaultPath: string, provider: SyncProvider) =>
    keychainSlotName({ vaultKey: vaultPath, service: "files", account: provider }),
  account: (vaultPath: string, accountId: string) =>
    keychainSlotName({ vaultKey: vaultPath, service: "account", account: accountId }),
  calendar: (vaultPath: string, accountId: string) =>
    keychainSlotName({ vaultKey: vaultPath, service: "calendar", account: accountId }),
  mail: mailSecretKey,
  encryption: (vaultPath: string) => keychainSlotName({ vaultKey: vaultPath, service: "encryption" }),
  repair: (vaultPath: string) => keychainSlotName({ vaultKey: vaultPath, service: "repair" }),
} as const;

export interface VaultSlotIds {
  /** Cloud account cards — the account-wide OAuth tokens. */
  accounts: string[];
  calendars: string[];
  mailboxes: string[];
  /** Slot names the profile map still remembers, verbatim. They are legacy by
   * definition: the map is written with the name used at the time. */
  fromProfileMap: string[];
}

/**
 * The account ids this vault could hold credentials for, read from the settings
 * store — the same derivation "forget this vault" and "stored access" use, and
 * for the same reason: the keychain cannot be enumerated (`keyring` 3.6.3 has
 * no search API), so the names have to be reconstructed.
 */
export async function vaultSlotIds(vaultPath: string): Promise<VaultSlotIds> {
  const store = await getSettingsStore();
  const key = b64(vaultPath);
  const accounts = new Set<string>();
  const calendars = new Set<string>();
  const mailboxes = new Set<string>();

  type CloudRecord = {
    id?: unknown;
    services?: { calendar?: { pimAccountId?: unknown }; mail?: { mailAccountId?: unknown } };
  };
  const cloud = await store.get<CloudRecord[]>(`cloudAccounts_${key}`);
  for (const record of Array.isArray(cloud) ? cloud : []) {
    if (typeof record?.id === "string") accounts.add(record.id);
    const pim = record?.services?.calendar?.pimAccountId;
    if (typeof pim === "string") calendars.add(pim);
    const mail = record?.services?.mail?.mailAccountId;
    if (typeof mail === "string") mailboxes.add(mail);
  }

  const mailAccounts = await store.get<Array<{ id?: unknown }>>(`mailAccounts_${key}`);
  for (const account of Array.isArray(mailAccounts) ? mailAccounts : []) {
    if (typeof account?.id === "string") mailboxes.add(account.id);
  }

  const map = await store.get<{ secretLocalToLogical?: Record<string, unknown> }>(
    `settingsSyncAccountMap_${key}`,
  );

  return {
    accounts: [...accounts],
    calendars: [...calendars],
    mailboxes: [...mailboxes],
    fromProfileMap: Object.keys(map?.secretLocalToLogical ?? {}).filter(Boolean),
  };
}

/** Legacy → readable, for every family this vault can hold. */
export function slotMigrations(vaultPath: string, ids: VaultSlotIds): SlotMigration[] {
  const pairs: SlotMigration[] = [
    { from: legacySlot.encryption(vaultPath), to: slot.encryption(vaultPath) },
    { from: legacySlot.repair(vaultPath), to: slot.repair(vaultPath) },
  ];
  for (const provider of SYNC_PROVIDERS) {
    pairs.push({ from: legacySlot.files(vaultPath, provider), to: slot.files(vaultPath, provider) });
  }
  for (const id of ids.accounts) {
    pairs.push({ from: legacySlot.account(vaultPath, id), to: slot.account(vaultPath, id) });
  }
  for (const id of ids.calendars) {
    pairs.push({ from: legacySlot.calendar(vaultPath, id), to: slot.calendar(vaultPath, id) });
  }
  for (const id of ids.mailboxes) {
    pairs.push({ from: legacySlot.mail(vaultPath, id), to: slot.mail(vaultPath, id) });
  }
  return pairs;
}

/** Both shapes of every slot this vault owns — what "forget" must delete and
 * what "stored access" must probe, while old names can still be around. */
export function allVaultSlots(vaultPath: string, ids: VaultSlotIds): string[] {
  const names = new Set<string>(ids.fromProfileMap);
  for (const pair of slotMigrations(vaultPath, ids)) {
    names.add(pair.from);
    names.add(pair.to);
  }
  return [...names];
}

/**
 * Moves this vault's keychain entries to the readable names, once.
 *
 * Runs on vault open, BEFORE anything reads a credential — the sync target is
 * built from the provider slot a few lines later, so a half-done rename would
 * look like a vault that lost its connection.
 *
 * Gated by a marker so the normal case costs nothing: without it every open
 * would probe a dozen slots against the OS keychain. The marker is only set
 * when the run had nothing left over — a locked keyring means "try again next
 * time", never "done".
 */
const MIGRATION_VERSION = 1;
const markerKey = (vaultPath: string) => `keychainSlotsMigrated_${b64(vaultPath)}`;

export async function migrateVaultKeychainSlots(
  vaultPath: string,
  // Passed in rather than imported: CredentialManager builds its own slot names
  // from this module, and an import back would close the circle.
  credentials: ICredentialStore,
): Promise<void> {
  const store = await getSettingsStore();
  if (((await store.get<number>(markerKey(vaultPath))) ?? 0) >= MIGRATION_VERSION) return;

  const report = await migrateKeychainSlots(
    credentials,
    slotMigrations(vaultPath, await vaultSlotIds(vaultPath)),
  );
  if (report.migrated.length) {
    console.log(`[keychainSlots] renamed ${report.migrated.length} keychain entr(ies) for ${vaultPath}`);
  }
  if (report.keptOld.length) {
    // Left where they were, and deliberately not marked done: the credential is
    // intact under its old name and the next open tries again.
    console.warn(`[keychainSlots] ${report.keptOld.length} entr(ies) could not be renamed; keeping the old names`);
    return;
  }
  await store.set(markerKey(vaultPath), MIGRATION_VERSION);
  await store.save();
}
