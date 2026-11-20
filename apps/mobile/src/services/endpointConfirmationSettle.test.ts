import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * F57's switch-over on the phone (maintainer, 2026-11-18; review of F57,
 * O1/O2): a password this phone holds and typed here confirms its address,
 * nothing else does — a phone that syncs its own Nextcloud over `http` at home
 * asks nothing after the update, a phone that got an account through the
 * settings sync asks before its password goes there, and what cannot be read
 * confirms nothing and leaves the vault for the next start. The shared rule
 * is `packages/ui/src/lib/endpointConfirmation.ts`.
 */

const state = vi.hoisted(() => ({
  settings: new Map<string, unknown>(),
  stored: null as unknown,
  pimRows: [] as Array<{ id: string; provider: string; config: Record<string, unknown> }>,
  pimCreds: new Map<string, unknown>(),
  calendars: new Map<string, unknown[]>(),
  importedCalDav: new Set<string>(),
  importedImap: new Set<string>(),
  mailboxes: [] as Array<Record<string, unknown>>,
  cachedMail: new Set<string>(),
  secrets: new Map<string, unknown>(),
  failing: null as null | "imports" | "secrets" | "calendars",
}));

vi.mock("./syncService", () => ({ getStoredProvider: async () => state.stored }));
vi.mock("./pim/pimCredentials", () => ({
  getPimCredentials: async (_vault: string, id: string) => {
    if (state.failing === "secrets") throw new Error("secure store does not answer");
    return state.pimCreds.get(id) ?? null;
  },
}));
vi.mock("./mobileSecretsPort", () => ({
  importedSecretOf: async () => {
    if (state.failing === "imports") throw new Error("settings unreadable");
    return {
    caldav: (url: string, user: string) => state.importedCalDav.has(`${url}|${user}`),
    imap: (account: { host: string; user: string }) => state.importedImap.has(`${account.host}|${account.user}`),
    };
  },
}));
vi.mock("./mobileSettingsSync", () => ({ mobileSyncDeviceId: async () => "phone" }));
vi.mock("@plainva/ui/mail", () => ({
  listMailAccounts: async () => state.mailboxes,
  mailAccountKind: (account: { kind?: string }) => account.kind ?? "imap",
  hasCachedMail: async (_db: unknown, id: string) => state.cachedMail.has(id),
  mailSecretKey: (_vault: string, id: string) => `mail_${id}`,
  legacyMailSecretKey: (_vault: string, id: string) => `mail_${id}`,
}));
vi.mock("@plainva/core", async (original) => ({
  ...(await original<typeof import("@plainva/core")>()),
  PimCacheRepository: class {
    async listAccounts() {
      if (state.failing === "calendars") throw new Error("database closed");
      return state.pimRows;
    }
    async listCalendars(id: string) { return state.calendars.get(id) ?? []; }
  },
}));

import { confirmationEndpoint, getPlatformServices, isEndpointConfirmedIn, setPlatformServices } from "@plainva/ui";
import { settleVaultEndpointConfirmations } from "./endpointConfirmationSettle";
import { mobileSyncStart } from "./fileSyncAccess";

const VAULT = { vaultId: "v1", db: {} as never };
const FILES = "http://192.168.1.5/remote.php/dav/files/anna";
const CALDAV = "http://192.168.1.5/remote.php/dav";

beforeEach(() => {
  let previous: ReturnType<typeof getPlatformServices> | undefined;
  try { previous = getPlatformServices(); } catch { previous = undefined; }
  setPlatformServices({
    ...previous,
    loadSettings: async () => ({
      get: async (key: string) => state.settings.get(key),
      set: async (key: string, value: unknown) => void state.settings.set(key, structuredClone(value)),
      delete: async (key: string) => void state.settings.delete(key),
      keys: async () => [...state.settings.keys()],
      save: async () => undefined,
    }),
    credentials: {
      readSecret: async (key: string) => {
        if (state.failing === "secrets") throw new Error("secure store does not answer");
        return state.secrets.get(key) ?? null;
      },
      writeSecret: async () => undefined,
      removeSecret: async () => undefined,
    },
  } as unknown as Parameters<typeof setPlatformServices>[0]);
  state.settings.clear();
  state.stored = null;
  state.pimRows = [];
  state.pimCreds.clear();
  state.calendars.clear();
  state.importedCalDav.clear();
  state.importedImap.clear();
  state.mailboxes = [];
  state.cachedMail.clear();
  state.secrets.clear();
  state.failing = null;
});

describe("the switch-over of a vault to F57 on the phone", () => {
  it("a phone with its Nextcloud over http at home asks nothing after the update", async () => {
    state.stored = { provider: "webdav", creds: { url: FILES, user: "anna", pass: "pw" } };
    state.pimRows = [{ id: "cal", provider: "caldav", config: {} }];
    state.pimCreds.set("cal", { kind: "caldav", url: CALDAV, user: "anna", pass: "pw" });
    state.calendars.set("cal", [{ id: "personal" }]);

    await settleVaultEndpointConfirmations(VAULT);

    expect(await isEndpointConfirmedIn("v1", confirmationEndpoint(FILES))).toBe(true);
    expect(await isEndpointConfirmedIn("v1", confirmationEndpoint(CALDAV))).toBe(true);
    expect(mobileSyncStart({ filesOff: false, entryProvider: "webdav", stored: state.stored as never, unconfirmed: false })).toMatchObject({ start: true });
  });

  it("a phone that got the calendar and the mailbox only through the sync asks before the password goes there", async () => {
    state.pimRows = [{ id: "cal", provider: "caldav", config: { confirmedAccess: { laptop: { url: CALDAV, user: "anna", seq: 1 } } } }];
    state.pimCreds.set("cal", { kind: "caldav", url: CALDAV, user: "anna", pass: "pw" });
    state.importedCalDav.add(`${CALDAV}|anna`);
    state.mailboxes = [{ id: "mb", kind: "imap", host: "mail.home.arpa", port: 993, user: "anna" }];
    state.importedImap.add("mail.home.arpa|anna");

    await settleVaultEndpointConfirmations(VAULT);

    expect(await isEndpointConfirmedIn("v1", confirmationEndpoint(CALDAV))).toBe(false);
    expect(await isEndpointConfirmedIn("v1", "imap://mail.home.arpa:993")).toBe(false);
  });

  it("a calendar or mailbox that came through the sync proves nothing, even one this phone already fetched", async () => {
    state.pimRows = [
      { id: "own", provider: "caldav", config: { confirmedAccess: { phone: { url: CALDAV, user: "anna", seq: 2 } } } },
      { id: "cached", provider: "caldav", config: {} },
    ];
    state.pimCreds.set("own", { kind: "caldav", url: CALDAV, user: "anna", pass: "pw" });
    state.pimCreds.set("cached", { kind: "caldav", url: "http://nas.local:5232/", user: "bob", pass: "pw" });
    state.importedCalDav.add(`${CALDAV}|anna`).add("http://nas.local:5232/|bob");
    state.calendars.set("cached", [{ id: "work" }]);
    state.mailboxes = [{ id: "mb", kind: "imap", host: "192.168.1.20", port: 993, user: "anna" }];
    state.secrets.set("mail_mb", { pass: "pw" });
    state.importedImap.add("192.168.1.20|anna");
    state.cachedMail.add("mb");

    await settleVaultEndpointConfirmations(VAULT);

    expect(await isEndpointConfirmedIn("v1", confirmationEndpoint(CALDAV))).toBe(false);
    expect(await isEndpointConfirmedIn("v1", "http://nas.local:5232")).toBe(false);
    expect(await isEndpointConfirmedIn("v1", "imap://192.168.1.20:993")).toBe(false);
  });

  it("a password typed here confirms its mailbox; a mailbox without a password here proves nothing, whatever the profile brought (O2)", async () => {
    state.mailboxes = [
      { id: "typed", kind: "imap", host: "192.168.1.20", port: 993, user: "anna", smtpHost: "192.168.1.20", smtpPort: 587 },
      { id: "nopass", kind: "imap", host: "192.168.1.30", port: 993, user: "bob" },
    ];
    state.secrets.set("mail_typed", { pass: "pw" });
    state.pimRows = [{ id: "cal", provider: "caldav", config: {} }];

    await settleVaultEndpointConfirmations(VAULT);

    expect(await isEndpointConfirmedIn("v1", "imap://192.168.1.20:993")).toBe(true);
    expect(await isEndpointConfirmedIn("v1", "smtp://192.168.1.20:587")).toBe(true);
    expect(await isEndpointConfirmedIn("v1", "imap://192.168.1.30:993")).toBe(false);
    // Its password comes later, through the sync: still nothing confirmed, nothing sent without the question.
    state.secrets.set("mail_nopass", { pass: "pw" });
    state.importedImap.add("192.168.1.30|bob");
    await settleVaultEndpointConfirmations(VAULT);
    expect(await isEndpointConfirmedIn("v1", "imap://192.168.1.30:993")).toBe(false);
  });

  it("a calendar sign-in stored without a password proves nothing (O2)", async () => {
    state.pimRows = [{ id: "cal", provider: "caldav", config: {} }];
    state.pimCreds.set("cal", { kind: "caldav", url: CALDAV, user: "anna", pass: "" });
    await settleVaultEndpointConfirmations(VAULT);
    expect(await isEndpointConfirmedIn("v1", confirmationEndpoint(CALDAV))).toBe(false);
  });

  for (const failing of ["imports", "secrets", "calendars"] as const) {
    it(`what cannot be read (${failing}) confirms nothing, and the next start runs the switch-over again (O1)`, async () => {
      state.stored = { provider: "webdav", creds: { url: FILES, user: "anna", pass: "pw" } };
      state.pimRows = [{ id: "cal", provider: "caldav", config: {} }];
      state.pimCreds.set("cal", { kind: "caldav", url: CALDAV, user: "anna", pass: "pw" });
      state.mailboxes = [{ id: "mb", kind: "imap", host: "192.168.1.20", port: 993, user: "anna" }];
      state.secrets.set("mail_mb", { pass: "pw" });
      state.failing = failing;
      await expect(settleVaultEndpointConfirmations(VAULT)).rejects.toThrow();
      state.failing = null;
      for (const endpoint of [confirmationEndpoint(CALDAV), "imap://192.168.1.20:993"]) expect(await isEndpointConfirmedIn("v1", endpoint)).toBe(false);
      await settleVaultEndpointConfirmations(VAULT);
      for (const endpoint of [confirmationEndpoint(FILES), confirmationEndpoint(CALDAV), "imap://192.168.1.20:993"]) expect(await isEndpointConfirmedIn("v1", endpoint)).toBe(true);
    });
  }

  it("an unconfirmed file address stops the sync, the settings profile included, and asks for Confirm, not a sign-in (O3)", () => {
    const stored = { provider: "webdav", creds: { url: FILES, user: "anna", pass: "pw" } } as never;
    expect(mobileSyncStart({ filesOff: false, entryProvider: "webdav", stored, unconfirmed: true })).toMatchObject({ start: false, confirmEndpoint: confirmationEndpoint(FILES) });
    expect(mobileSyncStart({ filesOff: false, entryProvider: "webdav", stored, unconfirmed: true })).not.toHaveProperty("signInNeeded");
    expect(mobileSyncStart({ filesOff: true, entryProvider: "webdav", stored, unconfirmed: true })).toMatchObject({ start: false });
  });

  it("runs once per vault: what arrives later through the sync is never taken as proven", async () => {
    await settleVaultEndpointConfirmations(VAULT);
    state.stored = { provider: "webdav", creds: { url: FILES, user: "anna", pass: "pw" } };
    await settleVaultEndpointConfirmations(VAULT);
    expect(await isEndpointConfirmedIn("v1", confirmationEndpoint(FILES))).toBe(false);
  });
});
