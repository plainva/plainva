import { describe, expect, it, vi } from "vitest";
vi.mock("@plainva/ui/mail", async original => ({ ...await original<typeof import("@plainva/ui/mail")>(), listMailAccounts: vi.fn(async () => []) }));

vi.mock("./services/pim/pimOAuth", () => ({ beginPimOAuth: vi.fn(), setOAuthPurposeHandler: vi.fn() }));
vi.mock("./services/accountBroker", () => ({
  brokerFamily: (f: string) => (f === "microsoft" || f === "google" ? f : null),
  getAccountToken: vi.fn(async () => null),
  saveAccountToken: vi.fn(),
}));
vi.mock("./services/pim/pimCredentials", () => ({
  getPimCredentials: vi.fn(async () => null),
  savePimCredentials: vi.fn(),
  pimSecretKey: (vault: string, id: string) => `pim_${vault}_${id}`,
}));
vi.mock("./services/accountCredentialStore", () => ({ accountCredentialStore: {
  read: async (key: string) => {
    const { getPlatformServices } = await import("@plainva/ui");
    const value = await getPlatformServices().credentials.readSecret(key);
    return value === null ? null : JSON.stringify(value);
  },
  compareAndSet: async (key: string, expected: string | null, next: string | null) => {
    const { getPlatformServices } = await import("@plainva/ui");
    const credentials = getPlatformServices().credentials;
    const value = await credentials.readSecret(key);
    if ((value === null ? null : JSON.stringify(value)) !== expected) return false;
    if (next === null) await credentials.removeSecret(key); else await credentials.writeSecret(key, JSON.parse(next));
    return true;
  },
} }));
vi.mock("./services/pim/pimService", () => ({ listPimAccounts: vi.fn(async () => []), restartPimAccountAfterLogin: vi.fn() }));
vi.mock("./services/syncService", () => ({
  getStoredProvider: vi.fn(async () => null),
  switchProviderToAccountBroker: vi.fn(),
}));
vi.mock("./services/cloudAccountsStore", () => ({ loadCloudAccounts: vi.fn(async () => []) }));
vi.mock("@plainva/ui/i18n", () => ({ default: { t: (k: string) => k } }));
vi.mock("./adapters/webdavHttp", () => ({ webdavFetch: async () => new Response(JSON.stringify({ sub: "person", email: "someone@example.com", email_verified: true })) }));

import { oauthServicesOf, unionScopeFor, canUnifyMobileAccount } from "./services/accountLogin";
import { getAccountToken } from "./services/accountBroker";
import type { CloudAccountRecord } from "@plainva/ui";

const record = (family: string, services: string[]): CloudAccountRecord =>
  ({
    id: "a1",
    family,
    label: "someone@example.com",
    services: Object.fromEntries(
      services.map((s) => [
        s,
        s === "files" ? { provider: "drive" } : s === "calendar" ? { pimAccountId: "p1" } : { mailAccountId: "m1" },
      ])
    ),
  }) as unknown as CloudAccountRecord;

/**
 * The phone signed in per service while the desktop had one consent per
 * account, so the same account followed two token models on two devices
 * (Sammelplan C5). What matters is that the consent asks for exactly the
 * services it will serve — no more.
 */
describe("mobile union consent scope", () => {
  it("covers files and calendar in one Google consent", () => {
    const scope = unionScopeFor("google", ["files", "calendar"]);
    expect(scope).toContain("auth/drive");
    expect(scope).toContain("auth/calendar");
  });

  it("requests Gmail scopes only for an OAuth mailbox, keeping app passwords independent", () => {
    expect(oauthServicesOf(record("google", ["files", "calendar", "mail"]))).toEqual(["files", "calendar"]);
    expect(unionScopeFor("google", ["files", "calendar"])).not.toContain("https://mail.google.com/");
    expect(oauthServicesOf(record("google", ["calendar", "mail"]), "gmail")).toEqual(["calendar", "mail"]);
    expect(unionScopeFor("google", ["mail"])).toContain("https://mail.google.com/");
  });

  it("carries all three services for Microsoft, without repeating shared scopes", () => {
    const scope = unionScopeFor("microsoft", ["files", "calendar", "mail"]);
    const parts = scope.split(" ");
    expect(new Set(parts).size).toBe(parts.length);
    expect(scope).toContain("Files.ReadWrite");
    expect(scope).toContain("Calendars.ReadWrite");
    expect(scope).toContain("Mail.Send");
  });

  it("stays narrow when the account carries one service", () => {
    const scope = unionScopeFor("google", ["calendar"]);
    expect(scope).toContain("auth/calendar");
    expect(scope).not.toContain("auth/drive");
  });
});

describe("canUnifyMobileAccount", () => {
  it("offers the merge for a Google account with files + calendar", async () => {
    await expect(canUnifyMobileAccount("v1", record("google", ["files", "calendar"]))).resolves.toBe(true);
  });

  it("does not offer it for one OAuth service — there is nothing to merge", async () => {
    // Google + mail is a single OAuth service (the mailbox is IMAP).
    await expect(canUnifyMobileAccount("v1", record("google", ["calendar", "mail"]))).resolves.toBe(false);
    await expect(canUnifyMobileAccount("v1", record("microsoft", ["files"]))).resolves.toBe(false);
  });

  it("does not offer it for families that cannot share a token", async () => {
    await expect(canUnifyMobileAccount("v1", record("dropbox", ["files"]))).resolves.toBe(false);
    await expect(canUnifyMobileAccount("v1", record("webdav", ["files", "calendar"]))).resolves.toBe(false);
  });

  it("stops offering it once the account already holds one shared token", async () => {
    vi.mocked(getAccountToken).mockResolvedValueOnce({ clientId: "c", refreshToken: "r" }).mockResolvedValueOnce({ clientId: "c", refreshToken: "r" });
    await expect(canUnifyMobileAccount("v1", record("microsoft", ["files", "calendar"]))).resolves.toBe(false);
  });

  it("offers local re-auth again when a client change has invalidated the old token", async () => {
    vi.mocked(getAccountToken).mockResolvedValueOnce({ clientId: "new-client", refreshToken: "" });
    await expect(canUnifyMobileAccount("v1", record("google", ["files", "calendar"]))).resolves.toBe(true);
  });

});

/**
 * Which client this device signs the account in with — and what happens when it
 * holds none (Befund 2026-08-20).
 *
 * `beginAccountLogin` looked in three places of its own while `pimReauth` had
 * been using a four-step chain since 2026-08-19, and it THREW when it found
 * nothing. On a phone that received the account through the settings sync —
 * where client ids are stripped on purpose — that was every time: the card's
 * only action answered "no client id for this account" in English and left the
 * user with nowhere to go.
 */
