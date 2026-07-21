/**
 * Desktop profile-sync port (settings-sync plan P1). Bridges the vault's
 * syncable per-vault settings (content placement, backup retention, sync
 * interval) to and from the platform-neutral profile document. The registry
 * below is the single source of truth for WHICH settings sync; every entry maps
 * a logical name (stable across devices) to the device-local store key (which
 * embeds the absolute vault path, so it must be re-keyed on each device).
 *
 * Deliberately scoped for P1: only settings that live in the settings store and
 * carry no account identity or absolute path. Account metadata + secrets and
 * bookmarks travel in a later package (they are inseparable from the sign-in
 * flow / a second sideband file).
 *
 * The app-facing writes go through getSettingsStore() only; the profile FILE
 * itself is read/written by the core sideband step through the raw backup
 * adapter (never the conflict-aware adapter — that would create .CONFLICT copies
 * of the settings file).
 */
import {
  SettingsSyncStep,
  KeyfileSyncStep,
  EncryptingSyncTarget,
  sealBlob,
  openBlob,
  evaluateManifestGuard,
  parseManifest,
  isEncryptedState,
  type ProfileSettingsPort,
  type ProfileCrypto,
  type SettingsSyncRunner,
  type ISyncTarget,
  type IVaultAdapter,
} from "@plainva/core";
import { toast, type ISettingsStore } from "@plainva/ui";
import i18n from "@plainva/ui/i18n";
import { getSettingsStore } from "./settingsStore";
import { loadCachedMasterKey } from "./encryptionSession";
import {
  GUARD_VERSION,
  connectionIdFor,
  loadConnectionState,
  readRemoteManifest,
  saveConnectionState,
} from "./encryptionManifest";
import { loadCloudAccounts } from "./cloudAccounts";
import { getSyncRootFolder } from "./cloudAccountsActions";
import {
  backupMaxAgeDaysKey,
  backupMaxCountKey,
  backupSnapshotIntervalKey,
  backupZipEnabledKey,
  backupZipKeepKey,
} from "./backupPolicy";

// Per-vault store keys, defined locally to avoid pulling the VaultContext module
// graph into a service (the same decoupling backupPolicy.ts uses). These MUST
// match the exported helpers in VaultContext.tsx byte-for-byte; a drift test in
// settingsProfile.test.ts pins the exact key strings.
const b64 = (p: string) => btoa(unescape(encodeURIComponent(p)));
const dailyNotesFolderKey = (v: string) => `dailyNotesFolder_${b64(v)}`;
const dailyNotesFormatKey = (v: string) => `dailyNotesFormat_${b64(v)}`;
const dailyNoteTemplateKey = (v: string) => `dailyNoteTemplate_${b64(v)}`;
const dailyNoteTypeKey = (v: string) => `dailyNoteType_${b64(v)}`;
const templateFolderKey = (v: string) => `templateFolder_${b64(v)}`;
const defaultNoteTypeKey = (v: string) => `defaultNoteType_${b64(v)}`;
const taskDatabaseKey = (v: string) => `taskDatabase_${b64(v)}`;
const extendedDatabasesKey = (v: string) => `extendedDatabases_${b64(v)}`;
const meetingFolderKey = (v: string) => `meetingFolder_${b64(v)}`;
const mailFolderKey = (v: string) => `mailFolder_${b64(v)}`;
const mailRemoteImagesKey = (v: string) => `mailRemoteImages_${b64(v)}`;
const syncIntervalKey = (v: string) => `syncIntervalSeconds_${b64(v)}`;

/** Per-vault opt-in: sync this vault's settings through `.plainva/sync/settings.json`. */
export const settingsSyncEnabledKey = (vaultPath: string) => `settingsSyncEnabled_${b64(vaultPath)}`;
/** Global stable device id (LWW tiebreak + "settings from device X" notice). */
export const DEVICE_ID_KEY = "deviceId";

/** A syncable setting: logical name (device-independent) ↔ device-local store key. */
interface ProfileField {
  logical: string;
  key: (vaultPath: string) => string;
}

/**
 * The syncable per-vault settings (P1). Order is irrelevant (the document is
 * key-sorted for hashing). No absolute paths, no runtime timestamps, no account
 * ids — those are excluded by design.
 */
const PROFILE_FIELDS: ProfileField[] = [
  { logical: "dailyNotesFolder", key: dailyNotesFolderKey },
  { logical: "dailyNotesFormat", key: dailyNotesFormatKey },
  { logical: "dailyNoteTemplate", key: dailyNoteTemplateKey },
  { logical: "dailyNoteType", key: dailyNoteTypeKey },
  { logical: "templateFolder", key: templateFolderKey },
  { logical: "defaultNoteType", key: defaultNoteTypeKey },
  { logical: "taskDatabase", key: taskDatabaseKey },
  { logical: "extendedDatabases", key: extendedDatabasesKey },
  { logical: "meetingFolder", key: meetingFolderKey },
  { logical: "mailFolder", key: mailFolderKey },
  { logical: "mailRemoteImages", key: mailRemoteImagesKey },
  { logical: "syncIntervalSeconds", key: syncIntervalKey },
  { logical: "backupSnapshotIntervalSeconds", key: backupSnapshotIntervalKey },
  { logical: "backupMaxCountPerFile", key: backupMaxCountKey },
  { logical: "backupMaxAgeDays", key: backupMaxAgeDaysKey },
  { logical: "backupZipEnabled", key: backupZipEnabledKey },
  { logical: "backupZipKeep", key: backupZipKeepKey },
];

/** Returns the stable device id, generating and persisting one on first use. */
export async function getDeviceId(store?: ISettingsStore): Promise<string> {
  const s = store ?? (await getSettingsStore());
  const existing = await s.get<string>(DEVICE_ID_KEY);
  if (existing) return existing;
  const id = globalThis.crypto.randomUUID();
  await s.set(DEVICE_ID_KEY, id);
  await s.save();
  return id;
}

/** Whether profile-sync is opted in for the given vault. */
export async function isSettingsSyncEnabled(vaultPath: string, store?: ISettingsStore): Promise<boolean> {
  const s = store ?? (await getSettingsStore());
  return (await s.get<boolean>(settingsSyncEnabledKey(vaultPath))) === true;
}

/**
 * Exports the syncable settings as logical name -> value. Only explicitly-set
 * keys are included; an absent key means "default" so the apply side can reset
 * it (full last-writer-wins convergence).
 */
export async function exportProfileValues(store: ISettingsStore, vaultPath: string): Promise<Record<string, unknown>> {
  const values: Record<string, unknown> = {};
  for (const field of PROFILE_FIELDS) {
    const v = await store.get(field.key(vaultPath));
    if (v !== undefined && v !== null) values[field.logical] = v;
  }
  return values;
}

/**
 * Applies imported values: sets the present keys and DELETES the registry keys
 * absent from the document (reset to default), then fires the live-apply events
 * whose listeners re-read (never re-write) the store — so an import never loops
 * back into an export.
 */
export async function applyProfileValues(store: ISettingsStore, vaultPath: string, values: Record<string, unknown>): Promise<void> {
  for (const field of PROFILE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(values, field.logical)) {
      await store.set(field.key(vaultPath), values[field.logical]);
    } else {
      await store.delete(field.key(vaultPath));
    }
  }
  await store.save();
  // Backup retention/ZIP + mail settings take effect live; the rest is lazy-read
  // on next use (daily/template/task) or on next vault open (sync interval).
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("plainva-backup-settings-changed"));
    window.dispatchEvent(new CustomEvent("plainva-mail-settings-changed"));
  }
}

/** Builds the desktop profile-sync port for a vault. */
export function createDesktopProfilePort(vaultPath: string): ProfileSettingsPort {
  return {
    async exportValues() {
      return exportProfileValues(await getSettingsStore(), vaultPath);
    },
    async applyValues(values) {
      await applyProfileValues(await getSettingsStore(), vaultPath, values);
    },
  };
}

/** Builds K_settings seal/open for the sealed profile mode from a cached MK. */
function profileCryptoFor(mk: { keyId: string; masterKey: Uint8Array }): ProfileCrypto {
  return {
    seal: (plain) => sealBlob(mk, plain, "settings"),
    open: (bytes) => openBlob(mk, bytes, "settings"),
  };
}

/** The active sync connection's fingerprint (provider + remote root), or null. */
export async function getActiveConnectionId(vaultPath: string): Promise<string | null> {
  const records = await loadCloudAccounts(vaultPath);
  const provider = records.find((r) => r.services.files)?.services.files?.provider;
  if (!provider) return null;
  const root = await getSyncRootFolder(vaultPath, provider);
  return connectionIdFor(provider, root);
}

/** Key-free manifest shape parse (state only), tolerant of malformed JSON. */
function safeParseManifest(text: string) {
  try {
    return parseManifest(JSON.parse(text));
  } catch {
    return null;
  }
}

/**
 * Wraps a sync target in the content-E2E decorator when THIS connection has an
 * active encryption manifest AND the master key is unlocked, so remote content
 * is ciphertext (the local vault always stays plaintext). Non-throwing and inert
 * otherwise: with no cached master key (locked / never set up) or no remote
 * manifest (a plaintext connection) the original target is returned unchanged —
 * a fatal protocol violation is handled per cycle by the runner's
 * `guardBeforeCycle`, not here at open. The extra manifest read only happens when
 * a master key is cached, so a normal vault pays no cost.
 */
export async function wrapEncryptedTargetIfActive(
  vaultPath: string,
  target: ISyncTarget
): Promise<ISyncTarget> {
  try {
    const mk = await loadCachedMasterKey(vaultPath);
    if (!mk) return target; // locked or no encryption on this device
    const connectionId = await getActiveConnectionId(vaultPath);
    if (!connectionId) return target;
    const manifestText = await readRemoteManifest(target);
    if (!manifestText) return target; // plaintext connection (no manifest)
    const known = await loadConnectionState(connectionId);
    // Throws on a violation (key mismatch, downgrade, guard too old); caught
    // below so vault-open never breaks — the per-cycle guard then fails closed.
    const decision = evaluateManifestGuard({ manifestText, known, masterKey: mk, guardVersion: GUARD_VERSION });
    if (decision.mode === "strict" || decision.mode === "mixed") {
      return new EncryptingSyncTarget(target, {
        contentKey: mk,
        isStrict: () => decision.mode === "strict",
      });
    }
    return target;
  } catch {
    // A fatal guard violation is surfaced per cycle by DesktopSidebandRunner
    // (guardBeforeCycle throws before any push/pull); at construction we simply
    // do not wrap, and the first cycle then fails closed if the remote really is
    // encrypted.
    return target;
  }
}

/**
 * Composite sideband runner (P1 profile + P3 keyfile + E3 sealed profile + the
 * P4/P5 fail-closed content-E2E guard). `guardBeforeCycle` reads the connection's
 * `encryption.json` before any pull/push and throws FatalSyncProtocolError on a
 * protocol violation (an encrypting/strict manifest we can't decrypt, a
 * key/manifest mismatch, a downgraded manifest for a known-encrypted connection);
 * this ends the cycle before the queue is pushed, fail-closed. `run` transports
 * the keyfile and the (sealed) profile. Steps run under one try/catch each.
 */
class DesktopSidebandRunner implements SettingsSyncRunner {
  constructor(
    private readonly vaultPath: string,
    private readonly connectionId: string | null,
    private readonly keyfileStep: KeyfileSyncStep | null,
    private readonly profileStep: SettingsSyncStep | null
  ) {}

  async guardBeforeCycle(target: ISyncTarget, vault: IVaultAdapter): Promise<void> {
    if (!this.connectionId) return; // no sync connection -> nothing to guard
    const known = await loadConnectionState(this.connectionId);
    let manifestText: string | null;
    try {
      manifestText = await readRemoteManifest(target);
    } catch (e) {
      // A known-encrypted connection must fail closed if we can't read the
      // manifest (an attacker could otherwise block it to force plaintext).
      // For a never-encrypted connection a transient fetch error just proceeds
      // plain and retries next cycle.
      if (known.knownEncrypted) throw e;
      return;
    }
    const mk = await loadCachedMasterKey(this.vaultPath);
    // Locked device on an encrypted connection: pull the PUBLIC keyfile FIRST so
    // the settings can offer "enter passphrase" (unlock), THEN fail closed below.
    // Without this the guard aborts the cycle before the sideband transports the
    // keyfile, so a second device shows "set passphrase" (create) forever.
    if (!mk && manifestText && this.keyfileStep) {
      const shape = safeParseManifest(manifestText);
      if (shape && isEncryptedState(shape.state)) {
        try {
          await this.keyfileStep.run(target, vault);
        } catch {
          // best-effort; the fatal guard below still stops the cycle
        }
        // The keyfile is now local: prompt the user to unlock this device
        // directly (EncryptionUnlockHost), instead of hunting through settings.
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("plainva-encryption-locked", { detail: { vaultPath: this.vaultPath } }));
        }
      }
    }
    // Throws FatalSyncProtocolError on any violation (fail-closed).
    const decision = evaluateManifestGuard({ manifestText, known, masterKey: mk, guardVersion: GUARD_VERSION });
    // Pin the connection as encrypted the first time we see a valid encrypted
    // manifest, so a later missing/downgraded manifest fails closed.
    if (decision.pinEncrypted) {
      await saveConnectionState({ ...known, knownEncrypted: true, expectedKeyId: mk?.keyId });
    }
  }

  async run(target: ISyncTarget, vault: IVaultAdapter): Promise<void> {
    if (this.keyfileStep) await this.keyfileStep.run(target, vault);
    if (this.profileStep) await this.profileStep.run(target, vault);
  }
}

/**
 * Builds the sideband runner for a vault, or null when nothing is engaged.
 * Called during vault open and on the toggle/encryption-changed events. A runner
 * is built whenever the vault has a sync connection (for the fail-closed guard),
 * profile-sync is opted in, or a master key is unlocked.
 */
export async function buildSettingsSyncStep(vaultPath: string): Promise<SettingsSyncRunner | null> {
  const store = await getSettingsStore();
  const profileOn = await isSettingsSyncEnabled(vaultPath, store);
  const mk = await loadCachedMasterKey(vaultPath);
  const connectionId = await getActiveConnectionId(vaultPath);
  if (!profileOn && !mk && !connectionId) return null;

  const deviceId = await getDeviceId(store);
  // Transport the public keyfile whenever this device holds a master key OR has a
  // sync connection — a locked second device needs to PULL the keyfile (which the
  // guard does before failing closed) so it can be unlocked with the passphrase.
  const keyfileStep = mk || connectionId
    ? new KeyfileSyncStep({
        onRemoteKeyfileAdopted: () => {
          if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("plainva-keyfile-arrived"));
        },
      })
    : null;
  // Sync the profile only when opted in; sealed once a master key exists (E3).
  const profileStep = profileOn
    ? new SettingsSyncStep({
        port: createDesktopProfilePort(vaultPath),
        deviceId,
        onAdopted: () => toast.info(i18n.t("settingsSync.adopted")),
        profileCrypto: mk ? profileCryptoFor(mk) : undefined,
      })
    : null;

  return new DesktopSidebandRunner(vaultPath, connectionId, keyfileStep, profileStep);
}
