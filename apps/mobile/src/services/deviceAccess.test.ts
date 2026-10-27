import { beforeEach, describe, expect, it, vi } from "vitest";
import { setPlatformServices } from "@plainva/ui";

/**
 * This phone's access (account sign-in plan E3), finding 2026-10-26: a phone
 * that never stored its choice adopted an "own" client by comparing with the
 * client THIS build ships - so the day a build switched to a new Google
 * project, the previous build's standard client (kept in a calendar slot since
 * the one sign-in) became an own client, and the browser answered
 * "Error 401: deleted_client". Nothing to adopt is now kept as a decision.
 */

const secrets = new Map<string, unknown>();
let pimSlot: unknown = null;
vi.mock("./devicePlatform", () => ({ devicePlatform: () => "android" }));
vi.mock("../adapters/webdavHttp", () => ({ webdavFetch: vi.fn() }));
vi.mock("./pim/pimOAuth", () => ({ beginPimOAuth: vi.fn(), setOAuthPurposeHandler: vi.fn() }));
vi.mock("./accountBroker", () => ({ getAccountToken: vi.fn(async () => null), saveAccountToken: vi.fn() }));
vi.mock("./pim/pimCredentials", () => ({ getPimCredentials: vi.fn(async () => pimSlot), pimSecretKey: () => "pim" }));
vi.mock("./pim/pimService", () => ({ restartPimAccountAfterLogin: vi.fn() }));
vi.mock("./cloudAccountsStore", () => ({
  loadCloudAccounts: vi.fn(async () => [{ id: "acc", family: "google", label: "a@gmail.com", services: { calendar: { pimAccountId: "pim-1" } } }]),
  saveCloudAccounts: vi.fn(),
}));
vi.mock("./syncService", () => ({ switchProviderToAccountBroker: vi.fn() }));
vi.mock("./googleNativeAuthorization", () => ({ authorizeNativeGoogle: vi.fn() }));
vi.mock("./accountCredentialStore", () => ({ accountCredentialStore: {} }));
vi.mock("./connectQueue", () => ({ startConnectQueue: vi.fn() }));
vi.mock("./accountLogin", () => ({ announceAccountLogin: vi.fn() }));
vi.mock("./signInNotice", () => ({ markSignInAnnounced: (e: unknown) => e }));

const { readDeviceAccess } = await import("./accountSignIn");

beforeEach(() => {
  secrets.clear();
  pimSlot = null;
  setPlatformServices({
    credentials: {
      readSecret: async (key: string) => (secrets.get(key) ?? null) as never,
      writeSecret: async (key: string, value: unknown) => { secrets.set(key, value); },
      removeSecret: async (key: string) => { secrets.delete(key); },
    },
  } as never);
});

describe("readDeviceAccess on the phone", () => {
  it("keeps 'nothing to adopt', so a later build never takes its predecessor's standard client for an own one", async () => {
    expect(await readDeviceAccess("google", "v1")).toEqual({ source: "plainva" });
    // The calendar slot names a client this build does not ship.
    pimSlot = { kind: "google", clientId: "previous-standard.apps.googleusercontent.com", refreshToken: "" };
    expect(await readDeviceAccess("google", "v1")).toEqual({ source: "plainva" });
  });

  it("still adopts an own client once, where there was one before the plan", async () => {
    pimSlot = { kind: "google", clientId: "own-1234.apps.googleusercontent.com", refreshToken: "" };
    expect(await readDeviceAccess("google", "v1")).toEqual({ source: "own", clientId: "own-1234.apps.googleusercontent.com" });
  });

  it("moves a phone whose own client belongs to the retired project back to the standard sign-in, once", async () => {
    secrets.set("oauth_access_google", { source: "own", clientId: "835308879715-bim1pgh5example.apps.googleusercontent.com" });
    expect(await readDeviceAccess("google", "v1")).toEqual({ source: "plainva" });
    expect(secrets.get("oauth_access_google")).toEqual({ source: "plainva" });
  });

  it("keeps an own client of any other project", async () => {
    secrets.set("oauth_access_google", { source: "own", clientId: "123456789012-mine.apps.googleusercontent.com" });
    expect(await readDeviceAccess("google", "v1")).toEqual({ source: "own", clientId: "123456789012-mine.apps.googleusercontent.com" });
  });

  it("never adopts a client of the retired project from a calendar slot", async () => {
    pimSlot = { kind: "google", clientId: "835308879715-bim1pgh5example.apps.googleusercontent.com", refreshToken: "" };
    expect(await readDeviceAccess("google", "v1")).toEqual({ source: "plainva" });
  });
});
