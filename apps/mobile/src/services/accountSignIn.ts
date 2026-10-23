import { Capacitor } from "@capacitor/core";
import {
  adoptFilesSignIn,
  bindSignedInAccount,
  completeSignIn,
  getPlatformServices,
  needsConsent,
  oauthAccessKey,
  plainvaGoogleClient,
  prepareSignIn,
  readStoredOAuthAccess,
  replaceProtectedSlot,
  resolveOAuthAccess,
  SignInNothingGrantedError,
  SignInWrongAccountError,
  validClientId,
  type AccessPlatform,
  type AccessResolution,
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
import { switchProviderToAccountBroker } from "./syncService";
import type { MobileSyncProvider } from "./syncSlot";
import { authorizeNativeGoogle } from "./googleNativeAuthorization";
import { accountCredentialStore } from "./accountCredentialStore";
import { startConnectQueue } from "./connectQueue";
import { announceAccountLogin } from "./accountLogin";

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
  constructor(readonly family: OAuthFamily, readonly problem: Exclude<AccessResolution, { ok: true }>["problem"]) {
    super(`No usable ${family} access on this device: ${problem}`);
    this.name = "AccessUnavailableError";
  }
}

const env = (): Record<string, unknown> => import.meta.env as unknown as Record<string, unknown>;

/** The phone's platform for the access rules; the web build signs in like an iPhone, through the browser. */
export function devicePlatform(): AccessPlatform {
  return Capacitor.getPlatform() === "android" ? "android" : "ios";
}

export async function readDeviceAccess(family: OAuthFamily, vaultId?: string): Promise<StoredOAuthAccess | null> {
  const credentials = getPlatformServices().credentials;
  const stored = readStoredOAuthAccess(await credentials.readSecret<unknown>(oauthAccessKey(family)));
  if (stored || !vaultId || family !== "google") return stored;
  // An own client this device held before the plan - in an account's grant
  // or a calendar's slot - becomes its access once, so nobody types it again.
  const plainva = plainvaGoogleClient(env(), devicePlatform());
  const own = (client: { clientId?: string; nativeGoogle?: unknown } | null | undefined): StoredOAuthAccess | null =>
    client?.clientId && !client.nativeGoogle && client.clientId !== plainva?.clientId && validClientId("google", client.clientId)
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
  return null;
}

export async function saveDeviceAccess(family: OAuthFamily, access: StoredOAuthAccess): Promise<void> {
  if (access.source === "own" && (!access.clientId || !validClientId(family, access.clientId))) throw new Error("invalid client id");
  await getPlatformServices().credentials.writeSecret(oauthAccessKey(family), access);
}

export async function deviceAccess(family: OAuthFamily, vaultId?: string): Promise<AccessResolution> {
  return resolveOAuthAccess(family, devicePlatform(), await readDeviceAccess(family, vaultId), env());
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
export async function beginMobileSignIn(vaultId: string, request: { family: OAuthFamily; cardId?: string; add: CloudServiceId[] }): Promise<MobileSignInStart> {
  const resolution = await deviceAccess(request.family, vaultId);
  if (!resolution.ok) throw new AccessUnavailableError(request.family, resolution.problem);
  const record = request.cardId ? (await loadCloudAccounts(vaultId)).find((entry) => entry.id === request.cardId) : undefined;
  const prepared = prepareSignIn(
    { vaultId, family: request.family, ...(request.cardId ? { cardId: request.cardId } : {}), add: request.add, access: resolution.access },
    record ? { record, mailKind: await mailKindOf(vaultId, record) } : undefined,
  );
  if (!needsConsent(prepared)) return { kind: "nothingToAsk" };
  if (record) {
    announceAccountLogin({ vaultId, accountId: record.id, services: Object.fromEntries(prepared.requested.map((s) => [s, i18n.t("cloudAccounts.statusWaiting")])) });
  }
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
      if (prepared.intent.cardId) {
        announceAccountLogin({ vaultId, accountId: prepared.intent.cardId, services: Object.fromEntries(prepared.requested.map((s) => [s, text])), message: text });
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
    for (const service of added) services[service] = i18n.t("cloudAccounts.statusWaiting");
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
