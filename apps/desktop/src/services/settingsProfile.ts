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
  SecretsSyncStep,
  KeyfileSyncStep,
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
  type PimAccountRow,
} from "@plainva/core";
import { parseBookmarksFile, serializeBookmarksFile, toast, type CloudAccountRecord, type ISettingsStore } from "@plainva/ui";
import i18n from "@plainva/ui/i18n";
import { getSettingsStore } from "./settingsStore";
import { loadCachedMasterKey, loadCachedMasterKeys } from "./encryptionSession";
import {
  GUARD_VERSION,
  connectionIdFor,
  loadConnectionState,
  readRemoteManifest,
  saveConnectionState,
} from "./encryptionManifest";
import { cloudAccountsRegistryKey, loadCloudAccounts, saveCloudAccounts } from "./cloudAccounts";
import { getSyncRootFolder } from "./cloudAccountsActions";
import {
  backupMaxAgeDaysKey,
  backupMaxCountKey,
  backupSnapshotIntervalKey,
  backupZipEnabledKey,
  backupZipKeepKey,
} from "./backupPolicy";
import type { PimRuntime } from "./pim/pimRuntime";
import { mailAccountsKey, listMailAccounts, replaceMailAccounts, type MailAccountConfig } from "./mail/mailAccounts";
import { createDesktopSecretsPort } from "./settingsSecrets";

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
const defaultCalendarKey = (v: string) => `defaultCalendar_${b64(v)}`;
const profileUnknownKey = (v: string) => `settingsSyncUnknown_${b64(v)}`;
const profileAccountMapKey = (v: string) => `settingsSyncAccountMap_${b64(v)}`;
const profileImportJournalKey = (v: string) => `settingsSyncImportJournal_${b64(v)}`;
export const secretsSyncEnabledKey = (vaultPath: string) => `secretsSyncEnabled_${b64(vaultPath)}`;

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
  { logical: "defaultCalendar", key: defaultCalendarKey },
  { logical: "backupSnapshotIntervalSeconds", key: backupSnapshotIntervalKey },
  { logical: "backupMaxCountPerFile", key: backupMaxCountKey },
  { logical: "backupMaxAgeDays", key: backupMaxAgeDaysKey },
  { logical: "backupZipEnabled", key: backupZipEnabledKey },
  { logical: "backupZipKeep", key: backupZipKeepKey },
];

export interface DesktopProfileContext {
  pimRuntime?: PimRuntime | null;
  rawVault?: IVaultAdapter | null;
}

export interface ProfileAccountMap {
  pimLocalToLogical: Record<string, string>;
  mailLocalToLogical: Record<string, string>;
}

export async function loadProfileAccountMap(vaultPath: string): Promise<ProfileAccountMap> {
  const store = await getSettingsStore();
  return (await store.get<ProfileAccountMap>(profileAccountMapKey(vaultPath))) ?? { pimLocalToLogical: {}, mailLocalToLogical: {} };
}

export async function isSecretsSyncEnabled(vaultPath: string, store?: ISettingsStore): Promise<boolean> {
  const s = store ?? (await getSettingsStore());
  return (await s.get<boolean>(secretsSyncEnabledKey(vaultPath))) === true;
}

interface ProfilePimSelections {
  calendars: Array<{ accountId: string; id: string; selected: boolean }>;
  taskLists: Array<{ accountId: string; id: string; selected: boolean }>;
}

interface ProfileImportSnapshot {
  fields: Record<string, unknown>;
  unknown?: Record<string, unknown>;
  accountMap?: ProfileAccountMap;
  mailAccounts?: MailAccountConfig[];
  cloudAccounts?: CloudAccountRecord[];
  pimAccounts?: PimAccountRow[];
  pimSelections?: ProfilePimSelections;
  bookmarks?: { existed: boolean; text?: string };
}

interface ProfileImportJournal {
  startedAt: string;
  snapshot: ProfileImportSnapshot;
}

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
export async function exportProfileValues(
  store: ISettingsStore,
  vaultPath: string,
  context: DesktopProfileContext = {}
): Promise<Record<string, unknown>> {
  const preserved = await store.get<Record<string, unknown>>(profileUnknownKey(vaultPath));
  const values: Record<string, unknown> = preserved && typeof preserved === "object" && !Array.isArray(preserved) ? { ...preserved } : {};
  for (const field of PROFILE_FIELDS) {
    const v = await store.get(field.key(vaultPath));
    if (v !== undefined && v !== null) values[field.logical] = v;
    else delete values[field.logical];
  }

  const map = (await store.get<ProfileAccountMap>(profileAccountMapKey(vaultPath))) ?? {
    pimLocalToLogical: {},
    mailLocalToLogical: {},
  };
  if (context.pimRuntime) {
    const pimAccounts = await context.pimRuntime.cache.listAccounts();
    values.pimAccounts = pimAccounts.map((a) => ({ ...a, id: map.pimLocalToLogical[a.id] ?? a.id }));
    const calendars = await context.pimRuntime.cache.listCalendars();
    const taskLists = await context.pimRuntime.cache.listTaskLists();
    values.pimSelections = {
      calendars: calendars.map((c) => ({ accountId: map.pimLocalToLogical[c.accountId] ?? c.accountId, id: c.id, selected: c.selected })),
      taskLists: taskLists.map((l) => ({ accountId: map.pimLocalToLogical[l.accountId] ?? l.accountId, id: l.id, selected: l.selected })),
    } satisfies ProfilePimSelections;
  }
  const rawMailAccounts = await store.get<MailAccountConfig[]>(mailAccountsKey(vaultPath));
  if (Array.isArray(rawMailAccounts)) {
    values.mailAccounts = rawMailAccounts.map((a) => ({ ...a, id: map.mailLocalToLogical[a.id] ?? a.id }));
  }

  const rawCloudAccounts = await store.get<CloudAccountRecord[]>(cloudAccountsRegistryKey(vaultPath));
  if (Array.isArray(rawCloudAccounts)) {
    values.cloudAccounts = rawCloudAccounts.map((record) => ({
      ...record,
      services: {
        ...record.services,
        ...(record.services.calendar
          ? { calendar: { pimAccountId: map.pimLocalToLogical[record.services.calendar.pimAccountId] ?? record.services.calendar.pimAccountId } }
          : {}),
        ...(record.services.mail
          ? { mail: { mailAccountId: map.mailLocalToLogical[record.services.mail.mailAccountId] ?? record.services.mail.mailAccountId } }
          : {}),
      },
    }));
  }

  if (context.rawVault) {
    try {
      const parsed = parseBookmarksFile(await context.rawVault.readTextFile(".plainva/bookmarks.json"));
      if (parsed.existed) values.bookmarks = parsed.paths;
    } catch {
      delete values.bookmarks;
    }
  }
  return values;
}

/**
 * Applies imported values: sets the present keys and DELETES the registry keys
 * absent from the document (reset to default), then fires the live-apply events
 * whose listeners re-read (never re-write) the store — so an import never loops
 * back into an export.
 */
export async function applyProfileValues(
  store: ISettingsStore,
  vaultPath: string,
  values: Record<string, unknown>,
  context: DesktopProfileContext = {}
): Promise<void> {
  validateProfileValues(values);
  await recoverProfileImportIfNeeded(store, vaultPath, context);
  const snapshot = await captureProfileSnapshot(store, vaultPath, context);
  await store.set(profileImportJournalKey(vaultPath), { startedAt: new Date().toISOString(), snapshot } satisfies ProfileImportJournal);
  await store.save();

  try {
    for (const field of PROFILE_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(values, field.logical)) {
        await store.set(field.key(vaultPath), values[field.logical]);
      } else {
        await store.delete(field.key(vaultPath));
      }
    }

    const known = new Set([...PROFILE_FIELDS.map((f) => f.logical), "pimAccounts", "pimSelections", "mailAccounts", "cloudAccounts", "bookmarks"]);
    await store.set(
      profileUnknownKey(vaultPath),
      Object.fromEntries(Object.entries(values).filter(([key]) => !known.has(key)))
    );

    const idMap = await importAccountMetadata(store, vaultPath, values, context.pimRuntime ?? null);
    await importCloudRegistry(vaultPath, values.cloudAccounts, idMap);
    if (context.rawVault && Array.isArray(values.bookmarks)) {
      await context.rawVault.writeTextFile(".plainva/bookmarks.json", serializeBookmarksFile(values.bookmarks as string[]));
    }
    await store.delete(profileImportJournalKey(vaultPath));
    await store.save();
  } catch (error) {
    await restoreProfileSnapshot(store, vaultPath, snapshot, context);
    await store.delete(profileImportJournalKey(vaultPath));
    await store.save();
    throw error;
  }
  // Backup retention/ZIP + mail settings take effect live; the rest is lazy-read
  // on next use (daily/template/task) or on next vault open (sync interval).
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("plainva-backup-settings-changed"));
    window.dispatchEvent(new CustomEvent("plainva-mail-settings-changed"));
    window.dispatchEvent(new CustomEvent("plainva-default-calendar-changed"));
    window.dispatchEvent(new CustomEvent("plainva-cloud-accounts-changed", { detail: { vaultPath } }));
    window.dispatchEvent(new CustomEvent("plainva-bookmarks-changed"));
  }
}

async function captureProfileSnapshot(store: ISettingsStore, vaultPath: string, context: DesktopProfileContext): Promise<ProfileImportSnapshot> {
  const fields: Record<string, unknown> = {};
  for (const field of PROFILE_FIELDS) fields[field.logical] = await store.get(field.key(vaultPath));
  const snapshot: ProfileImportSnapshot = {
    fields,
    unknown: (await store.get(profileUnknownKey(vaultPath))) ?? undefined,
    accountMap: (await store.get(profileAccountMapKey(vaultPath))) ?? undefined,
    mailAccounts: (await store.get(mailAccountsKey(vaultPath))) ?? undefined,
    cloudAccounts: (await store.get(cloudAccountsRegistryKey(vaultPath))) ?? undefined,
  };
  if (context.pimRuntime) {
    snapshot.pimAccounts = await context.pimRuntime.cache.listAccounts();
    snapshot.pimSelections = {
      calendars: (await context.pimRuntime.cache.listCalendars()).map((c) => ({ accountId: c.accountId, id: c.id, selected: c.selected })),
      taskLists: (await context.pimRuntime.cache.listTaskLists()).map((l) => ({ accountId: l.accountId, id: l.id, selected: l.selected })),
    };
  }
  if (context.rawVault) {
    const existed = await context.rawVault.exists(".plainva/bookmarks.json");
    snapshot.bookmarks = { existed, ...(existed ? { text: await context.rawVault.readTextFile(".plainva/bookmarks.json") } : {}) };
  }
  return snapshot;
}

async function restoreProfileSnapshot(store: ISettingsStore, vaultPath: string, snapshot: ProfileImportSnapshot, context: DesktopProfileContext): Promise<void> {
  for (const field of PROFILE_FIELDS) {
    const value = snapshot.fields[field.logical];
    if (value === undefined) await store.delete(field.key(vaultPath));
    else await store.set(field.key(vaultPath), value);
  }
  if (snapshot.unknown === undefined) await store.delete(profileUnknownKey(vaultPath));
  else await store.set(profileUnknownKey(vaultPath), snapshot.unknown);
  if (snapshot.accountMap === undefined) await store.delete(profileAccountMapKey(vaultPath));
  else await store.set(profileAccountMapKey(vaultPath), snapshot.accountMap);
  if (snapshot.mailAccounts === undefined) await store.delete(mailAccountsKey(vaultPath));
  else await store.set(mailAccountsKey(vaultPath), snapshot.mailAccounts);
  if (snapshot.cloudAccounts === undefined) await store.delete(cloudAccountsRegistryKey(vaultPath));
  else await store.set(cloudAccountsRegistryKey(vaultPath), snapshot.cloudAccounts);
  if (context.pimRuntime && snapshot.pimAccounts) {
    const previousIds = new Set(snapshot.pimAccounts.map((a) => a.id));
    for (const current of await context.pimRuntime.cache.listAccounts()) {
      if (!previousIds.has(current.id)) await context.pimRuntime.cache.deleteAccount(current.id);
    }
    for (const account of snapshot.pimAccounts) await context.pimRuntime.cache.upsertAccount(account);
    for (const cal of snapshot.pimSelections?.calendars ?? []) await context.pimRuntime.cache.setCalendarSelected(cal.accountId, cal.id, cal.selected);
    for (const list of snapshot.pimSelections?.taskLists ?? []) await context.pimRuntime.cache.setTaskListSelected(list.accountId, list.id, list.selected);
  }
  if (context.rawVault && snapshot.bookmarks) {
    if (snapshot.bookmarks.existed) await context.rawVault.writeTextFile(".plainva/bookmarks.json", snapshot.bookmarks.text ?? "");
    else if (await context.rawVault.exists(".plainva/bookmarks.json")) await context.rawVault.deleteItem(".plainva/bookmarks.json");
  }
  await store.save();
}

/** Rolls back an import interrupted after its durable journal write. */
export async function recoverProfileImportIfNeeded(store: ISettingsStore, vaultPath: string, context: DesktopProfileContext = {}): Promise<boolean> {
  const journal = await store.get<ProfileImportJournal>(profileImportJournalKey(vaultPath));
  if (!journal?.snapshot?.fields) return false;
  await restoreProfileSnapshot(store, vaultPath, journal.snapshot, context);
  await store.delete(profileImportJournalKey(vaultPath));
  await store.save();
  return true;
}

const PATH_FIELDS = new Set(["dailyNotesFolder", "dailyNoteTemplate", "templateFolder", "taskDatabase", "meetingFolder", "mailFolder"]);
const BOOLEAN_FIELDS = new Set(["extendedDatabases", "mailRemoteImages", "backupZipEnabled"]);
const NUMBER_FIELDS = new Set(["syncIntervalSeconds", "backupSnapshotIntervalSeconds", "backupMaxCountPerFile", "backupMaxAgeDays", "backupZipKeep"]);

function validVaultPath(value: string): boolean {
  if (value === "") return true; // explicit "disabled / use default" setting
  if (value.length > 1024 || value.includes("\0") || value.includes("\\")) return false;
  if (/^(?:[a-z]+:|\/|[A-Za-z]:|\\\\)/.test(value)) return false;
  const parts = value.split("/");
  return !parts.some((part) => part === ".." || part === ".") && parts[0] !== ".plainva";
}

/** Validates the whole incoming projection before the first native write. */
export function validateProfileValues(values: Record<string, unknown>): void {
  if (!values || typeof values !== "object" || Array.isArray(values)) throw new Error("settings profile values are invalid");
  for (const [key, value] of Object.entries(values)) {
    if (PATH_FIELDS.has(key) && (typeof value !== "string" || !validVaultPath(value))) throw new Error(`invalid vault-relative path in ${key}`);
    if (BOOLEAN_FIELDS.has(key) && typeof value !== "boolean") throw new Error(`invalid boolean in ${key}`);
    if (NUMBER_FIELDS.has(key) && (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1_000_000)) {
      throw new Error(`invalid number in ${key}`);
    }
  }
  if (values.bookmarks !== undefined && (!Array.isArray(values.bookmarks) || values.bookmarks.some((p) => typeof p !== "string" || !p || !validVaultPath(p)))) {
    throw new Error("invalid bookmarks in settings profile");
  }
  if (values.pimAccounts !== undefined && !Array.isArray(values.pimAccounts)) throw new Error("invalid PIM account metadata");
  if (values.mailAccounts !== undefined && !Array.isArray(values.mailAccounts)) throw new Error("invalid mail account metadata");
  if (values.cloudAccounts !== undefined && !Array.isArray(values.cloudAccounts)) throw new Error("invalid cloud account registry");
  if (Array.isArray(values.pimAccounts) && values.pimAccounts.some((a) => !validPimAccount(a))) throw new Error("invalid PIM account metadata");
  if (Array.isArray(values.mailAccounts) && values.mailAccounts.some((a) => !validMailAccount(a))) throw new Error("invalid mail account metadata");
  if (Array.isArray(values.cloudAccounts) && values.cloudAccounts.some((a) => !validCloudAccount(a))) throw new Error("invalid cloud account registry");
  const selections = values.pimSelections as Partial<ProfilePimSelections> | undefined;
  for (const selection of [...(selections?.calendars ?? []), ...(selections?.taskLists ?? [])]) {
    if (!selection || typeof selection.accountId !== "string" || typeof selection.id !== "string" || typeof selection.selected !== "boolean") {
      throw new Error("invalid PIM selections");
    }
  }
}

function nextLocalId(preferred: string, used: Set<string>): string {
  if (preferred && !used.has(preferred)) return preferred;
  let id: string;
  do id = globalThis.crypto.randomUUID().slice(0, 12); while (used.has(id));
  return id;
}

function pimIdentity(a: Pick<PimAccountRow, "provider" | "label" | "config">): string {
  const url = typeof a.config.url === "string" ? a.config.url.trim().replace(/\/+$/, "").toLowerCase() : "";
  const user = typeof a.config.user === "string" ? a.config.user.trim().toLowerCase() : "";
  const client = typeof a.config.clientId === "string" ? a.config.clientId.trim().toLowerCase() : "";
  return [a.provider, url, user, client, a.label.trim().toLowerCase()].join("|");
}

function mailIdentity(a: MailAccountConfig): string {
  return [a.kind ?? "imap", a.host.trim().toLowerCase(), a.port, a.user.trim().toLowerCase()].join("|");
}

function validPimAccount(value: unknown): value is PimAccountRow {
  const a = value as PimAccountRow;
  return !!a && typeof a.id === "string" && ["caldav", "google", "microsoft"].includes(a.provider) && typeof a.label === "string" && !!a.config && typeof a.config === "object" && !Array.isArray(a.config);
}

function validMailAccount(value: unknown): value is MailAccountConfig {
  const a = value as MailAccountConfig;
  return !!a && typeof a.id === "string" && typeof a.label === "string" && typeof a.host === "string" && typeof a.user === "string" && Number.isInteger(a.port) && a.port > 0 && a.port <= 65535 && (a.kind === undefined || a.kind === "imap" || a.kind === "microsoft");
}

function validCloudAccount(value: unknown): value is CloudAccountRecord {
  const a = value as CloudAccountRecord;
  return !!a && typeof a.id === "string" && typeof a.family === "string" && typeof a.label === "string" && !!a.services && typeof a.services === "object" && !Array.isArray(a.services);
}

async function importAccountMetadata(
  store: ISettingsStore,
  vaultPath: string,
  values: Record<string, unknown>,
  pimRuntime: PimRuntime | null
): Promise<{ pim: Map<string, string>; mail: Map<string, string> }> {
  const previousMap = (await store.get<ProfileAccountMap>(profileAccountMapKey(vaultPath))) ?? { pimLocalToLogical: {}, mailLocalToLogical: {} };
  const pimMap = new Map<string, string>();
  const mailMap = new Map<string, string>();

  if (pimRuntime && Array.isArray(values.pimAccounts)) {
    const existing = await pimRuntime.cache.listAccounts();
    const used = new Set(existing.map((a) => a.id));
    const selections = values.pimSelections as Partial<ProfilePimSelections> | undefined;
    for (const importedValue of values.pimAccounts) {
      if (!validPimAccount(importedValue)) throw new Error("invalid PIM account in settings profile");
      const imported = importedValue;
      const same = existing.find((a) => pimIdentity(a) === pimIdentity(imported));
      const idCollision = existing.find((a) => a.id === imported.id);
      const localId = same?.id ?? (idCollision && pimIdentity(idCollision) !== pimIdentity(imported) ? nextLocalId(imported.id, used) : imported.id);
      used.add(localId);
      pimMap.set(imported.id, localId);
      const calendarPending = Object.fromEntries((selections?.calendars ?? []).filter((s) => s.accountId === imported.id).map((s) => [s.id, s.selected]));
      const taskPending = Object.fromEntries((selections?.taskLists ?? []).filter((s) => s.accountId === imported.id).map((s) => [s.id, s.selected]));
      const row: PimAccountRow = {
        ...imported,
        id: localId,
        config: {
          ...imported.config,
          ...(Object.keys(calendarPending).length ? { plainvaPendingCalendarSelections: calendarPending } : {}),
          ...(Object.keys(taskPending).length ? { plainvaPendingTaskListSelections: taskPending } : {}),
        },
      };
      await pimRuntime.cache.upsertAccount(row);
      const currentCals = await pimRuntime.cache.listCalendars(localId);
      for (const cal of currentCals) if (Object.prototype.hasOwnProperty.call(calendarPending, cal.id)) await pimRuntime.cache.setCalendarSelected(localId, cal.id, !!calendarPending[cal.id]);
      const currentLists = await pimRuntime.cache.listTaskLists(localId);
      for (const list of currentLists) if (Object.prototype.hasOwnProperty.call(taskPending, list.id)) await pimRuntime.cache.setTaskListSelected(localId, list.id, !!taskPending[list.id]);
    }
  }

  if (Array.isArray(values.mailAccounts)) {
    const existing = await listMailAccounts(vaultPath);
    const used = new Set(existing.map((a) => a.id));
    const importedRows: MailAccountConfig[] = [];
    for (const importedValue of values.mailAccounts) {
      if (!validMailAccount(importedValue)) throw new Error("invalid mail account in settings profile");
      const imported = importedValue;
      const same = existing.find((a) => mailIdentity(a) === mailIdentity(imported));
      const idCollision = existing.find((a) => a.id === imported.id);
      const localId = same?.id ?? (idCollision && mailIdentity(idCollision) !== mailIdentity(imported) ? nextLocalId(imported.id, used) : imported.id);
      used.add(localId);
      mailMap.set(imported.id, localId);
      importedRows.push({ ...imported, id: localId });
    }
    const importedIds = new Set(importedRows.map((a) => a.id));
    await replaceMailAccounts(vaultPath, [...existing.filter((a) => !importedIds.has(a.id)), ...importedRows]);
  }

  const nextMap: ProfileAccountMap = {
    pimLocalToLogical: { ...previousMap.pimLocalToLogical, ...Object.fromEntries([...pimMap].map(([logical, local]) => [local, logical])) },
    mailLocalToLogical: { ...previousMap.mailLocalToLogical, ...Object.fromEntries([...mailMap].map(([logical, local]) => [local, logical])) },
  };
  await store.set(profileAccountMapKey(vaultPath), nextMap);

  const defaultCalendar = values.defaultCalendar;
  if (typeof defaultCalendar === "string" && defaultCalendar.includes(" ")) {
    const [logical, ...rest] = defaultCalendar.split(" ");
    await store.set(defaultCalendarKey(vaultPath), `${pimMap.get(logical) ?? logical} ${rest.join(" ")}`);
  }
  return { pim: pimMap, mail: mailMap };
}

async function importCloudRegistry(
  vaultPath: string,
  value: unknown,
  idMap: { pim: Map<string, string>; mail: Map<string, string> }
): Promise<void> {
  if (!Array.isArray(value)) return;
  const records: CloudAccountRecord[] = [];
  for (const raw of value) {
    const record = raw as CloudAccountRecord;
    if (!record || typeof record.id !== "string" || typeof record.family !== "string" || typeof record.label !== "string" || !record.services || typeof record.services !== "object") {
      throw new Error("invalid cloud account in settings profile");
    }
    records.push({
      ...record,
      services: {
        ...record.services,
        ...(record.services.calendar ? { calendar: { pimAccountId: idMap.pim.get(record.services.calendar.pimAccountId) ?? record.services.calendar.pimAccountId } } : {}),
        ...(record.services.mail ? { mail: { mailAccountId: idMap.mail.get(record.services.mail.mailAccountId) ?? record.services.mail.mailAccountId } } : {}),
      },
    });
  }
  await saveCloudAccounts(vaultPath, records);
}

/** Builds the desktop profile-sync port for a vault. */
export function createDesktopProfilePort(vaultPath: string, context: DesktopProfileContext = {}): ProfileSettingsPort {
  return {
    async exportValues() {
      return exportProfileValues(await getSettingsStore(), vaultPath, context);
    },
    async applyValues(values) {
      await applyProfileValues(await getSettingsStore(), vaultPath, values, context);
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
    private readonly profileStep: SettingsSyncStep | null,
    private readonly secretsStep: SecretsSyncStep | null
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
    const keys = mk ? await loadCachedMasterKeys(this.vaultPath) : undefined;
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
    const decision = evaluateManifestGuard({ manifestText, known, masterKey: mk, masterKeys: keys, guardVersion: GUARD_VERSION });
    // Pin the connection as encrypted the first time we see a valid encrypted
    // manifest, so a later missing/downgraded manifest fails closed.
    if (decision.pinEncrypted) {
      const shape = manifestText ? safeParseManifest(manifestText) : null;
      await saveConnectionState({ ...known, knownEncrypted: true, expectedKeyId: shape?.keyId ?? mk?.keyId });
    }
  }

  async run(target: ISyncTarget, vault: IVaultAdapter): Promise<void> {
    if (this.keyfileStep) await this.keyfileStep.run(target, vault);
    if (this.profileStep) await this.profileStep.run(target, vault);
    if (this.secretsStep) await this.secretsStep.run(target, vault);
  }
}

/**
 * Builds the sideband runner for a vault, or null when nothing is engaged.
 * Called during vault open and on the toggle/encryption-changed events. A runner
 * is built whenever the vault has a sync connection (for the fail-closed guard),
 * profile-sync is opted in, or a master key is unlocked.
 */
export async function buildSettingsSyncStep(vaultPath: string, context: DesktopProfileContext = {}): Promise<SettingsSyncRunner | null> {
  const store = await getSettingsStore();
  await recoverProfileImportIfNeeded(store, vaultPath, context);
  const profileOn = await isSettingsSyncEnabled(vaultPath, store);
  const secretsOn = await isSecretsSyncEnabled(vaultPath, store);
  const mk = await loadCachedMasterKey(vaultPath);
  const connectionId = await getActiveConnectionId(vaultPath);
  if (!profileOn && !secretsOn && !mk && !connectionId) return null;

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
        port: createDesktopProfilePort(vaultPath, context),
        deviceId,
        onAdopted: () => toast.info(i18n.t("settingsSync.adopted")),
        profileCrypto: mk ? profileCryptoFor(mk) : undefined,
      })
    : null;

  const secretsStep = secretsOn && mk && context.pimRuntime
    ? new SecretsSyncStep({ port: createDesktopSecretsPort(vaultPath, context.pimRuntime), masterKey: mk })
    : null;

  return new DesktopSidebandRunner(vaultPath, connectionId, keyfileStep, profileStep, secretsStep);
}
