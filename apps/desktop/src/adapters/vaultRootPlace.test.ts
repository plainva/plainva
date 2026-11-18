import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildVaultChain, ConflictAwareVaultAdapter, vaultFolderIsThere } from "@plainva/core";
import { TauriVaultAdapter } from "./TauriVaultAdapter";

/**
 * Whether the vault's folder is still the place it was opened at (review
 * 2026-11-18). On Linux and macOS a drive that went leaves its mount point
 * behind: a folder that exists, often empty, on the file system above — a
 * note saved or "saved here again" into it would lie hidden under the drive
 * once it is back. The folder's device (`stat`'s `dev`), kept at opening and
 * compared later, tells the two apart; a drive that comes back under another
 * device number is still the same folder by when it came to be (`birthtime`).
 * An empty folder on the same device is a vault whose one note was deleted,
 * and is there.
 */

const fs = vi.hoisted(() => ({ exists: vi.fn(), mkdir: vi.fn(), stat: vi.fn() }));
vi.mock("@tauri-apps/plugin-fs", () => fs);
vi.mock("@tauri-apps/api/core", () => ({ invoke: async (command: string) => (command === "checked_path_exists" ? true : command === "register_write_root" ? "root" : null) }));
vi.mock("@tauri-apps/api/path", () => ({ join: async (...parts: string[]) => parts.join("/"), normalize: async (path: string) => path, sep: () => "/" }));

/** The vault's folder: its device, and when it came to be (null where the file system names none). */
const OPENED_AT = new Date("2026-03-04T05:06:07.890Z");
const onDevice = (dev: number | null, birthtime: Date | null = OPENED_AT) => fs.stat.mockResolvedValue({ dev, birthtime });
/** The mount point the drive left behind: another device, and a folder made when the drive was first mounted there. */
const MOUNT_POINT_BORN = new Date("2024-02-03T04:05:06Z");

describe("the place of the vault's folder", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    fs.exists.mockResolvedValue(true);
  });

  it("is the same while the folder is on the device it was opened on", async () => {
    onDevice(41);
    const vault = new TauriVaultAdapter("/mnt/nas/Vault");
    await vault.initialize();
    expect(await vault.sameRootAsOpened()).toBe(true);
  });

  it("is not the same once the drive went and its mount point stands there", async () => {
    onDevice(41);
    const vault = new TauriVaultAdapter("/mnt/nas/Vault");
    await vault.initialize();
    onDevice(2049, MOUNT_POINT_BORN);
    expect(await vault.sameRootAsOpened()).toBe(false);
    expect(await vaultFolderIsThere(vault)).toBe(false);
  });

  it("is the vault again when the drive comes back under another device number, and takes the new one on", async () => {
    onDevice(41);
    const vault = new TauriVaultAdapter("/media/usb/Vault");
    await vault.initialize();
    // Plugged in again: sdb1 became sdc1, the folder is the one that was opened.
    onDevice(57, new Date(OPENED_AT));
    expect(await vault.sameRootAsOpened()).toBe(true);
    expect(await vaultFolderIsThere(vault)).toBe(true);
    // The new number is the one now: the mount point left by the next unplugging is told apart from it.
    onDevice(41, new Date("2025-01-01T00:00:00Z"));
    expect(await vault.sameRootAsOpened()).toBe(false);
  });

  it("is not the vault for a folder on another device that came to be at another moment — the mount point, a stray folder", async () => {
    onDevice(41);
    const vault = new TauriVaultAdapter("/media/usb/Vault");
    await vault.initialize();
    onDevice(2049, new Date("2026-11-18T09:00:00Z"));
    expect(await vault.sameRootAsOpened()).toBe(false);
  });

  it("stays not the same place on another device where the file system names no birth time, until the vault is opened again", async () => {
    onDevice(41, null);
    const vault = new TauriVaultAdapter("/mnt/nfs/Vault");
    await vault.initialize();
    onDevice(57, null);
    expect(await vault.sameRootAsOpened()).toBe(false);
  });

  it("is not the same when the folder cannot be read", async () => {
    onDevice(41);
    const vault = new TauriVaultAdapter("/mnt/nas/Vault");
    await vault.initialize();
    fs.stat.mockRejectedValue(new Error("Input/output error (os error 5)"));
    expect(await vaultFolderIsThere(vault)).toBe(false);
  });

  it("is not known where the platform names no device (Windows), and a folder that exists is there", async () => {
    onDevice(null);
    const vault = new TauriVaultAdapter("C:/Vault");
    await vault.initialize();
    expect(await vault.sameRootAsOpened()).toBeNull();
    expect(await vaultFolderIsThere(vault)).toBe(true);
  });

  it("is handed on to the chain's top, which a save and \"Save here again\" ask", async () => {
    onDevice(41);
    const storage = new TauriVaultAdapter("/mnt/nas/Vault");
    await storage.initialize();
    const chain = buildVaultChain({ storage, deviceId: "d", index: null } as never);
    expect(chain.files).toBeInstanceOf(ConflictAwareVaultAdapter);
    expect(await chain.files.sameRootAsOpened()).toBe(true);
    onDevice(2049, MOUNT_POINT_BORN);
    expect(await vaultFolderIsThere(chain.files)).toBe(false);
  });
});
