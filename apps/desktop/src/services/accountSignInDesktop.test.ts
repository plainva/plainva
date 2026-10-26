import { beforeEach, describe, expect, it, vi } from "vitest";
import { SignInWrongAccountError, type CloudAccountRecord, type StoredAccountToken } from "@plainva/ui";
import { FakeOAuthProvider, type FakeConsentChoice } from "@plainva/ui/testing";

/**
 * The desktop's one account sign-in (account sign-in plan K3), run against the
 * fake provider. Each case is one of the findings of 2026-10-23 (plan § 1):
 * three services ticked and one active, mail as a second account, signing in
 * again with the wrong account, and the own client that was a label nobody read.
 */

const OWN = { clientId: "own-desktop.apps.googleusercontent.com", clientSecret: "own-secret" };
const ALICE = { subject: "sub-alice", email: "alice@example.com" };
const BOB = { subject: "sub-bob", email: "bob@example.com" };

const h = vi.hoisted(() => ({
  provider: null as unknown as FakeOAuthProvider,
  choice: {} as FakeConsentChoice,
  secrets: new Map<string, unknown>(),
  registry: [] as CloudAccountRecord[],
  grants: new Map<string, StoredAccountToken[]>(),
  announced: [] as boolean[],
  pending: [] as (string | null)[],
  calendarConnects: 0,
  mailboxes: [] as { id: string; kind?: string; user: string }[],
}));

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true, invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: (input: RequestInfo | URL, init?: RequestInit) => h.provider.fetch(input, init) }));
vi.mock("./CredentialManager", () => ({
  credentialManager: {
    readSecret: vi.fn(async (key: string) => h.secrets.get(key) ?? null),
    writeSecret: vi.fn(async (key: string, value: unknown) => { h.secrets.set(key, value); }),
    getDriveCredentials: vi.fn(async () => h.secrets.get("drive") ?? null),
    saveDriveCredentials: vi.fn(async (_v: string, creds: unknown) => { h.secrets.set("drive", creds); }),
    getOneDriveCredentials: vi.fn(async () => h.secrets.get("onedrive") ?? null),
    saveOneDriveCredentials: vi.fn(async (_v: string, creds: unknown) => { h.secrets.set("onedrive", creds); }),
  },
}));
vi.mock("./driveAuth", () => ({
  authorizeDrive: vi.fn(async (opts: { clientId: string; clientSecret: string; scope: string; loginHint?: string }) => {
    const code = h.provider.consent({ clientId: opts.clientId, scope: opts.scope, loginHint: opts.loginHint }, h.choice);
    const answer = h.provider.exchange({ code, clientId: opts.clientId, clientSecret: opts.clientSecret });
    return { clientId: opts.clientId, clientSecret: opts.clientSecret, refreshToken: answer.refresh_token, grantedScope: answer.scope, accessToken: answer.access_token };
  }),
}));
vi.mock("./oneDriveAuth", () => ({ authorizeOneDrive: vi.fn() }));
vi.mock("./oauthLoopback", () => ({ oauthErrorText: (error: unknown) => (error instanceof Error ? error.message : String(error)) }));
vi.mock("./cloudAccounts", () => ({
  loadCloudAccounts: vi.fn(async () => h.registry),
  saveCloudAccounts: vi.fn(async (_v: string, records: CloudAccountRecord[]) => { h.registry = records; }),
  refreshCloudAccounts: vi.fn(async () => h.registry),
}));
vi.mock("./accountBroker", () => ({
  saveAccountToken: vi.fn(async (_v: string, id: string, token: StoredAccountToken) => { h.grants.set(id, [...(h.grants.get(id) ?? []), token]); }),
  getAccountToken: vi.fn(async (_v: string, id: string) => (h.grants.get(id) ?? []).slice(-1)[0] ?? null),
  getAccountBroker: vi.fn(() => ({ getAccessToken: vi.fn(async () => "access-from-broker") })),
  setPendingBrokerAccount: vi.fn((marker: { accountId: string } | null) => { h.pending.push(marker?.accountId ?? null); }),
  claimPendingMailbox: vi.fn(),
}));
vi.mock("./cloudAccountsActions", () => ({
  announceCredentials: vi.fn((isNew: boolean) => { h.announced.push(isNew); }),
  clearOtherSyncSlots: vi.fn(async () => undefined),
  connectMicrosoftMailAccount: vi.fn(async () => ({ id: "ms-mail", address: "x" })),
}));
vi.mock("./pim/pimAccounts", () => ({
  // As the real one: a runtime that a reload stopped refuses (`assertPimRuntime`).
  connectGoogleAccount: vi.fn(async (runtime: { isActive(): boolean }) => {
    if (!runtime.isActive()) throw new Error("pim runtime changed");
    h.calendarConnects++;
    return { id: `pim-${h.calendarConnects}`, label: "Calendar" };
  }),
  connectMicrosoftAccount: vi.fn(),
}));
vi.mock("./pim/pimCredentials", () => ({ getPimCredentials: vi.fn(async () => null) }));
vi.mock("./pim/pimRuntime", () => ({ restartPimAccountAfterLogin: vi.fn(async () => undefined) }));
vi.mock("./accountCredentialStore", () => ({ accountCredentialStore: { read: vi.fn(async () => null), compareAndSet: vi.fn(async () => true) } }));
vi.mock("./keychainSlots", () => ({ slot: { calendar: () => "cal" }, legacySlot: { calendar: () => "cal-legacy" } }));
vi.mock("@plainva/ui/mail", () => ({
  checkMailLogin: vi.fn(async () => []),
  forgetGraphMailRuntime: vi.fn(),
  legacyMailSecretKey: () => "mail-legacy",
  listMailAccounts: vi.fn(async () => h.mailboxes),
  mailSecretKey: () => "mail",
  mailTransport: () => ({ checkLogin: vi.fn(async () => undefined) }),
  saveBrokerMailAccount: vi.fn(async (_v: string, account: { id: string; kind?: string; user: string }) => { h.mailboxes.push(account); }),
  saveMailAccount: vi.fn(async (_v: string, account: { id: string; user: string }) => { h.mailboxes.push({ ...account, kind: "imap" }); }),
}));

const runtime = {
  cache: { listAccounts: vi.fn(async () => [{ id: "pim-1", enabled: false }]), upsertAccount: vi.fn(async () => undefined) },
  isActive: () => true,
} as never;

const { signInCloudAccount, AccessUnavailableError, readDeviceAccess } = await import("./accountSignIn");

beforeEach(() => {
  h.provider = new FakeOAuthProvider({ family: "google", accounts: [ALICE, BOB], clients: [OWN] });
  h.choice = {};
  h.secrets = new Map([["oauth_access_google", { source: "own", ...OWN }]]);
  h.registry = [];
  h.grants = new Map();
  h.announced = [];
  h.pending = [];
  h.calendarConnects = 0;
  h.mailboxes = [];
});

describe("connecting a Google account on the desktop", () => {
  /**
   * Finding 2026-10-26 (desktop dev build, new Google project): files and mail
   * connected, the calendar said "the target account or vault changed". The
   * runtime it was handed had been stopped by a vault reload whose new runtime
   * was not in place yet; nothing about the account had changed.
   */
  it("binds the calendar under the runtime that is alive when it runs, not one a reload stopped", async () => {
    const stopped = { ...(runtime as object), isActive: () => false } as never;
    let current: unknown = stopped;
    // The reload finishes while the sign-in is underway.
    setTimeout(() => { current = runtime; }, 150);
    const outcome = await signInCloudAccount("V", () => current as never, { family: "google", add: ["files", "calendar", "mail"] });
    expect(outcome.rows.map((row) => [row.service, row.state])).toEqual([["files", "active"], ["calendar", "active"], ["mail", "active"]]);
    expect(h.registry[0].services.calendar).toEqual({ pimAccountId: "pim-1" });
  });

  it("never calls a reload 'the target account changed'", async () => {
    const { serviceConnectionMessage } = await import("@plainva/ui");
    const text = serviceConnectionMessage(new Error("pim runtime changed"), (key) => key);
    expect(text).toBe("connection.runtimeChanged");
  });

  it("binds files, calendar and mail from ONE consent and reloads the vault once, at the end (plan § 1.1)", async () => {
    const outcome = await signInCloudAccount("V", () => runtime, { family: "google", add: ["files", "calendar", "mail"] });
    expect(h.provider.log.filter((entry) => entry.kind === "consent")).toHaveLength(1);
    expect(outcome.rows.map((row) => [row.service, row.state])).toEqual([["files", "active"], ["calendar", "active"], ["mail", "active"]]);
    expect(h.registry).toHaveLength(1);
    expect(h.registry[0].services).toEqual({ files: { provider: "drive" }, calendar: { pimAccountId: "pim-1" }, mail: { mailAccountId: expect.stringMatching(/^gmail-/) } });
    // The files slot names the client and keeps no token of its own.
    expect(h.secrets.get("drive")).toMatchObject({ clientId: OWN.clientId, clientSecret: OWN.clientSecret, refreshToken: "" });
    // One reload, after everything; the pending marker spans the binding only.
    expect(h.announced).toEqual([true]);
    expect(h.pending[h.pending.length - 1]).toBeNull();
  });

  it("says which service was left unticked instead of stopping at the first", async () => {
    h.choice = { untick: ["https://www.googleapis.com/auth/calendar", "https://www.googleapis.com/auth/tasks"] };
    const outcome = await signInCloudAccount("V", () => runtime, { family: "google", add: ["files", "calendar", "mail"] });
    expect(outcome.rows.map((row) => [row.service, row.state])).toEqual([["files", "active"], ["calendar", "notGranted"], ["mail", "active"]]);
    expect(h.calendarConnects).toBe(0);
  });

  it("adds mail to the account the vault already has instead of making a second one (plan § 1.3)", async () => {
    await signInCloudAccount("V", () => runtime, { family: "google", add: ["files"] });
    const outcome = await signInCloudAccount("V", () => runtime, { family: "google", add: ["mail"] });
    expect(outcome.completed?.joinedExistingCard).toBe(true);
    expect(h.registry).toHaveLength(1);
    expect(Object.keys(h.registry[0].services).sort()).toEqual(["files", "mail"]);
  });

  it("refuses another account when signing a card in again, and changes nothing (plan § 1.4)", async () => {
    await signInCloudAccount("V", () => runtime, { family: "google", add: ["files"] });
    const before = JSON.stringify(h.registry);
    const grants = h.grants.get(h.registry[0].id)?.length;
    h.choice = { account: BOB.email };
    await expect(signInCloudAccount("V", () => runtime, { family: "google", cardId: h.registry[0].id, add: [] })).rejects.toBeInstanceOf(SignInWrongAccountError);
    expect(JSON.stringify(h.registry)).toBe(before);
    expect(h.grants.get(h.registry[0].id)?.length).toBe(grants);
  });

  it("signing in again asks for everything the card carries and preselects its address", async () => {
    await signInCloudAccount("V", () => runtime, { family: "google", add: ["files", "calendar"] });
    await signInCloudAccount("V", () => runtime, { family: "google", cardId: h.registry[0].id, add: [] });
    const consents = h.provider.log.filter((entry) => entry.kind === "consent");
    expect(consents).toHaveLength(2);
    expect(consents[1].detail.loginHint).toBe(ALICE.email);
    expect(String(consents[1].detail.scope)).toContain("https://www.googleapis.com/auth/calendar");
    // The calendar row stays; it is rebound, not connected a second time.
    expect(h.calendarConnects).toBe(1);
  });
});

describe("this device's access", () => {
  it("names a missing access instead of trying some other client", async () => {
    h.secrets = new Map();
    await expect(signInCloudAccount("V", () => runtime, { family: "google", add: ["files"] })).rejects.toBeInstanceOf(AccessUnavailableError);
  });

  it("adopts the own client an account held before this plan, once", async () => {
    h.secrets = new Map([["drive", { clientId: "legacy.apps.googleusercontent.com", clientSecret: "legacy-secret", refreshToken: "" }]]);
    expect(await readDeviceAccess("google", "V")).toEqual({ source: "own", clientId: "legacy.apps.googleusercontent.com", clientSecret: "legacy-secret" });
    expect(h.secrets.get("oauth_access_google")).toEqual({ source: "own", clientId: "legacy.apps.googleusercontent.com", clientSecret: "legacy-secret" });
  });

  it("keeps 'nothing to adopt', so a later build never takes its predecessor's standard client for an own one (finding 2026-10-26)", async () => {
    h.secrets = new Map();
    expect(await readDeviceAccess("google", "V")).toEqual({ source: "plainva" });
    // Later the slots name a client this build does not ship - the standard
    // client of the build before a project switch, say.
    h.secrets.set("drive", { clientId: "previous-standard.apps.googleusercontent.com", clientSecret: "s", refreshToken: "" });
    expect(await readDeviceAccess("google", "V")).toEqual({ source: "plainva" });
  });

  it("moves a device whose own client belongs to the retired project back to the standard sign-in, once (finding 2026-10-26)", async () => {
    h.secrets = new Map([["oauth_access_google", { source: "own", clientId: "835308879715-bim1pgh5example.apps.googleusercontent.com", clientSecret: "s" }]]);
    expect(await readDeviceAccess("google", "V")).toEqual({ source: "plainva" });
    expect(h.secrets.get("oauth_access_google")).toEqual({ source: "plainva" });
  });

  it("keeps an own client of any other project", async () => {
    const own = { source: "own", clientId: "123456789012-mine.apps.googleusercontent.com", clientSecret: "s" };
    h.secrets = new Map([["oauth_access_google", own]]);
    expect(await readDeviceAccess("google", "V")).toEqual(own);
  });

  it("never adopts a client of the retired project from the slots", async () => {
    h.secrets = new Map([["drive", { clientId: "835308879715-bim1pgh5example.apps.googleusercontent.com", clientSecret: "s", refreshToken: "" }]]);
    expect(await readDeviceAccess("google", "V")).toEqual({ source: "plainva" });
  });
});
