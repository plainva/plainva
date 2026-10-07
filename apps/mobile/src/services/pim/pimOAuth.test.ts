import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CloudAccountRecord } from "@plainva/ui";
// Compile the integration graph during collection; each test still resets the
// module registry, including the simulated process restart before the redirect.
import "../accountLogin";

const state = vi.hoisted(() => ({
  secrets: new Map<string, unknown>(), records: [] as CloudAccountRecord[], urls: [] as string[],
  granted: "", storageFails: false, failKey: "", platform: "ios", nativeAuthorize: vi.fn(),
  savedPim: vi.fn(), restarted: vi.fn(), success: vi.fn(), error: vi.fn(),
  pim: { kind: "google", clientId: "client", clientSecret: "secret", refreshToken: "old-service" },
}));
vi.mock("@capacitor/browser", () => ({ Browser: { open: async ({ url }: { url: string }) => { state.urls.push(url); }, close: async () => {} } }));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => true, getPlatform: () => state.platform }, registerPlugin: () => ({}) }));
vi.mock("../googleNativeAuthorization", () => ({ authorizeNativeGoogle: state.nativeAuthorize }));
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
vi.mock("../cloudAccountsStore", () => ({ loadCloudAccounts: async () => structuredClone(state.records) }));
vi.mock("../syncService", () => ({ getStoredProvider: async () => null, switchProviderToAccountBroker: vi.fn() }));
vi.mock("../vaultRegistry", async original => ({ ...await original<typeof import("../vaultRegistry")>(), getActiveVaultEntry: async () => ({ id: "original-vault" }) }));
vi.mock("./pimCredentials", () => ({ getPimCredentials: async () => structuredClone(state.pim), savePimCredentials: state.savedPim, pimSecretKey: (vault: string, id: string) => `pim_${id}_${vault}` }));
vi.mock("./pimService", () => ({ listPimAccounts: async () => [], restartPimAccountAfterLogin: state.restarted, addPimAccount: vi.fn(), reauthorizePimAccount: vi.fn() }));
vi.mock("@plainva/core", async (original) => ({
  ...await original<typeof import("@plainva/core")>(),
  generatePkcePair: async () => ({ codeVerifier: "verifier", codeChallenge: "challenge" }),
  exchangeCode: async () => ({ accessToken: "access", refreshToken: "new-account", scope: state.granted }),
}));
vi.mock("@plainva/ui/i18n", () => ({ default: { t: (key: string) => key } }));

beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal("window", new EventTarget());
  state.secrets.clear(); state.urls.length = 0; state.storageFails = false; state.failKey = "";
  state.platform = "ios";
  state.nativeAuthorize.mockReset().mockImplementation(async (scope: string) => ({ accessToken: "native-access", scope, profile: { identity: { issuer: "google", subject: "subject" }, label: "person@example.test" } }));
  state.records = [{ id: "account", family: "google", label: "Person", services: { calendar: { pimAccountId: "calendar" } } }];
  state.pim = { kind: "google", clientId: "client", clientSecret: "secret", refreshToken: "old-service" };
  state.savedPim.mockClear(); state.restarted.mockClear(); state.success.mockClear(); state.error.mockClear();
  const { GOOGLE_CALENDAR_SCOPES } = await import("@plainva/core");
  state.granted = GOOGLE_CALENDAR_SCOPES;
  state.secrets.set("account_account_original-vault", { clientId: "client", clientSecret: "secret", refreshToken: "old-account", scopes: state.granted });
  state.secrets.set("pim_calendar_original-vault", structuredClone(state.pim));
});

async function start(): Promise<string> {
  const { beginAccountLogin } = await import("../accountLogin");
  await beginAccountLogin("original-vault", state.records[0]);
  const nonce = new URL(state.urls[0]).searchParams.get("state");
  return `com.plainva.app:/oauth2redirect?code=code&state=${nonce}`;
}
async function coldReturn(url: string): Promise<void> {
  vi.resetModules();
  const { registerAccountLoginHandler } = await import("../accountLogin");
  registerAccountLoginHandler();
  const { handlePimOAuthRedirect } = await import("./pimOAuth");
  expect(await handlePimOAuthRedirect(url)).toBe(true);
}

describe("the real mobile account redirect after a process restart", () => {
  it("does not mistake recovery of a narrower native grant for a new wider consent", async () => {
    state.platform = "android";
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
    state.platform = "android";
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
    state.platform = "android";
    state.nativeAuthorize.mockRejectedValueOnce(Object.assign(new Error("cancelled"), { code: "CANCELLED" }));
    const { registerAccountLoginHandler, beginAccountLogin } = await import("../accountLogin"); registerAccountLoginHandler();
    await expect(beginAccountLogin("original-vault", state.records[0])).rejects.toThrow("cancelled");
    expect(state.secrets.get("account_account_original-vault")).toMatchObject({ refreshToken: "old-account" });
    expect(state.secrets.get("pim_calendar_original-vault")).toMatchObject({ refreshToken: "old-service" });
    expect(state.secrets.has("pim_oauth_received")).toBe(false);
  });
  it("leaves nothing behind after a refused Android sign-in: the same button asks Google again and says the same", async () => {
    state.platform = "android";
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
    expect(texts).toEqual(["connection.googleBuildNotRegistered", "connection.googleBuildNotRegistered"]);
    expect(state.nativeAuthorize).toHaveBeenCalledTimes(2);
    // ...and once Google accepts, the third tap on the same button connects.
    await beginPimOAuth("google", options);
    expect(accept).toHaveBeenCalledTimes(1);
    expect(state.secrets.has("pim_oauth_received")).toBe(false);
  });
  it("renews an Android calendar through the native SDK and keeps its account identity", async () => {
    state.platform = "android";
    const { registerAccountLoginHandler, beginAccountLogin } = await import("../accountLogin");
    registerAccountLoginHandler();
    await beginAccountLogin("original-vault", state.records[0]);
    expect(state.urls).toEqual([]);
    expect(state.nativeAuthorize).toHaveBeenCalledWith(state.granted, true, expect.objectContaining({ refreshToken: "old-account" }));
    expect(state.secrets.get("account_account_original-vault")).toMatchObject({ version: 2, grants: expect.arrayContaining([expect.objectContaining({ refreshToken: "", nativeGoogle: { email: "person@example.test" }, providerIdentity: { issuer: "google", subject: "subject" } })]) });
    expect(state.restarted).toHaveBeenCalledWith("original-vault", "calendar");
  });
  it("keeps an Android Gmail grant recoverable when its mailbox write fails", async () => {
    state.platform = "android";
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
    state.platform = "android";
    const { beginOAuth } = await import("../oauthService");
    const { DRIVE_DEFAULT_SCOPE } = await import("@plainva/core");
    await beginOAuth("drive", { clientId: "android-client", serviceContext: { vaultId: "original-vault" } });
    expect(state.urls).toEqual([]);
    expect(state.nativeAuthorize).toHaveBeenCalledWith(DRIVE_DEFAULT_SCOPE, true);
    expect([...state.secrets.values()]).toContainEqual(expect.objectContaining({ provider: expect.objectContaining({ provider: "drive", creds: expect.objectContaining({ nativeGoogle: { email: "person@example.test" }, grantedScope: DRIVE_DEFAULT_SCOPE, refreshToken: "" }) }), context: { vaultId: "original-vault" } }));
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
    const { registerAccountLoginHandler } = await import("../accountLogin"); registerAccountLoginHandler();
    const { handlePimOAuthRedirect } = await import("./pimOAuth");
    await Promise.all([handlePimOAuthRedirect(url), handlePimOAuthRedirect(url)]);
    expect(state.secrets.get("pim_calendar_original-vault")).toMatchObject({ refreshToken: "" });
    expect(state.success).toHaveBeenCalledTimes(1);
  });

  it("keeps the transaction for an unrelated callback path", async () => {
    const url = await start();
    const { registerAccountLoginHandler } = await import("../accountLogin"); registerAccountLoginHandler();
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
    expect(state.success).toHaveBeenCalledTimes(1);
  });

  it("keeps all old credentials when consent does not grant the calendar", async () => {
    const url = await start(); state.granted = "openid email";
    await coldReturn(url);
    expect(state.error).toHaveBeenCalledWith("cloudAccounts.loginGrantIncomplete");
    expect(state.secrets.get("account_account_original-vault")).toMatchObject({ refreshToken: "old-account" });
    expect(state.savedPim).not.toHaveBeenCalled(); expect(state.restarted).not.toHaveBeenCalled();
    const { getAccountLoginStatus } = await import("../accountLogin");
    expect(getAccountLoginStatus("original-vault", "account")?.services.calendar).toBe("cloudAccounts.loginPermissionMissing");
  });

  it.each(["binding", "account-token", "service-token"])("does not overwrite a changed %s while consent was open", async (change) => {
    const url = await start();
    if (change === "binding") state.records[0].services.calendar!.pimAccountId = "other";
    if (change === "account-token") state.secrets.set("account_account_original-vault", { clientId: "client", refreshToken: "independent-login" });
    if (change === "service-token") state.pim.refreshToken = "independent-service-login";
    await coldReturn(url);
    expect(state.error).toHaveBeenCalledTimes(1);
    expect(state.savedPim).not.toHaveBeenCalled(); expect(state.success).not.toHaveBeenCalled();
    expect(state.secrets.get("account_account_original-vault")).toMatchObject({ refreshToken: change === "account-token" ? "independent-login" : "old-account" });
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
    const { registerAccountLoginHandler } = await import("../accountLogin"); registerAccountLoginHandler();
    const { resumePimOAuthResult } = await import("./pimOAuth");
    await Promise.all([resumePimOAuthResult(), resumePimOAuthResult()]);
    expect(state.secrets.get("pim_calendar_original-vault")).toMatchObject({ refreshToken: "" });
    expect(state.secrets.has("pim_oauth_received")).toBe(false);
    expect(state.secrets.get("account_account_original-vault")).toMatchObject({ version: 2, grants: expect.arrayContaining([expect.objectContaining({ refreshToken: "new-account" })]) });
  });
});
