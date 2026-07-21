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
import { SettingsSyncStep, type ProfileSettingsPort } from "@plainva/core";
import { toast, type ISettingsStore } from "@plainva/ui";
import i18n from "@plainva/ui/i18n";
import { getSettingsStore } from "./settingsStore";
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

/**
 * Builds the sideband sync step for a vault if profile-sync is opted in, else
 * null. Called during vault open to wire it into the SyncWorker.
 */
export async function buildSettingsSyncStep(vaultPath: string): Promise<SettingsSyncStep | null> {
  const store = await getSettingsStore();
  if (!(await isSettingsSyncEnabled(vaultPath, store))) return null;
  const deviceId = await getDeviceId(store);
  return new SettingsSyncStep({
    port: createDesktopProfilePort(vaultPath),
    deviceId,
    onAdopted: () => {
      toast.info(i18n.t("settingsSync.adopted"));
    },
  });
}
