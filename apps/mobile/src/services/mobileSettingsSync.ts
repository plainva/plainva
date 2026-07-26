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
import { getPlatformServices, toast } from "@plainva/ui";
import i18n from "@plainva/ui/i18n";
import { applyVaultSettings, getVaultSettings, type VaultSettings } from "./mobileSettings";
import { createMobileSecretsPort } from "./mobileSecretsPort";
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

function profilePort(vaultId: string) {
  return {
    async exportValues(): Promise<Record<string, unknown>> {
      const s = await getVaultSettings(vaultId);
      const unknown = (await (await settingsStore()).get<Record<string, unknown>>(unknownKey(vaultId))) ?? {};
      return {
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
      };
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
      const known = new Set(["dailyNotesFolder", "dailyNoteTemplate", "templateFolder", "backupSnapshotIntervalSeconds", "backupMaxCountPerFile", "backupMaxAgeDays", "syncIntervalSeconds"]);
      const unknown = Object.fromEntries(Object.entries(values).filter(([key]) => !known.has(key)));
      const store = await settingsStore();
      await store.set(unknownKey(vaultId), unknown);
      await store.save();
      await applyVaultSettings(vaultId, patch);
    },
  };
}

class MobileSidebandRunner implements SettingsSyncRunner {
  constructor(
    private readonly vaultId: string,
    private readonly connectionId: string,
    private readonly keyfile: KeyfileSyncStep,
    private readonly profile: SettingsSyncStep | null,
    private readonly secrets: SecretsSyncStep | null,
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
    await this.profile?.run(target, vault);
    // A refused secret must not take the file sync down with it: a binding
    // mismatch is a reason to leave the keychain alone and say so, not to stop
    // syncing notes.
    if (this.secrets) {
      try {
        await this.secrets.run(target, vault);
      } catch (error) {
        toast.error(i18n.t("settingsSync.secretsFailed", { error: error instanceof Error ? error.message : String(error) }));
      }
    }
  }
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
  let keyfilePreflightFailed = false;
  if (!ring) {
    try {
      await keyfile.run(rawTarget, rawVault);
    } catch {
      keyfilePreflightFailed = true;
    }
  }
  const hasKeyfile = await rawVault.exists(KEYFILE_PATH);
  ring = ring ?? await loadKeyring(vault.vaultId);
  if (hasKeyfile && !ring && typeof window !== "undefined") window.dispatchEvent(new CustomEvent("m-encryption-locked"));
  const profile = (await isMobileSettingsSyncEnabled(vault.vaultId)) && !keyfilePreflightFailed && (!hasKeyfile || !!ring)
    ? new SettingsSyncStep({
        port: profilePort(vault.vaultId),
        deviceId: await deviceId(),
        onAdopted: () => toast.info(i18n.t("settingsSync.adopted")),
        profileCrypto: ring ? { seal: (plain) => sealBlob(ring.active, plain, "settings"), open: (bytes) => openBlob(ring.active, bytes, "settings") } : undefined,
      })
    : null;
  // Secrets need a master key AND their own opt-in: without an unlocked
  // keyring there is nothing to seal the bundle with, so the step simply does
  // not exist rather than failing every cycle.
  const secrets =
    ring && (await isMobileSecretsSyncEnabled(vault.vaultId))
      ? new SecretsSyncStep({ port: createMobileSecretsPort(vault.vaultId), masterKey: ring.active })
      : null;
  const runner = new MobileSidebandRunner(vault.vaultId, connectionId, keyfile, profile, secrets);
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
