import {
  ENCRYPTION_MANIFEST_PATH,
  EncryptingSyncTarget,
  FatalSyncProtocolError,
  KeyfileSyncStep,
  SecretsSyncStep,
  SETTINGS_ENC_PATH,
  SettingsSyncStep,
  connectionFingerprint,
  createKeyfile,
  evaluateManifestGuard,
  exportRecoveryCode,
  fromBase64,
  isEncryptedState,
  openBlob,
  parseManifest,
  sealBlob,
  toBase64,
  unlockAllKeys,
  type ConnectionE2EState,
  type ISyncTarget,
  type IVaultAdapter,
  type Keyfile,
  type MasterKeyBundle,
  type ProfileSettingsPort,
  type SettingsSyncRunner,
  SecretPolicyError,
} from "@plainva/core";
import {
  cloudRegistryToLogical,
  shouldAnnounceProfileImport,
  pimAccountsForProfile,
  pimSelectionsForProfile,
  mailAccountsForProfile,
  normalizeAccountMap,
  getPlatformServices,
  importAccountMetadata,
  emptyDiagnostics,
  normalizeSyncDiagnostics,
  noteSettingsSyncFailure,
  type SettingsSyncFailure,
  recordLegacyClient,
  type LegacyClientDiagnosticReason,
  recordProfileExchange,
  recordSecretsError,
  recordSecretsResult,
  recordSkipped,
  canonicalizeProfileValues,
  profileDefault,
  clearLegacyClient,
  forgetReportedOnce,
  shouldReportOnce,
  rememberRemovedAccount,
  removedAccountsForProfile,
  shouldReportWaitingAccounts,
  storeBackedFields,
  toast,
  type AccountImportPorts,
  type ProfileAccountMap,
  type SyncDiagnostics,
} from "@plainva/ui";
import { listMailAccounts, mailSecretKey, replaceMailAccounts } from "@plainva/ui/mail";
import {
  barDef,
  barLayoutIsInherited,
  loadBarLayout,
  parseBookmarksFile,
  parseFolderTemplateRules,
  parseTypeTemplateRules,
  sanitizeAreaOrder,
  saveBarLayout,
  serializeBookmarksFile,
} from "@plainva/ui";
import { PimCacheRepository } from "@plainva/core";
import { loadCloudAccounts, saveCloudAccounts } from "./cloudAccountsStore";
import i18n from "@plainva/ui/i18n";
import { applyVaultSettings, getVaultSettings, type VaultSettings } from "./mobileSettings";
import {
  captureProfileSnapshot,
  clearProfileJournal,
  recoverProfileImportIfNeeded,
  restoreProfileSnapshot,
  writeProfileJournal,
} from "./profileImportJournal";
import { createMobileSecretsPort } from "./mobileSecretsPort";
import { MIN_SYNC_INTERVAL_SECONDS } from "./mobileSettingsScope";
import type { MobileSyncProvider } from "./syncService";
import type { MobileVault } from "./vaultService";
import { readSyncRootFolder } from "./syncRootFolder";
import { mobileKeyringCacheKey } from "./vaultForget";
import { clearPimCredentials, pimSecretKey } from "./pim/pimCredentials";
import { recoverMobileAccountRepair, repairMobileAccounts } from "./accountRepair";

const GUARD_VERSION = 1;
const KEYFILE_PATH = ".plainva/sync/keyfile.json";
const enabledKey = (vaultId: string) => `settingsSyncMobile_${vaultId}`;
/** Sign-in secrets are a SEPARATE opt-in from the settings profile (H2c). */
const secretsKey = (vaultId: string) => `secretsSyncMobile_${vaultId}`;
const unknownKey = (vaultId: string) => `settingsSyncUnknownMobile_${vaultId}`;
/** What the settings sync last did on THIS device, per vault (P1/S10). */
const diagnosticsKey = (vaultId: string) => `syncDiagnosticsMobile_${vaultId}`;
/** Fired after the record changed, so an open vault page can re-read it. */
export const SYNC_DIAGNOSTICS_EVENT = "m-sync-diagnostics";

export async function loadSyncDiagnostics(vaultId: string): Promise<SyncDiagnostics> {
  const store = await settingsStore();
  return normalizeSyncDiagnostics(
    (await store.get<SyncDiagnostics>(diagnosticsKey(vaultId))) ?? emptyDiagnostics(),
  );
}

/**
 * Serializes per-vault report writes. Profile completion, secret results and a
 * legacy warning can arrive back-to-back and all three are durable facts.
 */
const diagnosticsUpdateQueues = new Map<string, Promise<void>>();

async function updateDiagnostics(vaultId: string, reduce: (d: SyncDiagnostics) => SyncDiagnostics): Promise<void> {
  const previous = diagnosticsUpdateQueues.get(vaultId) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(async () => {
    try {
      const store = await settingsStore();
      await store.set(diagnosticsKey(vaultId), reduce(await loadSyncDiagnostics(vaultId)));
      await store.save();
      if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(SYNC_DIAGNOSTICS_EVENT, { detail: { vaultId } }));
    } catch {
      // A diagnostics write must never take the sync down with it.
    }
  });
  diagnosticsUpdateQueues.set(vaultId, next);
  await next;
  if (diagnosticsUpdateQueues.get(vaultId) === next) diagnosticsUpdateQueues.delete(vaultId);
}
const stateKey = (connectionId: string) => `e2eStateMobile_${connectionId}`;
// Same shape in vaultForget (mobileKeyringCacheKey), pinned by a test:
// forgetting a vault has to take this slot with it.
const cacheKey = mobileKeyringCacheKey;
/** "Ask for the passphrase on every start" (H2b) — mirrors the desktop's
 *  `passphraseEveryStart`: when on, the unlocked keyring stays in memory only. */
const everyStartKey = (vaultId: string) => `mkEveryStartMobile_${vaultId}`;
const deviceKey = "settingsSyncDeviceIdMobile";
const memory = new Map<string, { active: MasterKeyBundle; keys: Map<string, MasterKeyBundle> }>();

interface CachedKeyring {
  activeKeyId: string;
  keys: Array<{ keyId: string; mk: string }>;
}

/**
 * The remote root the connection fingerprint is built from.
 *
 * Since the folder moved out of the credentials (finding 2026-08-19) this has
 * to read the settings for the three OAuth providers: another remote root IS
 * another connection, and the E2E pin hangs off that fingerprint. The defaults
 * are kept verbatim so an existing vault keeps the fingerprint it already has.
 */
async function remoteRoot(vaultId: string, provider: MobileSyncProvider): Promise<string> {
  switch (provider.provider) {
    case "webdav": return provider.creds.url;
    case "s3": return `${provider.creds.endpoint}/${provider.creds.bucket}/${provider.creds.prefix ?? ""}`;
    case "drive":
    case "onedrive":
      return (await readSyncRootFolder(vaultId, provider.provider, provider)) || "Plainva";
    case "dropbox": return (await readSyncRootFolder(vaultId, "dropbox", provider)) || "/";
  }
}

async function settingsStore() {
  return getPlatformServices().loadSettings();
}

async function deviceId(): Promise<string> {
  const store = await settingsStore();
  let value = await store.get<string>(deviceKey);
  if (!value) {
    value = crypto.randomUUID();
    await store.set(deviceKey, value);
    await store.save();
  }
  return value;
}

async function loadState(connectionId: string): Promise<ConnectionE2EState> {
  const stored = await (await settingsStore()).get<ConnectionE2EState>(stateKey(connectionId));
  return { connectionId, knownEncrypted: stored?.knownEncrypted === true, expectedKeyId: stored?.expectedKeyId, lastGeneration: stored?.lastGeneration };
}

async function saveState(state: ConnectionE2EState): Promise<void> {
  const store = await settingsStore();
  await store.set(stateKey(state.connectionId), state);
  await store.save();
}

export async function isMobileSettingsSyncEnabled(vaultId: string): Promise<boolean> {
  return (await (await settingsStore()).get<boolean>(enabledKey(vaultId))) === true;
}

/**
 * Teardown for a deleted connection vault: drops the connection E2E pin
 * (`e2eStateMobile_<connectionId>`, keyed by provider + remote root, not the
 * vault id) plus the vault-scoped settings-sync state, so re-connecting the
 * same cloud folder starts fresh instead of reanimating the fail-closed guard.
 * The connection id is derived from the vault's stored provider; passing null
 * (no provider recorded) still clears the vault-scoped keys.
 */
export async function clearMobileSyncState(vaultId: string, provider: MobileSyncProvider | null): Promise<void> {
  const store = await settingsStore();
  if (provider) {
    const connectionId = connectionFingerprint(provider.provider, await remoteRoot(vaultId, provider));
    await store.delete(stateKey(connectionId));
  }
  await store.delete(enabledKey(vaultId));
  await store.delete(unknownKey(vaultId));
  await store.delete(everyStartKey(vaultId));
  await store.save();
  // Drops the in-memory keyring and the `mkcache_mobile_<vaultId>` credential
  // secret (a credential-store entry, not a settings key).
  await lockMobileEncryption(vaultId);
}

export async function isMobilePassphraseEveryStart(vaultId: string): Promise<boolean> {
  return (await (await settingsStore()).get<boolean>(everyStartKey(vaultId))) === true;
}

/** Turning it ON drops the persisted keyring immediately — otherwise the
 *  setting would only take effect after the next lock. */
export async function setMobilePassphraseEveryStart(vaultId: string, on: boolean): Promise<void> {
  const store = await settingsStore();
  await store.set(everyStartKey(vaultId), on);
  await store.save();
  if (on) await getPlatformServices().credentials.removeSecret(cacheKey(vaultId));
}

export async function setMobileSettingsSyncEnabled(vaultId: string, enabled: boolean): Promise<void> {
  const store = await settingsStore();
  await store.set(enabledKey(vaultId), enabled);
  await store.save();
}

/**
 * Sign-in secrets (H2c) — deliberately its own switch, not part of the settings
 * profile: carrying folder names between devices and carrying passwords between
 * them are different decisions, and only the second one needs the encryption to
 * be set up.
 */
/** Keyed on the vault, so cleaning up here re-arms the notice for this vault only. */
export const legacyNoticeKey = (vaultId: string) => `legacyPublisher_${vaultId}`;
const legacyCleanupRequestedKey = (vaultId: string) => `secretsLegacyCleanup_${vaultId}`;

/**
 * Asks the next sync cycle to drop the retired entries from the shared
 * credential document (desktop parity, P6).
 *
 * A request rather than a call: the cleanup needs the sync target and the
 * master key, and both live in the worker. Until this existed, the phone could
 * only be TOLD about the legacy entries — the one action that ends the notice
 * was on the desktop, so on a phone the warning was permanent by construction
 * (device report 2026-08-15, point 1).
 */
/**
 * Notes that a shared account was deleted on this device, so the next profile
 * import does not put it back (P2, Stufe A — local only).
 */
export async function noteAccountRemovedLocally(
  vaultId: string,
  kind: "pim" | "mail",
  localId: string,
): Promise<void> {
  const store = await settingsStore();
  const map = normalizeAccountMap(await store.get<ProfileAccountMap>(accountMapKey(vaultId)));
  const next = rememberRemovedAccount(map, kind, localId);
  if (next === map) return;
  await store.set(accountMapKey(vaultId), next);
  await store.save();
}

export async function requestMobileLegacyCleanup(vaultId: string): Promise<void> {
  const store = await settingsStore();
  await store.set(legacyCleanupRequestedKey(vaultId), true);
  await store.save();
}

export async function isMobileSecretsSyncEnabled(vaultId: string): Promise<boolean> {
  return (await (await settingsStore()).get<boolean>(secretsKey(vaultId))) === true;
}

export async function setMobileSecretsSyncEnabled(vaultId: string, enabled: boolean): Promise<void> {
  const store = await settingsStore();
  await store.set(secretsKey(vaultId), enabled);
  await store.save();
}

async function loadKeyring(vaultId: string): Promise<{ active: MasterKeyBundle; keys: Map<string, MasterKeyBundle> } | null> {
  const present = memory.get(vaultId);
  if (present) return present;
  // Every-start mode never reads a persisted keyring: the passphrase must be
  // entered again after each app start (H2b).
  if (await isMobilePassphraseEveryStart(vaultId)) return null;
  const cached = await getPlatformServices().credentials.readSecret<CachedKeyring>(cacheKey(vaultId));
  if (!cached?.activeKeyId || !Array.isArray(cached.keys)) return null;
  const keys = new Map(cached.keys.map((key) => [key.keyId, { keyId: key.keyId, masterKey: fromBase64(key.mk) }]));
  const active = keys.get(cached.activeKeyId);
  if (!active) return null;
  const ring = { active, keys };
  memory.set(vaultId, ring);
  return ring;
}

/** Caches an unlocked keyring for this vault (memory always, keychain unless H2b). */
async function rememberKeyring(vaultId: string, active: MasterKeyBundle, keys: Map<string, MasterKeyBundle>): Promise<void> {
  memory.set(vaultId, { active, keys });
  if (await isMobilePassphraseEveryStart(vaultId)) return; // memory only (H2b)
  await getPlatformServices().credentials.writeSecret<CachedKeyring>(cacheKey(vaultId), {
    activeKeyId: active.keyId,
    keys: [...keys.values()].map((key) => ({ keyId: key.keyId, mk: toBase64(key.masterKey) })),
  });
}

export async function unlockMobileEncryption(vault: MobileVault, passphrase: string): Promise<void> {
  const raw = vault.backup ?? vault.adapter;
  if (!(await raw.exists(KEYFILE_PATH))) throw new Error("no keyfile present");
  const keyfile = JSON.parse(await raw.readTextFile(KEYFILE_PATH));
  const keys = await unlockAllKeys(keyfile, passphrase);
  const active = keys.get(keyfile.activeKeyId);
  if (!active) throw new Error("active key missing");
  await rememberKeyring(vault.vaultId, active, keys);
}

/**
 * Creating the settings encryption ON THE PHONE (H2e).
 *
 * Until now the phone could only unlock what a desktop had created — a
 * restriction with no technical reason left, since the phone has been able to
 * set up an encrypted WORKSPACE since 0.4.10. The flow mirrors that one: what
 * happens here produces nothing but memory, the recovery code is shown and
 * verified first, and only `activatePreparedMobileEncryption` writes anything.
 * An abandoned wizard therefore leaves no keyfile, no cached key, nothing to
 * clean up.
 *
 * The dangerous case this guards against is a keyfile that already exists
 * REMOTELY but has not been pulled yet: publishing a second one would lock
 * every other device out of the sealed profile, because the keyfile sideband is
 * whole-file last-writer-wins. So the probe is not optional, and being offline
 * is a refusal rather than a guess.
 */
export class KeyfileAlreadyExistsError extends Error {
  constructor() {
    super("a keyfile for this vault already exists");
  }
}
export class KeyfileProbeFailedError extends Error {
  constructor() {
    super("could not check the cloud for an existing keyfile");
  }
}

interface EncryptionDraft {
  vaultId: string;
  keyfile: Keyfile;
  bundle: MasterKeyBundle;
  expiresAt: number;
}
const encryptionDrafts = new Map<string, EncryptionDraft>();
const DRAFT_TTL_MS = 30 * 60 * 1000;

/** Drops a draft and zeroes the master key it held. */
export function discardPreparedMobileEncryption(draftId: string): void {
  const draft = encryptionDrafts.get(draftId);
  if (!draft) return;
  draft.bundle.masterKey.fill(0);
  encryptionDrafts.delete(draftId);
}

export async function prepareMobileEncryption(
  vault: MobileVault,
  passphrase: string,
  probeRemote: (path: string) => Promise<boolean>,
): Promise<{ draftId: string; recoveryCode: string }> {
  const raw = vault.backup ?? vault.adapter;
  if (await raw.exists(KEYFILE_PATH)) throw new KeyfileAlreadyExistsError();
  let remoteExists: boolean;
  try {
    remoteExists = await probeRemote(KEYFILE_PATH);
  } catch {
    throw new KeyfileProbeFailedError();
  }
  if (remoteExists) throw new KeyfileAlreadyExistsError();

  // One draft per vault, and expired ones go with it.
  for (const [id, draft] of encryptionDrafts) {
    if (draft.vaultId === vault.vaultId || draft.expiresAt <= Date.now()) discardPreparedMobileEncryption(id);
  }
  const { keyfile, bundle } = await createKeyfile(passphrase);
  const draftId = crypto.randomUUID();
  encryptionDrafts.set(draftId, { vaultId: vault.vaultId, keyfile, bundle, expiresAt: Date.now() + DRAFT_TTL_MS });
  return { draftId, recoveryCode: exportRecoveryCode(bundle) };
}

/** The point of no return: writes the keyfile and unlocks this device. */
export async function activatePreparedMobileEncryption(vault: MobileVault, draftId: string): Promise<void> {
  const draft = encryptionDrafts.get(draftId);
  if (!draft || draft.vaultId !== vault.vaultId || draft.expiresAt <= Date.now()) {
    if (draft) discardPreparedMobileEncryption(draftId);
    throw new Error("encryption-draft-expired");
  }
  const raw = vault.backup ?? vault.adapter;
  await raw.writeTextFile(KEYFILE_PATH, JSON.stringify(draft.keyfile, null, 2));
  // The bundle now lives in the keyring, so it must NOT be zeroed with the draft.
  await rememberKeyring(vault.vaultId, draft.bundle, new Map([[draft.bundle.keyId, draft.bundle]]));
  encryptionDrafts.delete(draftId);
}

export async function lockMobileEncryption(vaultId: string): Promise<void> {
  memory.delete(vaultId);
  await getPlatformServices().credentials.removeSecret(cacheKey(vaultId));
}

export async function mobileEncryptionStatus(vault: MobileVault): Promise<"none" | "locked" | "unlocked"> {
  if (await loadKeyring(vault.vaultId)) return "unlocked";
  return (await (vault.backup ?? vault.adapter).exists(KEYFILE_PATH)) ? "locked" : "none";
}

/**
 * The account map lives beside the profile: it ties a device-local account id
 * to the id used in the shared document, so the same account is recognised
 * across devices even though the ids differ (they end up in keychain slots).
 */
const accountMapKey = (vaultId: string) => `settingsSyncAccountMapMobile_${vaultId}`;

/** Mobile side of the shared account import (plan P3). */
function mobileAccountPorts(vault: MobileVault): AccountImportPorts {
  const vaultId = vault.vaultId;
  // Write through a cache built on the vault's own database rather than the PIM
  // runtime: the runtime boots in parallel with the sync worker, and an import
  // that waited for it would simply do nothing on the cycle that matters.
  const cache = vault.db ? new PimCacheRepository(vault.db) : null;
  return {
    listPimAccounts: async () => (cache ? cache.listAccounts() : []),
    upsertPimAccount: async (row) => {
      if (cache) await cache.upsertAccount(row);
    },
    deletePimAccount: async (accountId) => {
      if (cache) await cache.deleteAccount(accountId);
      await clearPimCredentials(vaultId, accountId).catch(() => {});
    },
    listCalendars: async (accountId) => (cache ? cache.listCalendars(accountId) : []),
    setCalendarSelected: async (accountId, id, selected) => {
      if (cache) await cache.setCalendarSelected(accountId, id, selected);
    },
    listTaskLists: async (accountId) => (cache ? cache.listTaskLists(accountId) : []),
    setTaskListSelected: async (accountId, id, selected) => {
      if (cache) await cache.setTaskListSelected(accountId, id, selected);
    },
    listMailAccounts: () => listMailAccounts(vaultId),
    replaceMailAccounts: (accounts) => replaceMailAccounts(vaultId, accounts),
    listCloudAccounts: () => loadCloudAccounts(vaultId),
    replaceCloudAccounts: (accounts) => saveCloudAccounts(vaultId, accounts),
    pimSecretSlot: (accountId) => pimSecretKey(vaultId, accountId),
    mailSecretSlot: (accountId) => mailSecretKey(vaultId, accountId),
    loadAccountMap: async () => normalizeAccountMap(
      await (await settingsStore()).get<ProfileAccountMap>(accountMapKey(vaultId)),
    ),
    saveAccountMap: async (map) => {
      const s = await settingsStore();
      await s.set(accountMapKey(vaultId), map);
      await s.save();
    },
  };
}

/**
 * Logical profile field → the per-vault settings property that holds it, taken
 * from the shared catalog (S9). Typed against `VaultSettings`, so a catalog
 * entry naming a property this shell does not have fails to compile instead of
 * being written into a field nobody reads.
 */
const MOBILE_BINDING: Record<string, keyof VaultSettings> = Object.fromEntries(
  storeBackedFields("mobile").map((f) => [f.logical, f.mobile as keyof VaultSettings])
);

/**
 * Turns an incoming profile document into a settings patch, and names what it
 * refused. A value is only taken when it matches the kind the catalog declares
 * — an absolute path never travels (it would point into another machine's file
 * system), and a number below its floor is dropped rather than clamped, because
 * a wrong value from elsewhere should not silently become a valid-looking local
 * one. What was refused is reported rather than dropped in silence: "nothing
 * arrived" and "something arrived and could not be used" are different problems.
 */
export function importVaultSettings(
  values: Record<string, unknown>,
  resetAbsent = false,
): { patch: Partial<VaultSettings>; skipped: string[] } {
  const patch: Partial<VaultSettings> = {};
  const skipped: string[] = [];
  const set = (prop: keyof VaultSettings, value: unknown) => {
    (patch as Record<string, unknown>)[prop] = value;
  };
  for (const field of storeBackedFields("mobile")) {
    const prop = field.mobile as keyof VaultSettings;
    const present = Object.prototype.hasOwnProperty.call(values, field.logical);
    const value = present ? values[field.logical] : (resetAbsent ? profileDefault(field.logical) : undefined);
    if (value === undefined) continue;
    if (field.kind === "vaultPath" || field.kind === "text") {
      if (typeof value !== "string") skipped.push(`invalid text in ${field.logical}`);
      else if (field.kind === "vaultPath" && value.startsWith("/")) skipped.push(`invalid vault-relative path in ${field.logical}`);
      else set(prop, value);
    } else if (field.kind === "number") {
      const floor = field.logical === "syncIntervalSeconds" ? MIN_SYNC_INTERVAL_SECONDS : (field.min ?? 0);
      if (typeof value !== "number" || !Number.isFinite(value) || value < floor) skipped.push(`invalid number in ${field.logical}`);
      else set(prop, value);
    } else if (field.kind === "boolean") {
      if (typeof value !== "boolean") skipped.push(`invalid boolean in ${field.logical}`);
      else set(prop, value);
    }
  }
  return { patch, skipped };
}

/** Public for the cross-shell convergence contracts; production uses it below. */
export function createMobileProfilePort(vault: MobileVault): ProfileSettingsPort {
  const vaultId = vault.vaultId;
  return {
    normalizeValues: canonicalizeProfileValues,
    async exportValues(): Promise<Record<string, unknown>> {
      const s = await getVaultSettings(vaultId);
      const unknown = (await (await settingsStore()).get<Record<string, unknown>>(unknownKey(vaultId))) ?? {};
      const map = normalizeAccountMap(
        await (await settingsStore()).get<ProfileAccountMap>(accountMapKey(vaultId)),
      );
      const cache = vault.db ? new PimCacheRepository(vault.db) : null;

      const values: Record<string, unknown> = { ...unknown };
      // Which settings travel is the shared catalog's decision (S9); this side
      // only says which per-vault property holds each one. Two hand-written
      // lists — one here, one in applyValues — were the reason a field could
      // exist on one shell and quietly never arrive on the other.
      for (const [logical, prop] of Object.entries(MOBILE_BINDING)) values[logical] = s[prop];

      // Accounts (plan P3). Until now they fell into `unknown`, were written
      // back untouched and never applied — which is why a phone kept asking the
      // user to create every calendar and mailbox by hand.
      // Same shared helpers as the desktop: deterministic order and no parked
      // device state, so both shells publish the same document.
      if (cache) {
        values.pimAccounts = pimAccountsForProfile(await cache.listAccounts(), map);
        values.pimSelections = pimSelectionsForProfile(await cache.listCalendars(), await cache.listTaskLists(), map);
      }
      values.mailAccounts = mailAccountsForProfile(await listMailAccounts(vaultId), map);
      // Export is a projection, never a store refresh. Reconciliation against
      // device-local runtimes belongs to the account screen/login lifecycle;
      // doing it here injected observed-only deltas into every profile compare.
      const registry = await loadCloudAccounts(vaultId);
      values.cloudAccounts = cloudRegistryToLogical(registry, map);

      // Same as the desktop: a deletion is only shared if it is IN the document.
      const removed = removedAccountsForProfile(map, undefined);
      if (Object.keys(removed).length) values.removedAccounts = removed;

      // Bookmarks (S15). The phone has always kept them in the same shared file
      // as the desktop — it simply never put them in the profile, so a bookmark
      // set on one device stopped at that device. The FILE itself never travels
      // (`.plainva` is excluded from the file sync); the list does.
      try {
        const parsed = parseBookmarksFile(await vault.adapter.readTextFile(".plainva/bookmarks.json"));
        if (parsed.existed) values.bookmarks = parsed.paths;
      } catch {
        // no bookmarks on this device yet — nothing to publish
      }

      // Template rules (plan Vorlagen-Engine P6). Carried like bookmarks rather
      // than through the generic binding: they are `kind: "json"`, and the
      // phone's importer only knows the scalar kinds. Published as well as
      // applied, so the phone is not a hole the rules fall into.
      if (s.folderTemplates.length > 0) values.folderTemplates = s.folderTemplates;
      if (s.typeTemplates.length > 0) values.typeTemplates = s.typeTemplates;

      // Which database views the calendar shows (S18b). Carried the same way
      // and for the same reason: a `json` field the generic binding cannot
      // take. Only published when this device HAS a selection — an empty list
      // would otherwise read as "show nothing" on the other side.
      if (s.calendarOverlays.length > 0) values.calendarOverlays = s.calendarOverlays;

      // The navigation bar (S10). Published only where the vault has its own
      // arrangement: publishing the default would turn "this device never
      // changed anything" into a decision the other side has to follow.
      if (!(await barLayoutIsInherited("mobileBar", vaultId))) {
        values.barLayoutMobileBar = await loadBarLayout("mobileBar", vaultId);
      }
      return canonicalizeProfileValues(values);
    },
    async applyValues(values: Record<string, unknown>): Promise<void> {
      const canonical = canonicalizeProfileValues(values);
      const { patch, skipped } = importVaultSettings(canonical, true);
      await updateDiagnostics(vaultId, (d) => recordSkipped(d, new Date().toISOString(), skipped));

      await recoverMobileAccountRepair(vaultId, accountMapKey(vaultId));
      // A journal left behind means an earlier apply died halfway; undo it
      // before writing on top of a half state.
      await recoverProfileImportIfNeeded(vault);
      // Durable BEFORE the first change. Being killed out of the background
      // mid-apply is the normal case on a phone, and until this journal
      // existed there was no way back from it (finding 2026-08-19).
      // Fail-closed on purpose: no journal, no import. A half-written profile
      // with no way back is exactly what this fixes, so a device that cannot
      // journal skips the import rather than risking it. The file sync is
      // unaffected — the worker runs the sideband in its own try/catch.
      const snapshot = await captureProfileSnapshot(vault);
      await writeProfileJournal(vaultId, snapshot);

      try {
        // Without an index database there is no PIM truth on this device, so
        // importing calendar rows into nothing would only mint id mappings and
        // secret slots for rows that do not exist (the desktop has carried this
        // guard since the profile sync shipped; the phone did not).
        const accountValues = vault.db ? canonical : { ...canonical, pimAccounts: undefined, pimSelections: undefined };
        const idMap = await importAccountMetadata(accountValues, mobileAccountPorts(vault));
        await repairMobileAccounts(vaultId, accountMapKey(vaultId));

        // The default calendar travels as "<logical account id> <calendar id>",
        // and the local account id is a different one on every device. The phone
        // threw the mapping away, so the setting pointed at an account that does
        // not exist here — silently falling back to "first writable".
        if (typeof patch.defaultCalendar === "string" && patch.defaultCalendar.includes(" ")) {
          const [logical, ...rest] = patch.defaultCalendar.split(" ");
          patch.defaultCalendar = `${idMap.pim.get(logical) ?? logical} ${rest.join(" ")}`;
        }

        // Everything the phone does NOT understand is kept verbatim and written
        // back on the next export, so a newer Plainva on another device does not
        // lose its settings by syncing through this one.
        // Written LAST and only as a whole: a bookmark list is one value, so it
        // either lands completely or not at all. That is the part of the desktop's
        // import journal that matters here — the phone has no snapshot/rollback
        // around the whole apply, and this field does not need one.
        const bookmarkValue = values.bookmarks;
        const bookmarkPaths = Array.isArray(bookmarkValue)
          ? bookmarkValue.filter((path): path is string => typeof path === "string" && !!path && !path.startsWith("/"))
          : [];
        const invalidBookmarks = bookmarkValue !== undefined
          && (!Array.isArray(bookmarkValue) || bookmarkPaths.length !== bookmarkValue.length);
        if (invalidBookmarks) {
          skipped.push("invalid bookmarks in settings profile");
          await updateDiagnostics(vaultId, (d) => recordSkipped(d, new Date().toISOString(), skipped));
        } else {
          if (bookmarkPaths.length > 0) {
            await vault.adapter.writeTextFile(".plainva/bookmarks.json", serializeBookmarksFile(bookmarkPaths));
          } else if (await vault.adapter.exists(".plainva/bookmarks.json")) {
            await vault.adapter.deleteItem(".plainva/bookmarks.json");
          }
          if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("m-bookmarks-changed"));
        }

        // Template rules (plan Vorlagen-Engine P6). The parsers normalize and
        // drop malformed rows, so a rule written by a newer desktop can never
        // break note creation here. Each list is decided on its OWN presence:
        // a profile that carries folder rules but no type rules must not imply
        // anything about the other one.
        const rulePatch: Partial<VaultSettings> = {};
        rulePatch.folderTemplates = canonical.folderTemplates !== undefined
          ? parseFolderTemplateRules(canonical.folderTemplates)
          : profileDefault<VaultSettings["folderTemplates"]>("folderTemplates");
        rulePatch.typeTemplates = canonical.typeTemplates !== undefined
          ? parseTypeTemplateRules(canonical.typeTemplates)
          : profileDefault<VaultSettings["typeTemplates"]>("typeTemplates");
        // Same treatment for the calendar's database selection (S18b). A member
        // that is not a string is dropped rather than passed on: a malformed key
        // from a newer desktop must not be able to empty this calendar.
        rulePatch.calendarOverlays = Array.isArray(canonical.calendarOverlays)
          ? (canonical.calendarOverlays as unknown[]).filter((v): v is string => typeof v === "string")
          : profileDefault<VaultSettings["calendarOverlays"]>("calendarOverlays");
        if (Object.keys(rulePatch).length > 0) await applyVaultSettings(vaultId, rulePatch);

        // The navigation bar (S10). `saveBarLayout` sanitizes against the bar's
        // own spec, so an arrangement from a newer Plainva — one that names areas
        // this phone does not have — becomes a valid bar instead of an empty one.
        //
        // Absence deliberately means "nothing said", not "reset": a device that
        // never arranged the phone bar would otherwise clear it on every sync,
        // and the arrangement is the one thing here the user set with a finger.
        if (canonical.barLayoutMobileBar !== undefined) {
          await saveBarLayout("mobileBar", vaultId, sanitizeAreaOrder(canonical.barLayoutMobileBar, barDef("mobileBar").spec));
        }

        const known = new Set([...Object.keys(MOBILE_BINDING), "pimAccounts", "pimSelections", "mailAccounts", "cloudAccounts", "bookmarks", "folderTemplates", "typeTemplates", "calendarOverlays", "barLayoutMobileBar"]);
        const unknown = Object.fromEntries(Object.entries(canonical).filter(([key]) => !known.has(key)));
        const store = await settingsStore();
        await store.set(unknownKey(vaultId), unknown);
        await store.save();
        await applyVaultSettings(vaultId, patch);
        await clearProfileJournal(vaultId);
      } catch (error) {
        await restoreProfileSnapshot(vault, snapshot);
        await clearProfileJournal(vaultId);
        throw error;
      }
      // The accounts exist now; the runtimes have to be told, or the calendar
      // stays empty until the next app start.
      if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("m-accounts-imported"));
    },
  };
}

class MobileSidebandRunner implements SettingsSyncRunner {
  constructor(
    private readonly vaultId: string,
    private readonly connectionId: string,
    private readonly keyfile: KeyfileSyncStep,
    private readonly steps: SidebandSteps,
  ) {}

  async guardBeforeCycle(target: ISyncTarget, vault: IVaultAdapter): Promise<void> {
    const bytes = await target.download(ENCRYPTION_MANIFEST_PATH);
    const text = bytes ? new TextDecoder().decode(bytes as BufferSource) : null;
    const known = await loadState(this.connectionId);
    let ring = await loadKeyring(this.vaultId);
    if (!ring && text) {
      let shape = null;
      try { shape = parseManifest(JSON.parse(text)); } catch { /* guard below reports malformed */ }
      if (shape && isEncryptedState(shape.state)) {
        await this.keyfile.run(target, vault).catch(() => undefined);
        if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("m-encryption-locked"));
      }
    }
    ring = ring ?? await loadKeyring(this.vaultId);
    const decision = evaluateManifestGuard({ manifestText: text, known, masterKey: ring?.active ?? null, masterKeys: ring?.keys, guardVersion: GUARD_VERSION });
    if (decision.pinEncrypted) {
      const shape = text ? parseManifest(JSON.parse(text)) : null;
      await saveState({ ...known, knownEncrypted: true, expectedKeyId: shape?.keyId });
    }
  }

  async run(target: ISyncTarget, vault: IVaultAdapter): Promise<void> {
    await this.keyfile.run(target, vault);
    // Decided PER CYCLE, not once when the worker was built. It used to be
    // built once, which meant a single failed keyfile probe at startup — one
    // DNS hiccup is enough — switched the profile off for the rest of the
    // session, silently, with the chain still showing step 1 as on (device
    // report 2026-07-26). It also means unlocking the passphrase or flipping
    // the switch takes effect on the next cycle instead of needing a restart.
    const profile = await this.steps.profile(vault);
    if (profile) {
      try {
        await profile.run(target, vault);
      } catch (error) {
        // Rethrown, so the cycle behaves as before — but not in silence, and no
        // longer as an alarm either: a dropped request is a wait, not an answer
        // (finding 2026-08-21). The shared decision maker classifies, counts the
        // streak and remembers what was already said; the record it returns is
        // durable, so both survive a restart. Only a fatal failure — or the
        // third transient one in a row — is allowed to interrupt.
        let failure: SettingsSyncFailure | null = null;
        await updateDiagnostics(this.vaultId, (d) => {
          const outcome = noteSettingsSyncFailure(d, new Date().toISOString(), error);
          failure = outcome.failure;
          return outcome.diagnostics;
        });
        // The sync card renders the waiting state from the same record, so the
        // quiet case is visible without a toast.
        if (failure && (failure as SettingsSyncFailure).announce) {
          toast.error(i18n.t("settingsSync.profileFailed", { error: (failure as SettingsSyncFailure).message }));
        }
        throw error;
      }
    }
    // A refused secret must not take the file sync down with it: a binding
    // mismatch is a reason to leave the keychain alone and say so, not to stop
    // syncing notes.
    const secrets = await this.steps.secrets();
    if (secrets) {
      try {
        await secrets.run(target, vault);
      } catch (error) {
        const reason = error instanceof SecretPolicyError ? "invalid-or-unreadable-bundle" : "sync-failed";
        await updateDiagnostics(this.vaultId, (d) => recordSecretsError(d, new Date().toISOString(), reason));
        toast.error(i18n.t("settingsSync.secretsFailedSafe"));
      }
      await this.runLegacyCleanupIfRequested(secrets, target, vault);
    }
  }

  /** Carries the user's "every device is up to date" to the one place that can act. */
  private async runLegacyCleanupIfRequested(
    secrets: SecretsSyncStep,
    target: ISyncTarget,
    vault: IVaultAdapter,
  ): Promise<void> {
    const store = await settingsStore();
    if ((await store.get<boolean>(legacyCleanupRequestedKey(this.vaultId))) !== true) return;
    // Cleared FIRST: a failing cleanup must not retry itself on every cycle
    // behind the user's back — it rewrites the shared document.
    await store.delete(legacyCleanupRequestedKey(this.vaultId));
    await store.save();
    try {
      const result = await secrets.cleanupLegacyEntries(target, vault, { allDevicesUpdated: true });
      if (!result.documentRead) {
        // Third outcome, and the one that used to hide inside "nothing to
        // remove": there was no shared document to look into. Nothing was
        // proven, so nothing is cleared — the warning stays and the user can
        // try again once the sync has run (desktop rule, carried over
        // 2026-08-19).
        toast.warning(i18n.t("settingsSync.legacyEntriesCleanupUnread"));
        return;
      }
      // Only now is the absence OBSERVED: drop the finding and re-arm the
      // notice so it can speak again if it ever comes back.
      await updateDiagnostics(this.vaultId, (d) => clearLegacyClient(d, "legacy-google-client-entry"));
      await forgetReportedOnce(legacyNoticeKey(this.vaultId));
      toast.info(
        result.removed > 0
          ? i18n.t("settingsSync.legacyEntriesCleanupDone", { count: result.removed })
          : i18n.t("settingsSync.legacyEntriesCleanupNone"),
      );
    } catch (error) {
      console.error("[mobileSettingsSync] legacy secrets cleanup failed", error);
      toast.error(i18n.t("settingsSync.legacyEntriesCleanupFailed"));
    }
  }
}

/**
 * Builds the two optional sideband steps fresh for each cycle. Both depend on
 * state the user can change while the worker runs (the toggles, the unlocked
 * keyring) and on the vault (does a keyfile exist yet), so a decision taken
 * once at construction time goes stale the moment any of that moves.
 */
interface SidebandSteps {
  profile(vault: IVaultAdapter): Promise<SettingsSyncStep | null>;
  secrets(): Promise<SecretsSyncStep | null>;
}

/**
 * Same rule as the desktop (P7, E4): a finding is always recorded, but only
 * said out loud when the sentence is true. This device's OWN profile file
 * missing the capability stamp accuses nobody — warning about "an older
 * Plainva" there sends the user looking at their other machines for nothing.
 *
 * Never exposes account ids, endpoints or credential material.
 */
async function reportLegacyPublisher(vaultId: string, reason: LegacyClientDiagnosticReason): Promise<void> {
  const message =
    reason === "legacy-profile-capability-remote"
      ? "settingsSync.legacyProfileRemote"
      : reason === "legacy-google-client-entry"
        ? "settingsSync.legacyPublisherUpgrade"
        : null;
  // Durable: this finding needs a person to clean up, and an app restart is
  // not that person acting.
  if (message && (await shouldReportOnce(legacyNoticeKey(vaultId), reason))) {
    toast.warning(i18n.t(message));
  }
  void updateDiagnostics(vaultId, (diagnostics) =>
    recordLegacyClient(diagnostics, new Date().toISOString(), reason));
}

function sidebandSteps(vault: MobileVault, device: string): SidebandSteps {
  const vaultId = vault.vaultId;
  return {
    async profile(raw: IVaultAdapter): Promise<SettingsSyncStep | null> {
      if (!(await isMobileSettingsSyncEnabled(vaultId))) return null;
      const ring = await loadKeyring(vaultId);
      // A keyfile in the vault means the profile is sealed. Writing a plaintext
      // one beside it would be a second, competing truth — so a locked device
      // waits instead. The chain says so; it must not claim step 1 is running.
      if (!ring && (await raw.exists(KEYFILE_PATH))) {
        // Said once per session, like on the desktop: the chain shows the state,
        // but nothing tells a user who is not looking at it why their settings
        // stopped moving.
        if (shouldReportWaitingAccounts(`profile-locked:${vaultId}`, ["locked"])) {
          toast.info(i18n.t("settingsSync.lockedHere"));
        }
        return null;
      }
      return new SettingsSyncStep({
        port: createMobileProfilePort(vault),
        deviceId: device,
        // Once per session and only for a real change (E1): the arrival is a
        // moment, not a state — from then on the diagnostics record names the
        // fields. Before the roundtrip fix this fired on nearly every cycle.
        onAdopted: (_from, changedNames) => {
          if (shouldAnnounceProfileImport(vault.vaultId, changedNames)) toast.info(i18n.t("settingsSync.adopted"));
        },
        onExchange: async (info) => {
          const at = new Date().toISOString();
          await updateDiagnostics(vault.vaultId, (d) => recordProfileExchange(d, at, info));
        },
        onLegacyProfile: (info) => {
          void reportLegacyPublisher(
            vault.vaultId,
            info.source === "remote"
              ? "legacy-profile-capability-remote"
              : "legacy-profile-capability-local",
          );
        },
        profileCrypto: ring
          ? { seal: (plain) => sealBlob(ring.active, plain, "settings"), open: (bytes) => openBlob(ring.active, bytes, "settings") }
          : undefined,
      });
    },
    async secrets(): Promise<SecretsSyncStep | null> {
      // E2: secrets ride ON the profile. A password can only be placed on an
      // account this device already knows, and the accounts arrive with the
      // profile — running without it asked the user, every single cycle, to
      // switch on something that was either already on or would not have helped.
      if (!(await isMobileSettingsSyncEnabled(vaultId))) return null;
      const ring = await loadKeyring(vaultId);
      if (!ring || !(await isMobileSecretsSyncEnabled(vaultId))) return null;
      return new SecretsSyncStep({
        port: createMobileSecretsPort(vaultId),
        masterKey: ring.active,
        // Once per CHANGED set, not once per cycle: a skipped entry never
        // changes the local view that triggers this, so the condition persists.
        onUnknownAccounts: (ids) => {
          if (shouldReportWaitingAccounts(vaultId, ids)) {
            toast.info(i18n.t("settingsSync.secretsWaiting", { count: ids.length }));
          }
        },
        onImportResult: async (result) => {
          const at = new Date().toISOString();
          await updateDiagnostics(vaultId, (d) => {
            const recorded = recordSecretsResult(d, at, result);
            return result.legacyEntries.length > 0
              ? recordLegacyClient(recorded, at, "legacy-google-client-entry")
              : recorded;
          });
          if (result.legacyEntries.length > 0) {
            if (await shouldReportOnce(legacyNoticeKey(vaultId), "legacy-publisher")) {
              toast.warning(i18n.t("settingsSync.legacyPublisherUpgrade"));
            }
          }
        },
      });
    },
  };
}

/** Adds fail-closed content handling and the mobile profile sideband to a worker. */
export async function prepareMobileSettingsSync(
  vault: MobileVault,
  provider: MobileSyncProvider,
  rawTarget: ISyncTarget,
): Promise<{ target: ISyncTarget; runner: SettingsSyncRunner }> {
  await recoverMobileAccountRepair(vault.vaultId, accountMapKey(vault.vaultId));
  const connectionId = connectionFingerprint(provider.provider, await remoteRoot(vault.vaultId, provider));
  const keyfile = new KeyfileSyncStep({ onRemoteKeyfileAdopted: () => window.dispatchEvent(new CustomEvent("m-encryption-locked")) });
  const rawVault = vault.backup ?? vault.adapter;
  let ring = await loadKeyring(vault.vaultId);
  // The profile encryption is independent of content encryption. Pull the
  // public keyfile before choosing settings.json vs settings.enc; when it is
  // present but still locked, defer profile sync instead of creating a second
  // plaintext truth beside an existing sealed profile.
  // Best-effort: a failure here is a network blip, not an answer. The runner
  // re-decides every cycle, so it recovers on its own.
  if (!ring) await keyfile.run(rawTarget, rawVault).catch(() => undefined);
  ring = ring ?? await loadKeyring(vault.vaultId);
  if ((await rawVault.exists(KEYFILE_PATH)) && !ring && typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("m-encryption-locked"));
  }
  const runner = new MobileSidebandRunner(vault.vaultId, connectionId, keyfile, sidebandSteps(vault, await deviceId()));
  if (!ring) return { target: rawTarget, runner };
  const manifestBytes = await rawTarget.download(ENCRYPTION_MANIFEST_PATH);
  if (!manifestBytes) return { target: rawTarget, runner };
  const manifestText = new TextDecoder().decode(manifestBytes as BufferSource);
  const known = await loadState(connectionId);
  const decision = evaluateManifestGuard({ manifestText, known, masterKey: ring.active, masterKeys: ring.keys, guardVersion: GUARD_VERSION });
  if (decision.mode === "plain") return { target: rawTarget, runner };
  const shape = parseManifest(JSON.parse(manifestText));
  if (!shape) throw new FatalSyncProtocolError("manifest-invalid", "invalid encryption manifest");
  const writeKey = shape.state === "rotating" && shape.newKeyId ? ring.keys.get(shape.newKeyId) : ring.active;
  return {
    target: new EncryptingSyncTarget(rawTarget, { writeKey, readKeys: ring.keys, encryptWrites: shape.state !== "decrypting", isStrict: () => decision.mode === "strict" }),
    runner,
  };
}

export { SETTINGS_ENC_PATH };
