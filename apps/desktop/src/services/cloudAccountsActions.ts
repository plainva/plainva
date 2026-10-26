import { sameStoredValue, type DriveSyncTarget } from "@plainva/core";
import {
  PLAINVA_ONEDRIVE_CLIENT_ID,
  PLAINVA_DROPBOX_APP_KEY,
  accountOAuthServices,
  tokenCoversService,
  identityKey,
  type CloudAccountRecord,
  type CloudProviderFamily,
  type CloudServiceId,
  type SyncProviderId,
  type VerifiedProviderIdentity,
  type ServiceConnectionContext,
  assertConnectionIdentity,
  ServiceConnectionError,
  removeAccountCard,
  signOutAccountHere,
  withServiceOff,
  type ServiceSignInSlot,
} from "@plainva/ui";
import { credentialManager } from "./CredentialManager";
import { authorizeDropbox } from "./dropboxAuth";
import { oauthErrorText } from "./oauthLoopback";
import {
  buildWebDavTarget,
  buildS3Target,
  buildDriveTarget,
  buildOneDriveTarget,
  buildDropboxTarget,
  type S3TargetCreds,
} from "./syncTargets";
import { connectCalDavAccount, removePimAccount } from "./pim/pimAccounts";
import { graphMailAddress, forgetGraphMailRuntime, legacyMailSecretKey, mailSecretKey } from "@plainva/ui/mail";
import { checkMailLogin } from "@plainva/ui/mail";
import {
  listMailAccounts,
  saveMailAccount,
  saveMicrosoftMailAccount,
  removeMailAccount,
  type MailAccountConfig,
} from "@plainva/ui/mail";
import { restartPimAccountAfterLogin, type PimRuntime } from "./pim/pimRuntime";
import { loadCloudAccounts, saveCloudAccounts, refreshCloudAccounts } from "./cloudAccounts";
import {
  brokerFamily,
  claimPendingMailbox,
  fileBrokerTokenProvider,
  clearAccountToken,
  getAccountToken,
} from "./accountBroker";
import i18n from "@plainva/ui/i18n";
import { readDriveDestination, readSyncRootFolder, writeSyncRootFolder } from "./syncRootFolder";
import { rotateLegacyFileGrant } from "./accountGrantMigration";
import { accountCredentialStore } from "./accountCredentialStore";
import { slot, legacySlot } from "./keychainSlots";
import { announceCredentials } from "./credentialsAnnouncement";

/**
 * Stage-A connect orchestration for the "Cloud-Konten" wizard: per selected
 * service it drives the EXISTING subsystem connect flows in sequence (nothing
 * is bound before its flow succeeded — the OnlineVaultSetup lesson), then
 * upserts the account record so the services stay grouped even where the
 * subsystem itself stores no identity (OneDrive files).
 */

export type ServiceRunState = "idle" | "pending" | "ok" | "error";
export interface ServiceRunStatus {
  state: ServiceRunState;
  reason?: "permissions";
  /** i18n-ready detail: an error message, or a small success note. */
  detail?: string;
}
export type ServiceStatusCb = (service: CloudServiceId, status: ServiceRunStatus) => void;

export interface ConnectRequest {
  context?: ServiceConnectionContext;
  family: CloudProviderFamily;
  flavor?: "nextcloud";
  /** Selected services; executed in files → calendar → mail order. */
  services: CloudServiceId[];
  /**
   * What the CONSENT has to cover, when that is more than what is being
   * connected. Google and Microsoft share one refresh token across an
   * account's services, so re-authorising one service alone would hand back a
   * token that only covers that one — silently taking the others' access away
   * (finding 2026-07-30). Defaults to `services`.
   */
  consentServices?: CloudServiceId[];
  /** Own app id (Microsoft client id / Google client id / Dropbox app key). */
  byoClientId?: string;
  /** Google OAuth client secret (BYO desktop client, ADR 0006). */
  googleClientSecret?: string;
  webdav?: { filesUrl: string; caldavUrl: string; user: string; pass: string };
  s3?: S3TargetCreds & { prefix?: string };
  imap?: { email: string; host: string; port: number; smtpHost?: string; smtpPort?: number; pass: string; label?: string };
}

export interface ConnectResult {
  /** Set when a union consent minted the account id up front (Microsoft). */
  accountId?: string;
  filesProvider?: SyncProviderId;
  pimAccountId?: string;
  mailAccountId?: string;
  identity?: string;
  verifiedProviderIdentity?: VerifiedProviderIdentity;
}

const SERVICE_ORDER: CloudServiceId[] = ["files", "calendar", "mail"];

function newId(): string {
  return crypto.randomUUID();
}

export async function clearOtherSyncSlots(vaultPath: string, keep: SyncProviderId | null): Promise<void> {
  if (keep !== "webdav") await credentialManager.clearWebDavCredentials(vaultPath);
  if (keep !== "drive") await credentialManager.clearDriveCredentials(vaultPath);
  if (keep !== "onedrive") await credentialManager.clearOneDriveCredentials(vaultPath);
  if (keep !== "dropbox") await credentialManager.clearDropboxCredentials(vaultPath);
  if (keep !== "s3") await credentialManager.clearS3Credentials(vaultPath);
}

// Held while a surface shows a sign-in's result (moved to its own module so the
// password change of an account page holds too, plan "Verbinden", V2).
export { announceCredentials, holdCredentialsAnnouncements } from "./credentialsAnnouncement";

/** Connects the FILES service of the request. Binds nothing before success. */
async function connectFiles(vaultPath: string, req: ConnectRequest): Promise<SyncProviderId> {
  switch (req.family) {
    case "dropbox": {
      const appKey = req.byoClientId?.trim() || PLAINVA_DROPBOX_APP_KEY;
      const existing = await credentialManager.getDropboxCredentials(vaultPath);
      const creds = await authorizeDropbox({ appKey });
      await clearOtherSyncSlots(vaultPath, "dropbox");
      await credentialManager.saveDropboxCredentials(vaultPath, { ...creds, rootPath: existing?.rootPath });
      announceCredentials(true);
      return "dropbox";
    }
    // Catalog suites with a files service (Yandex/Mail.ru/Fastmail/mailbox.org/
    // Koofr/pCloud) ARE WebDAV file servers — same slot, same probe, the
    // family only differs registry-side.
    case "yandex":
    case "mailru":
    case "fastmail":
    case "mailboxorg":
    case "koofr":
    case "pcloud":
    case "webdav": {
      const w = req.webdav!;
      // Probe before binding: a WebDAV connect that cannot list is a failed connect.
      await buildWebDavTarget({ url: w.filesUrl, user: w.user, pass: w.pass }).listFolders("");
      await clearOtherSyncSlots(vaultPath, "webdav");
      await credentialManager.saveWebDavCredentials(vaultPath, { url: w.filesUrl, user: w.user, pass: w.pass });
      announceCredentials(true);
      return "webdav";
    }
    case "s3": {
      const s3 = req.s3!;
      await buildS3Target(s3).listFolders("");
      await clearOtherSyncSlots(vaultPath, "s3");
      await credentialManager.saveS3Credentials(vaultPath, s3);
      announceCredentials(true);
      return "s3";
    }
    default:
      throw new Error(`files is not available for ${req.family}`);
  }
}

async function connectCalendar(
  vaultPath: string,
  runtime: PimRuntime,
  req: ConnectRequest,
): Promise<{ id: string; label: string; verifiedProviderIdentity?: VerifiedProviderIdentity }> {
  switch (req.family) {
    // Catalog suites with a calendar service run over plain CalDAV against
    // their fixed endpoint (the adapter discovers the calendar home itself —
    // principal discovery covers iCloud's partition hosts).
    case "apple":
    case "yahoo":
    case "aol":
    case "yandex":
    case "mailru":
    case "zoho":
    case "fastmail":
    case "mailboxorg":
    case "webdav": {
      const w = req.webdav!;
      const row = await connectCalDavAccount(runtime, vaultPath, { url: w.caldavUrl, user: w.user, pass: w.pass });
      // Suites sign in with the mail address — prefer it over the subsystem's
      // user@host label so the registry card carries a mergeable identity.
      return { id: row.id, label: identityKey(w.user) ? w.user : row.label };
    }
    default:
      throw new Error(`calendar is not available for ${req.family}`);
  }
}

export async function connectMicrosoftMailAccount(vaultPath: string, clientId: string, viaBroker?: boolean): Promise<{ id: string; address: string }> {
  if (!viaBroker) throw new ServiceConnectionError("needsConsent");
  const refreshToken = "";
  const id = newId();
  // This mailbox is validated with the sign-in of the connect in progress —
  // just minted, or the one of the card the connect reuses — before any
  // card points at it. The broker hands that sign-in to the mailbox the
  // connect names and to no other, so the name comes first.
  claimPendingMailbox(vaultPath, id);
  const account: MailAccountConfig = { id, label: "Microsoft", host: "", port: 0, user: "", kind: "microsoft", clientId };
  await saveMicrosoftMailAccount(vaultPath, account, refreshToken);
  try {
    const address = await graphMailAddress(vaultPath, account);
    await saveMicrosoftMailAccount(vaultPath, { ...account, label: address, user: address }, refreshToken);
    return { id, address };
  } catch (err) {
    // The token cannot read the mailbox: undo the half-connected account.
    forgetGraphMailRuntime(vaultPath, id);
    await removeMailAccount(vaultPath, id).catch(() => undefined);
    throw err;
  }
}

async function connectMail(vaultPath: string, req: ConnectRequest): Promise<{ id: string; identity?: string }> {
  // Plain IMAP and the app-password suites share the same path.
  const m = req.imap!;
  const config: Omit<MailAccountConfig, "id" | "label"> = {
    host: m.host,
    port: m.port,
    user: m.email,
    smtpHost: m.smtpHost,
    smtpPort: m.smtpPort,
  };
  await checkMailLogin(config, m.pass);
  const id = newId();
  await saveMailAccount(vaultPath, { id, label: m.label?.trim() || m.email, ...config }, m.pass);
  return { id, identity: m.email };
}

/**
 * Runs the selected services of a password or app-key account (WebDAV, S3,
 * CalDAV, IMAP, the app-password suites, Dropbox) in order. STOPS at the first
 * failure; everything already connected stays connected and is reported
 * through the returned partial result.
 *
 * Google and Microsoft never come here: they sign in once for every service
 * through `signInCloudAccount` (account sign-in plan K3). This used to run
 * their consent too, then reloaded the vault after the files step and lost the
 * calendar under it (finding 2026-10-23).
 */
export async function runConnectSequence(
  vaultPath: string,
  runtime: PimRuntime | null,
  req: ConnectRequest,
  onStatus: ServiceStatusCb
): Promise<ConnectResult> {
  if (req.family === "google" || req.family === "microsoft") throw new Error("Google and Microsoft sign in through signInCloudAccount");
  const result: ConnectResult = {};
  const selected = SERVICE_ORDER.filter((s) => req.services.includes(s));
  if (req.context && req.context.vaultId !== vaultPath) throw new ServiceConnectionError("accountChanged");
  for (const service of selected) {
    onStatus(service, { state: "pending" });
    try {
      if (service === "files") {
        result.filesProvider = await connectFiles(vaultPath, req);
      } else if (service === "calendar") {
        if (!runtime) throw new Error("calendar needs the open vault's runtime");
        const row = await connectCalendar(vaultPath, runtime, req);
        result.pimAccountId = row.id;
        if (!result.identity) result.identity = row.label;
        if (!result.verifiedProviderIdentity && row.verifiedProviderIdentity) result.verifiedProviderIdentity = row.verifiedProviderIdentity;
      } else {
        const res = await connectMail(vaultPath, req);
        result.mailAccountId = res.id;
        if (!result.identity && res.identity) result.identity = res.identity;
      }
      onStatus(service, { state: "ok" });
    } catch (err) {
      onStatus(service, { state: "error", detail: oauthErrorText(err) });
      throw Object.assign(err instanceof Error ? err : new Error(String(err)), { partialResult: result });
    }
  }
  return result;
}

/**
 * Upserts the wizard result as ONE account record and re-reconciles. Returns
 * the bound account's id so a RETRYING caller keeps upserting the SAME record
 * (control pass 2026-07-20, finding #1: a retry without the id minted a second
 * record referencing the already-bound subsystem entries).
 */
export async function bindConnectResult(
  vaultPath: string,
  runtime: PimRuntime | null,
  req: ConnectRequest,
  result: ConnectResult,
  existingAccountId?: string
): Promise<{ records: CloudAccountRecord[]; accountId: string }> {
  const stored = await loadCloudAccounts(vaultPath);
  const boundId = existingAccountId ?? result.accountId;
  const existing = boundId ? stored.find((r) => r.id === boundId) : undefined;
  if (existing?.verifiedProviderIdentity && result.verifiedProviderIdentity) assertConnectionIdentity(existing.verifiedProviderIdentity, result.verifiedProviderIdentity);
  const record: CloudAccountRecord = existing
    ? { ...existing, services: { ...existing.services } }
    // A union consent already minted the id and wrote the account slot under
    // it — reuse it, or the slot would belong to no account.
    : { id: boundId ?? newId(), family: req.family, label: result.identity ?? "", flavor: req.flavor, services: {} };
  if (result.filesProvider) record.services.files = { provider: result.filesProvider };
  if (result.pimAccountId) record.services.calendar = { pimAccountId: result.pimAccountId };
  if (result.mailAccountId) record.services.mail = { mailAccountId: result.mailAccountId };
  if (req.byoClientId?.trim()) record.byoClientId = req.byoClientId.trim();
  if (result.identity && !record.label) record.label = result.identity;
  if (result.verifiedProviderIdentity) {
    record.verifiedProviderIdentity = result.verifiedProviderIdentity;
  }
  try {
    // A freshly connected files service moves the vault's XOR slot: strip the
    // files reference from every OTHER account so exactly one card carries it.
    const others = stored
      .filter((r) => r.id !== record.id)
      .map((r) => (result.filesProvider && r.services.files ? { ...r, services: { ...r.services, files: undefined } } : r));
    await saveCloudAccounts(vaultPath, [...others, record]);
    const persisted = (await loadCloudAccounts(vaultPath)).find(r => r.id === record.id);
    // Content, not text: the store returns `{ calendar, files }` for a written
    // `{ files, calendar }`, and the text comparison failed every files +
    // calendar binding (finding 2026-09-24).
    if (!persisted || !sameStoredValue(persisted.services, record.services)) throw new ServiceConnectionError("storageFailed");
    if (runtime && result.pimAccountId) {
      const row = (await runtime.cache.listAccounts()).find(r => r.id === result.pimAccountId);
      if (row) await runtime.cache.upsertAccount({ ...row, enabled: true });
      await restartPimAccountAfterLogin(runtime, result.pimAccountId);
    }
    return { records: await refreshCloudAccounts(vaultPath, runtime), accountId: record.id };
  } finally {
    // Nothing to release: the one sign-in owns the pending marker.
  }
}

/**
 * Re-authenticates every OAuth-backed service of an account IN PLACE (same
 * subsystem ids — nothing is removed or re-created). Password-backed services
 * (WebDAV/CalDAV/IMAP/S3) have nothing to re-run here.
 */
export async function rerunAccountAuth(
  vaultPath: string,
  runtime: PimRuntime | null,
  record: CloudAccountRecord,
  onStatus: ServiceStatusCb
): Promise<void> {
  // Google and Microsoft sign in again through signInCloudAccount.
  void runtime;
  if (record.family !== "dropbox" || record.services.files?.provider !== "dropbox") return;
  onStatus("files", { state: "pending" });
  try {
    const existing = await credentialManager.getDropboxCredentials(vaultPath);
    const creds = await authorizeDropbox({ appKey: existing?.appKey || record.byoClientId?.trim() || PLAINVA_DROPBOX_APP_KEY });
    await credentialManager.saveDropboxCredentials(vaultPath, { ...creds, rootPath: existing?.rootPath });
    announceCredentials(false);
    onStatus("files", { state: "ok" });
  } catch (error) {
    onStatus("files", { state: "error", detail: oauthErrorText(error) });
    throw error;
  }
}

export { passwordServicesOf } from "@plainva/ui";
export { updateAccountPassword } from "./accountPassword";

/**
 * Sentence for "this device cannot reach the account's file service". It replaces
 * the bare `"not connected"` that used to surface raw in the picker's error box:
 * the person needs to know that a SIGN-IN is missing, not that some string was
 * empty.
 */
function noFileAccessError(): Error {
  return new Error(i18n.t("settings.pickerNoFileAccess"));
}

/**
 * Folder listing from the STORED slots (wizard finish + slim sync page).
 *
 * Google and Microsoft accounts connected through a union consent keep ONE
 * refresh token in the ACCOUNT slot and leave the per-service slot's token
 * deliberately empty (stage B). Asking the broker first is therefore not a
 * fallback but the normal path — demanding `refreshToken` here made the picker
 * throw on exactly the accounts that sync fine, which is how a reconnected Drive
 * vault ended up with no way to set its folder at all (finding 2026-08-19).
 * Dropbox has no broker family, so its own token stays the only source there.
 *
 * OneDrive/Dropbox may rotate the refresh token during the call — persist it,
 * exactly like the sync worker does (a dropped rotation kills the token). Under
 * the broker the rotation belongs to the account, so no `onRotate` is passed.
 */
/**
 * The files target of an already connected provider, from the stored slots.
 *
 * One builder for listing AND creating folders (K10, finding 2026-09-03): the
 * settings paths listed folders but could not create one - not for Dropbox,
 * not for any provider - because only the splash flow had wired the create
 * call. Whatever the picker asks for now comes off the same target.
 */
export async function syncTargetFromSlots(vaultPath: string, provider: SyncProviderId): Promise<{ listFolders(path: string): Promise<string[]>; createFolder(path: string): Promise<void> }> {
  if (provider === "webdav") {
    const creds = await credentialManager.getWebDavCredentials(vaultPath);
    if (!creds) throw noFileAccessError();
    return buildWebDavTarget(creds);
  }
  if (provider === "s3") {
    const creds = await credentialManager.getS3Credentials(vaultPath);
    if (!creds) throw noFileAccessError();
    return buildS3Target({ ...creds, forcePathStyle: creds.forcePathStyle ?? true });
  }
  if (provider === "drive") {
    const creds = await credentialManager.getDriveCredentials(vaultPath);
    const filesTokenProvider = creds ? await fileBrokerTokenProvider(vaultPath, { provider: "drive", ...creds }) : undefined;
    if (!creds || !(creds.refreshToken || filesTokenProvider)) throw noFileAccessError();
    const destination = await readDriveDestination(vaultPath);
    return buildDriveTarget(
      {
        clientId: creds.clientId,
        clientSecret: creds.clientSecret,
        // Empty for broker-backed accounts: the provider supplies the access
        // token and this field is never read.
        refreshToken: creds.refreshToken ?? "",
        rootFolderName: destination.path || undefined,
        rootFolderId: destination.id,
      },
      filesTokenProvider
    );
  }
  if (provider === "onedrive") {
    const creds = await credentialManager.getOneDriveCredentials(vaultPath);
    const filesTokenProvider = creds ? await fileBrokerTokenProvider(vaultPath, { provider: "onedrive", ...creds }) : undefined;
    if (!creds || !(creds.refreshToken || filesTokenProvider)) throw noFileAccessError();
    return buildOneDriveTarget(
      { clientId: creds.clientId || PLAINVA_ONEDRIVE_CLIENT_ID, refreshToken: creds.refreshToken ?? "" },
      filesTokenProvider
        ? undefined
        : async (refreshToken) => {
            await rotateLegacyFileGrant(vaultPath, "onedrive", { ...creds, refreshToken: creds.refreshToken ?? "" }, refreshToken);
            creds.refreshToken = refreshToken;
          },
      filesTokenProvider
    );
  }
  const creds = await credentialManager.getDropboxCredentials(vaultPath);
  if (!creds?.refreshToken) throw noFileAccessError();
  return buildDropboxTarget(
    { appKey: creds.appKey || PLAINVA_DROPBOX_APP_KEY, refreshToken: creds.refreshToken },
    async (refreshToken) => {
      await rotateLegacyFileGrant(vaultPath, "dropbox", { clientId: creds.appKey, refreshToken: creds.refreshToken ?? "" }, refreshToken);
      creds.refreshToken = refreshToken;
    }
  );
}

export async function listSyncFoldersFromSlots(vaultPath: string, provider: SyncProviderId, path: string): Promise<string[]> {
  return (await syncTargetFromSlots(vaultPath, provider)).listFolders(path);
}

/** The picker's "new folder" row, for a provider that is already connected (K10). */
export async function createSyncFolderFromSlots(vaultPath: string, provider: SyncProviderId, path: string): Promise<void> {
  await (await syncTargetFromSlots(vaultPath, provider)).createFolder(path);
}

/**
 * Current remote folder/prefix of the vault ("" when unset).
 *
 * For the OAuth providers the answer comes from the per-vault settings, not
 * from the credential slot — see `syncRootFolder.ts` for why (a removed account
 * used to take the folder with it). WebDAV/S3 keep theirs in the credentials.
 */
export async function getSyncRootFolder(vaultPath: string, provider: SyncProviderId): Promise<string> {
  if (provider === "s3") return (await credentialManager.getS3Credentials(vaultPath))?.prefix ?? "";
  if (provider === "webdav") return (await credentialManager.getWebDavCredentials(vaultPath))?.url ?? "";
  return readSyncRootFolder(vaultPath, provider);
}

/**
 * Persists the remote folder/prefix.
 *
 * The settings write happens for the OAuth providers WITHOUT a stored slot as
 * well: the old version bailed out silently when no credentials existed
 * (`if (creds)`), which is precisely the state a freshly removed account leaves
 * behind.
 */
export async function saveSyncRootFolder(vaultPath: string, provider: SyncProviderId, value: string, folderId?: string): Promise<void> {
  if (provider === "dropbox") {
    // Keep the leading slash the Dropbox API expects; "" stays "" (= root).
    await writeSyncRootFolder(vaultPath, provider, value ? `/${value.replace(/^\/+/, "")}` : "");
  } else if (provider === "drive" || provider === "onedrive") {
    await writeSyncRootFolder(vaultPath, provider, value, folderId);
  } else if (provider === "s3") {
    const creds = await credentialManager.getS3Credentials(vaultPath);
    if (creds) await credentialManager.saveS3Credentials(vaultPath, { ...creds, prefix: value || undefined });
  }
  announceCredentials(false);
}

export async function openDriveDestination(vaultPath: string) {
  const target = await syncTargetFromSlots(vaultPath, "drive") as DriveSyncTarget;
  const destination = await readDriveDestination(vaultPath);
  return { vaultPath, currentPath: destination.path || "Plainva", previewCurrent: () => target.previewConfiguredFolder(),
    loadFolder: (id: string, page?: string) => target.previewFolder(id, page) };
}

/**
 * Offer one sign-in when a shared grant is absent or does not cover every
 * OAuth service. Gmail's app password is independent of that grant.
 */
export async function canUnifyAccountLogin(vaultPath: string, record: CloudAccountRecord): Promise<boolean> {
  const family = brokerFamily(record.family);
  if (!family) return false;
  const services = await oauthServicesInVault(vaultPath, record);
  if (services.length < 2) return false;
  const covered = await Promise.all(services.map(async (service) => tokenCoversService(await getAccountToken(vaultPath, record.id, service, family), service, family)));
  return covered.some((hasGrant) => !hasGrant);
}

async function oauthServicesInVault(vault: string, record: CloudAccountRecord): Promise<CloudServiceId[]> {
  const mail = record.services.mail ? (await listMailAccounts(vault)).find(row => row.id === record.services.mail!.mailAccountId) : undefined;
  return accountOAuthServices(record, mail?.kind);
}

/** Turns ONE service of an account off (existing subsystem removal semantics). */
export async function disableAccountService(
  vaultPath: string,
  runtime: PimRuntime | null,
  record: CloudAccountRecord,
  service: CloudServiceId
): Promise<CloudAccountRecord[]> {
  if (service === "files" && record.services.files) {
    await clearOtherSyncSlots(vaultPath, null);
    // The queue and the per-file records stay: they belong to the folder, not the
    // account, and the next file sync keeps them for the same folder and drops them
    // for another (third review, finding 1).
    announceCredentials(false);
  } else if (service === "calendar" && record.services.calendar && runtime) {
    await removePimAccount(runtime, vaultPath, record.services.calendar.pimAccountId);
  } else if (service === "mail" && record.services.mail) {
    forgetGraphMailRuntime(vaultPath, record.services.mail.mailAccountId);
    await removeMailAccount(vaultPath, record.services.mail.mailAccountId);
  }
  return refreshCloudAccounts(vaultPath, runtime);
}

/**
 * A service switched on or off for the vault (plan "Verbinden", E3): the
 * binding stays, so does what the service left in the vault. Files stop at
 * the next vault load (a reload follows), the calendar stops at once and on
 * every other device when it reads the records, mail stops being read.
 */
export async function setAccountServiceOff(
  vaultPath: string,
  runtime: PimRuntime | null,
  record: CloudAccountRecord,
  service: CloudServiceId,
  off: boolean,
  /**
   * Pushes the settings profile once (review finding 4): the switch lives in
   * the profile, which only travels with the file sync - switched off without
   * this, files stayed on for every other device.
   */
  pushSettings?: () => Promise<void>,
): Promise<CloudAccountRecord[]> {
  const stored = await loadCloudAccounts(vaultPath);
  await saveCloudAccounts(vaultPath, stored.map((entry) => (entry.id === record.id ? withServiceOff(entry, service, off) : entry)));
  if (service === "files" && off) await pushSettings?.().catch(() => undefined);
  if (service === "files") announceCredentials(false);
  if (service === "mail" && record.services.mail) forgetGraphMailRuntime(vaultPath, record.services.mail.mailAccountId);
  return refreshCloudAccounts(vaultPath, runtime);
}

/** Removes the whole account: every service, then the grant, then the registry entry (the shared order). */
export async function removeCloudAccount(
  vaultPath: string,
  runtime: PimRuntime | null,
  record: CloudAccountRecord
): Promise<CloudAccountRecord[]> {
  await removeAccountCard({
    services: (["files", "calendar", "mail"] as const).filter((service) => !!record.services[service]),
    disable: async (service) => { await disableAccountService(vaultPath, runtime, record, service); },
    // The account-wide token outlives its services otherwise (E9.2).
    clearCardGrant: () => clearAccountToken(vaultPath, record.id),
    dropRecord: async () => {
      const stored = await loadCloudAccounts(vaultPath);
      await saveCloudAccounts(vaultPath, stored.filter((r) => r.id !== record.id));
    },
  });
  return refreshCloudAccounts(vaultPath, runtime);
}

/**
 * "Sign out on this device" (plan "Verbinden", V0): this desktop's sign-in for
 * the card goes - the card's grant and any sign-in a service still kept for
 * itself (`signOutAccountHere`); the account, its services, settings and the
 * other devices stay. The card then reads "sign-in needed" and its button
 * signs it in again. Until now the desktop could only remove the account.
 */
export async function signOutCloudAccountHere(
  vaultPath: string,
  runtime: PimRuntime | null,
  record: CloudAccountRecord
): Promise<CloudAccountRecord[]> {
  const slots: ServiceSignInSlot[] = [];
  const files = record.services.files?.provider;
  // Every provider: a token for Drive, OneDrive and Dropbox, the password of
  // WebDAV, the secret key of S3 (plan "Verbinden", V2).
  if (files) slots.push({ keys: [slot.files(vaultPath, files), legacySlot.files(vaultPath, files)] });
  const pim = record.services.calendar?.pimAccountId;
  if (pim) slots.push({ keys: [slot.calendar(vaultPath, pim), legacySlot.calendar(vaultPath, pim)] });
  const mail = record.services.mail?.mailAccountId;
  if (mail) {
    forgetGraphMailRuntime(vaultPath, mail);
    slots.push({ keys: [mailSecretKey(vaultPath, mail), legacyMailSecretKey(vaultPath, mail)] });
  }
  await signOutAccountHere({ store: accountCredentialStore, serviceSlots: slots, clearCardGrant: () => clearAccountToken(vaultPath, record.id) });
  // The calendar says what it now is at once, not at its next turn.
  if (pim) await restartPimAccountAfterLogin(runtime, pim).catch(() => undefined);
  return refreshCloudAccounts(vaultPath, runtime);
}
