import { isTauri } from "@tauri-apps/api/core";
import { fetch as httpFetch } from "@tauri-apps/plugin-http";
import {
  adoptFilesSignIn,
  bindSignedInAccount,
  completeSignIn,
  needsConsent,
  oauthAccessKey,
  plainvaGoogleClient,
  prepareSignIn,
  isRetiredPlainvaClient,
  readStoredOAuthAccess,
  retiredAccessReplacement,
  replaceProtectedSlot,
  resolveOAuthAccess,
  validClientId,
  type AccessResolution,
  type CloudAccountRecord,
  type CloudServiceId,
  type CompletedSignIn,
  type FinishedSignIn,
  type OAuthFamily,
  type PreparedSignIn,
  type StoredOAuthAccess,
} from "@plainva/ui";
import {
  checkMailLogin,
  forgetGraphMailRuntime,
  legacyMailSecretKey,
  listMailAccounts,
  mailSecretKey,
  mailTransport,
  replaceMailbox,
  saveBrokerMailAccount,
  saveMailAccount,
  type MailAccountConfig,
} from "@plainva/ui/mail";
import { credentialManager } from "./CredentialManager";
import { authorizeDrive } from "./driveAuth";
import { authorizeOneDrive } from "./oneDriveAuth";
import { oauthErrorText } from "./oauthLoopback";
import { loadCloudAccounts, saveCloudAccounts, refreshCloudAccounts } from "./cloudAccounts";
import { claimPendingMailbox, getAccountBroker, getAccountToken, saveAccountToken, setPendingBrokerAccount } from "./accountBroker";
import { announceCredentials, clearOtherSyncSlots, connectMicrosoftMailAccount } from "./cloudAccountsActions";
import { connectGoogleAccount, connectMicrosoftAccount } from "./pim/pimAccounts";
import { getPimCredentials } from "./pim/pimCredentials";
import { restartPimAccountAfterLogin, type PimRuntime } from "./pim/pimRuntime";
import { accountCredentialStore } from "./accountCredentialStore";
import { slot, legacySlot } from "./keychainSlots";

/**
 * The desktop side of the one account sign-in (account sign-in plan K3).
 *
 * Every Google and Microsoft sign-in of the desktop goes through
 * `signInCloudAccount`: connecting an account, adding a service to it, signing
 * it in again. The shared core decides what to ask for and what was granted;
 * this file holds the desktop's hands - the loopback consent, the slots, the
 * calendar runtime - and keeps one rule the old wizard broke: nothing reloads
 * the vault until every service is bound (finding 2026-10-23, plan § 1.1).
 */

export class AccessUnavailableError extends Error {
  constructor(readonly family: OAuthFamily, readonly problem: Exclude<AccessResolution, { ok: true }>["problem"]) {
    super(`No usable ${family} access on this device: ${problem}`);
    this.name = "AccessUnavailableError";
  }
}

const env = (): Record<string, unknown> => import.meta.env as unknown as Record<string, unknown>;

/**
 * The device's choice, adopting a historical own client once.
 *
 * Before this plan the own client lived in each account's slots. The first
 * read on a device without a stored choice takes it from there, so nobody has
 * to type a client id again after the update - and writes it as the device's
 * choice, which is from then on the only place it is read from.
 */
export async function readDeviceAccess(family: OAuthFamily, vaultPath?: string): Promise<StoredOAuthAccess | null> {
  const stored = readStoredOAuthAccess(await credentialManager.readSecret<unknown>(oauthAccessKey(family)));
  const replacement = retiredAccessReplacement(family, stored);
  if (replacement) {
    await credentialManager.writeSecret(oauthAccessKey(family), replacement);
    return replacement;
  }
  if (stored || !vaultPath) return stored;
  // Nothing to adopt is a decision too, and it is kept (finding 2026-10-26):
  // the adoption tells an own client from the standard one by comparing with
  // the client THIS build ships, so a device that never stored its choice
  // took the previous build's standard client for an own one the day the
  // build switched to a new Google project - and signed in with a client that
  // project no longer had ("Error 401: deleted_client").
  const adopted = await adoptHistoricalClient(family, vaultPath) ?? (family === "google" ? { source: "plainva" as const } : null);
  if (adopted) await credentialManager.writeSecret(oauthAccessKey(family), adopted);
  return adopted;
}

export async function saveDeviceAccess(family: OAuthFamily, access: StoredOAuthAccess): Promise<void> {
  if (access.source === "own" && (!access.clientId || !validClientId(family, access.clientId))) throw new Error("invalid client id");
  await credentialManager.writeSecret(oauthAccessKey(family), access);
}

export async function deviceAccess(family: OAuthFamily, vaultPath?: string): Promise<AccessResolution> {
  return resolveOAuthAccess(family, "desktop", await readDeviceAccess(family, vaultPath), env());
}

async function adoptHistoricalClient(family: OAuthFamily, vaultPath: string): Promise<StoredOAuthAccess | null> {
  if (family !== "google") return null; // Microsoft always had Plainva's client; an own one stays opt-in.
  const plainva = plainvaGoogleClient(env(), "desktop");
  const own = (client: { clientId?: string; clientSecret?: string } | null | undefined): StoredOAuthAccess | null =>
    client?.clientId && client.clientSecret && client.clientId !== plainva?.clientId && validClientId("google", client.clientId)
      && !isRetiredPlainvaClient("google", client.clientId)
      ? { source: "own", clientId: client.clientId, clientSecret: client.clientSecret }
      : null;
  for (const record of await loadCloudAccounts(vaultPath)) {
    if (record.family !== "google") continue;
    const found = own(await getAccountToken(vaultPath, record.id).catch(() => null));
    if (found) return found;
    if (record.services.calendar) {
      const pim = await getPimCredentials(vaultPath, record.services.calendar.pimAccountId).catch(() => null);
      if (pim?.kind === "google") {
        const fromPim = own(pim);
        if (fromPim) return fromPim;
      }
    }
  }
  return own(await credentialManager.getDriveCredentials(vaultPath).catch(() => null));
}

export interface SignInRequest {
  family: OAuthFamily;
  cardId?: string;
  add: CloudServiceId[];
  /** Gmail outside the consent: the app password the person entered (E5). */
  mailPassword?: { email: string; pass: string };
}

export interface SignInOutcome extends FinishedSignIn {
  prepared: PreparedSignIn;
  completed?: CompletedSignIn;
}

async function mailKindOf(vaultPath: string, record: CloudAccountRecord | undefined): Promise<string | undefined> {
  if (!record?.services.mail) return undefined;
  return (await listMailAccounts(vaultPath)).find((mail) => mail.id === record.services.mail!.mailAccountId)?.kind;
}

/**
 * Connects, extends or signs in again one Google or Microsoft account.
 *
 * `getRuntime` is read at the moment the calendar needs it, never captured up
 * front: a runtime held from before a reload is a stopped one.
 */
export async function signInCloudAccount(vaultPath: string, getRuntime: () => PimRuntime | null, request: SignInRequest): Promise<SignInOutcome> {
  const resolution = await deviceAccess(request.family, vaultPath);
  if (!resolution.ok) throw new AccessUnavailableError(request.family, resolution.problem);
  const access = resolution.access;
  const record = request.cardId ? (await loadCloudAccounts(vaultPath)).find((entry) => entry.id === request.cardId) : undefined;
  const prepared = prepareSignIn(
    {
      vaultId: vaultPath, family: request.family, ...(request.cardId ? { cardId: request.cardId } : {}), add: request.add, access,
      // An app password the person entered takes the mailbox outside the consent (E5).
      ...(request.mailPassword && request.add.includes("mail") ? { outside: ["mail"] as CloudServiceId[] } : {}),
    },
    record ? { record, mailKind: await mailKindOf(vaultPath, record) } : undefined,
  );

  if (!needsConsent(prepared)) {
    // Only an app-password mailbox to add (Gmail without a mail-enabled access).
    if (!record || !request.mailPassword) throw new Error("nothing to sign in");
    const mailAccountId = await addPasswordMailbox(vaultPath, request.mailPassword);
    const saved = { ...record, services: { ...record.services, mail: { mailAccountId } } };
    await saveCloudAccounts(vaultPath, [...(await loadCloudAccounts(vaultPath)).filter((entry) => entry.id !== record.id), saved]);
    // The mailbox Google refused gives way to the app-password one (E7), with
    // everything the person set on it; filed mails stay notes (review finding 1).
    const replaced = record.services.mail?.mailAccountId;
    if (replaced && replaced !== mailAccountId) await replaceMailbox(vaultPath, replaced, mailAccountId);
    await refreshCloudAccounts(vaultPath, getRuntime());
    return { prepared, record: saved, rows: [{ service: "mail", state: "active" }] };
  }

  const consent = request.family === "google"
    ? await authorizeDrive({ clientId: access.clientId, clientSecret: access.clientSecret ?? "", scope: prepared.scope, includeAccessToken: true, loginHint: prepared.loginHint })
    : await authorizeOneDrive({ clientId: access.clientId, scope: prepared.scope, includeAccessToken: true, loginHint: prepared.loginHint });
  const completed = await completeSignIn(prepared, {
    refreshToken: consent.refreshToken,
    accessToken: consent.accessToken ?? "",
    ...(consent.grantedScope !== undefined ? { grantedScope: consent.grantedScope } : {}),
  }, {
    fetch: httpFetch,
    loadCards: () => loadCloudAccounts(vaultPath),
    saveGrant: (cardId, token) => saveAccountToken(vaultPath, cardId, token),
    newCardId: () => crypto.randomUUID(),
  });

  let filesBound = false;
  const finished = await bindSignedInAccount(prepared, completed, {
    loadCards: () => loadCloudAccounts(vaultPath),
    saveCards: (records) => saveCloudAccounts(vaultPath, records),
    setPending: (cardId, family) => setPendingBrokerAccount(cardId ? { vaultPath, accountId: cardId, family } : null),
    bindFiles: async (cardId) => {
      filesBound = true;
      return bindFiles(vaultPath, cardId, completed, access.clientSecret);
    },
    bindCalendar: (cardId, done, existing) => bindCalendar(vaultPath, getRuntime, cardId, done, existing, access.clientSecret),
    bindMail: (cardId, done, existing) => bindMail(vaultPath, cardId, done, existing),
    bindMailPassword: request.mailPassword
      ? async () => ({ mailAccountId: await addPasswordMailbox(vaultPath, request.mailPassword!) })
      : undefined,
    afterBinding: async ({ calendarAccountId }) => {
      // A runtime that is still being replaced is waited for; one that never
      // comes starts its worker on its own when it does (pimRuntime).
      const runtime = calendarAccountId ? await livingPimRuntime(getRuntime).catch(() => null) : null;
      if (runtime && calendarAccountId) {
        const row = (await runtime.cache.listAccounts()).find((entry) => entry.id === calendarAccountId);
        if (row && !row.enabled) await runtime.cache.upsertAccount({ ...row, enabled: true });
        await restartPimAccountAfterLogin(runtime, calendarAccountId);
      }
      // The ONE reload: the sync worker picks up the files service only now,
      // after the calendar and the mailbox were bound under a living runtime.
      if (filesBound) announceCredentials(true);
      await refreshCloudAccounts(vaultPath, getRuntime());
    },
    describeFailure: (error) => oauthErrorText(error),
  });
  return { ...finished, prepared, completed };
}

/**
 * "Open an online vault" (account sign-in plan K4b): the consent ran with this
 * device's access before the vault existed, the files slot was written with
 * the picked folder. This makes the sign-in the card's, with its identity,
 * like every other sign-in - before the vault opens, so the first sync already
 * renews through the card.
 */
export async function adoptOnlineVaultSignIn(vaultPath: string, family: OAuthFamily, access: AccessResolution & { ok: true }, refreshToken: string): Promise<CloudAccountRecord> {
  const finished = await adoptFilesSignIn({ vaultId: vaultPath, family, access: access.access, grant: { refreshToken } }, {
    fetch: httpFetch,
    loadCards: () => loadCloudAccounts(vaultPath),
    saveGrant: (cardId, token) => saveAccountToken(vaultPath, cardId, token),
    newCardId: () => crypto.randomUUID(),
    saveCards: (records) => saveCloudAccounts(vaultPath, records),
    setPending: (cardId, fam) => setPendingBrokerAccount(cardId ? { vaultPath, accountId: cardId, family: fam } : null),
    bindFiles: (cardId, completed) => bindFiles(vaultPath, cardId, completed, access.access.clientSecret),
    bindCalendar: () => Promise.reject(new Error("not part of an online vault sign-in")),
    bindMail: () => Promise.reject(new Error("not part of an online vault sign-in")),
    // The caller opens the vault next; that is its one load.
    afterBinding: async () => undefined,
    describeFailure: (error) => oauthErrorText(error),
  });
  const files = finished.rows.find((row) => row.service === "files");
  if (files?.state !== "active") throw new Error(files?.detail ?? "files were not granted");
  return finished.record;
}

async function bindFiles(vaultPath: string, cardId: string, completed: CompletedSignIn, clientSecret: string | undefined): Promise<{ provider: "drive" | "onedrive" }> {
  const family = completed.identity.issuer;
  const clientId = completed.token.clientId;
  if (family === "google") {
    const existing = await credentialManager.getDriveCredentials(vaultPath);
    await clearOtherSyncSlots(vaultPath, "drive");
    // The slot keeps the client and the folder choice; the sign-in is the card's.
    await credentialManager.saveDriveCredentials(vaultPath, { clientId, clientSecret: clientSecret ?? "", refreshToken: "", rootFolderName: existing?.rootFolderName });
    await getAccountBroker(vaultPath, cardId, "google").getAccessToken("files", completed.token);
    return { provider: "drive" };
  }
  const existing = await credentialManager.getOneDriveCredentials(vaultPath);
  await clearOtherSyncSlots(vaultPath, "onedrive");
  await credentialManager.saveOneDriveCredentials(vaultPath, { clientId, refreshToken: "", rootFolderName: existing?.rootFolderName });
  await getAccountBroker(vaultPath, cardId, "microsoft").getAccessToken("files", completed.token);
  return { provider: "onedrive" };
}

async function bindCalendar(
  vaultPath: string,
  getRuntime: () => PimRuntime | null,
  cardId: string,
  completed: CompletedSignIn,
  existing: string | undefined,
  clientSecret: string | undefined,
): Promise<{ pimAccountId: string; label?: string }> {
  const family = completed.identity.issuer;
  const clientId = completed.token.clientId;
  if (existing) {
    // Signing in again: the calendar row stays, its slot loses any token of
    // its own and names the client of the card's new sign-in.
    const previous = await getPimCredentials(vaultPath, existing);
    if (previous && previous.kind !== family) throw new Error("calendar of another provider");
    await replaceProtectedSlot(accountCredentialStore, [slot.calendar(vaultPath, existing), legacySlot.calendar(vaultPath, existing)], previous ?? null, {
      ...previous, kind: family, clientId, ...(family === "google" ? { clientSecret: clientSecret ?? "" } : {}), refreshToken: "", loginRevision: crypto.randomUUID(),
    });
    return { pimAccountId: existing };
  }
  const row = await withLivingPimRuntime(getRuntime, (runtime) => family === "google"
    ? connectGoogleAccount(runtime, vaultPath, { clientId, clientSecret: clientSecret ?? "", viaBroker: true, brokerAccountId: cardId, expectedIdentity: completed.identity })
    : connectMicrosoftAccount(runtime, vaultPath, { clientId, viaBroker: true, brokerAccountId: cardId, expectedIdentity: completed.identity }));
  return { pimAccountId: row.id, label: row.label };
}

/** How long a calendar binding waits for the vault's next runtime. */
export const RUNTIME_WAIT_MS = 20_000;

/**
 * The calendar runtime that is ALIVE now (finding 2026-10-26).
 *
 * Adding a Google account with files, calendar and mail on the desktop ended
 * with files and mail connected and the calendar refused with "the target
 * account or vault changed": the runtime the binding was handed had been
 * stopped by a vault reload - one that had started before the sign-in (the
 * reload after removing the previous account, say) and whose new runtime was
 * not yet in place. Files and mail need no runtime, so only the calendar fell.
 * The binding now takes the runtime alive at the moment it runs and waits for
 * the next one while a reload is replacing it; "no vault open" still says so
 * at once.
 */
export async function livingPimRuntime(getRuntime: () => PimRuntime | null, waitMs = RUNTIME_WAIT_MS): Promise<PimRuntime> {
  const deadline = Date.now() + waitMs;
  for (;;) {
    const runtime = getRuntime();
    if (!runtime) throw new Error("calendar needs the open vault's runtime");
    if (runtime.isActive()) return runtime;
    if (Date.now() >= deadline) throw new Error("pim runtime changed");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/** Runs `bind` under the living runtime; a reload that stops it half way gets one more turn with the next. */
export async function withLivingPimRuntime<T>(getRuntime: () => PimRuntime | null, bind: (runtime: PimRuntime) => Promise<T>, waitMs = RUNTIME_WAIT_MS): Promise<T> {
  const runtime = await livingPimRuntime(getRuntime, waitMs);
  try {
    return await bind(runtime);
  } catch (error) {
    if (runtime.isActive()) throw error;
    return bind(await livingPimRuntime(getRuntime, waitMs));
  }
}

async function stableGmailId(subject: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`gmail:${subject}`));
  return "gmail-" + [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function bindMail(vaultPath: string, cardId: string, completed: CompletedSignIn, existing: string | undefined): Promise<{ mailAccountId: string }> {
  const family = completed.identity.issuer;
  if (existing) {
    const mailbox = (await listMailAccounts(vaultPath)).find((entry) => entry.id === existing);
    const kind = family === "google" ? "gmail" : "microsoft";
    if (mailbox && (mailbox.kind ?? "imap") === kind) {
      forgetGraphMailRuntime(vaultPath, existing);
      const previous = await credentialManager.readSecret<unknown>(mailSecretKey(vaultPath, existing))
        ?? await credentialManager.readSecret<unknown>(legacyMailSecretKey(vaultPath, existing));
      await replaceProtectedSlot(accountCredentialStore, [mailSecretKey(vaultPath, existing), legacyMailSecretKey(vaultPath, existing)], previous ?? null,
        { ...(previous as object | null), refreshToken: "" });
      return { mailAccountId: existing };
    }
    // An app-password mailbox at a card whose consent now carries mail: the new
    // OAuth mailbox replaces it at the card; the password mailbox is kept.
  }
  if (family === "microsoft") {
    const { id } = await connectMicrosoftMailAccount(vaultPath, completed.token.clientId, true);
    return { mailAccountId: id };
  }
  const id = await stableGmailId(completed.identity.subject);
  claimPendingMailbox(vaultPath, id);
  const accessToken = await getAccountBroker(vaultPath, cardId, "google").getAccessToken("mail", completed.token);
  await mailTransport().checkLogin({ host: "imap.gmail.com", port: 993, user: completed.email, pass: accessToken, auth: "xoauth2" });
  const account: MailAccountConfig = {
    id, label: completed.email, kind: "gmail", host: "imap.gmail.com", port: 993, user: completed.email, smtpHost: "smtp.gmail.com", smtpPort: 465,
  };
  await saveBrokerMailAccount(vaultPath, account, "connect");
  return { mailAccountId: id };
}

/** Gmail with an app password, bound to the same card (E5). */
async function addPasswordMailbox(vaultPath: string, input: { email: string; pass: string }): Promise<string> {
  const config: Omit<MailAccountConfig, "id" | "label"> = { host: "imap.gmail.com", port: 993, user: input.email, smtpHost: "smtp.gmail.com", smtpPort: 465 };
  await checkMailLogin(config, input.pass);
  const id = crypto.randomUUID();
  await saveMailAccount(vaultPath, { id, label: input.email, ...config }, input.pass, "connect");
  return id;
}

/** Whether this desktop can run an OAuth consent at all (not in the browser preview). */
export function canSignIn(): boolean {
  return isTauri();
}
