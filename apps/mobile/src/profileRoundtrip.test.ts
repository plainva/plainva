import { describe, expect, it } from "vitest";
import { storeBackedFields } from "@plainva/ui";
import { importVaultSettings } from "./services/mobileSettingsSync";
import { vaultDefaults, MIN_SYNC_INTERVAL_SECONDS } from "./services/mobileSettingsScope";

/**
 * Desktop → profile → phone, one field at a time (S16).
 *
 * The finding was a field that existed on one shell and never arrived on the
 * other. A catalog entry alone does not prove arrival — this walks every field
 * the phone claims to carry and checks the value actually lands in the setting
 * it names, with the kind the catalog declares.
 */
const sampleFor = (kind: string): unknown =>
  kind === "vaultPath" ? "Journal/Daily" : kind === "text" ? "Meeting" : kind === "number" ? 42 : true;

describe("profile roundtrip into mobile settings", () => {
  it("lands every field the phone claims to carry", () => {
    const fields = storeBackedFields("mobile");
    expect(fields.length).toBeGreaterThan(5);
    for (const field of fields) {
      const value = sampleFor(field.kind);
      const { patch, skipped } = importVaultSettings({ [field.logical]: value });
      expect(skipped, field.logical).toEqual([]);
      expect(patch[field.mobile as keyof typeof patch], `${field.logical} → ${String(field.mobile)}`).toBe(value);
    }
  });

  it("names every property it writes as a real per-vault setting", () => {
    const { patch } = importVaultSettings(
      Object.fromEntries(storeBackedFields("mobile").map((f) => [f.logical, sampleFor(f.kind)]))
    );
    for (const prop of Object.keys(patch)) expect(vaultDefaults()).toHaveProperty(prop);
  });

  it("refuses an absolute path — it would point into another machine's file system", () => {
    const { patch, skipped } = importVaultSettings({ dailyNotesFolder: "/Users/someone/Vault/Daily" });
    expect(patch).toEqual({});
    expect(skipped[0]).toContain("dailyNotesFolder");
  });

  it("drops a number below its floor rather than clamping it", () => {
    // A wrong value from elsewhere should not silently become a valid-looking
    // local one; two seconds between cycles is not a setting we quietly accept.
    const { patch, skipped } = importVaultSettings({ syncIntervalSeconds: MIN_SYNC_INTERVAL_SECONDS - 1 });
    expect(patch).toEqual({});
    expect(skipped[0]).toContain("syncIntervalSeconds");
  });

  it("refuses a value of the wrong kind and says which field", () => {
    const { patch, skipped } = importVaultSettings({ mailRemoteImages: "yes", backupMaxAgeDays: "90" });
    expect(patch).toEqual({});
    expect(skipped.join(" ")).toContain("mailRemoteImages");
    expect(skipped.join(" ")).toContain("backupMaxAgeDays");
  });

  it("ignores fields it does not carry instead of guessing", () => {
    // They stay in the unknown bucket and are written back untouched, so a newer
    // Plainva on another device does not lose them by syncing through this one.
    const { patch, skipped } = importVaultSettings({ barLayoutRibbon: { order: [] }, somethingFromTheFuture: 1 });
    expect(patch).toEqual({});
    expect(skipped).toEqual([]);
  });

  it("materializes shared defaults for fields absent from a complete profile apply", () => {
    const { patch, skipped } = importVaultSettings({ dailyNotesFolder: "Journal" }, true);
    expect(skipped).toEqual([]);
    expect(patch.dailyFolder).toBe("Journal");
    expect(patch.dailyFormat).toBe(vaultDefaults().dailyFormat);
    expect(patch.syncIntervalSeconds).toBe(vaultDefaults().syncIntervalSeconds);
    expect(patch.mailRemoteImages).toBe(vaultDefaults().mailRemoteImages);
  });
});
