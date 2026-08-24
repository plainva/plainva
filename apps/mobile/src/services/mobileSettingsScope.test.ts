import { describe, expect, it } from "vitest";
import {
  MIN_SYNC_INTERVAL_SECONDS,
  vaultDefaults,
  VAULT_KEYS,
  pickVault,
  stripVaultKeys,
  vaultRecordsToSeed,
} from "./mobileSettingsScope";

describe("mobileSettingsScope — per-vault / app-wide partition (package A)", () => {
  it("pickVault returns exactly the per-vault fields", () => {
    expect(Object.keys(pickVault({})).sort()).toEqual([...VAULT_KEYS].sort());
  });

  it("pickVault keeps provided per-vault fields and fills the rest from defaults", () => {
    const r = pickVault({ dailyFolder: "Tagebuch", backupMaxPerFile: 5 });
    expect(r.dailyFolder).toBe("Tagebuch");
    expect(r.backupMaxPerFile).toBe(5);
    expect(r.templateFolder).toBe(vaultDefaults().templateFolder);
    expect(r.backupIntervalSeconds).toBe(vaultDefaults().backupIntervalSeconds);
  });

  it("stripVaultKeys removes exactly the per-vault fields, keeps app-wide, leaves the source intact", () => {
    const blob = {
      themeName: "nord",
      language: "de",
      tabSlots: ["notes"],
      dailyFolder: "Daily",
      backupMaxAgeDays: 30,
    };
    const app = stripVaultKeys(blob);
    for (const k of VAULT_KEYS) expect(k in app).toBe(false);
    expect(app.themeName).toBe("nord");
    expect(app.tabSlots).toEqual(["notes"]);
    // The split must never leak an app-wide field into the vault slice either.
    expect("themeName" in pickVault(blob)).toBe(false);
    // Source object is not mutated.
    expect(blob.dailyFolder).toBe("Daily");
  });

  it("vaultRecordsToSeed seeds only vaults without a record, from the old shared blob", () => {
    const oldBlob = { dailyFolder: "Journal", templateFolder: "Vorlagen", backupMaxPerFile: 42 };
    const seeded = vaultRecordsToSeed(oldBlob, ["local", "abc123", "def456"], (id) => id === "abc123");
    expect(seeded.map((s) => s.id)).toEqual(["local", "def456"]);
    expect(seeded[0].record.dailyFolder).toBe("Journal");
    expect(seeded[0].record.templateFolder).toBe("Vorlagen");
    expect(seeded[0].record.backupMaxPerFile).toBe(42);
    // Fields absent from the old blob fall back to defaults…
    expect(seeded[0].record.inboxFolder).toBe(vaultDefaults().inboxFolder);
    // …and every seeded vault gets its own object (no shared reference).
    expect(seeded[0].record).not.toBe(seeded[1].record);
  });

  it("vaultRecordsToSeed is a no-op once every vault already has a record (idempotent)", () => {
    expect(vaultRecordsToSeed({ dailyFolder: "X" }, ["local", "abc"], () => true)).toEqual([]);
  });

  it("vaultRecordsToSeed falls back to the defaults when there is no old blob", () => {
    const [only] = vaultRecordsToSeed(null, ["local"], () => false);
    expect(only.record).toEqual(vaultDefaults());
  });

  // S2: the cycle interval is now a shared profile default. An existing mobile
  // record that explicitly contains the former 30 s value keeps it as a normal
  // non-default override; fresh/absent state resolves exactly like desktop.
  it("syncIntervalSeconds is per vault, uses the shared 15 s default and survives migration", () => {
    expect(VAULT_KEYS).toContain("syncIntervalSeconds");
    expect(vaultDefaults().syncIntervalSeconds).toBe(15);
    expect(pickVault({}).syncIntervalSeconds).toBe(15);
    expect(pickVault({ syncIntervalSeconds: 900 }).syncIntervalSeconds).toBe(900);
    // Old blob without the field → default, not undefined (a NaN interval would
    // make the worker spin).
    const [seeded] = vaultRecordsToSeed({ dailyFolder: "X" }, ["local"], () => false);
    expect(seeded.record.syncIntervalSeconds).toBe(15);
    expect(stripVaultKeys({ syncIntervalSeconds: 60, themeName: "nord" })).toEqual({ themeName: "nord" });
    // Shared lower bound with the desktop.
    expect(MIN_SYNC_INTERVAL_SECONDS).toBe(5);
  });
});
