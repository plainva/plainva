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
const GOOGLE_RECORDS = [{ id: "acc", family: "google", label: "a@gmail.com", services: { calendar: { pimAccountId: "pim-1" } } }];
let records: unknown[] = GOOGLE_RECORDS;
let storedFiles: unknown = null;
vi.mock("./devicePlatform", () => ({ devicePlatform: () => "android" }));
vi.mock("../adapters/webdavHttp", () => ({ webdavFetch: vi.fn() }));
vi.mock("./pim/pimOAuth", () => ({ beginPimOAuth: vi.fn(), setOAuthPurposeHandler: vi.fn() }));
vi.mock("./accountBroker", () => ({ getAccountToken: vi.fn(async () => null), saveAccountToken: vi.fn() }));
vi.mock("./pim/pimCredentials", () => ({ getPimCredentials: vi.fn(async () => pimSlot), pimSecretKey: () => "pim" }));
vi.mock("./pim/pimService", () => ({ restartPimAccountAfterLogin: vi.fn() }));
vi.mock("./cloudAccountsStore", () => ({
  loadCloudAccounts: vi.fn(async () => records),
  saveCloudAccounts: vi.fn(),
}));
vi.mock("./syncService", () => ({ switchProviderToAccountBroker: vi.fn(), getStoredProvider: vi.fn(async () => storedFiles) }));
vi.mock("./googleNativeAuthorization", () => ({ authorizeNativeGoogle: vi.fn() }));
vi.mock("./accountCredentialStore", () => ({ accountCredentialStore: {} }));
vi.mock("./connectQueue", () => ({ startConnectQueue: vi.fn() }));
vi.mock("./accountLogin", () => ({ announceAccountLogin: vi.fn() }));
vi.mock("./signInNotice", () => ({ markSignInAnnounced: (e: unknown) => e }));

const { readDeviceAccess, deviceAccess, dropboxDeviceKey, AccessUnavailableError } = await import("./accountSignIn");
const { PLAINVA_DROPBOX_APP_KEY } = await import("@plainva/ui");

beforeEach(() => {
  secrets.clear();
  pimSlot = null;
  records = GOOGLE_RECORDS;
  storedFiles = null;
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

/**
 * Dropbox's app key is the phone's choice like the Google and Microsoft
 * client (settings plan 2026-10-29, E6). A key an account kept before is
 * taken over once; Plainva's own key, which the old account page wrote as the
 * account's, is the standard sign-in; nothing on the account is removed.
 */
describe("the Dropbox app key on the phone", () => {
  it("takes an account's own key over once and keeps it as the phone's choice", async () => {
    records = [{ id: "d", family: "dropbox", label: "x", byoClientId: "abcd1234efgh", services: { files: { provider: "dropbox" } } }];
    expect(await readDeviceAccess("dropbox", "v1")).toEqual({ source: "own", clientId: "abcd1234efgh" });
    expect(secrets.get("oauth_access_dropbox")).toEqual({ source: "own", clientId: "abcd1234efgh" });
    // Idempotent: a later change on the account does not move the phone's choice.
    records = [{ id: "d", family: "dropbox", label: "x", byoClientId: "zzzz9999yyyy", services: { files: { provider: "dropbox" } } }];
    expect(await readDeviceAccess("dropbox", "v1")).toEqual({ source: "own", clientId: "abcd1234efgh" });
    expect(await dropboxDeviceKey("v1")).toBe("abcd1234efgh");
  });

  it("reads the key the stored sign-in was made with, and Plainva's key as the standard sign-in", async () => {
    records = [];
    storedFiles = { provider: "dropbox", creds: { appKey: PLAINVA_DROPBOX_APP_KEY, refreshToken: "r" } };
    expect(await readDeviceAccess("dropbox", "v1")).toEqual({ source: "plainva" });
    expect(await dropboxDeviceKey("v1")).toBe(PLAINVA_DROPBOX_APP_KEY);
  });

  it("keeps 'no choice' when nothing is there to take over, and resolves to Plainva's key", async () => {
    records = [];
    expect(await readDeviceAccess("dropbox", "v1")).toBeNull();
    expect(secrets.has("oauth_access_dropbox")).toBe(false);
    expect(await deviceAccess("dropbox", "v1")).toEqual({ ok: true, access: { family: "dropbox", source: "plainva", clientId: PLAINVA_DROPBOX_APP_KEY } });
  });

  it("says that an own key is missing instead of falling back in silence", async () => {
    secrets.set("oauth_access_dropbox", { source: "own" });
    await expect(dropboxDeviceKey("v1")).rejects.toBeInstanceOf(AccessUnavailableError);
  });
});
