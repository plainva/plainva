import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * F57's switch-over on the desktop (maintainer, 2026-11-18; review of F57,
 * O1/O2), the twin of the phone's (`apps/mobile/src/services/
 * endpointConfirmationSettle.test.ts`): a password this device holds and typed
 * here confirms its address, nothing else does, and what cannot be read
 * confirms nothing and leaves the vault for the next start.
 */

const state = vi.hoisted(() => ({
  settings: new Map<string, unknown>(),
  secrets: new Map<string, unknown>(),
  imported: new Set<string>(),
  pimRows: [] as Array<{ id: string; provider: string; config: Record<string, unknown> }>,
  calendars: new Map<string, unknown[]>(),
  mailboxes: [] as Array<Record<string, unknown>>,
  cachedMail: new Set<string>(),
  failing: null as null | "keychain" | "imports" | "mailboxes" | "calendars",
}));

vi.mock("./CredentialManager", () => ({
  credentialManager: {
    readSecretStrict: async (key: string) => {
      if (state.failing === "keychain") throw new Error("keychain locked");
      return state.secrets.get(key) ?? null;
    },
    readSecret: async (key: string) => state.secrets.get(key) ?? null,
  },
}));
vi.mock("./settingsSecrets", () => ({
  importedSecretSlots: async () => {
    if (state.failing === "imports") throw new Error("settings unreadable");
    return state.imported;
  },
}));
vi.mock("@plainva/ui/mail", async (original) => ({
  ...(await original<typeof import("@plainva/ui/mail")>()),
  listMailAccounts: async () => {
    if (state.failing === "mailboxes") throw new Error("mail settings unreadable");
    return state.mailboxes;
  },
  hasCachedMail: async (_db: unknown, id: string) => state.cachedMail.has(id),
}));
vi.mock("@plainva/core", async (original) => ({
  ...(await original<typeof import("@plainva/core")>()),
  PimCacheRepository: class {
    async listAccounts() {
      if (state.failing === "calendars") throw new Error("database closed");
      return state.pimRows;
    }
    async listCalendars(id: string) {
      return state.calendars.get(id) ?? [];
    }
  },
}));

import { confirmationEndpoint, getPlatformServices, isEndpointConfirmedIn, setPlatformServices } from "@plainva/ui";
import { mailSecretKey } from "@plainva/ui/mail";
import { settleVaultEndpointConfirmations } from "./endpointConfirmationSettle";
import { slot } from "./keychainSlots";

const VAULT = "/vaults/home";
const FILES = "http://192.168.1.5/remote.php/dav/files/anna";
const CALDAV = "http://192.168.1.6/remote.php/dav";
let vault = 0;
let key = VAULT;

beforeEach(() => {
  let previous: ReturnType<typeof getPlatformServices> | undefined;
  try {
    previous = getPlatformServices();
  } catch {
    previous = undefined;
  }
  setPlatformServices({
    ...previous,
    loadSettings: async () => ({
      get: async (k: string) => structuredClone(state.settings.get(k)),
      set: async (k: string, value: unknown) => void state.settings.set(k, structuredClone(value)),
      delete: async (k: string) => void state.settings.delete(k),
      keys: async () => [...state.settings.keys()],
      save: async () => undefined,
    }),
  } as unknown as Parameters<typeof setPlatformServices>[0]);
  for (const map of [state.settings, state.secrets, state.calendars]) map.clear();
  state.imported = new Set();
  state.cachedMail.clear();
  state.pimRows = [];
  state.mailboxes = [];
  state.failing = null;
  // A vault of its own per test: the shared module keeps no state between them.
  key = `${VAULT}-${++vault}`;
});

const settle = () => settleVaultEndpointConfirmations(key, {} as never);
const confirmed = (endpoint: string | null) => isEndpointConfirmedIn(key, endpoint);

describe("the switch-over of a vault to F57 on the desktop", () => {
  it("its own Nextcloud over http, typed here: files, calendar and mailbox ask nothing after the update", async () => {
    state.secrets.set(slot.files(key, "webdav"), { url: FILES, user: "anna", pass: "pw" });
    state.pimRows = [{ id: "cal", provider: "caldav", config: {} }];
    state.secrets.set(slot.calendar(key, "cal"), { kind: "caldav", url: CALDAV, user: "anna", pass: "pw" });
    state.mailboxes = [{ id: "mb", kind: "imap", host: "192.168.1.20", port: 993, user: "anna", smtpHost: "192.168.1.20", smtpPort: 587 }];
    state.secrets.set(mailSecretKey(key, "mb"), { pass: "pw" });

    await settle();

    for (const endpoint of [confirmationEndpoint(FILES), confirmationEndpoint(CALDAV), "imap://192.168.1.20:993", "smtp://192.168.1.20:587"]) {
      expect(await confirmed(endpoint), endpoint!).toBe(true);
    }
  });

  it("a calendar or mailbox whose password came through the sync proves nothing, even one this device already used", async () => {
    state.pimRows = [{ id: "cal", provider: "caldav", config: { confirmedAccess: { laptop: { url: CALDAV, user: "anna", seq: 2 } } } }];
    state.secrets.set(slot.calendar(key, "cal"), { kind: "caldav", url: CALDAV, user: "anna", pass: "pw" });
    state.calendars.set("cal", [{ id: "personal" }]);
    state.mailboxes = [{ id: "mb", kind: "imap", host: "192.168.1.20", port: 993, user: "anna" }];
    state.secrets.set(mailSecretKey(key, "mb"), { pass: "pw" });
    state.cachedMail.add("mb");
    state.imported = new Set([slot.calendar(key, "cal"), mailSecretKey(key, "mb")]);

    await settle();

    expect(await confirmed(confirmationEndpoint(CALDAV))).toBe(false);
    expect(await confirmed("imap://192.168.1.20:993")).toBe(false);
  });

  it("an account without a password here proves nothing, whatever the profile brought; its password arriving later changes nothing (O2)", async () => {
    state.pimRows = [{ id: "cal", provider: "caldav", config: { url: CALDAV, user: "anna" } }];
    state.mailboxes = [{ id: "mb", kind: "imap", host: "192.168.1.20", port: 993, user: "anna" }];

    await settle();

    expect(await confirmed(confirmationEndpoint(CALDAV))).toBe(false);
    expect(await confirmed("imap://192.168.1.20:993")).toBe(false);
    state.secrets.set(slot.calendar(key, "cal"), { kind: "caldav", url: CALDAV, user: "anna", pass: "pw" });
    state.secrets.set(mailSecretKey(key, "mb"), { pass: "pw" });
    await settle();
    expect(await confirmed(confirmationEndpoint(CALDAV))).toBe(false);
    expect(await confirmed("imap://192.168.1.20:993")).toBe(false);
  });

  it("a calendar sign-in stored without a password proves nothing (O2)", async () => {
    state.pimRows = [{ id: "cal", provider: "caldav", config: {} }];
    state.secrets.set(slot.calendar(key, "cal"), { kind: "caldav", url: CALDAV, user: "anna", pass: "" });
    await settle();
    expect(await confirmed(confirmationEndpoint(CALDAV))).toBe(false);
  });

  for (const failing of ["keychain", "imports", "mailboxes", "calendars"] as const) {
    it(`what cannot be read (${failing}) confirms nothing, and the next start runs the switch-over again (O1)`, async () => {
      state.secrets.set(slot.files(key, "webdav"), { url: FILES, user: "anna", pass: "pw" });
      state.pimRows = [{ id: "cal", provider: "caldav", config: {} }];
      state.secrets.set(slot.calendar(key, "cal"), { kind: "caldav", url: CALDAV, user: "anna", pass: "pw" });
      state.mailboxes = [{ id: "mb", kind: "imap", host: "192.168.1.20", port: 993, user: "anna" }];
      state.secrets.set(mailSecretKey(key, "mb"), { pass: "pw" });
      state.failing = failing;
      await expect(settle()).rejects.toThrow();
      state.failing = null;
      for (const endpoint of [confirmationEndpoint(FILES), confirmationEndpoint(CALDAV), "imap://192.168.1.20:993"]) expect(await confirmed(endpoint), endpoint!).toBe(false);
      await settle();
      for (const endpoint of [confirmationEndpoint(FILES), confirmationEndpoint(CALDAV), "imap://192.168.1.20:993"]) expect(await confirmed(endpoint), endpoint!).toBe(true);
    });
  }
});
