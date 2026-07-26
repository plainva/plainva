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
  type SettingsSyncRunner,
} from "@plainva/core";
import {
  cloudRegistryToLogical,
  emptyAccountMap,
  getPlatformServices,
  importAccountMetadata,
  remapCloudRegistry,
  toast,
  validCloudAccount,
  type AccountImportPorts,
  type ProfileAccountMap,
  type ProfilePimSelections,
} from "@plainva/ui";
import { listMailAccounts, replaceMailAccounts } from "@plainva/ui/mail";
import { PimCacheRepository } from "@plainva/core";
import { loadCloudAccounts, refreshCloudAccounts, saveCloudAccounts } from "./cloudAccountsStore";
import i18n from "@plainva/ui/i18n";
import { applyVaultSettings, getVaultSettings, type VaultSettings } from "./mobileSettings";
import { createMobileSecretsPort } from "./mobileSecretsPort";
import { isPimRuntimeReady } from "./pim/pimService";
import { MIN_SYNC_INTERVAL_SECONDS } from "./mobileSettingsScope";
import type { MobileSyncProvider } from "./syncService";
import type { MobileVault } from "./vaultService";

const GUARD_VERSION = 1;
const KEYFILE_PATH = ".plainva/sync/keyfile.json";
const enabledKey = (vaultId: string) => `settingsSyncMobile_${vaultId}`;
/** Sign-in secrets are a SEPARATE opt-in from the settings profile (H2c). */
const secretsKey = (vaultId: string) => `secretsSyncMobile_${vaultId}`;
const unknownKey = (vaultId: string) => `settingsSyncUnknownMobile_${vaultId}`;
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
    loadAccountMap: async () => (await (await settingsStore()).get<ProfileAccountMap>(accountMapKey(vaultId))) ?? emptyAccountMap(),
    saveAccountMap: async (map) => {
      const s = await settingsStore();
      await s.set(accountMapKey(vaultId), map);
      await s.save();
    },
  };
}

function profilePort(vault: MobileVault) {
  const vaultId = vault.vaultId;
  return {
    async exportValues(): Promise<Record<string, unknown>> {
      const s = await getVaultSettings(vaultId);
      const unknown = (await (await settingsStore()).get<Record<string, unknown>>(unknownKey(vaultId))) ?? {};
      const map = (await (await settingsStore()).get<ProfileAccountMap>(accountMapKey(vaultId))) ?? emptyAccountMap();
      const cache = vault.db ? new PimCacheRepository(vault.db) : null;

      const values: Record<string, unknown> = {
        ...unknown,
        dailyNotesFolder: s.dailyFolder,
        dailyNoteTemplate: s.dailyTemplate,
        templateFolder: s.templateFolder,
        backupSnapshotIntervalSeconds: s.backupIntervalSeconds,
        backupMaxCountPerFile: s.backupMaxPerFile,
        backupMaxAgeDays: s.backupMaxAgeDays,
        // H2a: the desktop has always put this in the profile; mobile neither
        // read nor wrote it, so a value set there never arrived on the phone.
        syncIntervalSeconds: s.syncIntervalSeconds,
        // These two are per-vault on mobile and were documented as travelling
        // with the sync — but the port never listed them, so they never did.
        mailFolder: s.mailFolder,
        mailRemoteImages: s.mailRemoteImages,
      };

      // Accounts (plan P3). Until now they fell into `unknown`, were written
      // back untouched and never applied — which is why a phone kept asking the
      // user to create every calendar and mailbox by hand.
      if (cache) {
        const accounts = await cache.listAccounts();
        values.pimAccounts = accounts.map((a) => ({ ...a, id: map.pimLocalToLogical[a.id] ?? a.id }));
        const calendars = await cache.listCalendars();
        const taskLists = await cache.listTaskLists();
        values.pimSelections = {
          calendars: calendars.map((c) => ({ accountId: map.pimLocalToLogical[c.accountId] ?? c.accountId, id: c.id, selected: c.selected })),
          taskLists: taskLists.map((l) => ({ accountId: map.pimLocalToLogical[l.accountId] ?? l.accountId, id: l.id, selected: l.selected })),
        } satisfies ProfilePimSelections;
      }
      const mail = await listMailAccounts(vaultId);
      values.mailAccounts = mail.map((a) => ({ ...a, id: map.mailLocalToLogical[a.id] ?? a.id }));
      // Bring the registry up to date before publishing it — this is the one
      // place guaranteed to run whenever the profile is exported. It only writes
      // when something actually changed, so it cannot loop.
      const registry = await refreshCloudAccounts(vaultId, isPimRuntimeReady()).catch(() => loadCloudAccounts(vaultId));
      values.cloudAccounts = cloudRegistryToLogical(registry, map);
      return values;
    },
    async applyValues(values: Record<string, unknown>): Promise<void> {
      const patch: Partial<VaultSettings> = {};
      if (typeof values.dailyNotesFolder === "string" && !values.dailyNotesFolder.startsWith("/")) patch.dailyFolder = values.dailyNotesFolder;
      if (typeof values.dailyNoteTemplate === "string" && !values.dailyNoteTemplate.startsWith("/")) patch.dailyTemplate = values.dailyNoteTemplate;
      if (typeof values.templateFolder === "string" && !values.templateFolder.startsWith("/")) patch.templateFolder = values.templateFolder;
      if (typeof values.backupSnapshotIntervalSeconds === "number" && values.backupSnapshotIntervalSeconds >= 0) patch.backupIntervalSeconds = values.backupSnapshotIntervalSeconds;
      if (typeof values.backupMaxCountPerFile === "number" && values.backupMaxCountPerFile >= 0) patch.backupMaxPerFile = values.backupMaxCountPerFile;
      if (typeof values.backupMaxAgeDays === "number" && values.backupMaxAgeDays >= 0) patch.backupMaxAgeDays = values.backupMaxAgeDays;
      if (typeof values.syncIntervalSeconds === "number" && values.syncIntervalSeconds >= MIN_SYNC_INTERVAL_SECONDS) patch.syncIntervalSeconds = values.syncIntervalSeconds;
      if (typeof values.mailFolder === "string" && !values.mailFolder.startsWith("/")) patch.mailFolder = values.mailFolder;
      if (typeof values.mailRemoteImages === "boolean") patch.mailRemoteImages = values.mailRemoteImages;

      const idMap = await importAccountMetadata(values, mobileAccountPorts(vault));
      if (Array.isArray(values.cloudAccounts)) {
        await saveCloudAccounts(vaultId, remapCloudRegistry(values.cloudAccounts.filter(validCloudAccount), idMap));
      }

      const known = new Set([
        "dailyNotesFolder", "dailyNoteTemplate", "templateFolder",
        "backupSnapshotIntervalSeconds", "backupMaxCountPerFile", "backupMaxAgeDays",
        "syncIntervalSeconds", "mailFolder", "mailRemoteImages",
        "pimAccounts", "pimSelections", "mailAccounts", "cloudAccounts",
      ]);
      const unknown = Object.fromEntries(Object.entries(values).filter(([key]) => !known.has(key)));
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
    await profile?.run(target, vault);
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

function sidebandSteps(vault: MobileVault, device: string): SidebandSteps {
  const vaultId = vault.vaultId;
  return {
    async profile(raw: IVaultAdapter): Promise<SettingsSyncStep | null> {
      if (!(await isMobileSettingsSyncEnabled(vaultId))) return null;
      const ring = await loadKeyring(vaultId);
      // A keyfile in the vault means the profile is sealed. Writing a plaintext
      // one beside it would be a second, competing truth — so a locked device
      // waits instead. The chain says so; it must not claim step 1 is running.
      if (!ring && (await raw.exists(KEYFILE_PATH))) return null;
      return new SettingsSyncStep({
        port: profilePort(vault),
        deviceId: device,
        onAdopted: () => toast.info(i18n.t("settingsSync.adopted")),
        profileCrypto: ring
          ? { seal: (plain) => sealBlob(ring.active, plain, "settings"), open: (bytes) => openBlob(ring.active, bytes, "settings") }
          : undefined,
      });
    },
    async secrets(): Promise<SecretsSyncStep | null> {
      const ring = await loadKeyring(vaultId);
      if (!ring || !(await isMobileSecretsSyncEnabled(vaultId))) return null;
      return new SecretsSyncStep({
        port: createMobileSecretsPort(vaultId),
        masterKey: ring.active,
        onUnknownAccounts: (ids) => toast.info(i18n.t("settingsSync.secretsWaiting", { count: ids.length })),
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
