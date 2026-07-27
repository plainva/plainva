import { describe, it, expect, vi } from "vitest";

vi.mock("./CredentialManager", () => ({ credentialManager: {} }));
vi.mock("./authFetch", () => ({ microsoftAuthFetch: vi.fn() }));

import { accountSecretKey, microsoftScopeFor, microsoftUnionScope } from "./accountBroker";

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
