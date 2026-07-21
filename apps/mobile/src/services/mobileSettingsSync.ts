import {
  ENCRYPTION_MANIFEST_PATH,
  EncryptingSyncTarget,
  FatalSyncProtocolError,
  KeyfileSyncStep,
  SETTINGS_ENC_PATH,
  SettingsSyncStep,
  connectionFingerprint,
  evaluateManifestGuard,
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
  type MasterKeyBundle,
  type SettingsSyncRunner,
} from "@plainva/core";
import { getPlatformServices, toast } from "@plainva/ui";
import i18n from "@plainva/ui/i18n";
import { getMobileSettings, updateMobileSettings } from "./mobileSettings";
import type { MobileSyncProvider } from "./syncService";
import type { MobileVault } from "./vaultService";

const GUARD_VERSION = 1;
const enabledKey = (vaultId: string) => `settingsSyncMobile_${vaultId}`;
const unknownKey = (vaultId: string) => `settingsSyncUnknownMobile_${vaultId}`;
const stateKey = (connectionId: string) => `e2eStateMobile_${connectionId}`;
const cacheKey = (vaultId: string) => `mkcache_mobile_${vaultId}`;
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

export async function setMobileSettingsSyncEnabled(vaultId: string, enabled: boolean): Promise<void> {
  const store = await settingsStore();
  await store.set(enabledKey(vaultId), enabled);
  await store.save();
}

async function loadKeyring(vaultId: string): Promise<{ active: MasterKeyBundle; keys: Map<string, MasterKeyBundle> } | null> {
  const present = memory.get(vaultId);
  if (present) return present;
  const cached = await getPlatformServices().credentials.readSecret<CachedKeyring>(cacheKey(vaultId));
  if (!cached?.activeKeyId || !Array.isArray(cached.keys)) return null;
  const keys = new Map(cached.keys.map((key) => [key.keyId, { keyId: key.keyId, masterKey: fromBase64(key.mk) }]));
  const active = keys.get(cached.activeKeyId);
  if (!active) return null;
  const ring = { active, keys };
  memory.set(vaultId, ring);
  return ring;
}

export async function unlockMobileEncryption(vault: MobileVault, passphrase: string): Promise<void> {
  const raw = vault.backup ?? vault.adapter;
  const path = ".plainva/sync/keyfile.json";
  if (!(await raw.exists(path))) throw new Error("no keyfile present");
  const keyfile = JSON.parse(await raw.readTextFile(path));
  const keys = await unlockAllKeys(keyfile, passphrase);
  const active = keys.get(keyfile.activeKeyId);
  if (!active) throw new Error("active key missing");
  memory.set(vault.vaultId, { active, keys });
  await getPlatformServices().credentials.writeSecret<CachedKeyring>(cacheKey(vault.vaultId), {
    activeKeyId: active.keyId,
    keys: [...keys.values()].map((key) => ({ keyId: key.keyId, mk: toBase64(key.masterKey) })),
  });
}

export async function lockMobileEncryption(vaultId: string): Promise<void> {
  memory.delete(vaultId);
  await getPlatformServices().credentials.removeSecret(cacheKey(vaultId));
}

export async function mobileEncryptionStatus(vault: MobileVault): Promise<"none" | "locked" | "unlocked"> {
  if (await loadKeyring(vault.vaultId)) return "unlocked";
  return (await (vault.backup ?? vault.adapter).exists(".plainva/sync/keyfile.json")) ? "locked" : "none";
}

function profilePort(vaultId: string) {
  return {
    async exportValues(): Promise<Record<string, unknown>> {
      const s = getMobileSettings();
      const unknown = (await (await settingsStore()).get<Record<string, unknown>>(unknownKey(vaultId))) ?? {};
      return {
        ...unknown,
        dailyNotesFolder: s.dailyFolder,
        dailyNoteTemplate: s.dailyTemplate,
        templateFolder: s.templateFolder,
        backupSnapshotIntervalSeconds: s.backupIntervalSeconds,
        backupMaxCountPerFile: s.backupMaxPerFile,
        backupMaxAgeDays: s.backupMaxAgeDays,
      };
    },
    async applyValues(values: Record<string, unknown>): Promise<void> {
      const patch: Record<string, unknown> = {};
      if (typeof values.dailyNotesFolder === "string" && !values.dailyNotesFolder.startsWith("/")) patch.dailyFolder = values.dailyNotesFolder;
      if (typeof values.dailyNoteTemplate === "string" && !values.dailyNoteTemplate.startsWith("/")) patch.dailyTemplate = values.dailyNoteTemplate;
      if (typeof values.templateFolder === "string" && !values.templateFolder.startsWith("/")) patch.templateFolder = values.templateFolder;
      if (typeof values.backupSnapshotIntervalSeconds === "number" && values.backupSnapshotIntervalSeconds >= 0) patch.backupIntervalSeconds = values.backupSnapshotIntervalSeconds;
      if (typeof values.backupMaxCountPerFile === "number" && values.backupMaxCountPerFile >= 0) patch.backupMaxPerFile = values.backupMaxCountPerFile;
      if (typeof values.backupMaxAgeDays === "number" && values.backupMaxAgeDays >= 0) patch.backupMaxAgeDays = values.backupMaxAgeDays;
      const known = new Set(["dailyNotesFolder", "dailyNoteTemplate", "templateFolder", "backupSnapshotIntervalSeconds", "backupMaxCountPerFile", "backupMaxAgeDays"]);
      const unknown = Object.fromEntries(Object.entries(values).filter(([key]) => !known.has(key)));
      const store = await settingsStore();
      await store.set(unknownKey(vaultId), unknown);
      await store.save();
      await updateMobileSettings(patch);
    },
  };
}

class MobileSidebandRunner implements SettingsSyncRunner {
  constructor(
    private readonly vaultId: string,
    private readonly connectionId: string,
    private readonly keyfile: KeyfileSyncStep,
    private readonly profile: SettingsSyncStep | null,
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
  const hasKeyfile = await rawVault.exists(".plainva/sync/keyfile.json");
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
  const runner = new MobileSidebandRunner(vault.vaultId, connectionId, keyfile, profile);
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
