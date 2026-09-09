import { beforeEach, describe, expect, it, vi } from "vitest";
import { VaultFileNotFoundError } from "@plainva/core";
import { TauriVaultAdapter } from "./TauriVaultAdapter";

const fs = vi.hoisted(() => ({ exists: vi.fn(), readFile: vi.fn(), readTextFile: vi.fn(), stat: vi.fn() }));
vi.mock("@tauri-apps/plugin-fs", () => fs);
vi.mock("@tauri-apps/api/path", () => ({
  join: async (...parts: string[]) => parts.join("/"), normalize: async (path: string) => path, sep: () => "/",
}));

describe("desktop vault read failures", () => {
  const vault = new TauriVaultAdapter("/vault");
  beforeEach(() => { vi.resetAllMocks(); fs.exists.mockResolvedValue(true); });
  it.each(["permission denied", "device unavailable"])("preserves %s instead of claiming absence", async (message) => {
    const error = new Error(message);
    fs.readFile.mockRejectedValue(error);
    fs.readTextFile.mockRejectedValue(error);
    fs.stat.mockRejectedValue(error);
    await expect(vault.readBinaryFile("note.md")).rejects.toBe(error);
    await expect(vault.readTextFile("note.md")).rejects.toBe(error);
    await expect(vault.getFileInfo("note.md")).rejects.toBe(error);
    fs.exists.mockRejectedValue(error);
    await expect(vault.exists("note.md")).rejects.toBe(error);
    await expect(vault.readBinaryFile("note.md")).rejects.toBe(error);
  });
  it("reports actual absence with the shared missing-file error", async () => {
    fs.exists.mockResolvedValue(false);
    await expect(vault.readBinaryFile("gone.md")).rejects.toBeInstanceOf(VaultFileNotFoundError);
    expect(fs.readFile).not.toHaveBeenCalled();
  });
});
