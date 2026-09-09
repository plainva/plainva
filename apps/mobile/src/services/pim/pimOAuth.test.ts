import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CloudAccountRecord } from "@plainva/ui";
// Compile the integration graph during collection; each test still resets the
// module registry, including the simulated process restart before the redirect.
import "../accountLogin";

const state = vi.hoisted(() => ({
  secrets: new Map<string, unknown>(), records: [] as CloudAccountRecord[], urls: [] as string[],
  granted: "", storageFails: false,
  savedPim: vi.fn(), restarted: vi.fn(), success: vi.fn(), error: vi.fn(),
  pim: { kind: "google", clientId: "client", clientSecret: "secret", refreshToken: "old-service" },
}));
vi.mock("@capacitor/browser", () => ({ Browser: { open: async ({ url }: { url: string }) => { state.urls.push(url); }, close: async () => {} } }));
vi.mock("@plainva/ui", async (original) => ({
  ...await original<typeof import("@plainva/ui")>(),
  getPlatformServices: () => ({ credentials: {
    readSecret: async (key: string) => structuredClone(state.secrets.get(key) ?? null),
    writeSecret: async (key: string, value: unknown) => { if (state.storageFails) throw Error("storage unavailable"); state.secrets.set(key, structuredClone(value)); },
    removeSecret: async (key: string) => { state.secrets.delete(key); },
  } }),
  toast: { success: state.success, error: state.error },
}));
vi.mock("../../platform/secureStore", () => ({ secureCredentialStore: {
  readSecret: async (key: string) => structuredClone(state.secrets.get(key) ?? null),
  writeSecret: async (key: string, value: unknown) => { state.secrets.set(key, structuredClone(value)); },
  removeSecret: async (key: string) => { state.secrets.delete(key); },
} }));
vi.mock("../cloudAccountsStore", () => ({ loadCloudAccounts: async () => structuredClone(state.records) }));
vi.mock("../syncService", () => ({ getStoredProvider: async () => null, switchProviderToAccountBroker: vi.fn() }));
vi.mock("./pimCredentials", () => ({ getPimCredentials: async () => structuredClone(state.pim), savePimCredentials: state.savedPim }));
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
  state.secrets.clear(); state.urls.length = 0; state.storageFails = false;
  state.records = [{ id: "account", family: "google", label: "Person", services: { calendar: { pimAccountId: "calendar" } } }];
  state.pim = { kind: "google", clientId: "client", clientSecret: "secret", refreshToken: "old-service" };
  state.savedPim.mockClear(); state.restarted.mockClear(); state.success.mockClear(); state.error.mockClear();
  const { GOOGLE_CALENDAR_SCOPES } = await import("@plainva/core");
  state.granted = GOOGLE_CALENDAR_SCOPES;
  state.secrets.set("account_account_original-vault", { clientId: "client", clientSecret: "secret", refreshToken: "old-account", scopes: state.granted });
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
  it("restores the original vault/account, saves its grant and wakes only its calendar", async () => {
    const url = await start();
    await coldReturn(url);
    expect(state.error).not.toHaveBeenCalled();
    expect(state.secrets.get("account_account_original-vault")).toMatchObject({ refreshToken: "new-account", scopes: state.granted });
    expect(state.savedPim).toHaveBeenCalledWith("original-vault", "calendar", expect.objectContaining({ refreshToken: "" }));
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
});
