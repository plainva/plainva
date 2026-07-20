import {
  PLAINVA_ONEDRIVE_CLIENT_ID,
  PLAINVA_DROPBOX_APP_KEY,
  type CloudAccountRecord,
  type CloudProviderFamily,
  type CloudServiceId,
  type SyncProviderId,
} from "@plainva/ui";
import { credentialManager } from "./CredentialManager";
import { authorizeDrive } from "./driveAuth";
import { authorizeOneDrive } from "./oneDriveAuth";
import { authorizeDropbox } from "./dropboxAuth";
import {
  buildWebDavTarget,
  buildS3Target,
  buildDriveTarget,
  buildOneDriveTarget,
  buildDropboxTarget,
  type S3TargetCreds,
} from "./syncTargets";
import { connectCalDavAccount, connectGoogleAccount, connectMicrosoftAccount, removePimAccount } from "./pim/pimAccounts";
import { savePimCredentials, getPimCredentials } from "./pim/pimCredentials";
import { authorizeGooglePim, authorizeMicrosoftPim } from "./pim/pimAuth";
import { authorizeMicrosoftMail, graphMailAddress, forgetGraphMailRuntime } from "./mail/graphMail";
import { checkMailLogin } from "./mail/mailClient";
import {
  listMailAccounts,
  saveMailAccount,
  saveMicrosoftMailAccount,
  saveMailRefreshToken,
  removeMailAccount,
  type MailAccountConfig,
} from "./mail/mailAccounts";
import type { PimRuntime } from "./pim/pimRuntime";
import { loadCloudAccounts, saveCloudAccounts, refreshCloudAccounts } from "./cloudAccounts";

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
  /** i18n-ready detail: an error message, or a small success note. */
  detail?: string;
}
export type ServiceStatusCb = (service: CloudServiceId, status: ServiceRunStatus) => void;

export interface ConnectRequest {
  family: CloudProviderFamily;
  flavor?: "nextcloud";
  /** Selected services; executed in files → calendar → mail order. */
  services: CloudServiceId[];
  /** Own app id (Microsoft client id / Google client id / Dropbox app key). */
  byoClientId?: string;
  /** Google OAuth client secret (BYO desktop client, ADR 0006). */
  googleClientSecret?: string;
  webdav?: { filesUrl: string; caldavUrl: string; user: string; pass: string };
  s3?: S3TargetCreds & { prefix?: string };
  imap?: { email: string; host: string; port: number; smtpHost?: string; smtpPort?: number; pass: string; label?: string };
}

export interface ConnectResult {
  filesProvider?: SyncProviderId;
  pimAccountId?: string;
  mailAccountId?: string;
  identity?: string;
}

const SERVICE_ORDER: CloudServiceId[] = ["files", "calendar", "mail"];

function newId(): string {
  return Math.random().toString(36).slice(2, 10);
}

async function clearOtherSyncSlots(vaultPath: string, keep: SyncProviderId | null): Promise<void> {
  if (keep !== "webdav") await credentialManager.clearWebDavCredentials(vaultPath);
  if (keep !== "drive") await credentialManager.clearDriveCredentials(vaultPath);
  if (keep !== "onedrive") await credentialManager.clearOneDriveCredentials(vaultPath);
  if (keep !== "dropbox") await credentialManager.clearDropboxCredentials(vaultPath);
  if (keep !== "s3") await credentialManager.clearS3Credentials(vaultPath);
}

function announceCredentials(isNewConnection: boolean): void {
  window.dispatchEvent(new CustomEvent("plainva-credentials-saved", { detail: { isNewConnection } }));
}

/** Connects the FILES service of the request. Binds nothing before success. */
async function connectFiles(vaultPath: string, req: ConnectRequest): Promise<SyncProviderId> {
  switch (req.family) {
    case "microsoft": {
      const clientId = req.byoClientId?.trim() || PLAINVA_ONEDRIVE_CLIENT_ID;
      const existing = await credentialManager.getOneDriveCredentials(vaultPath);
      const creds = await authorizeOneDrive({ clientId });
      await clearOtherSyncSlots(vaultPath, "onedrive");
      await credentialManager.saveOneDriveCredentials(vaultPath, { ...creds, rootFolderName: existing?.rootFolderName });
      announceCredentials(true);
      return "onedrive";
    }
    case "google": {
      const clientId = req.byoClientId?.trim() ?? "";
      const clientSecret = req.googleClientSecret?.trim() ?? "";
      const existing = await credentialManager.getDriveCredentials(vaultPath);
      const creds = await authorizeDrive({ clientId, clientSecret });
      await clearOtherSyncSlots(vaultPath, "drive");
      await credentialManager.saveDriveCredentials(vaultPath, { ...creds, rootFolderName: existing?.rootFolderName });
      announceCredentials(true);
      return "drive";
    }
    case "dropbox": {
      const appKey = req.byoClientId?.trim() || PLAINVA_DROPBOX_APP_KEY;
      const existing = await credentialManager.getDropboxCredentials(vaultPath);
      const creds = await authorizeDropbox({ appKey });
      await clearOtherSyncSlots(vaultPath, "dropbox");
      await credentialManager.saveDropboxCredentials(vaultPath, { ...creds, rootPath: existing?.rootPath });
      announceCredentials(true);
      return "dropbox";
    }
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

async function connectCalendar(vaultPath: string, runtime: PimRuntime, req: ConnectRequest): Promise<{ id: string; label: string }> {
  switch (req.family) {
    case "microsoft": {
      const clientId = req.byoClientId?.trim() || PLAINVA_ONEDRIVE_CLIENT_ID;
      const row = await connectMicrosoftAccount(runtime, vaultPath, { clientId });
      return { id: row.id, label: row.label };
    }
    case "google": {
      const row = await connectGoogleAccount(runtime, vaultPath, {
        clientId: req.byoClientId?.trim() ?? "",
        clientSecret: req.googleClientSecret?.trim() ?? "",
      });
      return { id: row.id, label: row.label };
    }
    case "webdav": {
      const w = req.webdav!;
      const row = await connectCalDavAccount(runtime, vaultPath, { url: w.caldavUrl, user: w.user, pass: w.pass });
      return { id: row.id, label: row.label };
    }
    default:
      throw new Error(`calendar is not available for ${req.family}`);
  }
}

async function connectMicrosoftMailAccount(vaultPath: string, clientId: string): Promise<{ id: string; address: string }> {
  const { refreshToken } = await authorizeMicrosoftMail({ clientId });
  const id = newId();
  const account: MailAccountConfig = { id, label: "Microsoft", host: "", port: 0, user: "", kind: "microsoft", clientId };
  await saveMicrosoftMailAccount(vaultPath, account, refreshToken);
  try {
    const address = await graphMailAddress(vaultPath, account);
    await saveMicrosoftMailAccount(vaultPath, { ...account, label: address, user: address }, refreshToken);
    return { id, address };
  } catch (err) {
    // The token cannot read the mailbox: undo the half-connected account.
    forgetGraphMailRuntime(id);
    await removeMailAccount(vaultPath, id).catch(() => undefined);
    throw err;
  }
}

async function connectMail(vaultPath: string, req: ConnectRequest): Promise<{ id: string; identity?: string }> {
  if (req.family === "microsoft") {
    const clientId = req.byoClientId?.trim() || PLAINVA_ONEDRIVE_CLIENT_ID;
    const res = await connectMicrosoftMailAccount(vaultPath, clientId);
    return { id: res.id, identity: res.address };
  }
  // google mail (app password) and plain IMAP share the same path.
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
 * Runs the selected services in order. STOPS at the first failure (remaining
 * services stay untouched); everything already connected stays connected and
 * is reported through the returned partial result.
 */
export async function runConnectSequence(
  vaultPath: string,
  runtime: PimRuntime | null,
  req: ConnectRequest,
  onStatus: ServiceStatusCb
): Promise<ConnectResult> {
  const result: ConnectResult = {};
  const selected = SERVICE_ORDER.filter((s) => req.services.includes(s));
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
      } else {
        const res = await connectMail(vaultPath, req);
        result.mailAccountId = res.id;
        if (!result.identity && res.identity) result.identity = res.identity;
      }
      onStatus(service, { state: "ok" });
    } catch (err) {
      onStatus(service, { state: "error", detail: err instanceof Error ? err.message : String(err) });
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
  const existing = existingAccountId ? stored.find((r) => r.id === existingAccountId) : undefined;
  const record: CloudAccountRecord = existing
    ? { ...existing }
    : { id: newId(), family: req.family, label: result.identity ?? "", flavor: req.flavor, services: {} };
  if (result.filesProvider) record.services.files = { provider: result.filesProvider };
  if (result.pimAccountId) record.services.calendar = { pimAccountId: result.pimAccountId };
  if (result.mailAccountId) record.services.mail = { mailAccountId: result.mailAccountId };
  if (req.byoClientId?.trim()) record.byoClientId = req.byoClientId.trim();
  if (result.identity && !record.label) record.label = result.identity;
  // A freshly connected files service moves the vault's XOR slot: strip the
  // files reference from every OTHER account so exactly one card carries it.
  const others = stored
    .filter((r) => r.id !== record.id)
    .map((r) => (result.filesProvider && r.services.files ? { ...r, services: { ...r.services, files: undefined } } : r));
  await saveCloudAccounts(vaultPath, [...others, record]);
  return { records: await refreshCloudAccounts(vaultPath, runtime), accountId: record.id };
}

/** Reads a reusable Google BYO client (id + secret) from the account's existing slots. */
export async function googleByoFromSlots(
  vaultPath: string,
  record: CloudAccountRecord
): Promise<{ clientId: string; clientSecret: string } | null> {
  const drive = await credentialManager.getDriveCredentials(vaultPath);
  if (drive?.clientId && drive.clientSecret) return { clientId: drive.clientId, clientSecret: drive.clientSecret };
  if (record.services.calendar) {
    const creds = await getPimCredentials(vaultPath, record.services.calendar.pimAccountId);
    if (creds?.kind === "google" && creds.clientId && creds.clientSecret) {
      return { clientId: creds.clientId, clientSecret: creds.clientSecret };
    }
  }
  return null;
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
  if (record.family !== "microsoft" && record.family !== "google" && record.family !== "dropbox") return;
  const google = record.family === "google" ? await googleByoFromSlots(vaultPath, record) : null;
  if (record.family === "google" && !google) throw new Error("missing Google client");
  const msClientId = record.byoClientId?.trim() || PLAINVA_ONEDRIVE_CLIENT_ID;

  if (record.services.files) {
    onStatus("files", { state: "pending" });
    try {
      const provider = record.services.files.provider;
      if (provider === "onedrive") {
        const existing = await credentialManager.getOneDriveCredentials(vaultPath);
        const creds = await authorizeOneDrive({ clientId: existing?.clientId || msClientId });
        await credentialManager.saveOneDriveCredentials(vaultPath, { ...creds, rootFolderName: existing?.rootFolderName });
      } else if (provider === "drive") {
        const existing = await credentialManager.getDriveCredentials(vaultPath);
        const creds = await authorizeDrive({ clientId: google!.clientId, clientSecret: google!.clientSecret });
        await credentialManager.saveDriveCredentials(vaultPath, { ...creds, rootFolderName: existing?.rootFolderName });
      } else if (provider === "dropbox") {
        const existing = await credentialManager.getDropboxCredentials(vaultPath);
        const creds = await authorizeDropbox({ appKey: existing?.appKey || record.byoClientId?.trim() || PLAINVA_DROPBOX_APP_KEY });
        await credentialManager.saveDropboxCredentials(vaultPath, { ...creds, rootPath: existing?.rootPath });
      }
      announceCredentials(false);
      onStatus("files", { state: "ok" });
    } catch (err) {
      onStatus("files", { state: "error", detail: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  }

  if (record.services.calendar && runtime) {
    onStatus("calendar", { state: "pending" });
    try {
      const accountId = record.services.calendar.pimAccountId;
      if (record.family === "google") {
        const { refreshToken } = await authorizeGooglePim(google!);
        await savePimCredentials(vaultPath, accountId, { kind: "google", ...google!, refreshToken });
      } else {
        const { refreshToken } = await authorizeMicrosoftPim({ clientId: msClientId });
        await savePimCredentials(vaultPath, accountId, { kind: "microsoft", clientId: msClientId, refreshToken });
      }
      void runtime.worker.triggerImmediate();
      onStatus("calendar", { state: "ok" });
    } catch (err) {
      onStatus("calendar", { state: "error", detail: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  }

  if (record.services.mail && record.family === "microsoft") {
    onStatus("mail", { state: "pending" });
    try {
      const accountId = record.services.mail.mailAccountId;
      const accounts = await listMailAccounts(vaultPath);
      const account = accounts.find((a) => a.id === accountId);
      const { refreshToken } = await authorizeMicrosoftMail({ clientId: account?.clientId || msClientId });
      forgetGraphMailRuntime(accountId);
      await saveMailRefreshToken(vaultPath, accountId, refreshToken);
      onStatus("mail", { state: "ok" });
    } catch (err) {
      onStatus("mail", { state: "error", detail: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  }
}

/**
 * Folder listing from the STORED slots (wizard finish + slim sync page).
 * OneDrive/Dropbox may rotate the refresh token during the call — persist it,
 * exactly like the sync worker does (a dropped rotation kills the token).
 */
export async function listSyncFoldersFromSlots(vaultPath: string, provider: SyncProviderId, path: string): Promise<string[]> {
  if (provider === "webdav") {
    const creds = await credentialManager.getWebDavCredentials(vaultPath);
    if (!creds) throw new Error("not connected");
    return buildWebDavTarget(creds).listFolders(path);
  }
  if (provider === "s3") {
    const creds = await credentialManager.getS3Credentials(vaultPath);
    if (!creds) throw new Error("not connected");
    return buildS3Target({ ...creds, forcePathStyle: creds.forcePathStyle ?? true }).listFolders(path);
  }
  if (provider === "drive") {
    const creds = await credentialManager.getDriveCredentials(vaultPath);
    if (!creds?.refreshToken) throw new Error("not connected");
    return buildDriveTarget({
      clientId: creds.clientId,
      clientSecret: creds.clientSecret,
      refreshToken: creds.refreshToken,
    }).listFolders(path);
  }
  if (provider === "onedrive") {
    const creds = await credentialManager.getOneDriveCredentials(vaultPath);
    if (!creds?.refreshToken) throw new Error("not connected");
    return buildOneDriveTarget(
      { clientId: creds.clientId || PLAINVA_ONEDRIVE_CLIENT_ID, refreshToken: creds.refreshToken },
      (refreshToken) =>
        credentialManager
          .saveOneDriveCredentials(vaultPath, { ...creds, refreshToken })
          .catch((e) => console.error("[CloudAccounts] persisting rotated OneDrive token failed", e))
    ).listFolders(path);
  }
  const creds = await credentialManager.getDropboxCredentials(vaultPath);
  if (!creds?.refreshToken) throw new Error("not connected");
  return buildDropboxTarget(
    { appKey: creds.appKey || PLAINVA_DROPBOX_APP_KEY, refreshToken: creds.refreshToken },
    (refreshToken) =>
      credentialManager
        .saveDropboxCredentials(vaultPath, { ...creds, refreshToken })
        .catch((e) => console.error("[CloudAccounts] persisting rotated Dropbox token failed", e))
  ).listFolders(path);
}

/** Current remote folder/prefix of the vault's sync slot ("" when unset). */
export async function getSyncRootFolder(vaultPath: string, provider: SyncProviderId): Promise<string> {
  if (provider === "drive") return (await credentialManager.getDriveCredentials(vaultPath))?.rootFolderName ?? "";
  if (provider === "onedrive") return (await credentialManager.getOneDriveCredentials(vaultPath))?.rootFolderName ?? "";
  if (provider === "dropbox") return (await credentialManager.getDropboxCredentials(vaultPath))?.rootPath ?? "";
  if (provider === "s3") return (await credentialManager.getS3Credentials(vaultPath))?.prefix ?? "";
  return (await credentialManager.getWebDavCredentials(vaultPath))?.url ?? "";
}

/** Persists the remote folder/prefix into the matching slot field. */
export async function saveSyncRootFolder(vaultPath: string, provider: SyncProviderId, value: string): Promise<void> {
  if (provider === "drive") {
    const creds = await credentialManager.getDriveCredentials(vaultPath);
    if (creds) await credentialManager.saveDriveCredentials(vaultPath, { ...creds, rootFolderName: value || undefined });
  } else if (provider === "onedrive") {
    const creds = await credentialManager.getOneDriveCredentials(vaultPath);
    if (creds) await credentialManager.saveOneDriveCredentials(vaultPath, { ...creds, rootFolderName: value || undefined });
  } else if (provider === "dropbox") {
    const creds = await credentialManager.getDropboxCredentials(vaultPath);
    if (creds) {
      const rootPath = value ? `/${value.replace(/^\/+/, "")}` : undefined;
      await credentialManager.saveDropboxCredentials(vaultPath, { ...creds, rootPath });
    }
  } else if (provider === "s3") {
    const creds = await credentialManager.getS3Credentials(vaultPath);
    if (creds) await credentialManager.saveS3Credentials(vaultPath, { ...creds, prefix: value || undefined });
  }
  announceCredentials(false);
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
    announceCredentials(false);
  } else if (service === "calendar" && record.services.calendar && runtime) {
    await removePimAccount(runtime, vaultPath, record.services.calendar.pimAccountId);
  } else if (service === "mail" && record.services.mail) {
    forgetGraphMailRuntime(record.services.mail.mailAccountId);
    await removeMailAccount(vaultPath, record.services.mail.mailAccountId);
  }
  return refreshCloudAccounts(vaultPath, runtime);
}

/** Removes the whole account: every service, then the registry entry. */
export async function removeCloudAccount(
  vaultPath: string,
  runtime: PimRuntime | null,
  record: CloudAccountRecord
): Promise<CloudAccountRecord[]> {
  if (record.services.files) await disableAccountService(vaultPath, runtime, record, "files");
  if (record.services.calendar) await disableAccountService(vaultPath, runtime, record, "calendar");
  if (record.services.mail) await disableAccountService(vaultPath, runtime, record, "mail");
  const stored = await loadCloudAccounts(vaultPath);
  await saveCloudAccounts(vaultPath, stored.filter((r) => r.id !== record.id));
  return refreshCloudAccounts(vaultPath, runtime);
}
