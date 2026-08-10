// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CloudAccountRecord } from "@plainva/ui";

/**
 * Net for the identity backfill of a card WITHOUT a files service
 * (P5a/P8, 2026-08-10).
 *
 * The existing backfill asks the FILES provider, so a card carrying only
 * calendar (and mail) could never earn a verified identity — and the reconcile
 * refuses to fold two cards of one account without one, because folding must
 * never guess from a label. That is how a single Google account stayed two
 * permanent cards with a repair prompt that could not be satisfied.
 */

const VAULT = "/vaults/wiki";

const store = new Map<string, unknown>();
vi.mock("./settingsStore", () => ({
  getSettingsStore: vi.fn(async () => ({
    get: async (key: string) => store.get(key) ?? null,
    set: async (key: string, value: unknown) => void store.set(key, value),
    save: async () => undefined,
  })),
}));

vi.mock("./CredentialManager", () => ({ credentialManager: {} }));
vi.mock("@plainva/ui/mail", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@plainva/ui/mail")>();
  return { ...actual, listMailAccounts: vi.fn(async () => []) };
});

let pimCreds: unknown = null;
vi.mock("./pim/pimCredentials", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./pim/pimCredentials")>();
  return { ...actual, getPimCredentials: vi.fn(async () => pimCreds) };
});

/** The token refresh is network; only its result matters here. */
vi.mock("@plainva/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@plainva/core")>();
  return { ...actual, refreshDriveAccessToken: vi.fn(async () => ({ accessToken: "at" })) };
});

const userInfo = vi.fn(async () => ({
  ok: true,
  json: async () => ({ sub: "108124", email: "marco@example.com", email_verified: true }),
}));
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: (...args: unknown[]) => userInfo(...(args as [])) }));

import { backfillCalendarIdentity, cloudAccountsRegistryKey } from "./cloudAccounts";

const put = (records: CloudAccountRecord[]) => store.set(cloudAccountsRegistryKey(VAULT), records);

const calendarOnly: CloudAccountRecord = {
  id: "ml8ln2n0",
  family: "google",
  label: "",
  services: { calendar: { pimAccountId: "pim-1" } },
};

beforeEach(() => {
  store.clear();
  pimCreds = null;
  userInfo.mockClear();
});

describe("identity backfill for a calendar-only card", () => {
  it("earns the verified identity from the calendar sign-in", async () => {
    put([calendarOnly]);
    pimCreds = { kind: "google", clientId: "cid", clientSecret: "cs", refreshToken: "rt" };

    const next = await backfillCalendarIdentity(VAULT);

    expect(next?.[0]?.verifiedProviderIdentity).toEqual({ issuer: "google", subject: "108124" });
    expect(next?.[0]?.label).toBe("marco@example.com");
  });

  it("leaves a card that has files to the sync backfill", async () => {
    put([{ ...calendarOnly, services: { ...calendarOnly.services, files: { provider: "drive" } } }]);
    pimCreds = { kind: "google", clientId: "cid", clientSecret: "cs", refreshToken: "rt" };

    expect(await backfillCalendarIdentity(VAULT)).toBeNull();
    expect(userInfo).not.toHaveBeenCalled();
  });

  it("does not derive an identity from a CalDAV login", async () => {
    // A self-entered address is not provider-attested. Treating it as verified
    // would be exactly the label guessing the repair planner forbids.
    put([calendarOnly]);
    pimCreds = { kind: "caldav", url: "https://cloud.example.com/dav", user: "marco", pass: "p" };

    expect(await backfillCalendarIdentity(VAULT)).toBeNull();
    expect(userInfo).not.toHaveBeenCalled();
  });
});
