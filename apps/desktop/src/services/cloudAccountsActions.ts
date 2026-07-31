import { DRIVE_DEFAULT_SCOPE, GOOGLE_CALENDAR_SCOPES } from "@plainva/core";
import {
  PLAINVA_ONEDRIVE_CLIENT_ID,
  PLAINVA_DROPBOX_APP_KEY,
  accountServices,
  identityKey,
  verifiedProviderIdentityOf,
  type CloudAccountRecord,
  type CloudProviderFamily,
  type CloudServiceId,
  type SyncProviderId,
  type VerifiedProviderIdentity,
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
import { checkCalDavLogin, connectCalDavAccount, connectGoogleAccount, connectMicrosoftAccount, removePimAccount } from "./pim/pimAccounts";
import { savePimCredentials, getPimCredentials } from "./pim/pimCredentials";
import { authorizeGooglePim, authorizeMicrosoftPim } from "./pim/pimAuth";
import { graphMailAddress, forgetGraphMailRuntime } from "@plainva/ui/mail";
import { authorizeMicrosoftMail } from "./mail/graphMailAuth";
import { checkMailLogin } from "@plainva/ui/mail";
import {
  listMailAccounts,
  mailAccountKind,
  mailSecretKey,
  saveMailAccount,
  saveMicrosoftMailAccount,
  saveMailRefreshToken,
  removeMailAccount,
  type MailAccountConfig,
} from "@plainva/ui/mail";
import type { PimRuntime } from "./pim/pimRuntime";
import { loadCloudAccounts, saveCloudAccounts, refreshCloudAccounts } from "./cloudAccounts";
import {
  brokerFamily,
  clearAccountToken,
  getAccountToken,
  googleScopeFor,
  microsoftUnionScope,
  saveAccountToken,
  setPendingBrokerAccount,
} from "./accountBroker";

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

/**
 * Google's consent covers the ACCOUNT, not one service — so when files and
 * calendar are ticked together, one run with the union of both scopes replaces
 * two browser round trips (stage B / B2). Google refresh tokens do not rotate,
 * which is why the resulting token can safely back both services.
 */
function googleUnionScope(services: CloudServiceId[]): string | null {
  const parts: string[] = [];
  if (services.includes("files")) parts.push(DRIVE_DEFAULT_SCOPE);
  if (services.includes("calendar")) parts.push(GOOGLE_CALENDAR_SCOPES);
  return parts.length > 1 ? parts.join(" ") : null;
}

/** Connects the FILES service of the request. Binds nothing before success. */
async function connectFiles(
  vaultPath: string,
  req: ConnectRequest,
  googleToken?: string,
  msViaBroker?: boolean,
  googleViaBroker?: boolean
): Promise<SyncProviderId> {
  switch (req.family) {
    case "microsoft": {
      const clientId = req.byoClientId?.trim() || PLAINVA_ONEDRIVE_CLIENT_ID;
      const existing = await credentialManager.getOneDriveCredentials(vaultPath);
      // Broker-backed: the union consent already ran and owns the refresh
      // token; this slot keeps only the client id and the folder choice.
      const creds = msViaBroker ? { clientId, refreshToken: "" } : await authorizeOneDrive({ clientId });
      await clearOtherSyncSlots(vaultPath, "onedrive");
      await credentialManager.saveOneDriveCredentials(vaultPath, { ...creds, rootFolderName: existing?.rootFolderName });
      announceCredentials(true);
      return "onedrive";
    }
    case "google": {
      const clientId = req.byoClientId?.trim() ?? "";
      const clientSecret = req.googleClientSecret?.trim() ?? "";
      const existing = await credentialManager.getDriveCredentials(vaultPath);
      // Broker-backed: the account slot owns the refresh token, this slot keeps
      // the client and the folder choice — the same shape OneDrive uses. The
      // empty string is deliberate: a copy here is what used to go stale.
      const creds = googleViaBroker
        ? { clientId, clientSecret, refreshToken: "" }
        : googleToken
          ? { clientId, clientSecret, refreshToken: googleToken }
          : await authorizeDrive({ clientId, clientSecret });
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
  googleToken?: string,
  msViaBroker?: boolean,
  googleViaBroker?: boolean
): Promise<{ id: string; label: string; verifiedProviderIdentity?: VerifiedProviderIdentity }> {
  switch (req.family) {
    case "microsoft": {
      const clientId = req.byoClientId?.trim() || PLAINVA_ONEDRIVE_CLIENT_ID;
      const row = await connectMicrosoftAccount(runtime, vaultPath, { clientId, viaBroker: msViaBroker });
      return {
        id: row.id,
        label: row.label,
        verifiedProviderIdentity: verifiedProviderIdentityOf(row) ?? undefined,
      };
    }
    case "google": {
      const row = await connectGoogleAccount(runtime, vaultPath, {
        clientId: req.byoClientId?.trim() ?? "",
        clientSecret: req.googleClientSecret?.trim() ?? "",
        refreshToken: googleToken,
        viaBroker: googleViaBroker,
      });
      return {
        id: row.id,
        label: row.label,
        verifiedProviderIdentity: verifiedProviderIdentityOf(row) ?? undefined,
      };
    }
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

async function connectMicrosoftMailAccount(vaultPath: string, clientId: string, viaBroker?: boolean): Promise<{ id: string; address: string }> {
  const { refreshToken } = viaBroker ? { refreshToken: "" } : await authorizeMicrosoftMail({ clientId });
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

async function connectMail(vaultPath: string, req: ConnectRequest, msViaBroker?: boolean): Promise<{ id: string; identity?: string }> {
  if (req.family === "microsoft") {
    const clientId = req.byoClientId?.trim() || PLAINVA_ONEDRIVE_CLIENT_ID;
    const res = await connectMicrosoftMailAccount(vaultPath, clientId, msViaBroker);
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
  // What the consent covers can be wider than what is connected: repairing one
  // service must not narrow the account token the others read.
  const consented = SERVICE_ORDER.filter((s) => (req.consentServices ?? req.services).includes(s));

  // One consent for the whole Google account instead of one per service. The
  // scopes are the union of exactly the SELECTED services — ticking calendar
  // alone must never hand out Drive access (the scope minimisation this plan
  // was built on).
  let googleToken: string | undefined;
  let googleAccountId: string | undefined;
  let grantedScope: string | undefined;
  const unionScope = req.family === "google" ? googleUnionScope(consented) : null;
  if (unionScope) {
    for (const service of selected) if (service !== "mail") onStatus(service, { state: "pending" });
    try {
      const clientId = req.byoClientId?.trim() ?? "";
      const clientSecret = req.googleClientSecret?.trim() ?? "";
      const creds = await authorizeDrive({ clientId, clientSecret, scope: unionScope });
      googleToken = creds.refreshToken;
      // Google's consent screen grants permissions ONE BY ONE. Asking for three
      // and recording "three granted" is how an account ended up with a sign-in
      // that could sync files and silently not read a calendar — for hours,
      // because nothing ever compared the answer to the request (finding
      // 2026-07-30). Whatever Google says it gave is what gets stored, and a
      // service that was left out says so instead of binding.
      // Storing the ANSWER means the scope guard now compares against what the
      // account can really do, instead of against our own wish list.
      grantedScope = creds.grantedScope ?? unionScope;
      // The token goes into the ACCOUNT slot and every service reads it through
      // the broker. It used to be copied into each service slot instead — and a
      // renewal then reached exactly one copy (finding 2026-07-28).
      if (googleToken) {
        googleAccountId = newId();
        await saveAccountToken(vaultPath, googleAccountId, { clientId, clientSecret, refreshToken: googleToken, scopes: grantedScope });
        setPendingBrokerAccount({ vaultPath, accountId: googleAccountId, family: "google" });
        result.accountId = googleAccountId;
      }
    } catch (err) {
      for (const service of selected) {
        if (service !== "mail") onStatus(service, { state: "error", detail: err instanceof Error ? err.message : String(err) });
      }
      throw Object.assign(err instanceof Error ? err : new Error(String(err)), { partialResult: result });
    }
  }

  // Microsoft consents per account as well, but its refresh token ROTATES —
  // so the union token must NOT be copied into the per-service slots. It goes
  // into the account slot, and every service reads through the broker. The
  // account id is minted here (not in bindConnectResult) because the service
  // validations below already need to resolve a token.
  let msAccountId: string | undefined;
  if (req.family === "microsoft" && consented.length > 1) {
    const clientId = req.byoClientId?.trim() || PLAINVA_ONEDRIVE_CLIENT_ID;
    const scope = microsoftUnionScope(consented);
    for (const service of selected) onStatus(service, { state: "pending" });
    try {
      const { refreshToken } = await authorizeOneDrive({ clientId, scope });
      msAccountId = newId();
      await saveAccountToken(vaultPath, msAccountId, { clientId, refreshToken, scopes: scope });
      setPendingBrokerAccount({ vaultPath, accountId: msAccountId, family: "microsoft" });
      result.accountId = msAccountId;
    } catch (err) {
      for (const service of selected) {
        onStatus(service, { state: "error", detail: err instanceof Error ? err.message : String(err) });
      }
      throw Object.assign(err instanceof Error ? err : new Error(String(err)), { partialResult: result });
    }
  }

  try {
    for (const service of selected) {
      onStatus(service, { state: "pending" });
      try {
        if (service === "files") {
          result.filesProvider = await connectFiles(vaultPath, req, googleToken, !!msAccountId, !!googleAccountId);
        } else if (service === "calendar") {
          if (!runtime) throw new Error("calendar needs the open vault's runtime");
          const row = await connectCalendar(vaultPath, runtime, req, googleToken, !!msAccountId, !!googleAccountId);
          result.pimAccountId = row.id;
          if (!result.identity) result.identity = row.label;
          if (!result.verifiedProviderIdentity && row.verifiedProviderIdentity) {
            result.verifiedProviderIdentity = row.verifiedProviderIdentity;
          }
        } else {
          const res = await connectMail(vaultPath, req, !!msAccountId);
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
  } finally {
    // The pending marker exists only for the duration of the connect; after
    // this the registry record carries the account and the normal lookup wins.
    if (msAccountId || googleAccountId) setPendingBrokerAccount(null);
  }
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
  const record: CloudAccountRecord = existing
    ? { ...existing }
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
  // A union consent mints its own id and writes the fresh refresh token under
  // it. When this binding targets an EXISTING card, that token would belong to
  // no account while the card keeps reading its old, dead slot — signing in
  // again would change nothing, forever (finding 2026-07-30). So the token
  // moves to the account it was just granted for, and the orphan is removed
  // rather than left behind as a second, stale copy.
  let marked = false;
  if (result.accountId && result.accountId !== record.id) {
    const minted = await getAccountToken(vaultPath, result.accountId);
    if (minted) {
      await saveAccountToken(vaultPath, record.id, minted);
      await clearAccountToken(vaultPath, result.accountId);
      const family = brokerFamily(record.family);
      if (family) {
        setPendingBrokerAccount({ vaultPath, accountId: record.id, family });
        marked = true;
      }
    }
  }
  try {
    // A freshly connected files service moves the vault's XOR slot: strip the
    // files reference from every OTHER account so exactly one card carries it.
    const others = stored
      .filter((r) => r.id !== record.id)
      .map((r) => (result.filesProvider && r.services.files ? { ...r, services: { ...r.services, files: undefined } } : r));
    await saveCloudAccounts(vaultPath, [...others, record]);
    return { records: await refreshCloudAccounts(vaultPath, runtime), accountId: record.id };
  } finally {
    // The marker is for the length of THIS binding only. Left standing, it makes
    // every service of the vault draw the token of the account just connected —
    // which is how adding an Outlook account broke the Google calendar with a
    // 401 until the Outlook account was deleted again (finding 2026-07-30).
    if (marked) setPendingBrokerAccount(null);
  }
}

/** Reads a reusable Google BYO client (id + secret) from the account's existing slots. */
export async function googleByoFromSlots(
  vaultPath: string,
  record: CloudAccountRecord
): Promise<{ clientId: string; clientSecret: string } | null> {
  const account = await getAccountToken(vaultPath, record.id);
  if (account?.clientId && account.clientSecret) {
    return { clientId: account.clientId, clientSecret: account.clientSecret };
  }
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

/** Microsoft re-auth also reads its client only from installation-local slots. */
async function microsoftClientFromSlots(vaultPath: string, record: CloudAccountRecord): Promise<string> {
  const account = await getAccountToken(vaultPath, record.id);
  if (account?.clientId) return account.clientId;
  if (record.services.files?.provider === "onedrive") {
    const files = await credentialManager.getOneDriveCredentials(vaultPath);
    if (files?.clientId) return files.clientId;
  }
  if (record.services.calendar) {
    const pim = await getPimCredentials(vaultPath, record.services.calendar.pimAccountId);
    if (pim?.kind === "microsoft" && pim.clientId) return pim.clientId;
  }
  if (record.services.mail) {
    const mail = (await listMailAccounts(vaultPath)).find((entry) => entry.id === record.services.mail?.mailAccountId);
    if (mail?.clientId) return mail.clientId;
  }
  return PLAINVA_ONEDRIVE_CLIENT_ID;
}

/**
 * Forgets a stored calendar-account failure. Best-effort on purpose: this runs
 * after a successful repair, and a cache write that fails must not turn that
 * success into an error.
 */
async function clearPimAccountError(runtime: PimRuntime | null, pimAccountId: string): Promise<void> {
  if (!runtime) return;
  await runtime.cache.setScopeState(pimAccountId, "account", { lastError: null }).catch(() => undefined);
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
  // An account that shares one token renews it ONCE for everything. Signing in
  // per service is what let a Google calendar keep a dead token while the file
  // sync had a fresh one (finding 2026-07-28) — and for the user, "sign in
  // again" and "one login for all services" were never two different wishes.
  if (brokerFamily(record.family) && accountServices(record).filter((s) => record.family !== "google" || s !== "mail").length > 1) {
    await unifyAccountLogin(vaultPath, runtime, record, onStatus);
    return;
  }
  const google = record.family === "google" ? await googleByoFromSlots(vaultPath, record) : null;
  if (record.family === "google" && !google) throw new Error("missing Google client");
  const msClientId = await microsoftClientFromSlots(vaultPath, record);

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
      await clearPimAccountError(runtime, accountId);
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

/** One password-backed service of an account, ready to be verified and written. */
interface PasswordSlotPlan {
  service: CloudServiceId;
  /** Proves the new secret against the live endpoint. Throws on failure. */
  verify: (pass: string) => Promise<void>;
  /** Writes the new secret. Only runs after EVERY verify() succeeded. */
  write: (pass: string) => Promise<void>;
  /** Restores the pre-write value if a later write fails. */
  rollback: () => Promise<void>;
}

/**
 * Which services of an account are secured by a PASSWORD (as opposed to an
 * OAuth token or an S3 key pair). Synchronous, so the settings page can decide
 * whether to offer the credentials card without touching the keychain — the
 * same predicate then drives passwordSlots below, so both stay in step.
 *
 * Calendar is CalDAV unless the family authenticates through OAuth; mail is
 * IMAP unless it is Microsoft Graph (Gmail deliberately uses an app password).
 */
export function passwordServicesOf(record: CloudAccountRecord): CloudServiceId[] {
  const services: CloudServiceId[] = [];
  if (record.services.files?.provider === "webdav") services.push("files");
  if (record.services.calendar && record.family !== "google" && record.family !== "microsoft") services.push("calendar");
  if (record.services.mail && record.family !== "microsoft") services.push("mail");
  return services;
}

/**
 * Reads the stored slot of every password-backed service and wraps it into a
 * verify/write/rollback plan. A service whose slot is missing or holds another
 * credential kind is skipped rather than guessed at.
 */
async function passwordSlots(
  vaultPath: string,
  runtime: PimRuntime | null,
  record: CloudAccountRecord
): Promise<PasswordSlotPlan[]> {
  const plans: PasswordSlotPlan[] = [];
  const wanted = new Set(passwordServicesOf(record));

  if (wanted.has("files")) {
    const creds = await credentialManager.getWebDavCredentials(vaultPath);
    if (creds) {
      plans.push({
        service: "files",
        verify: (pass) => buildWebDavTarget({ ...creds, pass }).listFolders("").then(() => undefined),
        write: (pass) => credentialManager.saveWebDavCredentials(vaultPath, { ...creds, pass }),
        rollback: () => credentialManager.saveWebDavCredentials(vaultPath, creds),
      });
    }
  }

  const pimId = wanted.has("calendar") ? record.services.calendar?.pimAccountId : undefined;
  if (pimId && runtime) {
    const creds = await getPimCredentials(vaultPath, pimId);
    if (creds?.kind === "caldav") {
      plans.push({
        service: "calendar",
        verify: (pass) => checkCalDavLogin({ url: creds.url, user: creds.user, pass }),
        write: (pass) => savePimCredentials(vaultPath, pimId, { ...creds, pass }),
        rollback: () => savePimCredentials(vaultPath, pimId, creds),
      });
    }
  }

  const mailId = wanted.has("mail") ? record.services.mail?.mailAccountId : undefined;
  if (mailId) {
    const account = (await listMailAccounts(vaultPath)).find((a) => a.id === mailId);
    if (account && mailAccountKind(account) === "imap") {
      const stored = await credentialManager.readSecret<{ pass?: string }>(mailSecretKey(vaultPath, mailId));
      const previous = stored?.pass ?? "";
      plans.push({
        service: "mail",
        verify: (pass) => checkMailLogin(account, pass).then(() => undefined),
        write: (pass) => saveMailAccount(vaultPath, account, pass),
        rollback: () => saveMailAccount(vaultPath, account, previous),
      });
    }
  }

  return plans;
}

/**
 * Updates the password of EVERY password-backed service of one account — the
 * stage-B answer to "the app password was rotated" (before this, the only way
 * was removing the account and connecting it again, service by service).
 *
 * Ordering is deliberate and mirrors createSecretsPort: verify every service
 * FIRST, write only afterwards, and roll back what was already written if a
 * later write fails. A half-updated account (files reachable, calendar locked
 * out) is the outcome this prevents.
 */
export async function updateAccountPassword(
  vaultPath: string,
  runtime: PimRuntime | null,
  record: CloudAccountRecord,
  pass: string,
  onStatus: ServiceStatusCb
): Promise<void> {
  const plans = await passwordSlots(vaultPath, runtime, record);
  if (plans.length === 0) throw new Error("this account has no password-backed service");

  for (const plan of plans) {
    onStatus(plan.service, { state: "pending" });
    try {
      await plan.verify(pass);
    } catch (err) {
      onStatus(plan.service, { state: "error", detail: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  }

  const written: PasswordSlotPlan[] = [];
  for (const plan of plans) {
    try {
      await plan.write(pass);
      written.push(plan);
      onStatus(plan.service, { state: "ok" });
    } catch (err) {
      for (const done of written) await done.rollback().catch(() => undefined);
      onStatus(plan.service, { state: "error", detail: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  }

  announceCredentials(false);
  if (record.services.calendar && runtime) void runtime.worker.triggerImmediate();
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

/**
 * True for a Microsoft account that still holds one refresh token per service
 * — i.e. it was connected before stage B and can be migrated to the shared
 * broker with a single re-consent (decision E8: an offer, never a forced
 * migration).
 */
export async function canUnifyAccountLogin(vaultPath: string, record: CloudAccountRecord): Promise<boolean> {
  if (!brokerFamily(record.family)) return false;
  if (accountServices(record).length < 2) return false;
  // Gmail rides on IMAP, so a Google account with mail + calendar shares only
  // the calendar through OAuth — one service is nothing to unify.
  if (record.family === "google" && accountServices(record).filter((s) => s !== "mail").length < 2) return false;
  return !(await getAccountToken(vaultPath, record.id))?.refreshToken;
}

/**
 * Moves an existing account onto the shared broker: ONE consent for the union
 * of the services it already carries, the token into the account slot, and the
 * per-service tokens cleared afterwards so nothing keeps refreshing a copy on
 * the side.
 *
 * The per-service slots themselves stay (they hold the folder choice, the
 * account row, the mailbox address); only their refresh tokens go.
 *
 * Google was added on 2026-07-28 and is also what `rerunAccountAuth` now uses
 * for these families: "sign in again" and "one login for all services" are the
 * same act, and doing it per service was how one Google service ended up with
 * a fresh token while the others kept a dead one.
 */
export async function unifyAccountLogin(
  vaultPath: string,
  runtime: PimRuntime | null,
  record: CloudAccountRecord,
  onStatus: ServiceStatusCb
): Promise<void> {
  const services = accountServices(record);
  const isGoogle = record.family === "google";
  const google = isGoogle ? await googleByoFromSlots(vaultPath, record) : null;
  if (isGoogle && !google) throw new Error("missing Google client");
  const clientId = isGoogle ? google!.clientId : await microsoftClientFromSlots(vaultPath, record);
  // Google's mail never travels through OAuth here, so it must not widen the
  // consent either.
  const scope = isGoogle
    ? googleUnionScope(services.filter((s) => s !== "mail")) ?? googleScopeFor(services.includes("files") ? "files" : "calendar")
    : microsoftUnionScope(services);
  for (const service of services) onStatus(service, { state: "pending" });

  const consent = isGoogle
    ? authorizeDrive({ clientId, clientSecret: google!.clientSecret, scope })
    : authorizeOneDrive({ clientId, scope });
  const { refreshToken } = await consent.catch((err) => {
    for (const service of services) {
      onStatus(service, { state: "error", detail: err instanceof Error ? err.message : String(err) });
    }
    throw err;
  });
  if (!refreshToken) throw new Error("the provider returned no refresh token");

  // Account slot first: from here on every service can resolve a token, so a
  // failure while clearing the old ones leaves the account working.
  await saveAccountToken(vaultPath, record.id, {
    clientId,
    ...(isGoogle ? { clientSecret: google!.clientSecret } : {}),
    refreshToken,
    scopes: scope,
  });

  if (record.services.files?.provider === "onedrive") {
    const creds = await credentialManager.getOneDriveCredentials(vaultPath);
    if (creds) await credentialManager.saveOneDriveCredentials(vaultPath, { ...creds, refreshToken: "" });
    onStatus("files", { state: "ok" });
  } else if (record.services.files?.provider === "drive") {
    const creds = await credentialManager.getDriveCredentials(vaultPath);
    if (creds) await credentialManager.saveDriveCredentials(vaultPath, { ...creds, refreshToken: "" });
    onStatus("files", { state: "ok" });
  }
  const pimId = record.services.calendar?.pimAccountId;
  if (pimId) {
    const creds = await getPimCredentials(vaultPath, pimId);
    if (creds?.kind === "microsoft" || creds?.kind === "google") {
      await savePimCredentials(vaultPath, pimId, { ...creds, refreshToken: "" });
    }
    // The stored failure is over; leaving it on screen is what made a successful
    // repair look like a no-op (report 2026-07-30).
    await clearPimAccountError(runtime, pimId);
    onStatus("calendar", { state: "ok" });
  }
  const mailId = record.services.mail?.mailAccountId;
  if (mailId) {
    forgetGraphMailRuntime(mailId);
    await saveMailRefreshToken(vaultPath, mailId, "");
    onStatus("mail", { state: "ok" });
  }

  announceCredentials(false);
  if (pimId && runtime) void runtime.worker.triggerImmediate();
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
  // The account-wide token outlives its services otherwise (E9.2).
  await clearAccountToken(vaultPath, record.id).catch(() => undefined);
  const stored = await loadCloudAccounts(vaultPath);
  await saveCloudAccounts(vaultPath, stored.filter((r) => r.id !== record.id));
  return refreshCloudAccounts(vaultPath, runtime);
}
