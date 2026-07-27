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
import {
  cloudRegistryToLogical,
  emptyAccountMap,
  importAccountMetadata as sharedImportAccountMetadata,
  parseBookmarksFile,
  remapCloudRegistry,
  serializeBookmarksFile,
  shouldReportWaitingAccounts,
  toast,
  validCloudAccount,
  validMailAccount,
  validPimAccount,
  type AccountImportPorts,
  type CloudAccountRecord,
  type ISettingsStore,
  type ProfileAccountMap,
  type ProfilePimSelections,
} from "@plainva/ui";
import i18n from "@plainva/ui/i18n";
import { getSettingsStore } from "./settingsStore";
import { hasLocalKeyfile, loadCachedMasterKey, loadCachedMasterKeys } from "./encryptionSession";
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
import { mailAccountsKey, listMailAccounts, replaceMailAccounts, type MailAccountConfig } from "@plainva/ui/mail";
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
  /**
   * Reports records that were dropped as malformed. The port wires this to a
   * toast; keeping it a callback rather than toasting from here leaves the
   * import function pure enough to test.
   */
  onSkipped?: (reasons: string[]) => void;
}

export type { ProfileAccountMap };

export async function loadProfileAccountMap(vaultPath: string): Promise<ProfileAccountMap> {
  const store = await getSettingsStore();
  return (await store.get<ProfileAccountMap>(profileAccountMapKey(vaultPath))) ?? emptyAccountMap();
}

export async function isSecretsSyncEnabled(vaultPath: string, store?: ISettingsStore): Promise<boolean> {
  const s = store ?? (await getSettingsStore());
  return (await s.get<boolean>(secretsSyncEnabledKey(vaultPath))) === true;
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
  if (Array.isArray(rawCloudAccounts)) values.cloudAccounts = cloudRegistryToLogical(rawCloudAccounts, map);

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
  incoming: Record<string, unknown>,
  context: DesktopProfileContext = {}
): Promise<void> {
  const sanitized = sanitizeProfileValues(incoming);
  const values = sanitized.values;
  if (sanitized.skipped.length > 0) {
    // Visible, not silent: this is the class of problem that hid until now.
    console.warn("[settingsProfile] skipped while importing:", sanitized.skipped.join("; "));
    context.onSkipped?.(sanitized.skipped);
  }
  await recoverProfileImportIfNeeded(store, vaultPath, context);
  const snapshot = await captureProfileSnapshot(store, vaultPath, context);
  await store.set(profileImportJournalKey(vaultPath), { startedAt: new Date().toISOString(), snapshot } satisfies ProfileImportJournal);
  await store.save();

  try {
    for (const field of PROFILE_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(values, field.logical)) {
        await store.set(field.key(vaultPath), values[field.logical]);
      } else if (!sanitized.preserve.has(field.logical)) {
        // Absent means "reset to default" — but a value we DROPPED as invalid is
        // not absent, and wiping the local setting over it would turn a foreign
        // formatting mistake into local data loss.
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

/** A cleaned projection plus what had to be left out, and why. */
export interface SanitizedProfile {
  values: Record<string, unknown>;
  /**
   * Logical names that were dropped as INVALID rather than being absent. The
   * caller must not delete these keys: absence normally means "reset to
   * default", and a malformed incoming value is no reason to wipe a working
   * local setting.
   */
  preserve: Set<string>;
  /** Human-readable reasons, for the error surface. */
  skipped: string[];
}

/**
 * Cleans the incoming projection instead of rejecting it wholesale.
 *
 * This used to throw on the first bad field, and `applyProfileValues` called it
 * as its very first statement — so ONE unusable record (a Microsoft mailbox, a
 * Windows path separator that had found its way into a folder setting) silently
 * disabled the entire settings sync: no accounts, no calendar selection, not
 * even the daily-notes folder, on every device and every cycle.
 *
 * A malformed record is now dropped and reported; everything else is applied.
 * Only a structurally impossible document (not an object) is still fatal.
 */
export function sanitizeProfileValues(values: Record<string, unknown>): SanitizedProfile {
  if (!values || typeof values !== "object" || Array.isArray(values)) throw new Error("settings profile values are invalid");
  const out: Record<string, unknown> = { ...values };
  const preserve = new Set<string>();
  const skipped: string[] = [];

  const drop = (key: string, reason: string) => {
    delete out[key];
    preserve.add(key);
    skipped.push(reason);
  };

  for (const [key, value] of Object.entries(values)) {
    if (PATH_FIELDS.has(key) && (typeof value !== "string" || !validVaultPath(value))) drop(key, `invalid vault-relative path in ${key}`);
    else if (BOOLEAN_FIELDS.has(key) && typeof value !== "boolean") drop(key, `invalid boolean in ${key}`);
    else if (NUMBER_FIELDS.has(key) && (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1_000_000)) {
      drop(key, `invalid number in ${key}`);
    }
  }

  if (out.bookmarks !== undefined && (!Array.isArray(out.bookmarks) || out.bookmarks.some((p) => typeof p !== "string" || !p || !validVaultPath(p)))) {
    drop("bookmarks", "invalid bookmarks in settings profile");
  }

  // Account lists: keep the usable rows, name the ones that were left out.
  const filterAccounts = <T,>(key: string, isValid: (v: unknown) => v is T, label: string): void => {
    const raw = out[key];
    if (raw === undefined) return;
    if (!Array.isArray(raw)) {
      drop(key, `invalid ${label}`);
      return;
    }
    const kept = raw.filter((row) => isValid(row));
    if (kept.length !== raw.length) skipped.push(`${raw.length - kept.length} × invalid ${label}`);
    out[key] = kept;
  };
  filterAccounts("pimAccounts", validPimAccount, "PIM account metadata");
  filterAccounts("mailAccounts", validMailAccount, "mail account metadata");
  filterAccounts("cloudAccounts", validCloudAccount, "cloud account registry");

  const selections = out.pimSelections as Partial<ProfilePimSelections> | undefined;
  const validSelection = (s: unknown): boolean =>
    !!s && typeof (s as { accountId?: unknown }).accountId === "string" && typeof (s as { id?: unknown }).id === "string" && typeof (s as { selected?: unknown }).selected === "boolean";
  if (selections && (selections.calendars ?? selections.taskLists)) {
    const calendars = (selections.calendars ?? []).filter(validSelection);
    const taskLists = (selections.taskLists ?? []).filter(validSelection);
    const dropped = (selections.calendars?.length ?? 0) + (selections.taskLists?.length ?? 0) - calendars.length - taskLists.length;
    if (dropped > 0) skipped.push(`${dropped} × invalid PIM selection`);
    out.pimSelections = { calendars, taskLists } satisfies ProfilePimSelections;
  }

  return { values: out, preserve, skipped };
}

/**
 * Desktop side of the shared account import. The judgement (identity matching,
 * id collisions, the map) lives in `@plainva/ui/accountProfile` so the phone
 * runs the SAME code; this only says where the desktop keeps its accounts.
 */
function desktopAccountPorts(store: ISettingsStore, vaultPath: string, pimRuntime: PimRuntime | null): AccountImportPorts {
  return {
    listPimAccounts: async () => (pimRuntime ? pimRuntime.cache.listAccounts() : []),
    upsertPimAccount: async (row) => {
      if (pimRuntime) await pimRuntime.cache.upsertAccount(row);
    },
    listCalendars: async (accountId) => (pimRuntime ? pimRuntime.cache.listCalendars(accountId) : []),
    setCalendarSelected: async (accountId, id, selected) => {
      if (pimRuntime) await pimRuntime.cache.setCalendarSelected(accountId, id, selected);
    },
    listTaskLists: async (accountId) => (pimRuntime ? pimRuntime.cache.listTaskLists(accountId) : []),
    setTaskListSelected: async (accountId, id, selected) => {
      if (pimRuntime) await pimRuntime.cache.setTaskListSelected(accountId, id, selected);
    },
    listMailAccounts: () => listMailAccounts(vaultPath),
    replaceMailAccounts: (accounts) => replaceMailAccounts(vaultPath, accounts),
    loadAccountMap: async () => (await store.get<ProfileAccountMap>(profileAccountMapKey(vaultPath))) ?? emptyAccountMap(),
    saveAccountMap: async (map) => store.set(profileAccountMapKey(vaultPath), map),
  };
}

async function importAccountMetadata(
  store: ISettingsStore,
  vaultPath: string,
  values: Record<string, unknown>,
  pimRuntime: PimRuntime | null
): Promise<{ pim: Map<string, string>; mail: Map<string, string> }> {
  // Without a runtime there is no PIM truth to reconcile against; importing
  // calendars into nothing would strand them. Mail is store-backed and fine.
  const scoped = pimRuntime ? values : { ...values, pimAccounts: undefined, pimSelections: undefined };
  const idMap = await sharedImportAccountMetadata(scoped, desktopAccountPorts(store, vaultPath, pimRuntime));

  const defaultCalendar = values.defaultCalendar;
  if (typeof defaultCalendar === "string" && defaultCalendar.includes(" ")) {
    const [logical, ...rest] = defaultCalendar.split(" ");
    await store.set(defaultCalendarKey(vaultPath), `${idMap.pim.get(logical) ?? logical} ${rest.join(" ")}`);
  }
  return idMap;
}

async function importCloudRegistry(
  vaultPath: string,
  value: unknown,
  idMap: { pim: Map<string, string>; mail: Map<string, string> }
): Promise<void> {
  if (!Array.isArray(value)) return;
  await saveCloudAccounts(vaultPath, remapCloudRegistry(value.filter(validCloudAccount), idMap));
}

/** Builds the desktop profile-sync port for a vault. */
export function createDesktopProfilePort(vaultPath: string, context: DesktopProfileContext = {}): ProfileSettingsPort {
  const withReporting: DesktopProfileContext = {
    ...context,
    onSkipped: context.onSkipped ?? ((reasons) => toast.warning(i18n.t("settingsSync.partialImport", { details: reasons.join("; ") }))),
  };
  return {
    async exportValues() {
      return exportProfileValues(await getSettingsStore(), vaultPath, withReporting);
    },
    async applyValues(values) {
      await applyProfileValues(await getSettingsStore(), vaultPath, values, withReporting);
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
    private readonly steps: DesktopSidebandSteps
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
    // Decided PER CYCLE, not once when the vault opened — the same fix the phone
    // already carries. Unlocking the passphrase, flipping a switch or a keyfile
    // that only just arrived used to need a restart before they were noticed,
    // and the crypto choice (sealed vs plaintext) froze for the whole session.
    const profile = await this.steps.profile(vault);
    if (profile) {
      try {
        await profile.run(target, vault);
      } catch (error) {
        // Rethrown, so the cycle behaves exactly as before — but no longer in
        // silence: the worker only console.errors this, which is why a settings
        // sync that transported nothing for days looked like a working one.
        const message = error instanceof Error ? error.message : String(error);
        if (shouldReportWaitingAccounts(`profile-error:${this.vaultPath}`, [message])) {
          toast.error(i18n.t("settingsSync.profileFailed", { error: message }));
        }
        throw error;
      }
    }
    // A refused secret must not take the rest down with it, and it must not be
    // invisible either — the worker only console.errors, so until now a rejected
    // credential import looked exactly like "nothing happens". Mobile has had
    // this toast; the desktop had neither the catch nor the message.
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

/** Vaults whose "locked, so settings stay put" notice has already been shown. */
const lockedProfileNotified = new Set<string>();

/** Says once per session why the settings are not moving on this device. */
function reportProfileLocked(vaultPath: string): void {
  if (lockedProfileNotified.has(vaultPath)) return;
  lockedProfileNotified.add(vaultPath);
  toast.info(i18n.t("settingsSync.lockedHere"));
}

/** The two optional steps, rebuilt for every cycle (see `run` above). */
interface DesktopSidebandSteps {
  profile(raw: IVaultAdapter): Promise<SettingsSyncStep | null>;
  secrets(): Promise<SecretsSyncStep | null>;
}

/**
 * Builds the per-cycle steps for a vault.
 *
 * The locked-device guard is the important part: with a keyfile in the vault the
 * profile is sealed, so a device that cannot seal must NOT write the plaintext
 * variant beside it. Doing so created two competing files that never saw each
 * other — the sealed devices ignored the plaintext one, the locked ones ignored
 * the sealed one, and nothing converged on either side (device report
 * 2026-07-27, five devices, both files present for two days). The phone has
 * refused this since 2026-07-26; the desktop did not.
 */
function desktopSidebandSteps(vaultPath: string, deviceId: string, context: DesktopProfileContext): DesktopSidebandSteps {
  return {
    async profile(raw: IVaultAdapter): Promise<SettingsSyncStep | null> {
      if (!(await isSettingsSyncEnabled(vaultPath))) return null;
      const mk = await loadCachedMasterKey(vaultPath);
      if (!mk && (await hasLocalKeyfile(raw))) {
        // Say it once per session instead of syncing nothing in silence.
        reportProfileLocked(vaultPath);
        return null;
      }
      return new SettingsSyncStep({
        port: createDesktopProfilePort(vaultPath, context),
        deviceId,
        onAdopted: () => toast.info(i18n.t("settingsSync.adopted")),
        profileCrypto: mk ? profileCryptoFor(mk) : undefined,
      });
    },
    async secrets(): Promise<SecretsSyncStep | null> {
      // E2: secrets ride ON the profile. A credential can only be placed on an
      // account this device knows, and the accounts arrive with the profile —
      // running without it produced a toast every cycle asking for something
      // that was already switched on.
      if (!(await isSettingsSyncEnabled(vaultPath))) return null;
      if (!(await isSecretsSyncEnabled(vaultPath))) return null;
      const mk = await loadCachedMasterKey(vaultPath);
      if (!mk || !context.pimRuntime) return null;
      return new SecretsSyncStep({
        port: createDesktopSecretsPort(vaultPath, context.pimRuntime),
        masterKey: mk,
        // Not an error: the account simply has not arrived here yet. Reported
        // once per changed set — it used to fire on every cycle (~30s), because
        // a skipped entry never changes the local view that triggers it.
        onUnknownAccounts: (ids) => {
          if (shouldReportWaitingAccounts(vaultPath, ids)) {
            toast.info(i18n.t("settingsSync.secretsWaiting", { count: ids.length }));
          }
        },
      });
    },
  };
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

  return new DesktopSidebandRunner(vaultPath, connectionId, keyfileStep, desktopSidebandSteps(vaultPath, deviceId, context));
}
