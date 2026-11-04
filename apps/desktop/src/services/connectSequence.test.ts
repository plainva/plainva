import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CloudAccountRecord } from "@plainva/ui";

/**
 * Connecting a provider with credentials or an app key on the desktop
 * (settings plan 2026-10-29, § 5.1): every chosen service says its own
 * result, and a failure does not stop the ones after it - the run used to
 * stop at the first, leaving the mailbox "waiting" behind a refused calendar.
 * And a Dropbox account has a sign-in on this device the page can read.
 */

const h = vi.hoisted(() => ({
  secrets: new Map<string, unknown>(),
  calendarFails: false as false | Error,
  mailFails: false as false | Error,
}));

vi.mock("./CredentialManager", () => ({
  credentialManager: {
    readSecret: vi.fn(async (key: string) => h.secrets.get(key) ?? null),
    writeSecret: vi.fn(async (key: string, value: unknown) => { h.secrets.set(key, value); }),
    saveWebDavCredentials: vi.fn(async (_v: string, creds: unknown) => { h.secrets.set("webdav", creds); }),
    getDropboxCredentials: vi.fn(async () => h.secrets.get("dropbox") ?? null),
    saveDropboxCredentials: vi.fn(async (_v: string, creds: unknown) => { h.secrets.set("dropbox", creds); }),
    clearWebDavCredentials: vi.fn(async () => undefined),
    clearDriveCredentials: vi.fn(async () => undefined),
    clearOneDriveCredentials: vi.fn(async () => undefined),
    clearDropboxCredentials: vi.fn(async () => undefined),
    clearS3Credentials: vi.fn(async () => undefined),
  },
}));
vi.mock("./dropboxAuth", () => ({ authorizeDropbox: vi.fn(async ({ appKey }: { appKey: string }) => ({ appKey, refreshToken: "dbx-refresh" })) }));
vi.mock("./oauthLoopback", () => ({ oauthErrorText: (error: unknown) => (error instanceof Error ? error.message : String(error)) }));
vi.mock("./syncTargets", () => ({
  buildWebDavTarget: () => ({ listFolders: vi.fn(async () => []) }),
  buildS3Target: () => ({ listFolders: vi.fn(async () => []) }),
  buildDriveTarget: vi.fn(),
  buildOneDriveTarget: vi.fn(),
  buildDropboxTarget: vi.fn(),
}));
vi.mock("./pim/pimAccounts", () => ({
  connectCalDavAccount: vi.fn(async () => {
    if (h.calendarFails) throw h.calendarFails;
    return { id: "pim-1", label: "anna@fastmail.example" };
  }),
  removePimAccount: vi.fn(),
}));
vi.mock("@plainva/ui/mail", () => ({
  checkMailLogin: vi.fn(async () => {
    if (h.mailFails) throw h.mailFails;
    return [];
  }),
  saveMailAccount: vi.fn(async () => undefined),
  saveMicrosoftMailAccount: vi.fn(),
  removeMailAccount: vi.fn(),
  listMailAccounts: vi.fn(async () => []),
  graphMailAddress: vi.fn(),
  forgetGraphMailRuntime: vi.fn(),
  legacyMailSecretKey: () => "mail-legacy",
  mailSecretKey: () => "mail",
}));
vi.mock("./pim/pimRuntime", () => ({ restartPimAccountAfterLogin: vi.fn(async () => undefined) }));
vi.mock("./cloudAccounts", () => ({ loadCloudAccounts: vi.fn(async () => []), saveCloudAccounts: vi.fn(), refreshCloudAccounts: vi.fn(async () => []) }));
vi.mock("./accountBroker", () => ({
  brokerFamily: vi.fn(() => null),
  claimPendingMailbox: vi.fn(),
  fileBrokerTokenProvider: vi.fn(),
  clearAccountToken: vi.fn(),
  getAccountToken: vi.fn(async () => null),
  accountSecretKey: () => "account-slot",
}));
vi.mock("./syncRootFolder", () => ({ readDriveDestination: vi.fn(), readSyncRootFolder: vi.fn(async () => ""), writeSyncRootFolder: vi.fn() }));
vi.mock("./accountGrantMigration", () => ({ rotateLegacyFileGrant: vi.fn() }));
vi.mock("./accountCredentialStore", () => ({ accountCredentialStore: { read: vi.fn(async () => null), compareAndSet: vi.fn(async () => true) } }));
vi.mock("./credentialsAnnouncement", () => ({ announceCredentials: vi.fn(), holdCredentialsAnnouncements: vi.fn() }));
vi.mock("./pim/pimCredentials", () => ({ pimSecretKey: () => "pim-slot", getPimCredentials: vi.fn(async () => null) }));
vi.mock("./accountSignIn", () => ({
  deviceAccess: vi.fn(async () => ({ ok: true, access: { family: "dropbox", source: "own", clientId: "devicekey1234" } })),
  AccessUnavailableError: class extends Error {},
}));

const { runConnectSequence } = await import("./cloudAccountsActions");
const { accountSignedInHere } = await import("./deviceSignIn");
const { slot } = await import("./keychainSlots");

const fastmail = {
  family: "fastmail" as const,
  services: ["files", "calendar", "mail"] as const,
  webdav: { filesUrl: "https://webdav.fastmail.com", caldavUrl: "https://caldav.fastmail.com", user: "anna@fastmail.example", pass: "app-pass" },
  imap: { email: "anna@fastmail.example", host: "imap.fastmail.com", port: 993, pass: "app-pass" },
};

beforeEach(() => {
  h.secrets = new Map();
  h.calendarFails = false;
  h.mailFails = false;
});

describe("runConnectSequence: each service says its own result", () => {
  it("a refused calendar does not stop the mailbox after it", async () => {
    const refused = new Error("caldav PROPFIND 401");
    h.calendarFails = refused;
    const seen: Array<[string, string, unknown]> = [];
    const result = await runConnectSequence("V", { isActive: () => true } as never, { ...fastmail, services: [...fastmail.services] }, (service, status) => {
      seen.push([service, status.state, status.cause]);
    });
    expect(result.filesProvider).toBe("webdav");
    expect(result.mailAccountId).toBeTruthy();
    expect(result.pimAccountId).toBeUndefined();
    expect(result.failed).toEqual({ calendar: refused });
    // The failure itself travels, so the surface can name who refused.
    expect(seen.filter(([, state]) => state !== "pending")).toEqual([
      ["files", "ok", undefined],
      ["calendar", "error", refused],
      ["mail", "ok", undefined],
    ]);
  });

  it("every service can fail on its own - the run still ends and reports each", async () => {
    h.calendarFails = new Error("no calendar");
    h.mailFails = new Error("AUTHENTICATIONFAILED");
    const result = await runConnectSequence("V", { isActive: () => true } as never, { ...fastmail, services: ["calendar", "mail"] }, () => undefined);
    expect(Object.keys(result.failed ?? {}).sort()).toEqual(["calendar", "mail"]);
  });

  it("Dropbox signs in with this device's app key, not the account's", async () => {
    const result = await runConnectSequence("V", null, { family: "dropbox", services: ["files"] }, () => undefined);
    expect(result.filesProvider).toBe("dropbox");
    expect(h.secrets.get("dropbox")).toEqual({ appKey: "devicekey1234", refreshToken: "dbx-refresh", rootPath: undefined });
  });
});

describe("accountSignedInHere: Dropbox", () => {
  const card: CloudAccountRecord = { id: "dbx", family: "dropbox", label: "anna", services: { files: { provider: "dropbox" } } };

  it("a stored Dropbox sign-in is this device's sign-in", async () => {
    h.secrets.set(slot.files("V", "dropbox"), { appKey: "k", refreshToken: "r" });
    expect(await accountSignedInHere("V", card)).toBe(true);
  });

  it("without one the card says it is not signed in here, instead of nothing", async () => {
    expect(await accountSignedInHere("V", card)).toBe(false);
  });
});
