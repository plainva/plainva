import { describe, it, expect, vi } from "vitest";

vi.mock("./CredentialManager", () => ({ credentialManager: {} }));
vi.mock("./authFetch", () => ({ microsoftAuthFetch: vi.fn() }));
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: vi.fn() }));

import { accountSecretKey, brokerFamily, googleScopeFor, microsoftScopeFor, microsoftUnionScope } from "./accountBroker";

/**
 * The union scope is what the wizard sends to Microsoft for an account that
 * connects several services at once. Every per-service scope set ends in
 * offline_access, so a naive concatenation would repeat it — Entra tolerates
 * that, but the consent screen and the stored scope string should stay clean.
 */
describe("microsoft account scopes", () => {
  it("merges the selected services without repeating shared scopes", () => {
    const union = microsoftUnionScope(["files", "calendar", "mail"]);
    const parts = union.split(" ");
    expect(new Set(parts).size).toBe(parts.length);
    expect(parts).toContain("offline_access");
    expect(parts.filter((p) => p === "offline_access")).toHaveLength(1);
    expect(union).toContain("Files.ReadWrite");
    expect(union).toContain("Calendars.ReadWrite");
    expect(union).toContain("Mail.Send");
  });

  it("keeps a single service narrow", () => {
    const union = microsoftUnionScope(["calendar"]);
    expect(union).toContain("Calendars.ReadWrite");
    expect(union).not.toContain("Files.ReadWrite");
    expect(union).not.toContain("Mail.Send");
  });

  it("rejects an unknown audience instead of requesting a silent empty scope", () => {
    expect(() => microsoftScopeFor("contacts")).toThrow(/unknown audience/);
  });

  it("keys the account slot per vault, like every other credential", () => {
    const a = accountSecretKey("/vault/one", "acc1");
    const b = accountSecretKey("/vault/two", "acc1");
    expect(a).not.toBe(b);
    expect(a.startsWith("account_acc1_")).toBe(true);
  });
});

/**
 * Google joined the broker on 2026-07-28. Its consent always covered the whole
 * account, but the token was copied into each service slot — and a renewal then
 * reached one copy while the others kept a dead one, which is how a vault ended
 * up syncing files while its calendar reported invalid_grant.
 */
describe("google account scopes", () => {
  it("serves the two audiences a Google account can have", () => {
    expect(googleScopeFor("files")).toContain("auth/drive");
    expect(googleScopeFor("calendar")).toContain("auth/calendar");
  });

  it("refuses a mail token: Gmail is IMAP with an app password, not OAuth", () => {
    expect(() => googleScopeFor("mail")).toThrow(/unknown Google audience/);
  });

  it("names exactly the families that can share one token", () => {
    expect(brokerFamily("microsoft")).toBe("microsoft");
    expect(brokerFamily("google")).toBe("google");
    // Dropbox carries one service, the catalog suites use passwords — neither
    // has anything to share.
    expect(brokerFamily("dropbox")).toBeNull();
    expect(brokerFamily("nextcloud")).toBeNull();
  });
});
