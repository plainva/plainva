import { describe, it, expect } from "vitest";
import { buildZipFileName, selectZipsToDelete } from "./vaultZipBackup";
import { shouldRunZip } from "./backupScheduler";

describe("vaultZipBackup", () => {
  it("builds Windows-safe, sortable zip file names", () => {
    const name = buildZipFileName("Mein Vault", new Date(2026, 6, 5, 14, 30, 45));
    expect(name).toBe("Mein Vault_2026-07-05_14-30-45.zip");
    expect(buildZipFileName('Va:ult*', new Date(2026, 0, 1, 0, 0, 0))).toBe("Va-ult-_2026-01-01_00-00-00.zip");
  });

  describe("selectZipsToDelete", () => {
    const mine = [
      "Vault_2026-07-01_10-00-00.zip",
      "Vault_2026-07-02_10-00-00.zip",
      "Vault_2026-07-03_10-00-00.zip",
      "Vault_2026-07-04_10-00-00.zip",
    ];

    it("keeps the newest N and deletes the oldest", () => {
      expect(selectZipsToDelete(mine, "Vault", 2)).toEqual([
        "Vault_2026-07-01_10-00-00.zip",
        "Vault_2026-07-02_10-00-00.zip",
      ]);
      expect(selectZipsToDelete(mine, "Vault", 7)).toEqual([]);
    });

    it("never touches foreign files in a user-chosen folder", () => {
      const names = [
        ...mine,
        "Urlaub.zip",
        "Vault_backup.zip",
        "OtherVault_2026-07-01_10-00-00.zip",
        "Vault_2026-07-01_10-00-00.zip.part",
      ];
      const deletions = selectZipsToDelete(names, "Vault", 1);
      expect(deletions).toEqual([
        "Vault_2026-07-01_10-00-00.zip",
        "Vault_2026-07-02_10-00-00.zip",
        "Vault_2026-07-03_10-00-00.zip",
      ]);
    });

    it("escapes regex metacharacters in the vault name", () => {
      const names = ["A+B (1)_2026-07-01_10-00-00.zip", "A+B (1)_2026-07-02_10-00-00.zip", "AxB (1)_2026-07-03_10-00-00.zip"];
      expect(selectZipsToDelete(names, "A+B (1)", 1)).toEqual(["A+B (1)_2026-07-01_10-00-00.zip"]);
    });

    it("treats keep < 1 as keep 1", () => {
      expect(selectZipsToDelete(mine, "Vault", 0)).toEqual(mine.slice(0, 3));
    });
  });

  describe("shouldRunZip", () => {
    const h24 = 24 * 60 * 60 * 1000;
    const base = { enabled: true, lastRun: 0, now: h24 + 1, running: false };

    it("runs when enabled, due and idle", () => {
      expect(shouldRunZip(base)).toBe(true);
    });
    it("never runs when disabled", () => {
      expect(shouldRunZip({ ...base, enabled: false })).toBe(false);
    });
    it("waits out the 24h window", () => {
      expect(shouldRunZip({ ...base, lastRun: 2, now: h24 })).toBe(false);
      expect(shouldRunZip({ ...base, lastRun: 2, now: h24 + 3 })).toBe(true);
    });
    it("never overlaps a running backup", () => {
      expect(shouldRunZip({ ...base, running: true })).toBe(false);
    });
  });
});
