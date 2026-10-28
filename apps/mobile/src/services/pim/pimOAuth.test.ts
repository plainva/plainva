import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CloudAccountRecord } from "@plainva/ui";
// Compile the integration graph during collection; each test still resets the
// module registry, including the simulated process restart before the redirect.
import "../accountSignIn";

const state = vi.hoisted(() => ({
  secrets: new Map<string, unknown>(), records: [] as CloudAccountRecord[], urls: [] as string[],
  granted: "", storageFails: false, failKey: "", platform: "ios", nativeAuthorize: vi.fn(),
  savedPim: vi.fn(), restarted: vi.fn(), success: vi.fn(), error: vi.fn(),
  pim: { kind: "google", clientId: "client", clientSecret: "secret", refreshToken: "old-service" } as { kind: string; clientId: string; clientSecret: string; refreshToken: string; nativeGoogle?: { email: string } },
  /** The Android client this build ships ("" = none): the only one the system sign-in is offered with. */
  builtIn: "",
}));
vi.mock("@capacitor/browser", () => ({ Browser: { open: async ({ url }: { url: string }) => { state.urls.push(url); }, close: async () => {} } }));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => true, getPlatform: () => state.platform }, registerPlugin: () => ({}) }));
// The plugin is mocked; the rule that picks browser or Play services is the real one.
vi.mock("../googleNativeAuthorization", async () => {
  const { chooseGoogleSignInFlow } = await vi.importActual<typeof import("@plainva/ui")>("@plainva/ui");
  return {
    authorizeNativeGoogle: state.nativeAuthorize,
    hasGooglePlayServices: () => state.platform === "android",
    googleSignInFlow: (clientId: string, held: readonly (string | null | undefined)[] = []) =>
      chooseGoogleSignInFlow({ playServices: state.platform === "android", clientId, builtInClientId: state.builtIn, nativeGrantClientIds: held }),
  };
});
vi.mock("../../adapters/webdavHttp", () => ({ webdavFetch: async () => Response.json({ sub: "subject", email: "person@example.test", email_verified: true }) }));
vi.mock("@plainva/ui", async (original) => ({
  ...await original<typeof import("@plainva/ui")>(),
  getPlatformServices: () => ({ credentials: {
    readSecret: async (key: string) => structuredClone(state.secrets.get(key) ?? null),
    writeSecret: async (key: string, value: unknown) => { if (state.storageFails || state.failKey === key) throw Error("storage unavailable"); state.secrets.set(key, structuredClone(value)); },
    removeSecret: async (key: string) => { state.secrets.delete(key); },
  } }),
  toast: { success: state.success, error: state.error },
}));
vi.mock("../../platform/secureStore", () => ({ secureCredentialStore: {
  readSecret: async (key: string) => structuredClone(state.secrets.get(key) ?? null),
  writeSecret: async (key: string, value: unknown) => { if (state.failKey === key) throw Error("storage unavailable"); state.secrets.set(key, structuredClone(value)); },
  removeSecret: async (key: string) => { state.secrets.delete(key); },
} }));
vi.mock("../../platform/protectedSecrets", () => ({ protectedSecrets: {
  read: async (key: string) => state.secrets.has(key) ? JSON.stringify(state.secrets.get(key)) : null,
  compareAndSet: async (key: string, expected: string | null, value: string | null) => {
    if (state.storageFails || state.failKey === key) throw new Error("storage unavailable");
    if ((state.secrets.has(key) ? JSON.stringify(state.secrets.get(key)) : null) !== expected) return false;
    if (value === null) state.secrets.delete(key); else state.secrets.set(key, JSON.parse(value));
    return true;
  },
} }));
vi.mock("../cloudAccountsStore", () => ({ loadCloudAccounts: async () => structuredClone(state.records), saveCloudAccounts: async (_v: string, records: CloudAccountRecord[]) => { state.records = structuredClone(records); } }));
vi.mock("../syncService", () => ({ getStoredProvider: async () => null, switchProviderToAccountBroker: vi.fn() }));
vi.mock("../vaultRegistry", async original => ({ ...await original<typeof import("../vaultRegistry")>(), getActiveVaultEntry: async () => ({ id: "original-vault" }) }));
vi.mock("./pimCredentials", () => ({ getPimCredentials: async () => structuredClone(state.pim), savePimCredentials: state.savedPim, pimSecretKey: (vault: string, id: string) => `pim_${id}_${vault}` }));
vi.mock("./pimService", () => ({ listPimAccounts: async () => [], restartPimAccountAfterLogin: state.restarted, addPimAccount: vi.fn(), reauthorizePimAccount: vi.fn() }));
vi.mock("@plainva/core", async (original) => ({
  ...await original<typeof import("@plainva/core")>(),
  generatePkcePair: async () => ({ codeVerifier: "verifier", codeChallenge: "challenge" }),
  exchangeCode: async () => ({ accessToken: "access", refreshToken: "new-account", scope: state.granted }),
  exchangeOneDriveCode: async () => ({ accessToken: "access", refreshToken: "new-microsoft", scope: "Calendars.ReadWrite" }),
}));
vi.mock("@plainva/ui/i18n", () => ({ default: { t: (key: string) => key } }));

beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal("window", new EventTarget());
  state.secrets.clear(); state.urls.length = 0; state.storageFails = false; state.failKey = "";
  state.platform = "ios"; state.builtIn = "";
  state.nativeAuthorize.mockReset().mockImplementation(async (scope: string) => ({ accessToken: "native-access", scope, profile: { identity: { issuer: "google", subject: "subject" }, label: "person@example.test" } }));
  state.records = [{ id: "account", family: "google", label: "Person", services: { calendar: { pimAccountId: "calendar" } } }];
  state.pim = { kind: "google", clientId: "client", clientSecret: "secret", refreshToken: "old-service" };
  state.savedPim.mockClear(); state.restarted.mockClear(); state.success.mockClear(); state.error.mockClear();
  const { GOOGLE_CALENDAR_SCOPES } = await import("@plainva/core");
  state.granted = GOOGLE_CALENDAR_SCOPES;
  state.secrets.set("account_account_original-vault", { clientId: "client", clientSecret: "secret", refreshToken: "old-account", scopes: state.granted });
  state.secrets.set("pim_calendar_original-vault", structuredClone(state.pim));
  // This phone's access (account sign-in plan E3): the own client on iOS.
  state.secrets.set("oauth_access_google", { source: "own", clientId: "client.apps.googleusercontent.com" });
  vi.unstubAllEnvs();
});

/** Android with Plainva's own client: the system sheet (oauthAccess.ts). */
function plainvaAndroid(): void {
  state.platform = "android"; state.builtIn = "client.apps.googleusercontent.com";
  state.secrets.set("oauth_access_google", { source: "plainva" });
  vi.stubEnv("VITE_PLAINVA_GOOGLE_ANDROID_CLIENT_ID", "client.apps.googleusercontent.com");
}

async function start(): Promise<string> {
  const { beginMobileSignIn } = await import("../accountSignIn");
  await beginMobileSignIn("original-vault", { family: "google", cardId: "account", add: [] });
  const nonce = new URL(state.urls[0]).searchParams.get("state");
  return `com.plainva.app:/oauth2redirect?code=code&state=${nonce}`;
}
async function coldReturn(url: string): Promise<void> {
  vi.resetModules();
  const { registerSignInHandler } = await import("../accountSignIn");
  registerSignInHandler();
  const { handlePimOAuthRedirect } = await import("./pimOAuth");
  expect(await handlePimOAuthRedirect(url).catch(() => true)).toBe(true);
}

describe("the real mobile account redirect after a process restart", () => {
  it("does not mistake recovery of a narrower native grant for a new wider consent", async () => {
    state.platform = "android"; state.builtIn = "android-client";
    const { beginPimOAuth, setOAuthPurposeHandler } = await import("./pimOAuth");
    const { GOOGLE_MAIL_SCOPES } = await import("@plainva/ui");
    const handler = vi.fn().mockRejectedValueOnce(new Error("storage unavailable")).mockResolvedValue(undefined);
    setOAuthPurposeHandler("gmail", handler);
    const options = { clientId: "android-client", purpose: "gmail" as const, scope: GOOGLE_MAIL_SCOPES, serviceContext: { vaultId: "original-vault" } };
    await expect(beginPimOAuth("google", options)).rejects.toThrow("storage unavailable");
    const wider = `${GOOGLE_MAIL_SCOPES} ${state.granted}`;
    await beginPimOAuth("google", { ...options, scope: wider });
    expect(state.nativeAuthorize).toHaveBeenCalledTimes(2);
    expect(handler).toHaveBeenLastCalledWith(expect.objectContaining({ requestedScope: wider }));
    expect(state.secrets.has("pim_oauth_received")).toBe(false);
  });
  it("serializes native authorization until the first durable handler has acknowledged its result", async () => {
    state.platform = "android"; state.builtIn = "android-client";
    const { beginPimOAuth, setOAuthPurposeHandler } = await import("./pimOAuth");
    const { GOOGLE_MAIL_SCOPES } = await import("@plainva/ui");
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const handler = vi.fn().mockImplementationOnce(() => held).mockResolvedValue(undefined);
    setOAuthPurposeHandler("gmail", handler);
    const options = { clientId: "android-client", purpose: "gmail" as const, scope: GOOGLE_MAIL_SCOPES, serviceContext: { vaultId: "original-vault" } };
    const first = beginPimOAuth("google", options);
    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
    const second = beginPimOAuth("google", options);
    await Promise.resolve();
    expect(state.nativeAuthorize).toHaveBeenCalledTimes(1);
    release(); await Promise.all([first, second]);
    expect(handler).toHaveBeenCalledTimes(2);
    expect(state.secrets.has("pim_oauth_received")).toBe(false);
  });
  it("keeps existing credentials when Android consent is cancelled", async () => {
    plainvaAndroid();
    state.nativeAuthorize.mockRejectedValueOnce(Object.assign(new Error("cancelled"), { code: "CANCELLED" }));
    const { registerSignInHandler, beginMobileSignIn } = await import("../accountSignIn"); registerSignInHandler();
    await expect(beginMobileSignIn("original-vault", { family: "google", cardId: "account", add: [] })).rejects.toThrow("cancelled");
    expect(state.secrets.get("account_account_original-vault")).toMatchObject({ refreshToken: "old-account" });
    expect(state.secrets.get("pim_calendar_original-vault")).toMatchObject({ refreshToken: "old-service" });
    expect(state.secrets.has("pim_oauth_received")).toBe(false);
  });
  it("leaves nothing behind after a refused Android sign-in: the same button asks Google again and says the same", async () => {
    state.platform = "android"; state.builtIn = "android-client";
    const { beginPimOAuth, setOAuthPurposeHandler } = await import("./pimOAuth");
    const { GoogleAuthorizationError, serviceConnectionMessage } = await import("@plainva/ui");
    const accept = vi.fn(); setOAuthPurposeHandler("calendar", accept);
    const refused = () => Promise.reject(new GoogleAuthorizationError({ code: "DEVELOPER_ERROR", status: 10, stage: "result", resultCode: 0, hadIntent: true }));
    state.nativeAuthorize.mockImplementationOnce(refused).mockImplementationOnce(refused);
    const options = { clientId: "android-client", label: "Person", serviceContext: { vaultId: "original-vault" } };
    const texts: string[] = [];
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await beginPimOAuth("google", options).catch((error: unknown) => texts.push(serviceConnectionMessage(error, (key) => key)));
      expect(state.secrets.has("pim_oauth_pending_tx")).toBe(false);
      expect(state.secrets.has("pim_oauth_received")).toBe(false);
    }
    expect(texts).toEqual(["connection.googleSystemSignInUnavailable", "connection.googleSystemSignInUnavailable"]);
    expect(state.nativeAuthorize).toHaveBeenCalledTimes(2);
    // ...and once Google accepts, the third tap on the same button connects.
    await beginPimOAuth("google", options);
    expect(accept).toHaveBeenCalledTimes(1);
    expect(state.secrets.has("pim_oauth_received")).toBe(false);
  });
  it("renews an Android calendar through the native SDK and keeps its account identity", async () => {
    plainvaAndroid();
    const { registerSignInHandler, beginMobileSignIn } = await import("../accountSignIn");
    registerSignInHandler();
    await beginMobileSignIn("original-vault", { family: "google", cardId: "account", add: [] });
    expect(state.urls).toEqual([]);
    expect(state.nativeAuthorize).toHaveBeenCalledWith(state.granted, true, undefined);
    expect(state.secrets.get("account_account_original-vault")).toMatchObject({ version: 2, grants: expect.arrayContaining([expect.objectContaining({ refreshToken: "", nativeGoogle: { email: "person@example.test" }, providerIdentity: { issuer: "google", subject: "subject" } })]) });
    expect(state.restarted).toHaveBeenCalledWith("original-vault", "calendar");
  });
  it("keeps an Android Gmail grant recoverable when its mailbox write fails", async () => {
    state.platform = "android"; state.builtIn = "android-client";
    const { beginPimOAuth, setOAuthPurposeHandler } = await import("./pimOAuth");
    const { GOOGLE_MAIL_SCOPES } = await import("@plainva/ui");
    setOAuthPurposeHandler("gmail", async () => { throw new Error("mailbox storage unavailable"); });
    await expect(beginPimOAuth("google", { clientId: "android-client", purpose: "gmail", scope: GOOGLE_MAIL_SCOPES, serviceContext: { vaultId: "original-vault" } })).rejects.toThrow("mailbox storage");
    expect(state.urls).toEqual([]);
    expect(state.secrets.has("pim_oauth_received")).toBe(true);
    vi.resetModules();
    const next = await import("./pimOAuth");
    const accept = vi.fn(); next.setOAuthPurposeHandler("gmail", accept);
    await next.resumePimOAuthResult();
    expect(accept).toHaveBeenCalledWith(expect.objectContaining({ nativeGoogle: { email: "person@example.test" }, grantedScope: GOOGLE_MAIL_SCOPES, refreshToken: "" }));
    expect(state.secrets.has("pim_oauth_received")).toBe(false);
  });
  it("opens the durable Drive folder picker from Android authorization without a browser redirect", async () => {
    state.platform = "android"; state.builtIn = "android-client";
    const { beginOAuth } = await import("../oauthService");
    const { DRIVE_DEFAULT_SCOPE } = await import("@plainva/core");
    await beginOAuth("drive", { clientId: "android-client", serviceContext: { vaultId: "original-vault" } });
    expect(state.urls).toEqual([]);
    expect(state.nativeAuthorize).toHaveBeenCalledWith(DRIVE_DEFAULT_SCOPE, true);
    expect([...state.secrets.values()]).toContainEqual(expect.objectContaining({ provider: expect.objectContaining({ provider: "drive", creds: expect.objectContaining({ nativeGoogle: { email: "person@example.test" }, grantedScope: DRIVE_DEFAULT_SCOPE, refreshToken: "" }) }), context: { vaultId: "original-vault" } }));
  });
  // Since 0.8.3 Android knew only Play services, which serves ONE Google project
  // in the world. A client ID the user entered signs in through the browser again.
  it("signs an Android user's own client in through the browser and stores an ordinary grant", async () => {
    state.platform = "android";
    const { beginPimOAuth, setOAuthPurposeHandler, handlePimOAuthRedirect } = await import("./pimOAuth");
    const accept = vi.fn(); setOAuthPurposeHandler("calendar", accept);
    await beginPimOAuth("google", { clientId: "users-own", label: "Person", serviceContext: { vaultId: "original-vault" } });
    expect(state.nativeAuthorize).not.toHaveBeenCalled();
    const url = new URL(state.urls[0]);
    expect(url.hostname).toBe("accounts.google.com");
    expect(url.searchParams.get("client_id")).toBe("users-own");
    expect(url.searchParams.get("redirect_uri")).toBe("com.plainva.app:/oauth2redirect");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    // The return arrives through the manifest's scheme filter as an app URL.
    expect(await handlePimOAuthRedirect(`com.plainva.app:/oauth2redirect?code=code&state=${url.searchParams.get("state")}`)).toBe(true);
    expect(accept).toHaveBeenCalledTimes(1);
    expect(accept.mock.calls[0][0]).toMatchObject({ provider: "google", clientId: "users-own", refreshToken: "new-account" });
    expect(accept.mock.calls[0][0].nativeGoogle).toBeUndefined();
    expect(state.secrets.has("pim_oauth_pending_tx")).toBe(false);
    expect(state.secrets.has("pim_oauth_received")).toBe(false);
  });
  it("keeps the user's own client in the browser even when the build ships a client of its own", async () => {
    state.platform = "android"; state.builtIn = "android-client";
    const { beginPimOAuth } = await import("./pimOAuth");
    await beginPimOAuth("google", { clientId: "users-own", serviceContext: { vaultId: "original-vault" } });
    expect(state.nativeAuthorize).not.toHaveBeenCalled();
    expect(state.urls).toHaveLength(1);
  });
  it("signs an account in again through Play services when its stored grant is one, with the same client only", async () => {
    state.platform = "android";
    state.pim = { kind: "google", clientId: "client", clientSecret: "", refreshToken: "", nativeGoogle: { email: "person@example.test" } };
    const { beginPimOAuth, setOAuthPurposeHandler } = await import("./pimOAuth");
    setOAuthPurposeHandler("calendar", vi.fn());
    await beginPimOAuth("google", { clientId: "client", accountId: "calendar", serviceContext: { vaultId: "original-vault" } });
    expect(state.nativeAuthorize).toHaveBeenCalledTimes(1);
    expect(state.urls).toEqual([]);
    // Another client typed into the form is the user's decision to move to the browser.
    await beginPimOAuth("google", { clientId: "users-own", accountId: "calendar", serviceContext: { vaultId: "original-vault" } });
    expect(state.nativeAuthorize).toHaveBeenCalledTimes(1);
    expect(state.urls).toHaveLength(1);
    // A new account never inherits the system sign-in from a neighbour.
    await beginPimOAuth("google", { clientId: "client", serviceContext: { vaultId: "original-vault" } });
    expect(state.nativeAuthorize).toHaveBeenCalledTimes(1);
    expect(state.urls).toHaveLength(2);
  });
  it("leaves the button working after an abandoned and after a refused browser sign-in on Android", async () => {
    state.platform = "android";
    const { beginPimOAuth, setOAuthPurposeHandler, handlePimOAuthRedirect } = await import("./pimOAuth");
    const accept = vi.fn(); setOAuthPurposeHandler("calendar", accept);
    const options = { clientId: "users-own", label: "Person", serviceContext: { vaultId: "original-vault" } };
    const stateOf = (index: number) => new URL(state.urls[index]).searchParams.get("state");
    // 1. The browser tab is closed without an answer; the same button opens Google again.
    await beginPimOAuth("google", options);
    await beginPimOAuth("google", options);
    expect(state.urls).toHaveLength(2);
    expect(stateOf(1)).not.toBe(stateOf(0));
    // A late return of the abandoned attempt is not this sign-in.
    expect(await handlePimOAuthRedirect(`com.plainva.app:/oauth2redirect?code=code&state=${stateOf(0)}`)).toBe(false);
    expect(accept).not.toHaveBeenCalled();
    // 2. Google returns a refusal: consumed, nothing stored, nothing left waiting.
    expect(await handlePimOAuthRedirect(`com.plainva.app:/oauth2redirect?error=access_denied&state=${stateOf(1)}`)).toBe(true);
    expect(state.secrets.has("pim_oauth_pending_tx")).toBe(false);
    expect(state.secrets.has("pim_oauth_received")).toBe(false);
    expect(state.error).not.toHaveBeenCalled();
    // 3. The same button once more, and this time it connects.
    await beginPimOAuth("google", options);
    expect(await handlePimOAuthRedirect(`com.plainva.app:/oauth2redirect?code=code&state=${stateOf(2)}`)).toBe(true);
    expect(accept).toHaveBeenCalledTimes(1);
    expect(state.nativeAuthorize).not.toHaveBeenCalled();
  });
  it("tells a Microsoft refusal, keeps a Microsoft cancel quiet, and leaves both in the diagnostics (device finding 2026-10-28)", async () => {
    state.platform = "android";
    const { beginPimOAuth, setOAuthPurposeHandler, handlePimOAuthRedirect } = await import("./pimOAuth");
    const { getDiagnostics } = await import("@plainva/ui");
    setOAuthPurposeHandler("calendar", vi.fn());
    const options = { clientId: "ms-client", serviceContext: { vaultId: "original-vault" } };
    const stateOf = (index: number) => new URL(state.urls[index]).searchParams.get("state");
    await beginPimOAuth("microsoft", options);
    expect(getDiagnostics()[getDiagnostics().length - 1]?.message).toBe("microsoft (calendar): browser opened");
    // The person pressed "Cancel" at Microsoft: their own decision, nothing to tell.
    expect(await handlePimOAuthRedirect(`com.plainva.app://oauth?error=access_denied&error_subcode=cancel&state=${stateOf(0)}`)).toBe(true);
    expect(state.error).not.toHaveBeenCalled();
    expect(getDiagnostics().some((entry) => entry.message.startsWith("microsoft answered access_denied (cancel)"))).toBe(true);
    // Microsoft refused: said, with Microsoft's own words.
    await beginPimOAuth("microsoft", options);
    expect(await handlePimOAuthRedirect(`com.plainva.app://oauth?error=access_denied&error_description=${encodeURIComponent("AADSTS65001: consent needed")}&state=${stateOf(1)}`)).toBe(true);
    expect(state.error).toHaveBeenCalledTimes(1);
    // An answer nobody waits for is in the diagnostics too.
    expect(await handlePimOAuthRedirect("com.plainva.app://oauth?code=late&state=gone")).toBe(false);
    expect(getDiagnostics()[getDiagnostics().length - 1]?.message).toBe("answer arrived, no sign-in waits for it");
  });
  it("takes Microsoft's answer at the address with the slash of its empty path (device finding 2026-10-28)", async () => {
    state.platform = "android";
    const { beginPimOAuth, setOAuthPurposeHandler, handlePimOAuthRedirect } = await import("./pimOAuth");
    const accept = vi.fn(); setOAuthPurposeHandler("calendar", accept);
    await beginPimOAuth("microsoft", { clientId: "ms-client", serviceContext: { vaultId: "original-vault" } });
    const sent = new URL(state.urls[0]).searchParams;
    expect(sent.get("redirect_uri")).toBe("com.plainva.app://oauth");
    // What Android handed to the app on the device: the same address, with the slash.
    expect(await handlePimOAuthRedirect(`com.plainva.app://oauth/?code=code&state=${sent.get("state")}`)).toBe(true);
    expect(accept).toHaveBeenCalledTimes(1);
  });
  it("reads an answer's address without query, fragment and the slash of an empty path", async () => {
    const { redirectAddress } = await import("../appScheme");
    expect(redirectAddress("com.plainva.app://oauth/?code=a&state=b")).toBe("com.plainva.app://oauth");
    expect(redirectAddress("com.plainva.app://oauth?code=a")).toBe("com.plainva.app://oauth");
    expect(redirectAddress("com.plainva.app:/oauth2redirect/#x")).toBe("com.plainva.app:/oauth2redirect");
    expect(redirectAddress("com.plainva.app://")).toBe("com.plainva.app://");
    // Another address stays another address.
    expect(redirectAddress("com.plainva.app://oauth/other")).toBe("com.plainva.app://oauth/other");
  });
  it("describes an app URL by its address and parameter names, never their values", async () => {
    const { describeAppUrl } = await import("../appUrlRoutes");
    expect(describeAppUrl("com.plainva.app://oauth?code=SECRET&state=abc")).toBe("com.plainva.app://oauth (code, state)");
    expect(describeAppUrl("com.plainva.app://shortcut/journal")).toBe("com.plainva.app://shortcut/journal");
  });
  it("opens the browser for an Android user's own Drive client", async () => {
    state.platform = "android";
    const { beginOAuth } = await import("../oauthService");
    await beginOAuth("drive", { clientId: "users-own", serviceContext: { vaultId: "original-vault" } });
    expect(state.nativeAuthorize).not.toHaveBeenCalled();
    const url = new URL(state.urls[0]);
    expect(url.searchParams.get("client_id")).toBe("users-own");
    expect(url.searchParams.get("redirect_uri")).toBe("com.plainva.app:/oauth2redirect");
  });
  it("restores an iOS Gmail consent to its mail handler with PKCE and state", async () => {
    const { beginPimOAuth } = await import("./pimOAuth");
    const { GOOGLE_MAIL_SCOPES } = await import("@plainva/ui"); state.granted = GOOGLE_MAIL_SCOPES;
    await beginPimOAuth("google", { clientId: "ios-client", purpose: "gmail", scope: GOOGLE_MAIL_SCOPES, serviceContext: { vaultId: "original-vault" } });
    const url = new URL(state.urls[0]);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    const nonce = url.searchParams.get("state");
    vi.resetModules();
    const { setOAuthPurposeHandler, handlePimOAuthRedirect } = await import("./pimOAuth");
    const accept = vi.fn(); setOAuthPurposeHandler("gmail", accept);
    expect(await handlePimOAuthRedirect(`com.plainva.app:/oauth2redirect?code=code&state=${nonce}`)).toBe(true);
    expect(accept).toHaveBeenCalledWith(expect.objectContaining({ provider: "google", grantedScope: GOOGLE_MAIL_SCOPES, serviceContext: { vaultId: "original-vault" } }));
    expect(state.savedPim).not.toHaveBeenCalled();
  });
  it("claims a concurrently delivered callback only once", async () => {
    const url = await start();
    const { registerSignInHandler } = await import("../accountSignIn"); registerSignInHandler();
    const { handlePimOAuthRedirect } = await import("./pimOAuth");
    await Promise.all([handlePimOAuthRedirect(url), handlePimOAuthRedirect(url)]);
    expect(state.secrets.get("pim_calendar_original-vault")).toMatchObject({ refreshToken: "" });
    expect(state.restarted).toHaveBeenCalledTimes(1);
  });

  it("keeps the transaction for an unrelated callback path", async () => {
    const url = await start();
    const { registerSignInHandler } = await import("../accountSignIn"); registerSignInHandler();
    const { handlePimOAuthRedirect } = await import("./pimOAuth");
    expect(await handlePimOAuthRedirect(url.replace("/oauth2redirect?", "/oauth2redirect-unrelated?"))).toBe(false);
    expect(state.secrets.has("pim_oauth_pending_tx")).toBe(true);
    await handlePimOAuthRedirect(url);
    expect(state.secrets.get("pim_calendar_original-vault")).toMatchObject({ refreshToken: "" });
  });
  it("restores the original vault/account, saves its grant and wakes only its calendar", async () => {
    const url = await start();
    await coldReturn(url);
    expect(state.error).not.toHaveBeenCalled();
    expect(state.secrets.get("account_account_original-vault")).toMatchObject({ version: 2, grants: expect.arrayContaining([expect.objectContaining({ refreshToken: "new-account", scopes: state.granted })]) });
    expect(state.secrets.get("pim_calendar_original-vault")).toMatchObject({ refreshToken: "" });
    expect(state.restarted).toHaveBeenCalledWith("original-vault", "calendar");
  });

  it("keeps all old credentials when consent does not grant the calendar", async () => {
    const url = await start(); state.granted = "openid email";
    await coldReturn(url);
    expect(state.secrets.get("account_account_original-vault")).toMatchObject({ refreshToken: "old-account" });
    expect(state.savedPim).not.toHaveBeenCalled(); expect(state.restarted).not.toHaveBeenCalled();
    const { getAccountLoginStatus } = await import("../accountLogin");
    expect(getAccountLoginStatus("original-vault", "account")?.services.calendar).toBe("cloudAccounts.notGranted");
  });

  it("does not open consent when its restorable context cannot be stored", async () => {
    state.storageFails = true;
    await expect(start()).rejects.toThrow("storage unavailable");
    expect(state.urls).toEqual([]);
  });
  it("replays a received grant after a storage failure and another process restart", async () => {
    const url = await start();
    state.failKey = "account_account_original-vault";
    await coldReturn(url);
    expect(state.secrets.has("pim_oauth_received")).toBe(true);
    expect(state.secrets.get(state.failKey)).toMatchObject({ refreshToken: "old-account" });
    expect(state.savedPim).not.toHaveBeenCalled();
    state.failKey = "";
    vi.resetModules();
    const { registerSignInHandler } = await import("../accountSignIn"); registerSignInHandler();
    const { resumePimOAuthResult } = await import("./pimOAuth");
    await Promise.all([resumePimOAuthResult(), resumePimOAuthResult()]);
    expect(state.secrets.get("pim_calendar_original-vault")).toMatchObject({ refreshToken: "" });
    expect(state.secrets.has("pim_oauth_received")).toBe(false);
    expect(state.secrets.get("account_account_original-vault")).toMatchObject({ version: 2, grants: expect.arrayContaining([expect.objectContaining({ refreshToken: "new-account" })]) });
  });
});
