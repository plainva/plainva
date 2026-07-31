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
  recordError,
  recordExport,
  recordImport,
  recordSkipped,
  canonicalizeProfileValues,
  profileDefault,
  shouldReportWaitingAccounts,
  storeBackedFields,
  toast,
  type AccountImportPorts,
  type ProfileAccountMap,
  type SyncDiagnostics,
} from "@plainva/ui";
import { listMailAccounts, mailSecretKey, replaceMailAccounts } from "@plainva/ui/mail";
import {
  parseBookmarksFile,
  parseFolderTemplateRules,
  parseTypeTemplateRules,
  serializeBookmarksFile,
} from "@plainva/ui";
import { PimCacheRepository } from "@plainva/core";
import { loadCloudAccounts, saveCloudAccounts } from "./cloudAccountsStore";
import i18n from "@plainva/ui/i18n";
import { applyVaultSettings, getVaultSettings, type VaultSettings } from "./mobileSettings";
import { createMobileSecretsPort } from "./mobileSecretsPort";
import { MIN_SYNC_INTERVAL_SECONDS } from "./mobileSettingsScope";
import type { MobileSyncProvider } from "./syncService";
import type { MobileVault } from "./vaultService";
import { pimSecretKey } from "./pim/pimCredentials";
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
  return (await store.get<SyncDiagnostics>(diagnosticsKey(vaultId))) ?? emptyDiagnostics();
}

/**
 * Reads, reduces and writes back. Deliberately swallows its own failures: the
 * record is a report about the sync, and it must never be the reason one stops.
 */
async function updateDiagnostics(vaultId: string, reduce: (d: SyncDiagnostics) => SyncDiagnostics): Promise<void> {
  try {
    const store = await settingsStore();
    await store.set(diagnosticsKey(vaultId), reduce(await loadSyncDiagnostics(vaultId)));
    await store.save();
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(SYNC_DIAGNOSTICS_EVENT, { detail: { vaultId } }));
  } catch {
    // see above
  }
}
const stateKey = (connectionId: string) => `e2eStateMobile_${connectionId}`;
const cacheKey = (vaultId: string) => `mkcache_mobile_${vaultId}`;
/** "Ask for the passphrase on every start" (H2b) — mirrors the desktop's
 *  `passphraseEveryStart`: when on, the unlocked keyring stays in memory only. */
const everyStartKey = (vaultId: string) => `mkEveryStartMobile_${vaultId}`;
const deviceKey = "settingsSyncDeviceIdMobile";
const memory = new Map<string, { active: MasterKeyBundle; keys: Map<string, MasterKeyBundle> }>();

interface CachedKeyring {
  activeKeyId: string;
  keys: Array<{ keyId: string; mk: string }>;
}

function remoteRoot(provider: MobileSyncProvider): string {
  switch (provider.provider) {
    case "webdav": return provider.creds.url;
    case "s3": return `${provider.creds.endpoint}/${provider.creds.bucket}/${provider.creds.prefix ?? ""}`;
    case "drive": return provider.creds.rootFolderName ?? "Plainva";
    case "onedrive": return provider.creds.rootFolderName ?? "Plainva";
    case "dropbox": return provider.creds.rootPath ?? "/";
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
    const connectionId = connectionFingerprint(provider.provider, remoteRoot(provider));
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
      return canonicalizeProfileValues(values);
    },
    async applyValues(values: Record<string, unknown>): Promise<void> {
      const canonical = canonicalizeProfileValues(values);
      const { patch, skipped } = importVaultSettings(canonical, true);
      await updateDiagnostics(vaultId, (d) => recordSkipped(d, new Date().toISOString(), skipped));

      await recoverMobileAccountRepair(vaultId, accountMapKey(vaultId));
      await importAccountMetadata(canonical, mobileAccountPorts(vault));
      await repairMobileAccounts(vaultId, accountMapKey(vaultId));

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
      if (Object.keys(rulePatch).length > 0) await applyVaultSettings(vaultId, rulePatch);

      const known = new Set([...Object.keys(MOBILE_BINDING), "pimAccounts", "pimSelections", "mailAccounts", "cloudAccounts", "bookmarks", "folderTemplates", "typeTemplates"]);
      const unknown = Object.fromEntries(Object.entries(canonical).filter(([key]) => !known.has(key)));
      const store = await settingsStore();
      await store.set(unknownKey(vaultId), unknown);
      await store.save();
      await applyVaultSettings(vaultId, patch);
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
        // Rethrown, so the cycle behaves as before — but not in silence: the
        // worker only console.errors this, and a settings sync that transported
        // nothing for days looked exactly like a working one.
        const message = error instanceof Error ? error.message : String(error);
        if (shouldReportWaitingAccounts(`profile-error:${this.vaultId}`, [message])) {
          toast.error(i18n.t("settingsSync.profileFailed", { error: message }));
        }
        // A toast is gone in seconds; the record keeps the reason until the
        // next success clears it.
        await updateDiagnostics(this.vaultId, (d) => recordError(d, new Date().toISOString(), message));
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
        toast.error(i18n.t("settingsSync.secretsFailed", { error: error instanceof Error ? error.message : String(error) }));
      }
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

/** Warns without exposing account ids, endpoints or credential material. */
function reportLegacyPublisher(vaultId: string, reason: string): void {
  if (shouldReportWaitingAccounts(`legacy-publisher:${vaultId}`, ["legacy-publisher"])) {
    toast.warning(i18n.t("settingsSync.legacyPublisherUpgrade"));
  }
  void updateDiagnostics(vaultId, (diagnostics) => {
    const reasons = [...new Set([...(diagnostics.skipped?.reasons ?? []), reason])];
    return recordSkipped(diagnostics, new Date().toISOString(), reasons);
  });
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
        onExchange: (info) => {
          const at = new Date().toISOString();
          void updateDiagnostics(vault.vaultId, (d) => {
            const next = recordExport(d, at, info.exported, info.exportedNames);
            // The CHANGED fields, not all of them: that is what names the cause
            // when a device reports an import on every cycle.
            return info.imported > 0 ? recordImport(next, at, info.imported, info.peerDeviceId, info.changedNames) : next;
          });
        },
        onLegacyProfile: () => {
          reportLegacyPublisher(vault.vaultId, "legacy-profile-capability");
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
        onImportResult: (result) => {
          if (result.legacyEntries.length > 0) {
            reportLegacyPublisher(vaultId, "legacy-google-client-entry");
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
  const connectionId = connectionFingerprint(provider.provider, remoteRoot(provider));
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
