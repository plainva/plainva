import { devicePlatform } from "./devicePlatform";
import {
  adoptFilesSignIn,
  adoptedDropboxAccess,
  resolveDropboxAccess,
  bindSignedInAccount,
  completeSignIn,
  getPlatformServices,
  needsConsent,
  oauthAccessKey,
  plainvaGoogleClient,
  prepareSignIn,
  isRetiredPlainvaClient,
  readStoredOAuthAccess,
  retiredAccessReplacement,
  replaceProtectedSlot,
  resolveOAuthAccess,
  SignInNothingGrantedError,
  SignInWrongAccountError,
  validClientId,
  type AccessFamily,
  type AccessResolution,
  type DropboxAccessResolution,
  type CloudAccountRecord,
  type CloudServiceId,
  type OAuthAccess,
  type OAuthFamily,
  type StoredOAuthAccess,
  unionScope,
} from "@plainva/ui";
import { forgetGraphMailRuntime, legacyMailSecretKey, listMailAccounts, mailSecretKey } from "@plainva/ui/mail";
import i18n from "@plainva/ui/i18n";
import { webdavFetch } from "../adapters/webdavHttp";
import { beginPimOAuth, setOAuthPurposeHandler } from "./pim/pimOAuth";
import { getAccountToken, saveAccountToken } from "./accountBroker";
import { getPimCredentials, pimSecretKey } from "./pim/pimCredentials";
import { restartPimAccountAfterLogin } from "./pim/pimService";
import { loadCloudAccounts, saveCloudAccounts } from "./cloudAccountsStore";
import { getStoredProvider, switchProviderToAccountBroker } from "./syncService";
import type { MobileSyncProvider } from "./syncSlot";
import { authorizeNativeGoogle } from "./googleNativeAuthorization";
import { accountCredentialStore } from "./accountCredentialStore";
import { startConnectQueue } from "./connectQueue";
import { announceAccountLogin } from "./accountLogin";
import { markSignInAnnounced } from "./signInNotice";

/**
 * The phone's side of the one account sign-in (account sign-in plan K4).
 *
 * The same core as on the desktop (`prepareSignIn`, `completeSignIn`,
 * `bindSignedInAccount`); what differs is the platform step - the consent
 * leaves the app through the browser or, with Plainva's own client on
 * Android, the system sheet, and comes back through the `signin` purpose of
 * the OAuth transaction, also after a cold start.
 *
 * Services the card already carries are bound again right here. A service that
 * is being ADDED needs its screen (a vault and a folder for files, the
 * calendars to show, the mailbox): the run of the connect queue opens those
 * screens, and each binds through the card's sign-in without a second consent.
 */

export class AccessUnavailableError extends Error {
  constructor(readonly family: AccessFamily, readonly problem: Exclude<AccessResolution, { ok: true }>["problem"]) {
    super(`No usable ${family} access on this device: ${problem}`);
    this.name = "AccessUnavailableError";
  }
}

const env = (): Record<string, unknown> => import.meta.env as unknown as Record<string, unknown>;

export { devicePlatform };

export async function readDeviceAccess(family: AccessFamily, vaultId?: string): Promise<StoredOAuthAccess | null> {
  const credentials = getPlatformServices().credentials;
  const stored = readStoredOAuthAccess(await credentials.readSecret<unknown>(oauthAccessKey(family)));
  if (family === "dropbox") return readDropboxDeviceAccess(stored, vaultId);
  const replacement = retiredAccessReplacement(family, stored);
  if (replacement) {
    await credentials.writeSecret(oauthAccessKey(family), replacement);
    return replacement;
  }
  if (stored || !vaultId || family !== "google") return stored;
  // An own client this device held before the plan - in an account's grant
  // or a calendar's slot - becomes its access once, so nobody types it again.
  const plainva = plainvaGoogleClient(env(), devicePlatform());
  const own = (client: { clientId?: string; nativeGoogle?: unknown } | null | undefined): StoredOAuthAccess | null =>
    client?.clientId && !client.nativeGoogle && client.clientId !== plainva?.clientId && validClientId("google", client.clientId)
      && !isRetiredPlainvaClient("google", client.clientId)
      ? { source: "own", clientId: client.clientId }
      : null;
  for (const record of await loadCloudAccounts(vaultId)) {
    if (record.family !== "google") continue;
    const found = own(await getAccountToken(vaultId, record.id).catch(() => null))
      ?? (record.services.calendar ? own(await getPimCredentials(vaultId, record.services.calendar.pimAccountId).catch(() => null) as never) : null);
    if (found) {
      await credentials.writeSecret(oauthAccessKey(family), found);
      return found;
    }
  }
  // Nothing to adopt is a decision too, and it is kept (finding 2026-10-26):
  // `own` compares with the client THIS build ships, so a phone that never
  // stored its choice took the previous build's standard client - kept in a
  // calendar slot since the one sign-in (K2) - for an own one the day the
  // build switched to a new Google project, and signed in through the browser
  // with a client that project no longer had ("Error 401: deleted_client").
  const standard: StoredOAuthAccess = { source: "plainva" };
  await credentials.writeSecret(oauthAccessKey(family), standard);
  return standard;
}

/**
 * Dropbox's app key became the phone's choice like the Google and Microsoft
 * client (settings plan 2026-10-29, E6). A phone without a choice takes over
 * what the vault's Dropbox account kept - its own app id, or the key its
 * stored sign-in was made with - once, and keeps it as its choice. The
 * account's value stays: nothing is lost, and every other device of the
 * vault takes it over the same way.
 */
async function readDropboxDeviceAccess(stored: StoredOAuthAccess | null, vaultId?: string): Promise<StoredOAuthAccess | null> {
  if (stored || !vaultId) return stored;
  const records = await loadCloudAccounts(vaultId).catch(() => []);
  const signedIn = await getStoredProvider(vaultId).catch(() => null);
  const adopted = adoptedDropboxAccess([
    ...records.filter((record) => record.family === "dropbox").map((record) => record.byoClientId),
    signedIn?.provider === "dropbox" ? signedIn.creds.appKey : undefined,
  ]);
  if (adopted) await getPlatformServices().credentials.writeSecret(oauthAccessKey("dropbox"), adopted);
  return adopted;
}

export async function saveDeviceAccess(family: AccessFamily, access: StoredOAuthAccess): Promise<void> {
  if (access.source === "own" && (!access.clientId || !validClientId(family, access.clientId))) throw new Error("invalid client id");
  await getPlatformServices().credentials.writeSecret(oauthAccessKey(family), access);
}

export async function deviceAccess(family: OAuthFamily, vaultId?: string): Promise<AccessResolution>;
export async function deviceAccess(family: "dropbox", vaultId?: string): Promise<DropboxAccessResolution>;
export async function deviceAccess(family: AccessFamily, vaultId?: string): Promise<AccessResolution | DropboxAccessResolution>;
export async function deviceAccess(family: AccessFamily, vaultId?: string): Promise<AccessResolution | DropboxAccessResolution> {
  if (family === "dropbox") return resolveDropboxAccess(await readDeviceAccess(family, vaultId));
  return resolveOAuthAccess(family, devicePlatform(), await readDeviceAccess(family, vaultId), env());
}

/**
 * The Dropbox app key this phone signs in with (E6). A choice the phone
 * cannot use is said, never replaced by another key in silence.
 */
export async function dropboxDeviceKey(vaultId?: string): Promise<string> {
  const resolved = await deviceAccess("dropbox", vaultId);
  if (!resolved.ok) throw new AccessUnavailableError("dropbox", resolved.problem);
  return resolved.access.clientId;
}

async function mailKindOf(vaultId: string, record: CloudAccountRecord | undefined): Promise<string | undefined> {
  if (!record?.services.mail) return undefined;
  return (await listMailAccounts(vaultId)).find((mail) => mail.id === record.services.mail!.mailAccountId)?.kind;
}

export type MobileSignInStart = { kind: "started" } | { kind: "nothingToAsk" };

/**
 * Starts the one sign-in. The browser (or the system sheet) takes over; the
 * result arrives through `registerSignInHandler`, after a cold start too.
 */
export async function beginMobileSignIn(vaultId: string, request: { family: OAuthFamily; cardId?: string; add: CloudServiceId[]; outside?: CloudServiceId[] }): Promise<MobileSignInStart> {
  const resolution = await deviceAccess(request.family, vaultId);
  if (!resolution.ok) throw new AccessUnavailableError(request.family, resolution.problem);
  const record = request.cardId ? (await loadCloudAccounts(vaultId)).find((entry) => entry.id === request.cardId) : undefined;
  const prepared = prepareSignIn(
    { vaultId, family: request.family, ...(request.cardId ? { cardId: request.cardId } : {}), add: request.add, access: resolution.access, ...(request.outside?.length ? { outside: request.outside } : {}) },
    record ? { record, mailKind: await mailKindOf(vaultId, record) } : undefined,
  );
  if (!needsConsent(prepared)) return { kind: "nothingToAsk" };
  // Nothing is announced before the provider answers: a sign-in that never
  // came back (the browser closed, the app ended) left every row of the card
  // on "waiting for sign-in" while it worked (device finding 2026-10-27). The
  // rows say what the facts say until the answer is there.
  await beginPimOAuth(request.family, {
    clientId: resolution.access.clientId,
    ...(resolution.access.clientSecret ? { clientSecret: resolution.access.clientSecret } : {}),
    label: record?.label ?? "",
    purpose: "signin",
    scope: prepared.scope,
    signIn: prepared,
  });
  return { kind: "started" };
}

/** Completes the one sign-in when the consent comes back. Registered at startup. */
export function registerSignInHandler(): void {
  setOAuthPurposeHandler("signin", async ({ refreshToken, accessToken, grantedScope, nativeGoogle, signIn }) => {
    if (!signIn) throw new Error(i18n.t("cloudAccounts.loginBindingChanged"));
    const prepared = signIn;
    const vaultId = prepared.intent.vaultId;
    const family = prepared.intent.family;
    // A refused sign-in says why at each service of the card, as a finished one does.
    const failed = (error: unknown): never => {
      const text = error instanceof SignInNothingGrantedError ? i18n.t("cloudAccounts.notGranted")
        : error instanceof SignInWrongAccountError ? i18n.t("cloudAccounts.wrongAccount", { expected: error.expected, actual: error.actual })
          : error instanceof Error ? error.message : String(error);
      // Said once, at the card, and the redirect handler stays quiet. What
      // the provider left unticked belongs to the rows of those services; any
      // other refusal (another account, say) is the card's, in its banner,
      // while the rows keep their state - nothing changed.
      if (prepared.intent.cardId) {
        announceAccountLogin(error instanceof SignInNothingGrantedError
          ? { vaultId, accountId: prepared.intent.cardId, services: Object.fromEntries(prepared.requested.map((s) => [s, text])) }
          : { vaultId, accountId: prepared.intent.cardId, services: {}, message: text });
        throw markSignInAnnounced(error);
      }
      throw error;
    };
    const completed = await completeSignIn(prepared, {
      refreshToken,
      accessToken: accessToken ?? "",
      ...(grantedScope !== undefined ? { grantedScope } : {}),
      ...(nativeGoogle ? { nativeGoogle } : {}),
    }, {
      fetch: webdavFetch,
      loadCards: () => loadCloudAccounts(vaultId),
      saveGrant: (cardId, token) => saveAccountToken(vaultId, cardId, token),
      newCardId: () => crypto.randomUUID(),
    }).catch(failed);
    // What the card already carried is bound again here; what was added goes on in the run's screens.
    const rebound = completed.granted.filter((service) => prepared.carried.includes(service));
    const added = completed.granted.filter((service) => !prepared.carried.includes(service));
    const finished = await bindSignedInAccount(prepared, { ...completed, granted: rebound }, {
      loadCards: () => loadCloudAccounts(vaultId),
      saveCards: (records) => saveCloudAccounts(vaultId, records),
      setPending: () => undefined,
      bindFiles: async (cardId) => {
        const record = (await loadCloudAccounts(vaultId)).find((entry) => entry.id === cardId)!;
        await switchProviderToAccountBroker(vaultId, record, completed.token.clientId, { clientSecret: completed.token.clientSecret });
        return { provider: family === "google" ? "drive" : "onedrive" };
      },
      bindCalendar: async (_cardId, _done, existing) => {
        if (!existing) throw new Error("a calendar is added on its screen");
        const previous = await getPimCredentials(vaultId, existing);
        await replaceProtectedSlot(accountCredentialStore, [pimSecretKey(vaultId, existing)], previous ?? null, {
          ...previous, kind: family, clientId: completed.token.clientId,
          ...(family === "google" ? { clientSecret: completed.token.clientSecret ?? "", nativeGoogle: undefined } : {}),
          refreshToken: "", loginRevision: crypto.randomUUID(),
        });
        await restartPimAccountAfterLogin(vaultId, existing);
        return { pimAccountId: existing };
      },
      bindMail: async (_cardId, _done, existing) => {
        if (!existing) throw new Error("a mailbox is added on its screen");
        forgetGraphMailRuntime(vaultId, existing);
        const credentials = getPlatformServices().credentials;
        const previous = await credentials.readSecret<Record<string, unknown>>(mailSecretKey(vaultId, existing))
          ?? await credentials.readSecret<Record<string, unknown>>(legacyMailSecretKey(vaultId, existing));
        await replaceProtectedSlot(accountCredentialStore, [mailSecretKey(vaultId, existing), legacyMailSecretKey(vaultId, existing)], previous ?? null, { ...previous, refreshToken: "" });
        return { mailAccountId: existing };
      },
      afterBinding: async () => {
        if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("m-pim-changed"));
      },
      describeFailure: (error) => (error instanceof Error ? error.message : String(error)),
    });
    const services: Partial<Record<CloudServiceId, string>> = {};
    for (const row of finished.rows) {
      services[row.service] = row.state === "active" ? i18n.t("cloudAccounts.statusConnected")
        : row.state === "notGranted" ? i18n.t("cloudAccounts.notGranted")
          : row.state === "needsPassword" ? i18n.t("cloudAccounts.needsAppPassword")
            : row.detail ?? "";
    }
    for (const service of completed.notGranted) services[service] = i18n.t("cloudAccounts.notGranted");
    // What was added goes on in the run's own screens; its rows follow its facts.
    announceAccountLogin({
      vaultId, accountId: completed.cardId, services,
      ...(completed.joinedExistingCard ? { message: i18n.t("cloudAccounts.joinedExisting", { account: finished.record.label }) } : {}),
    });
    // Gmail outside the consent asks for its app password on the mail screen, bound to this card (E5).
    const next = [...added, ...prepared.outside];
    if (next.length) {
      await startConnectQueue(family, next, { vaultId, cloudAccountId: completed.cardId, expectedIdentity: completed.identity });
    }
  });
}

/**
 * "Add vault" from a cloud (account sign-in plan K4b): the consent ran with
 * this device's access before the vault existed, the vault was made after the
 * folder pick. This makes that sign-in a card with its identity - before the
 * vault is entered, so its first sync already renews through the card. A
 * sign-in through Android's system sheet holds no refresh token; it is renewed
 * silently here instead.
 */
export async function adoptAddedVaultSignIn(vaultId: string, access: OAuthAccess, provider: MobileSyncProvider): Promise<void> {
  if (provider.provider !== "drive" && provider.provider !== "onedrive") return;
  const family: OAuthFamily = provider.provider === "drive" ? "google" : "microsoft";
  const files = provider.provider;
  let grant: { refreshToken: string } | { consent: { refreshToken: string; accessToken: string; grantedScope: string; nativeGoogle: { email: string } } };
  if (provider.provider === "drive" && provider.creds.nativeGoogle) {
    const renewed = await authorizeNativeGoogle(unionScope("google", ["files"]), false);
    grant = { consent: { refreshToken: "", accessToken: renewed.accessToken, grantedScope: renewed.scope, nativeGoogle: { email: renewed.profile.label! } } };
  } else {
    grant = { refreshToken: provider.creds.refreshToken };
  }
  const finished = await adoptFilesSignIn({ vaultId, family, access, grant }, {
    fetch: webdavFetch,
    loadCards: () => loadCloudAccounts(vaultId),
    saveGrant: (cardId, token) => saveAccountToken(vaultId, cardId, token),
    newCardId: () => crypto.randomUUID(),
    saveCards: (records) => saveCloudAccounts(vaultId, records),
    setPending: () => undefined,
    bindFiles: async (cardId) => {
      // The card is written after the binding; the slot only needs to know its id and provider.
      const record: CloudAccountRecord = { id: cardId, family, label: "", services: { files: { provider: files } } };
      await switchProviderToAccountBroker(vaultId, record, access.clientId, { clientSecret: access.clientSecret });
      return { provider: files };
    },
    bindCalendar: () => Promise.reject(new Error("not part of a vault sign-in")),
    bindMail: () => Promise.reject(new Error("not part of a vault sign-in")),
    // The vault is entered next; that starts its worker.
    afterBinding: async () => undefined,
    describeFailure: (error) => (error instanceof Error ? error.message : String(error)),
  });
  const row = finished.rows.find((entry) => entry.service === "files");
  if (row?.state !== "active") throw new Error(row?.detail ?? i18n.t("cloudAccounts.notGranted"));
}
