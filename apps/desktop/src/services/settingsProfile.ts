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
  SecretPolicyError,
} from "@plainva/core";
import {
  cloudRegistryToLogical,
  shouldAnnounceProfileImport,
  pimAccountsForProfile,
  pimSelectionsForProfile,
  mailAccountsForProfile,
  normalizeAccountMap,
  rememberRemovedAccount,
  removedAccountsForProfile,
  importAccountMetadata as sharedImportAccountMetadata,
  parseBookmarksFile,
  serializeBookmarksFile,
  forgetReportedOnce,
  shouldReportOnce,
  shouldReportWaitingAccounts,
  toast,
  validCloudAccount,
  validMailAccount,
  validPimAccount,
  emptyDiagnostics,
  isMemberProfileField as isMemberProfileFieldShared,
  normalizeSyncDiagnostics,
  noteSettingsSyncFailure,
  type SettingsSyncFailure,
  clearLegacyClient,
  recordLegacyClient,
  type LegacyClientDiagnosticReason,
  recordProfileExchange,
  recordSecretsError,
  recordSecretsResult,
  recordSkipped,
  canonicalizeProfileValues,
  deviceLocalPimConfig,
  emptyAccountMap,
  storeBackedFields,
  type AccountImportPorts,
  type CloudAccountRecord,
  type ISettingsStore,
  type ProfileAccountMap,
  type ProfilePimSelections,
  type ProfileScope,
  type SyncDiagnostics,
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
import { clearPimCredentials } from "./pim/pimCredentials";
import { getSyncRootFolder } from "./cloudAccountsActions";
import {
  backupMaxAgeDaysKey,
  backupMaxCountKey,
  backupSnapshotIntervalKey,
  backupZipEnabledKey,
  backupZipKeepKey,
} from "./backupPolicy";
import type { PimRuntime } from "./pim/pimRuntime";
import { mailAccountsKey, mailSecretKey, listMailAccounts, replaceMailAccounts, type MailAccountConfig } from "@plainva/ui/mail";
import { createDesktopSecretsPort } from "./settingsSecrets";
import { pimSecretKey } from "./pim/pimCredentials";
import { BAR_LAYOUT_CHANGED_EVENT, barLayoutKey } from "@plainva/ui";
import { recoverDesktopAccountRepair, repairDesktopAccounts } from "./accountRepair";

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
const folderTemplatesKey = (v: string) => `folderTemplates_${b64(v)}`;
const typeTemplatesKey = (v: string) => `typeTemplates_${b64(v)}`;
const inboxFolderKey = (v: string) => `inboxFolder_${b64(v)}`;
const attachmentFolderKey = (v: string) => `attachmentFolder_${b64(v)}`;
const textFileExtensionsKey = (v: string) => `textFileExtensions_${b64(v)}`;
const defaultNoteTypeKey = (v: string) => `defaultNoteType_${b64(v)}`;
const taskDatabaseKey = (v: string) => `taskDatabase_${b64(v)}`;
const extendedDatabasesKey = (v: string) => `extendedDatabases_${b64(v)}`;
const meetingFolderKey = (v: string) => `meetingFolder_${b64(v)}`;
export const calendarOverlaysKey = (v: string) => `calendarOverlays_${b64(v)}`;
const mailFolderKey = (v: string) => `mailFolder_${b64(v)}`;
const mailRemoteImagesKey = (v: string) => `mailRemoteImages_${b64(v)}`;
/** Snoozed messages (S22) — one list per vault, per member. */
export const mailSnoozedKey = (v: string) => `mailSnoozed_${b64(v)}`;
const syncIntervalKey = (v: string) => `syncIntervalSeconds_${b64(v)}`;
const defaultCalendarKey = (v: string) => `defaultCalendar_${b64(v)}`;
const profileUnknownKey = (v: string) => `settingsSyncUnknown_${b64(v)}`;
const profileAccountMapKey = (v: string) => `settingsSyncAccountMap_${b64(v)}`;
const profileImportJournalKey = (v: string) => `settingsSyncImportJournal_${b64(v)}`;
export const secretsSyncEnabledKey = (vaultPath: string) => `secretsSyncEnabled_${b64(vaultPath)}`;

/** What a vault should do about carrying credentials (E5). */
export type SecretsSyncStance =
  /** Freshly encrypted and never asked: start with credentials travelling. */
  | "enable-by-default"
  /** Encrypted, ready, never asked: put the question on screen. */
  | "ask"
  /** Already answered, or not ready to answer — say nothing. */
  | "leave-alone";

/**
 * E5, as one rule rather than two conditions scattered across a screen.
 *
 * The distinction that matters is `undefined` versus `false`: "never asked" is
 * not "switched off". Getting that wrong in either direction is bad in a way
 * nobody sees — treat "never asked" as off and every further device stays in
 * "account here, sign-in missing" (the pain that started this plan); treat it
 * as on and an existing vault silently starts moving passwords into the user's
 * cloud, which is a change of behaviour that deserves a question.
 *
 * A vault only gets asked once it COULD act on the answer: the accounts have to
 * travel (step 1) and the key has to be unlocked (step 2), because a password
 * can only reach an account this device knows and the bundle is sealed with
 * that key. Pure.
 */
export function secretsSyncStance(
  stored: boolean | undefined,
  opts: { freshlyEncrypted: boolean; unlocked: boolean; settingsSync: boolean }
): SecretsSyncStance {
  if (stored !== undefined) return "leave-alone";
  if (opts.freshlyEncrypted) return "enable-by-default";
  return opts.unlocked && opts.settingsSync ? "ask" : "leave-alone";
}
/** What the settings sync last did on THIS device, per vault (P1/S10). */
export const syncDiagnosticsKey = (vaultPath: string) => `syncDiagnostics_${b64(vaultPath)}`;

/** Per-vault opt-in: sync this vault's settings through `.plainva/sync/settings.json`. */
export const settingsSyncEnabledKey = (vaultPath: string) => `settingsSyncEnabled_${b64(vaultPath)}`;
/**
 * The user's confirmation that every device is up to date, waiting for a cycle
 * to act on it (P7). Retired entries can only be removed where the sync target
 * and the raw vault adapter exist, and that is not the settings page.
 */
/**
 * Notes that a shared account was deleted on this device, so the next profile
 * import does not put it back (P2, Stufe A — local only).
 */
export async function noteAccountRemovedLocally(
  vaultPath: string,
  kind: "pim" | "mail",
  localId: string,
): Promise<void> {
  const store = await getSettingsStore();
  const map = normalizeAccountMap(await store.get<ProfileAccountMap>(profileAccountMapKey(vaultPath)));
  const next = rememberRemovedAccount(map, kind, localId);
  if (next === map) return;
  await store.set(profileAccountMapKey(vaultPath), next);
  await store.save();
}

export const legacyCleanupRequestedKey = (vaultPath: string) => `secretsLegacyCleanup_${b64(vaultPath)}`;
/**
 * Keyed on the vault, so cleaning up here re-arms the notice for this vault only.
 *
 * TWO keys, one per finding: they used to share one, and `shouldReportOnce`
 * remembers a FINGERPRINT — so the retired-entries notice and the older-profile
 * notice overwrote each other's fingerprint and both kept firing, cycle after
 * cycle, for conditions the user had long acted on (finding 2026-08-19).
 */
export const legacySecretsNoticeKey = (vaultPath: string) => `legacyPublisher_${b64(vaultPath)}`;
export const legacyProfileNoticeKey = (vaultPath: string) => `legacyProfileNotice_${b64(vaultPath)}`;

/** Asks the next sync cycle to drop the retired entries from the document. */
export async function requestLegacySecretsCleanup(vaultPath: string): Promise<void> {
  const store = await getSettingsStore();
  await store.set(legacyCleanupRequestedKey(vaultPath), true);
  await store.save();
}
/** Global stable device id (LWW tiebreak + "settings from device X" notice). */
export const DEVICE_ID_KEY = "deviceId";

/**
 * Who a setting belongs to. Definition and the per-field assignment now live in
 * the shared catalog (`@plainva/ui`, profileFields.ts); re-exported here so the
 * existing importers of this module keep working.
 */
export type { ProfileScope };

/** A syncable setting: logical name (device-independent) ↔ device-local store key. */
interface ProfileField {
  logical: string;
  key: (vaultPath: string) => string;
  scope: ProfileScope;
}

/**
 * Where this device keeps each syncable setting. WHICH settings sync is decided
 * by the shared catalog (`PROFILE_FIELDS` in `@plainva/ui`) — this map only says
 * which local store key holds the value, because the key embeds the absolute
 * vault path and is therefore device-specific by nature. A catalog entry
 * without a key here fails at module load rather than silently not syncing.
 */
const DESKTOP_KEYS: Record<string, (vaultPath: string) => string> = {
  dailyNotesFolder: dailyNotesFolderKey,
  dailyNotesFormat: dailyNotesFormatKey,
  dailyNoteTemplate: dailyNoteTemplateKey,
  dailyNoteType: dailyNoteTypeKey,
  templateFolder: templateFolderKey,
  folderTemplates: folderTemplatesKey,
  typeTemplates: typeTemplatesKey,
  inboxFolder: inboxFolderKey,
  attachmentFolder: attachmentFolderKey,
  defaultNoteType: defaultNoteTypeKey,
  taskDatabase: taskDatabaseKey,
  textFileExtensions: textFileExtensionsKey,
  extendedDatabases: extendedDatabasesKey,
  meetingFolder: meetingFolderKey,
  calendarOverlays: calendarOverlaysKey,
  mailFolder: mailFolderKey,
  mailRemoteImages: mailRemoteImagesKey,
  mailSnoozed: mailSnoozedKey,
  syncIntervalSeconds: syncIntervalKey,
  defaultCalendar: defaultCalendarKey,
  backupSnapshotIntervalSeconds: backupSnapshotIntervalKey,
  backupMaxCountPerFile: backupMaxCountKey,
  backupMaxAgeDays: backupMaxAgeDaysKey,
  backupZipEnabled: backupZipEnabledKey,
  backupZipKeep: backupZipKeepKey,
  barLayoutRibbon: (v) => barLayoutKey("ribbon", v),
  barLayoutLeftTabs: (v) => barLayoutKey("leftTabs", v),
  barLayoutLeftSections: (v) => barLayoutKey("leftSections", v),
  barLayoutRightSections: (v) => barLayoutKey("rightSections", v),
  barLayoutMobileBar: (v) => barLayoutKey("mobileBar", v),
};

/**
 * Built on first use, never at module load.
 *
 * `storeBackedFields` reads a module constant that lives in another bundle
 * chunk, and running that read while this module initialises means depending
 * on the order rolldown happens to pick. It picked wrong the moment a new
 * import edge appeared, and the production bundle died on module init with
 * "Cannot read properties of undefined (reading 'filter')" — the same shape
 * that made v0.3.0 start into a white window. Dev and every unit test stayed
 * green; only the prod smoke saw it.
 */
let profileFieldsCache: ProfileField[] | null = null;
function profileFields(): ProfileField[] {
  if (!profileFieldsCache) {
    profileFieldsCache = storeBackedFields("desktop").map((f) => {
      const key = DESKTOP_KEYS[f.logical];
      if (!key) throw new Error(`no desktop store key for profile field "${f.logical}"`);
      return { logical: f.logical, key, scope: f.scope };
    });
  }
  return profileFieldsCache;
}

/**
 * Whether a logical field belongs to the signed-in member rather than the
 * vault — the shared catalog decides, including the fields that come from their
 * own sources (accounts, bookmarks).
 */
export function isMemberProfileField(logical: string): boolean {
  return isMemberProfileFieldShared(logical);
}

export interface DesktopProfileContext {
  pimRuntime?: PimRuntime | null;
  rawVault?: IVaultAdapter | null;
  /**
   * The signed-in member of an encrypted workspace. Present only there; without
   * it the profile stays one shared file, which is the single-person case.
   */
  memberId?: string | null;
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
  return normalizeAccountMap(await store.get<ProfileAccountMap>(profileAccountMapKey(vaultPath)));
}

export async function loadSyncDiagnostics(vaultPath: string, store?: ISettingsStore): Promise<SyncDiagnostics> {
  const s = store ?? (await getSettingsStore());
  return normalizeSyncDiagnostics(
    (await s.get<SyncDiagnostics>(syncDiagnosticsKey(vaultPath))) ?? emptyDiagnostics(),
  );
}

/**
 * Serializes per-vault report writes. Profile completion, secret results and a
 * legacy warning can arrive back-to-back; losing any one of them would make
 * this diagnostic misleading again.
 */
const diagnosticsUpdateQueues = new Map<string, Promise<void>>();

async function updateDiagnostics(vaultPath: string, reduce: (d: SyncDiagnostics) => SyncDiagnostics): Promise<void> {
  const previous = diagnosticsUpdateQueues.get(vaultPath) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(async () => {
    try {
      const store = await getSettingsStore();
      await store.set(syncDiagnosticsKey(vaultPath), reduce(await loadSyncDiagnostics(vaultPath, store)));
      await store.save();
      window.dispatchEvent(new CustomEvent(SYNC_DIAGNOSTICS_EVENT, { detail: { vaultPath } }));
    } catch {
      // A diagnostics write must never take the sync down with it.
    }
  });
  diagnosticsUpdateQueues.set(vaultPath, next);
  await next;
  if (diagnosticsUpdateQueues.get(vaultPath) === next) diagnosticsUpdateQueues.delete(vaultPath);
}

/** Fired after the record changed, so an open settings page can re-read it. */
export const SYNC_DIAGNOSTICS_EVENT = "plainva-sync-diagnostics";

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

/**
 * Whether this vault's settings travel with it. ON unless the user switched it
 * off (maintainer decision 2026-08-24) — settings and account METADATA are not
 * secrets, and a second device that has to be told every preference by hand is
 * a second device that drifts. What stays opt-in is step 3 of the chain, the
 * one that carries sign-ins; that flag keeps its `=== true`.
 *
 * `!== false`, not `?? true`: an absent value means "never asked", a stored
 * `false` means "switched off", and only the first may be turned on by an
 * update. Same distinction `secretsSyncStance` draws above — the alternative
 * would be a device whose owner deliberately silenced it starting to exchange
 * settings again after installing a new version.
 */
export async function isSettingsSyncEnabled(vaultPath: string, store?: ISettingsStore): Promise<boolean> {
  const s = store ?? (await getSettingsStore());
  return (await s.get<boolean>(settingsSyncEnabledKey(vaultPath))) !== false;
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
  for (const field of profileFields()) {
    const v = await store.get(field.key(vaultPath));
    if (v !== undefined && v !== null) values[field.logical] = v;
    else delete values[field.logical];
  }

  const map = normalizeAccountMap(await store.get<ProfileAccountMap>(profileAccountMapKey(vaultPath)));
  // The shared helpers decide the SHAPE (deterministic order, no parked device
  // state) so both shells publish the same document for the same accounts —
  // that is what makes the export round-trip.
  if (context.pimRuntime) {
    values.pimAccounts = pimAccountsForProfile(await context.pimRuntime.cache.listAccounts(), map);
    values.pimSelections = pimSelectionsForProfile(
      await context.pimRuntime.cache.listCalendars(),
      await context.pimRuntime.cache.listTaskLists(),
      map
    );
  }
  const rawMailAccounts = await store.get<MailAccountConfig[]>(mailAccountsKey(vaultPath));
  if (Array.isArray(rawMailAccounts)) values.mailAccounts = mailAccountsForProfile(rawMailAccounts, map);

  const rawCloudAccounts = await store.get<CloudAccountRecord[]>(cloudAccountsRegistryKey(vaultPath));
  if (Array.isArray(rawCloudAccounts)) values.cloudAccounts = cloudRegistryToLogical(rawCloudAccounts, map);

  // Deletions travel with the document, or they only ever hold on the device
  // that made them (E1). The union already happened on import, which is what
  // keeps the grow-only set from losing another device's entries.
  const removed = removedAccountsForProfile(map, undefined);
  if (Object.keys(removed).length) values.removedAccounts = removed;

  if (context.rawVault) {
    try {
      const parsed = parseBookmarksFile(await context.rawVault.readTextFile(".plainva/bookmarks.json"));
      if (parsed.existed) values.bookmarks = parsed.paths;
    } catch {
      delete values.bookmarks;
    }
  }
  return canonicalizeProfileValues(values);
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
  const values = canonicalizeProfileValues(sanitized.values);
  if (sanitized.skipped.length > 0) {
    // Visible, not silent: this is the class of problem that hid until now.
    console.warn("[settingsProfile] skipped while importing:", sanitized.skipped.join("; "));
    context.onSkipped?.(sanitized.skipped);
  }
  // Also on the record, not only in a toast that is gone a moment later: a
  // refused field is the difference between "nothing arrived" and "something
  // arrived and could not be used".
  await updateDiagnostics(vaultPath, (d) => recordSkipped(d, new Date().toISOString(), sanitized.skipped));
  await recoverDesktopAccountRepair(store, vaultPath, profileAccountMapKey(vaultPath));
  await recoverProfileImportIfNeeded(store, vaultPath, context);
  const snapshot = await captureProfileSnapshot(store, vaultPath, context);
  await store.set(profileImportJournalKey(vaultPath), { startedAt: new Date().toISOString(), snapshot } satisfies ProfileImportJournal);
  await store.save();

  try {
    for (const field of profileFields()) {
      if (Object.prototype.hasOwnProperty.call(values, field.logical)) {
        await store.set(field.key(vaultPath), values[field.logical]);
      } else if (!sanitized.preserve.has(field.logical)) {
        // Absent means "reset to default" — but a value we DROPPED as invalid is
        // not absent, and wiping the local setting over it would turn a foreign
        // formatting mistake into local data loss.
        await store.delete(field.key(vaultPath));
      }
    }

    const known = new Set([...profileFields().map((f) => f.logical), "pimAccounts", "pimSelections", "mailAccounts", "cloudAccounts", "bookmarks"]);
    await store.set(
      profileUnknownKey(vaultPath),
      Object.fromEntries(Object.entries(values).filter(([key]) => !known.has(key)))
    );

    await importAccountMetadata(store, vaultPath, values, context.pimRuntime ?? null);
    await repairDesktopAccounts(store, vaultPath, profileAccountMapKey(vaultPath));
    if (context.rawVault && !sanitized.preserve.has("bookmarks")) {
      if (Array.isArray(values.bookmarks)) {
        await context.rawVault.writeTextFile(".plainva/bookmarks.json", serializeBookmarksFile(values.bookmarks as string[]));
      } else if (await context.rawVault.exists(".plainva/bookmarks.json")) {
        await context.rawVault.deleteItem(".plainva/bookmarks.json");
      }
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
    window.dispatchEvent(new CustomEvent(BAR_LAYOUT_CHANGED_EVENT));
  }
}

async function captureProfileSnapshot(store: ISettingsStore, vaultPath: string, context: DesktopProfileContext): Promise<ProfileImportSnapshot> {
  const fields: Record<string, unknown> = {};
  for (const field of profileFields()) fields[field.logical] = await store.get(field.key(vaultPath));
  const accountMap = emptyAccountMap();
  const mailAccounts = await store.get<MailAccountConfig[]>(mailAccountsKey(vaultPath));
  const cloudAccounts = await store.get<CloudAccountRecord[]>(cloudAccountsRegistryKey(vaultPath));
  const snapshot: ProfileImportSnapshot = {
    fields,
    unknown: (await store.get(profileUnknownKey(vaultPath))) ?? undefined,
    accountMap: (await store.get(profileAccountMapKey(vaultPath))) ?? undefined,
    mailAccounts: Array.isArray(mailAccounts)
      ? mailAccountsForProfile(mailAccounts, accountMap) as MailAccountConfig[]
      : undefined,
    cloudAccounts: Array.isArray(cloudAccounts)
      ? cloudRegistryToLogical(cloudAccounts, accountMap) as CloudAccountRecord[]
      : undefined,
  };
  if (context.pimRuntime) {
    snapshot.pimAccounts = pimAccountsForProfile(
      await context.pimRuntime.cache.listAccounts(),
      accountMap,
    );
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
  for (const field of profileFields()) {
    const value = snapshot.fields[field.logical];
    if (value === undefined) await store.delete(field.key(vaultPath));
    else await store.set(field.key(vaultPath), value);
  }
  if (snapshot.unknown === undefined) await store.delete(profileUnknownKey(vaultPath));
  else await store.set(profileUnknownKey(vaultPath), snapshot.unknown);
  if (snapshot.accountMap === undefined) await store.delete(profileAccountMapKey(vaultPath));
  else await store.set(profileAccountMapKey(vaultPath), snapshot.accountMap);
  if (snapshot.mailAccounts === undefined) {
    await store.delete(mailAccountsKey(vaultPath));
  } else {
    const currentMail = await store.get<MailAccountConfig[]>(mailAccountsKey(vaultPath));
    const currentById = new Map((currentMail ?? []).map((account) => [account.id, account]));
    await store.set(mailAccountsKey(vaultPath), snapshot.mailAccounts.map((account) => {
      const local = currentById.get(account.id);
      return {
        ...account,
        ...(local?.clientId !== undefined ? { clientId: local.clientId } : {}),
      };
    }));
  }
  if (snapshot.cloudAccounts === undefined) {
    await store.delete(cloudAccountsRegistryKey(vaultPath));
  } else {
    const currentCloud = await store.get<CloudAccountRecord[]>(cloudAccountsRegistryKey(vaultPath));
    const currentById = new Map((currentCloud ?? []).map((account) => [account.id, account]));
    await store.set(cloudAccountsRegistryKey(vaultPath), snapshot.cloudAccounts.map((account) => {
      const local = currentById.get(account.id);
      return {
        ...account,
        ...(local?.byoClientId !== undefined ? { byoClientId: local.byoClientId } : {}),
      };
    }));
  }
  if (context.pimRuntime && snapshot.pimAccounts) {
    const currentAccounts = await context.pimRuntime.cache.listAccounts();
    const currentById = new Map(currentAccounts.map((account) => [account.id, account]));
    const previousIds = new Set(snapshot.pimAccounts.map((a) => a.id));
    for (const current of currentAccounts) {
      if (!previousIds.has(current.id)) await context.pimRuntime.cache.deleteAccount(current.id);
    }
    for (const account of snapshot.pimAccounts) {
      await context.pimRuntime.cache.upsertAccount({
        ...account,
        config: {
          ...account.config,
          ...deviceLocalPimConfig(currentById.get(account.id)?.config ?? {}),
        },
      });
    }
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

/**
 * A template rule from another device: both halves must be vault-relative, and
 * the template has to be a real file reference. An unfinished rule (empty
 * template) is legitimate — it is a row someone started — and travels along.
 */
function validFolderTemplateRule(value: unknown): value is { folder: string; template: string } {
  if (!value || typeof value !== "object") return false;
  const { folder, template } = value as { folder?: unknown; template?: unknown };
  if (typeof folder !== "string" || typeof template !== "string") return false;
  return validVaultPath(folder) && validVaultPath(template);
}

function validTypeTemplateRule(value: unknown): value is { type: string; template: string } {
  if (!value || typeof value !== "object") return false;
  const { type, template } = value as { type?: unknown; template?: unknown };
  if (typeof type !== "string" || typeof template !== "string") return false;
  return type.length <= 200 && validVaultPath(template);
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

  // Template rules carry vault-relative paths, so an incoming profile gets the
  // same path check every other path field gets — a rule pointing outside the
  // vault would otherwise arrive from another device unchecked.
  filterAccounts("folderTemplates", validFolderTemplateRule, "folder template rule");
  filterAccounts("typeTemplates", validTypeTemplateRule, "type template rule");

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
    deletePimAccount: async (accountId) => {
      if (pimRuntime) await pimRuntime.cache.deleteAccount(accountId);
      await clearPimCredentials(vaultPath, accountId).catch(() => {});
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
    listCloudAccounts: () => loadCloudAccounts(vaultPath),
    replaceCloudAccounts: (accounts) => saveCloudAccounts(vaultPath, accounts),
    pimSecretSlot: (accountId) => pimSecretKey(vaultPath, accountId),
    mailSecretSlot: (accountId) => mailSecretKey(vaultPath, accountId),
    loadAccountMap: async () => normalizeAccountMap(await store.get<ProfileAccountMap>(profileAccountMapKey(vaultPath))),
    saveAccountMap: async (map) => store.set(profileAccountMapKey(vaultPath), map),
  };
}

async function importAccountMetadata(
  store: ISettingsStore,
  vaultPath: string,
  values: Record<string, unknown>,
  pimRuntime: PimRuntime | null
): Promise<{ pim: Map<string, string>; mail: Map<string, string>; cloud: Map<string, string> }> {
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

/** Builds the desktop profile-sync port for a vault. */
export function createDesktopProfilePort(vaultPath: string, context: DesktopProfileContext = {}): ProfileSettingsPort {
  const withReporting: DesktopProfileContext = {
    ...context,
    onSkipped: context.onSkipped ?? ((reasons) => toast.warning(i18n.t("settingsSync.partialImport", { details: reasons.join("; ") }))),
  };
  return {
    normalizeValues: canonicalizeProfileValues,
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
        // silence, and no longer as an alarm either (finding 2026-08-21). The
        // desktop had the identical "every throw is red" path as the phone, so
        // it gets the identical fix, from the same shared decision maker: a
        // dropped request waits, a revoked sign-in is red at once, and the
        // "already said" flag lives in the durable record.
        let failure: SettingsSyncFailure | null = null;
        await updateDiagnostics(this.vaultPath, (d) => {
          const outcome = noteSettingsSyncFailure(d, new Date().toISOString(), error);
          failure = outcome.failure;
          return outcome.diagnostics;
        });
        if (failure && (failure as SettingsSyncFailure).announce) {
          toast.error(i18n.t("settingsSync.profileFailed", { error: (failure as SettingsSyncFailure).message }));
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
        const reason = error instanceof SecretPolicyError ? "invalid-or-unreadable-bundle" : "sync-failed";
        await updateDiagnostics(this.vaultPath, (d) => recordSecretsError(d, new Date().toISOString(), reason));
        toast.error(i18n.t("settingsSync.secretsFailedSafe"));
      }
      // Retired entries are removable, but only from a cycle: the cleanup needs
      // the sync target and the raw vault adapter, and only here do both exist.
      // The settings page therefore leaves a REQUEST behind (P7) — it is the
      // user's confirmation that every device is up to date, carried to the one
      // place that can act on it.
      await this.runLegacyCleanupIfRequested(secrets, target, vault);
    }
  }

  private async runLegacyCleanupIfRequested(
    secrets: SecretsSyncStep,
    target: ISyncTarget,
    vault: IVaultAdapter,
  ): Promise<void> {
    const store = await getSettingsStore();
    if ((await store.get<boolean>(legacyCleanupRequestedKey(this.vaultPath))) !== true) return;
    // Cleared FIRST: a failing cleanup must not retry itself on every cycle
    // behind the user's back — it rewrites the shared document.
    await store.delete(legacyCleanupRequestedKey(this.vaultPath));
    await store.save();
    try {
      const result = await secrets.cleanupLegacyEntries(target, vault, { allDevicesUpdated: true });
      if (!result.documentRead) {
        // Third outcome, and the one that used to hide inside "nothing to
        // remove": there was no shared document to look into. Nothing was
        // proven, so nothing is cleared — the warning stays and the user can
        // try again once the sync has run.
        toast.warning(i18n.t("settingsSync.legacyEntriesCleanupUnread"));
        return;
      }
      // Only now is the absence OBSERVED: drop the finding and re-arm the
      // notice so it can speak again if it ever comes back.
      await updateDiagnostics(this.vaultPath, (d) => clearLegacyClient(d, "legacy-google-client-entry"));
      await forgetReportedOnce(legacySecretsNoticeKey(this.vaultPath));
      toast.info(
        result.removed > 0
          ? i18n.t("settingsSync.legacyEntriesCleanupDone", { count: result.removed })
          : i18n.t("settingsSync.legacyEntriesCleanupNone"),
      );
    } catch (error) {
      console.error("[settingsProfile] legacy secrets cleanup failed", error);
      toast.error(i18n.t("settingsSync.legacyEntriesCleanupFailed"));
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

/**
 * Records that something old was seen — and says so on screen only when the
 * claim is actually true (P7, E4).
 *
 * The old text told the user "an older Plainva version is still publishing
 * retired account data" for THREE different findings, one of which was this
 * device's OWN profile file missing the current capability stamp. Nobody is
 * publishing there; the file simply predates the stamp. Accusing an absent
 * device of a fault it did not commit sends the user hunting through their
 * other machines for nothing.
 *
 * So: a local document is recorded and stays silent. A remote profile gets a
 * message that says what it actually means. Retired entries in the secrets
 * document get their own message, because that one is removable and the text
 * has to point at the way out.
 *
 * Never exposes account ids, endpoints or credential material.
 */
export function legacyToastFor(reason: LegacyClientDiagnosticReason): string | null {
  switch (reason) {
    // A remote profile from an older version: true, and it fixes itself.
    case "legacy-profile-capability-remote":
      return "settingsSync.legacyProfileRemote";
    // Retired entries in the shared credentials document: true, and removable.
    case "legacy-google-client-entry":
      return "settingsSync.legacyPublisherUpgrade";
    // This device's OWN profile file, or a record from before the split that
    // does not say which document it meant. Nobody to warn about either way.
    case "legacy-profile-capability-local":
    case "legacy-profile-capability":
      return null;
  }
}

async function reportLegacyPublisher(vaultPath: string, reason: LegacyClientDiagnosticReason): Promise<void> {
  const message = legacyToastFor(reason);
  // Durable, same as the phone: the condition behind it needs a person.
  if (message && (await shouldReportOnce(legacyProfileNoticeKey(vaultPath), reason))) {
    toast.warning(i18n.t(message));
  }
  void updateDiagnostics(vaultPath, (diagnostics) =>
    recordLegacyClient(diagnostics, new Date().toISOString(), reason));
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
        // Once per session and only for a real change (E1): the arrival is a
        // moment, not a state — from then on the diagnostics record names the
        // fields. Before the roundtrip fix this fired on nearly every cycle.
        onAdopted: (_from, changedNames) => {
          if (shouldAnnounceProfileImport(vaultPath, changedNames)) toast.info(i18n.t("settingsSync.adopted"));
        },
        onExchange: async (info) => {
          const at = new Date().toISOString();
          await updateDiagnostics(vaultPath, (d) => recordProfileExchange(d, at, info));
        },
        onLegacyProfile: (info) => {
          void reportLegacyPublisher(
            vaultPath,
            info.source === "remote"
              ? "legacy-profile-capability-remote"
              : "legacy-profile-capability-local",
          );
        },
        profileCrypto: mk ? profileCryptoFor(mk) : undefined,
        memberId: context.memberId ?? undefined,
        isMemberField: isMemberProfileField,
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
      // No pimRuntime requirement: a mail password does not depend on the
      // calendar runtime (see localCandidates). Only the master key is mandatory
      // — without it there is nothing to seal the bundle with.
      if (!mk) return null;
      return new SecretsSyncStep({
        port: createDesktopSecretsPort(vaultPath, context.pimRuntime ?? null),
        masterKey: mk,
        // Not an error: the account simply has not arrived here yet. Reported
        // once per changed set — it used to fire on every cycle (~30s), because
        // a skipped entry never changes the local view that triggers it.
        onUnknownAccounts: (ids) => {
          if (shouldReportWaitingAccounts(vaultPath, ids)) {
            toast.info(i18n.t("settingsSync.secretsWaiting", { count: ids.length }));
          }
        },
        onImportResult: async (result) => {
          const at = new Date().toISOString();
          await updateDiagnostics(vaultPath, (d) => {
            const recorded = recordSecretsResult(d, at, result);
            // This cycle READ the shared document, so its answer is the current
            // state — not one more entry in a list that only ever grew. Without
            // the clearing half the warning outlived its cause and the cleanup
            // button truthfully said "nothing to remove" while the banner kept
            // accusing (finding 2026-08-19).
            return result.legacyEntries.length > 0
              ? recordLegacyClient(recorded, at, "legacy-google-client-entry")
              : clearLegacyClient(recorded, "legacy-google-client-entry");
          });
          if (result.legacyEntries.length > 0) {
            if (await shouldReportOnce(legacySecretsNoticeKey(vaultPath), "legacy-publisher")) {
              toast.warning(i18n.t("settingsSync.legacyPublisherUpgrade"));
            }
          } else {
            // Gone: let the notice speak again if it ever comes back.
            await forgetReportedOnce(legacySecretsNoticeKey(vaultPath));
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
  await recoverDesktopAccountRepair(store, vaultPath, profileAccountMapKey(vaultPath));
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
