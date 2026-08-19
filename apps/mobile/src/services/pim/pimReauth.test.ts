import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const begin = vi.fn(async () => {});
/** Keyed by account id — `own` and the siblings must not share one answer. */
const credsByAccount = new Map<string, unknown>();
const provider = vi.fn(async () => null as unknown);
const accountToken = vi.fn(async () => null as unknown);
const accounts = vi.fn(async () => [] as unknown[]);
const records = vi.fn(async () => [] as unknown[]);

vi.mock("../vaultRegistry", () => ({ getActiveVaultEntry: async () => ({ id: "v1" }) }));
vi.mock("./pimOAuth", () => ({ beginPimOAuth: (...a: unknown[]) => begin(...(a as [])) }));
vi.mock("./pimCredentials", () => ({
  getPimCredentials: async (_vault: string, accountId: string) => credsByAccount.get(accountId) ?? null,
}));
vi.mock("./pimService", () => ({ listPimAccounts: () => accounts() }));
vi.mock("../syncService", () => ({ getStoredProvider: () => provider() }));
vi.mock("../accountBroker", () => ({ getAccountToken: () => accountToken() }));
vi.mock("../cloudAccountsStore", () => ({ loadCloudAccounts: () => records() }));

import { reauthorizeCalendarAccount } from "./pimReauth";

/**
 * Re-authorising a calendar account that arrived through the settings sync.
 *
 * Client ids are device-local by design — they are stripped from the profile so
 * a desktop BYO id never travels to the phone. The consequence nobody drew: the
 * row on the receiving device has no slot, and asking only the slot produced
 * "Google needs its own client id" for an id the device was already holding in
 * its Drive sync (finding 2026-08-19). The user could not act on that answer:
 * the form it pointed at was not open.
 */
describe("reauthorizeCalendarAccount", () => {
  beforeEach(() => {
    begin.mockClear();
    credsByAccount.clear();
    provider.mockResolvedValue(null);
    accountToken.mockResolvedValue(null);
    accounts.mockResolvedValue([]);
    records.mockResolvedValue([]);
  });

  it("signs in with the client id of the file sync when the row has no slot", async () => {
    provider.mockResolvedValue({ provider: "drive", creds: { clientId: "from-sync", clientSecret: "s" } });
    const out = await reauthorizeCalendarAccount({ id: "a1", label: "Google", provider: "google" });
    expect(out).toEqual({ kind: "started" });
    expect(begin).toHaveBeenCalledWith("google", expect.objectContaining({ clientId: "from-sync", accountId: "a1" }));
  });

  it("borrows from another calendar account of the same provider", async () => {
    accounts.mockResolvedValue([{ id: "a2", provider: "google" }]);
    credsByAccount.set("a2", { kind: "google", clientId: "from-sibling" });
    const out = await reauthorizeCalendarAccount({ id: "a1", label: "Google", provider: "google" });
    expect(out).toEqual({ kind: "started" });
    expect(begin).toHaveBeenCalledWith("google", expect.objectContaining({ clientId: "from-sibling" }));
  });

  it("keeps the SAME account id, so calendars and task anchors survive", async () => {
    provider.mockResolvedValue({ provider: "onedrive", creds: { clientId: "ms" } });
    await reauthorizeCalendarAccount({ id: "keep-me", label: "Outlook", provider: "microsoft" });
    expect(begin).toHaveBeenCalledWith("microsoft", expect.objectContaining({ accountId: "keep-me" }));
  });

  it("never borrows a Drive id for a Microsoft account", async () => {
    provider.mockResolvedValue({ provider: "drive", creds: { clientId: "google-id" } });
    await reauthorizeCalendarAccount({ id: "a1", label: "Outlook", provider: "microsoft" });
    // Microsoft still starts — on the shipped central registration, not on a
    // Google client id that would be rejected.
    expect(begin).toHaveBeenCalledWith("microsoft", expect.not.objectContaining({ clientId: "google-id" }));
  });

  it("asks the form only when the device really holds nothing", async () => {
    const out = await reauthorizeCalendarAccount({ id: "a1", label: "Google", provider: "google" });
    expect(out).toEqual({ kind: "needsForm", provider: "google", reason: "missingClientId" });
    expect(begin).not.toHaveBeenCalled();
  });

  it("sends CalDAV to the form without touching the chain", async () => {
    const out = await reauthorizeCalendarAccount({ id: "a1", label: "Fastmail", provider: "caldav" });
    expect(out).toEqual({ kind: "needsForm", provider: "caldav", reason: "caldav" });
  });
});

/**
 * The outcome must OPEN the form, not merely preselect inside a closed sheet.
 *
 * Read from the source: the form is a sheet gated on `formOpen`, and the branch
 * that answers `needsForm` is a handful of setter calls — a test with a mounted
 * screen would be asserting against its own harness, while what can regress is
 * exactly a missing `setFormOpen(true)` or a hard-wired provider.
 */
describe("the accounts screen acts on needsForm", () => {
  const source = readFileSync(join(__dirname, "..", "..", "screens", "PimAccountsScreen.tsx"), "utf-8");
  const branch = (() => {
    const start = source.indexOf('if (out.kind === "needsForm")');
    expect(start).toBeGreaterThan(-1);
    return source.slice(start, source.indexOf("\n    }", start));
  })();

  it("opens the sheet", () => {
    expect(branch).toContain("setFormOpen(true)");
  });

  it("preselects the account's own provider instead of defaulting to Google", () => {
    expect(branch).toContain('a.provider === "microsoft" ? "microsoft"');
  });
});
