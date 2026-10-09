import { beforeEach, describe, expect, it, vi } from "vitest";
import { accountCredentialGrants, createTokenBroker, GOOGLE_MAIL_SCOPES, tokenCoversService, type StoredAccountToken } from "@plainva/ui";

const state = vi.hoisted(() => ({ authorize: vi.fn(), clearToken: vi.fn(), fetch: vi.fn() }));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => true, getPlatform: () => "android" }, registerPlugin: () => ({ authorize: state.authorize, clearToken: state.clearToken, takeOrphanResult: async () => ({}) }) }));
vi.mock("../adapters/webdavHttp", () => ({ webdavFetch: state.fetch }));
let native: typeof import("./googleNativeAuthorization");
const grant: StoredAccountToken = { clientId: "android-registration", refreshToken: "", nativeGoogle: { email: "person@example.test" }, providerIdentity: { issuer: "google", subject: "subject" }, scopes: GOOGLE_MAIL_SCOPES };
beforeEach(async () => {
  vi.resetModules();
  state.authorize.mockReset().mockResolvedValue({ accessToken: "ephemeral", scopes: GOOGLE_MAIL_SCOPES.split(" ") });
  state.clearToken.mockReset().mockResolvedValue(undefined);
  state.fetch.mockReset().mockImplementation(async () => Response.json({ sub: "subject", email: "person@example.test", email_verified: true }));
  native = await import("./googleNativeAuthorization");
});
describe("Android Google authorization", () => {
  it("stores a verified native grant without inventing a refresh token and single-flights mail", async () => {
    expect(accountCredentialGrants(grant)).toEqual([grant]);
    expect(tokenCoversService(grant, "mail", "google")).toBe(true);
    const write = vi.fn();
    const broker = createTokenBroker({ family: "google", store: { read: async () => grant, write }, scopeFor: () => GOOGLE_MAIL_SCOPES,
      refresh: request => native.authorizeNativeGoogle(request.scope, false, request) });
    expect(await Promise.all([broker.getAccessToken("mail"), broker.getAccessToken("mail")])).toEqual(["ephemeral", "ephemeral"]);
    expect(state.authorize).toHaveBeenCalledTimes(1);
    expect(state.authorize).toHaveBeenCalledWith({ scopes: GOOGLE_MAIL_SCOPES.split(" "), email: grant.nativeGoogle!.email, interactive: false });
    expect(write).not.toHaveBeenCalled();
  });
  it("clears a rejected SDK token before asking again", async () => {
    await native.authorizeNativeGoogle(GOOGLE_MAIL_SCOPES, false, grant);
    native.forgetNativeGoogleTokens();
    state.authorize.mockImplementationOnce(async () => { expect(state.clearToken).toHaveBeenCalledWith({ token: "ephemeral" }); return { accessToken: "next", scopes: GOOGLE_MAIL_SCOPES.split(" ") }; });
    await native.authorizeNativeGoogle(GOOGLE_MAIL_SCOPES, false, grant);
  });
  it("surfaces revoked consent without opening the native account picker in the background", async () => {
    state.authorize.mockRejectedValue({ code: "CONSENT_REQUIRED" });
    await expect(native.authorizeNativeGoogle(GOOGLE_MAIL_SCOPES, false, grant)).rejects.toThrow("invalid_grant");
    expect(state.authorize.mock.calls[0][0].interactive).toBe(false);
  });
  it("names the class of a failed sign-in and writes one line without anything personal", async () => {
    const { getDiagnostics, clearDiagnosticsForTests, serviceConnectionMessage } = await import("@plainva/ui");
    clearDiagnosticsForTests();
    const calendar = "https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/tasks openid email";
    state.authorize.mockRejectedValue({ message: "Google authorization failed", code: "DEVELOPER_ERROR",
      data: { stage: "result", resultCode: 0, hadIntent: true, status: 10, statusName: "DEVELOPER_ERROR", detail: "not set up for person@example.test https://www.googleapis.com/auth/calendar" } });
    const error = await native.authorizeNativeGoogle(calendar, true).catch((e: unknown) => e);
    expect(error).toMatchObject({ name: "GoogleAuthorizationError", code: "DEVELOPER_ERROR", status: 10 });
    expect(serviceConnectionMessage(error, (key) => key)).toBe("connection.googleSystemSignInUnavailable");
    const lines = getDiagnostics().filter((entry) => entry.source === "google-signin").map((entry) => entry.message);
    expect(lines).toEqual(["calendar sign-in failed: DEVELOPER_ERROR, interactive, account chooser, stage result, status 10 DEVELOPER_ERROR, resultCode 0, intent present, detail: not set up for <address> <link>"]);
    expect(lines.join(" ")).not.toMatch(/person@|googleapis/);
  });
  it("keeps a closed sheet a cancel, and an unknown answer a failure", async () => {
    state.authorize.mockRejectedValueOnce({ message: "Google authorization cancelled", code: "CANCELLED", data: { stage: "result", resultCode: 0, hadIntent: false } });
    await expect(native.authorizeNativeGoogle(GOOGLE_MAIL_SCOPES, true)).rejects.toMatchObject({ code: "CANCELLED", message: "google_authorization:CANCELLED" });
    state.authorize.mockRejectedValueOnce(new Error("plugin is not implemented"));
    await expect(native.authorizeNativeGoogle(GOOGLE_MAIL_SCOPES, true)).rejects.toMatchObject({ code: "AUTH_FAILED" });
  });
  it("offers Google's chooser when the named account is not on this phone, and still insists on the same account", async () => {
    state.authorize.mockRejectedValueOnce({ code: "INVALID_ACCOUNT", data: { stage: "request", status: 5 } });
    const result = await native.authorizeNativeGoogle(GOOGLE_MAIL_SCOPES, true, grant);
    expect(result.profile.label).toBe("person@example.test");
    expect(state.authorize.mock.calls.map((call) => call[0].email)).toEqual([grant.nativeGoogle!.email, undefined]);
    // Another account picked in the chooser is refused exactly as before.
    state.authorize.mockRejectedValueOnce({ code: "INVALID_ACCOUNT", data: { stage: "request", status: 5 } });
    state.fetch.mockResolvedValueOnce(Response.json({ sub: "someone-else", email: "other@example.test", email_verified: true }));
    await expect(native.authorizeNativeGoogle(GOOGLE_MAIL_SCOPES, true, grant)).rejects.toThrow("different provider account");
    // A background renewal never opens anything.
    state.authorize.mockClear().mockRejectedValueOnce({ code: "INVALID_ACCOUNT", data: { stage: "request", status: 5 } });
    await expect(native.authorizeNativeGoogle(GOOGLE_MAIL_SCOPES, false, grant)).rejects.toMatchObject({ code: "INVALID_ACCOUNT" });
    expect(state.authorize).toHaveBeenCalledTimes(1);
  });
  it("logs a failing background renewal once, not every cycle", async () => {
    const { getDiagnostics, clearDiagnosticsForTests, logDiagnostic } = await import("@plainva/ui");
    clearDiagnosticsForTests();
    state.authorize.mockRejectedValue({ code: "NETWORK_ERROR", data: { stage: "request", status: 7, statusName: "NETWORK_ERROR" } });
    for (let cycle = 0; cycle < 3; cycle += 1) {
      await expect(native.authorizeNativeGoogle(GOOGLE_MAIL_SCOPES, false, grant)).rejects.toMatchObject({ code: "NETWORK_ERROR" });
      logDiagnostic("pim", `cycle ${cycle}`);
    }
    expect(getDiagnostics().filter((entry) => entry.source === "google-signin")).toHaveLength(1);
  });
  it("uses the system sign-in only with the build's own client or to renew a grant it already holds", async () => {
    const own = "plainva-android.apps.googleusercontent.com";
    expect(native.hasGooglePlayServices()).toBe(true);
    // No client ships with this build: whatever the user enters goes through the browser.
    expect(native.googleSignInFlow("users-own.apps.googleusercontent.com")).toBe("browser");
    expect(native.googleSignInFlow(own)).toBe("browser");
    // ...except to sign in again an account whose grant Play services holds, with the same client.
    expect(native.googleSignInFlow("users-own.apps.googleusercontent.com", ["users-own.apps.googleusercontent.com"])).toBe("native");
    expect(native.googleSignInFlow("another.apps.googleusercontent.com", ["users-own.apps.googleusercontent.com"])).toBe("browser");
    vi.stubEnv("VITE_PLAINVA_GOOGLE_MAIL_STATE", "testing");
    vi.stubEnv("VITE_PLAINVA_GOOGLE_ANDROID_CLIENT_ID", own);
    expect(native.googleSignInFlow(own)).toBe("native");
    expect(native.googleSignInFlow("users-own.apps.googleusercontent.com")).toBe("browser");
    // The gate of the shipped entry stays: outside "testing" there is none.
    vi.stubEnv("VITE_PLAINVA_GOOGLE_MAIL_STATE", "production");
    expect(native.googleSignInFlow(own)).toBe("browser");
    vi.unstubAllEnvs();
  });
  it("rejects another subject and a partial consent", async () => {
    state.fetch.mockResolvedValueOnce(Response.json({ sub: "other", email: "person@example.test", email_verified: true }));
    await expect(native.authorizeNativeGoogle(GOOGLE_MAIL_SCOPES, false, grant)).rejects.toThrow("different provider account");
    state.authorize.mockResolvedValueOnce({ accessToken: "token", scopes: ["openid", "email"] });
    await expect(native.authorizeNativeGoogle(GOOGLE_MAIL_SCOPES, true)).rejects.toThrow("requested permissions");
  });
});
