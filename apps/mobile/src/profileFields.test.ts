import { describe, expect, it } from "vitest";
import { PROFILE_FIELDS, storeBackedFields, isMemberProfileField, travellingAreas } from "@plainva/ui";
import { VAULT_KEYS } from "./services/mobileSettingsScope";

/**
 * The catalog is only worth having if it cannot lie. Two shells kept their own
 * list of syncable settings, and a field that existed on one and not the other
 * was invisible — that is the 2026-07-28 finding. These tests make every gap a
 * declared fact: a field the phone does not carry needs a written reason, and a
 * field it claims to carry must name a setting that actually exists.
 */
describe("profile field catalog", () => {
  it("has no duplicate logical names", () => {
    const names = PROFILE_FIELDS.map((f) => f.logical);
    expect(new Set(names).size).toBe(names.length);
  });

  it("names a real per-vault setting for every field the phone carries", () => {
    for (const field of storeBackedFields("mobile")) {
      expect(VAULT_KEYS, `${field.logical} → ${String(field.mobile)}`).toContain(field.mobile);
    }
  });

  it("requires a written reason for every field the phone does not carry", () => {
    for (const field of PROFILE_FIELDS) {
      if (field.mobile === null) expect(field.mobileGap?.length, field.logical).toBeGreaterThan(10);
      else expect(field.mobileGap, field.logical).toBeUndefined();
    }
  });

  it("keeps accounts and personal preferences with the member, conventions with the vault", () => {
    // A shared workspace has one archive but several people: mailboxes and
    // calendar selections are personal, folder conventions are not.
    expect(isMemberProfileField("mailAccounts")).toBe(true);
    expect(isMemberProfileField("pimSelections")).toBe(true);
    expect(isMemberProfileField("bookmarks")).toBe(true);
    expect(isMemberProfileField("dailyNotesFolder")).toBe(false);
    expect(isMemberProfileField("templateFolder")).toBe(false);
    // Unknown fields (a newer Plainva) stay with the vault — guessing would be
    // worse than keeping today's behaviour.
    expect(isMemberProfileField("somethingFromTheFuture")).toBe(false);
  });

  it("pins what the phone syncs today, so the catalog cannot quietly widen it", () => {
    // Grows only when a step deliberately closes a gap (and updates this list).
    expect(storeBackedFields("mobile").map((f) => f.logical).sort()).toEqual([
      "backupMaxAgeDays",
      "backupMaxCountPerFile",
      "backupSnapshotIntervalSeconds",
      "dailyNoteTemplate",
      "dailyNotesFolder",
      "mailFolder",
      "mailRemoteImages",
      "syncIntervalSeconds",
      "templateFolder",
    ]);
  });

  it("summarises only areas a shell really carries, so the chips cannot overpromise", () => {
    // The desktop carries every area; the phone has no bar arrangement to sync.
    expect(travellingAreas("desktop")).toContain("layout");
    expect(travellingAreas("mobile")).not.toContain("layout");
    // Accounts come first — it is the answer people are actually looking for.
    expect(travellingAreas("desktop")[0]).toBe("accounts");
    for (const shell of ["desktop", "mobile"] as const) {
      expect(new Set(travellingAreas(shell)).size).toBe(travellingAreas(shell).length);
    }
  });

  it("declares a vault-relative path as its own kind, so an absolute one can be refused", () => {
    // An absolute path from another machine must never travel; the importer
    // relies on this kind to tell it apart from ordinary text.
    for (const logical of ["dailyNotesFolder", "templateFolder", "mailFolder", "dailyNoteTemplate"]) {
      expect(PROFILE_FIELDS.find((f) => f.logical === logical)?.kind, logical).toBe("vaultPath");
    }
  });
});
