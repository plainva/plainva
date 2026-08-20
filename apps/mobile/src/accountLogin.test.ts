import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./services/pim/pimOAuth", () => ({ beginPimOAuth: vi.fn(), setOAuthPurposeHandler: vi.fn() }));
vi.mock("./services/accountBroker", () => ({
  brokerFamily: (f: string) => (f === "microsoft" || f === "google" ? f : null),
  getAccountToken: vi.fn(async () => null),
  saveAccountToken: vi.fn(),
}));
vi.mock("./services/pim/pimCredentials", () => ({
  getPimCredentials: vi.fn(async () => null),
  savePimCredentials: vi.fn(),
}));
vi.mock("./services/pim/pimService", () => ({ listPimAccounts: vi.fn(async () => []) }));
vi.mock("./services/syncService", () => ({
  getStoredProvider: vi.fn(async () => null),
  switchProviderToAccountBroker: vi.fn(),
}));
vi.mock("@plainva/ui/i18n", () => ({ default: { t: (k: string) => k } }));

import { oauthServicesOf, unionScopeFor, canUnifyMobileAccount, beginAccountLogin } from "./services/accountLogin";
import { getAccountToken } from "./services/accountBroker";
import { getPimCredentials } from "./services/pim/pimCredentials";
import { listPimAccounts } from "./services/pim/pimService";
import { getStoredProvider } from "./services/syncService";
import { beginPimOAuth } from "./services/pim/pimOAuth";
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

  it("leaves Gmail out: it runs over IMAP, so mail scopes would be permission we never use", () => {
    expect(oauthServicesOf(record("google", ["files", "calendar", "mail"]))).toEqual(["files", "calendar"]);
    expect(unionScopeFor("google", ["files", "calendar"])).not.toContain("gmail");
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
    vi.mocked(getAccountToken).mockResolvedValueOnce({ clientId: "c", refreshToken: "r" });
    await expect(canUnifyMobileAccount("v1", record("microsoft", ["files", "calendar"]))).resolves.toBe(false);
  });

  it("offers local re-auth again when a client change has invalidated the old token", async () => {
    vi.mocked(getAccountToken).mockResolvedValueOnce({ clientId: "new-client", refreshToken: "" });
    await expect(canUnifyMobileAccount("v1", record("google", ["files", "calendar"]))).resolves.toBe(true);
  });

  it("starts consent from the local account slot, never from synced registry metadata", async () => {
    const account = { ...record("google", ["files", "calendar"]), byoClientId: "foreign-client" };
    vi.mocked(getAccountToken).mockResolvedValueOnce({
      clientId: "local-client",
      clientSecret: "local-secret",
      refreshToken: "local-refresh",
    });

    await beginAccountLogin("v1", account);

    expect(beginPimOAuth).toHaveBeenCalledWith("google", expect.objectContaining({
      clientId: "local-client",
      clientSecret: "local-secret",
    }));
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
describe("finding the client to sign in with", () => {
  beforeEach(() => {
    vi.mocked(getAccountToken).mockResolvedValue(null);
    vi.mocked(getPimCredentials).mockResolvedValue(null);
    vi.mocked(getStoredProvider).mockResolvedValue(null);
    vi.mocked(listPimAccounts).mockResolvedValue([]);
    vi.mocked(beginPimOAuth).mockClear();
  });

  it("takes the id from the file sync of the same family", async () => {
    vi.mocked(getStoredProvider).mockResolvedValue({
      provider: "drive",
      creds: { clientId: "drive-client", clientSecret: "drive-secret", refreshToken: "" },
    } as never);

    await expect(beginAccountLogin("v1", record("google", ["files", "calendar"]))).resolves.toEqual({ kind: "started" });
    expect(beginPimOAuth).toHaveBeenCalledWith("google", expect.objectContaining({ clientId: "drive-client" }));
  });

  it("falls back to a sibling account of the same family — the step this caller never had", async () => {
    vi.mocked(listPimAccounts).mockResolvedValue([{ id: "other", provider: "google" }] as never);
    vi.mocked(getPimCredentials).mockImplementation(async (_v: string, id: string) =>
      (id === "other" ? { kind: "google", clientId: "sibling-client" } : null) as never
    );

    await expect(beginAccountLogin("v1", record("google", ["files", "calendar"]))).resolves.toEqual({ kind: "started" });
    expect(beginPimOAuth).toHaveBeenCalledWith("google", expect.objectContaining({ clientId: "sibling-client" }));
  });

  it("asks instead of throwing when Google has nothing on this device", async () => {
    await expect(beginAccountLogin("v1", record("google", ["files", "calendar"]))).resolves.toEqual({
      kind: "needsClientId",
      family: "google",
    });
    expect(beginPimOAuth, "no consent may be opened without a client").not.toHaveBeenCalled();
  });

  it("signs in with the id the form then supplies", async () => {
    await expect(
      beginAccountLogin("v1", record("google", ["files", "calendar"]), { clientId: " typed-client ", clientSecret: "typed-secret" })
    ).resolves.toEqual({ kind: "started" });
    expect(beginPimOAuth).toHaveBeenCalledWith("google", expect.objectContaining({
      clientId: "typed-client",
      clientSecret: "typed-secret",
    }));
  });

  it("never asks Microsoft: it ships a registration of its own", async () => {
    await expect(beginAccountLogin("v1", record("microsoft", ["files", "calendar"]))).resolves.toEqual({ kind: "started" });
  });
});
