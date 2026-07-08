import { describe, it, expect } from "vitest";
import type { Store } from "@tauri-apps/plugin-store";
import {
  backupMaxAgeDaysKey,
  backupMaxCountKey,
  backupSnapshotIntervalKey,
  backupZipEnabledKey,
  backupZipKeepKey,
  loadBackupRetentionSettings,
  loadZipBackupSettings,
  sanitizeFileName,
  sha8,
  vaultFolderName,
} from "./backupPolicy";

const fakeStore = (data: Record<string, unknown>): Store =>
  ({ get: async (k: string) => data[k] }) as unknown as Store;

describe("backupPolicy", () => {
  it("builds per-vault keys with the established b64 encoding", () => {
    const vault = "C:\\Users\\marco\\Vault äöü";
    const expected = btoa(unescape(encodeURIComponent(vault)));
    expect(backupZipEnabledKey(vault)).toBe(`backupZipEnabled_${expected}`);
    expect(backupSnapshotIntervalKey(vault)).toBe(`backupSnapshotIntervalSeconds_${expected}`);
  });

  it("loads retention settings with defaults (120 s / 100 / 90 d)", async () => {
    const vault = "C:\\V";
    expect(await loadBackupRetentionSettings(fakeStore({}), vault)).toEqual({
      minSnapshotIntervalSeconds: 120,
      maxBackupsPerFile: 100,
      maxAgeDays: 90,
    });
    const store = fakeStore({
      [backupSnapshotIntervalKey(vault)]: 0,
      [backupMaxCountKey(vault)]: 25,
      [backupMaxAgeDaysKey(vault)]: 0,
    });
    expect(await loadBackupRetentionSettings(store, vault)).toEqual({
      minSnapshotIntervalSeconds: 0,
      maxBackupsPerFile: 25,
      maxAgeDays: 0,
    });
  });

  it("loads zip settings with defaults (enabled, app-data dest, keep 7)", async () => {
    const vault = "C:\\V";
    expect(await loadZipBackupSettings(fakeStore({}), vault)).toEqual({
      enabled: true,
      dest: "",
      keep: 7,
      lastRun: 0,
    });
    const store = fakeStore({
      [backupZipEnabledKey(vault)]: false,
      [backupZipKeepKey(vault)]: 3,
    });
    const loaded = await loadZipBackupSettings(store, vault);
    expect(loaded.enabled).toBe(false);
    expect(loaded.keep).toBe(3);
  });

  it("derives the vault folder name from Windows and POSIX paths", () => {
    expect(vaultFolderName("C:\\Users\\marco\\Mein Vault")).toBe("Mein Vault");
    expect(vaultFolderName("/home/marco/vault/")).toBe("vault");
    expect(vaultFolderName("")).toBe("Vault");
  });

  it("sanitizes Windows-unsafe characters in file names", () => {
    expect(sanitizeFileName('Va<u>lt:2*?"')).toBe("Va-u-lt-2---");
    expect(sanitizeFileName("  ")).toBe("Vault");
    expect(sanitizeFileName("Notizen 2026")).toBe("Notizen 2026");
  });

  it("computes a stable 8-hex-char vault hash", async () => {
    const h = await sha8("C:\\V");
    expect(h).toMatch(/^[0-9a-f]{8}$/);
    expect(await sha8("C:\\V")).toBe(h);
    expect(await sha8("C:\\W")).not.toBe(h);
  });
});
