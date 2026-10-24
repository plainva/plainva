import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const { begin, records, AccessUnavailableError } = vi.hoisted(() => {
  class AccessUnavailableError extends Error {
    constructor(readonly family: string) {
      super("no access");
    }
  }
  return {
    begin: vi.fn(async (..._args: unknown[]) => ({ kind: "started" }) as unknown),
    records: vi.fn(async () => [] as unknown[]),
    AccessUnavailableError,
  };
});

vi.mock("../vaultRegistry", () => ({ getActiveVaultEntry: async () => ({ id: "v1" }) }));
vi.mock("../cloudAccountsStore", () => ({ loadCloudAccounts: () => records() }));
vi.mock("../accountSignIn", () => ({
  AccessUnavailableError,
  beginMobileSignIn: (...a: unknown[]) => begin(...a),
}));

import { reauthorizeCalendarAccount } from "./pimReauth";

/**
 * Renewing a Google or Microsoft calendar is its card's "Sign in again"
 * (account sign-in plan K4b). Until then this module ran a consent for the
 * calendar alone, with a client id looked up along a chain of its own - the
 * second way to sign in that the plan removes.
 */
describe("reauthorizeCalendarAccount", () => {
  beforeEach(() => {
    begin.mockReset();
    begin.mockResolvedValue({ kind: "started" });
    records.mockResolvedValue([]);
  });

  it("signs the card that carries the calendar in again, for everything it carries", async () => {
    records.mockResolvedValue([
      { id: "other", family: "google", label: "b@example.com", services: { files: { provider: "drive" } } },
      { id: "card-a", family: "google", label: "a@example.com", services: { calendar: { pimAccountId: "cal-1" } } },
    ]);
    expect(await reauthorizeCalendarAccount({ id: "cal-1", label: "Google", provider: "google" })).toEqual({ kind: "started" });
    expect(begin).toHaveBeenCalledWith("v1", { family: "google", cardId: "card-a", add: [] });
  });

  it("works the same for Microsoft", async () => {
    records.mockResolvedValue([{ id: "card-m", family: "microsoft", label: "m@example.com", services: { calendar: { pimAccountId: "keep-me" } } }]);
    await reauthorizeCalendarAccount({ id: "keep-me", label: "Outlook", provider: "microsoft" });
    expect(begin).toHaveBeenCalledWith("v1", { family: "microsoft", cardId: "card-m", add: [] });
  });

  it("asks for this device's access when it has none", async () => {
    records.mockResolvedValue([{ id: "card-a", family: "google", label: "a@example.com", services: { calendar: { pimAccountId: "cal-1" } } }]);
    begin.mockRejectedValue(new AccessUnavailableError("google"));
    expect(await reauthorizeCalendarAccount({ id: "cal-1", label: "Google", provider: "google" })).toEqual({ kind: "needsAccess", family: "google" });
  });

  it("never runs a consent of its own for a calendar no card carries", async () => {
    const out = await reauthorizeCalendarAccount({ id: "orphan", label: "Google", provider: "google" });
    expect(out.kind).toBe("failed");
    expect(begin).not.toHaveBeenCalled();
  });

  it("sends CalDAV to the form without a sign-in", async () => {
    const out = await reauthorizeCalendarAccount({ id: "a1", label: "Fastmail", provider: "caldav" });
    expect(out).toEqual({ kind: "needsForm", provider: "caldav", reason: "caldav" });
    expect(begin).not.toHaveBeenCalled();
  });
});

/**
 * The outcome must OPEN the form, not merely preselect inside a closed sheet.
 *
 * Read from the source: the form is a sheet gated on `formOpen`, and the branch
 * that answers `needsForm` is a handful of setter calls - a test with a mounted
 * screen would be asserting against its own harness, while what can regress is
 * exactly a missing `setFormOpen(true)`.
 */
describe("the accounts screen acts on the outcome", () => {
  const source = readFileSync(join(__dirname, "..", "..", "screens", "PimAccountsScreen.tsx"), "utf-8");
  const branch = (() => {
    const start = source.indexOf('if (out.kind === "needsForm")');
    expect(start).toBeGreaterThan(-1);
    return source.slice(start, source.indexOf("\n    }", start));
  })();

  it("opens the CalDAV form", () => {
    expect(branch).toContain("setFormOpen(true)");
    expect(branch).toContain('setAddProvider("caldav")');
  });

  it("opens the access sheet when the device has no access", () => {
    expect(source).toContain('if (out.kind === "needsAccess") { setAccessFor(out.family); return; }');
  });
});
