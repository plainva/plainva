import { beforeEach, describe, expect, it, vi } from "vitest";
import { VaultFileNotFoundError } from "@plainva/core";
import { TauriVaultAdapter } from "./TauriVaultAdapter";

const fs = vi.hoisted(() => ({ exists: vi.fn(), readFile: vi.fn(), readTextFile: vi.fn(), stat: vi.fn() }));
const native = vi.hoisted(() => ({ exists: vi.fn(), text: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: async (command: string) => {
  if (command === "register_write_root") return "root";
  if (command === "checked_path_exists") return native.exists();
  if (command === "checked_read_text_file") return native.text();
  throw new Error("Unexpected filesystem command");
} }));
vi.mock("@tauri-apps/plugin-fs", () => fs);
vi.mock("@tauri-apps/api/path", () => ({
  join: async (...parts: string[]) => parts.join("/"), normalize: async (path: string) => path, sep: () => "/",
}));

describe("desktop vault read failures", () => {
  const vault = new TauriVaultAdapter("/vault");
  beforeEach(() => { vi.resetAllMocks(); native.exists.mockResolvedValue(true); native.text.mockResolvedValue("note"); });
  it.each(["permission denied", "device unavailable"])("preserves %s instead of claiming absence", async (message) => {
    const error = new Error(message);
    fs.readFile.mockRejectedValue(error);
    native.text.mockRejectedValue(error);
    fs.stat.mockRejectedValue(error);
    await expect(vault.readBinaryFile("note.md")).rejects.toBe(error);
    await expect(vault.readTextFile("note.md")).rejects.toBe(error);
    await expect(vault.getFileInfo("note.md")).rejects.toBe(error);
    native.exists.mockRejectedValue(error);
    await expect(vault.exists("note.md")).rejects.toBe(error);
    await expect(vault.readBinaryFile("note.md")).rejects.toBe(error);
  });
  it("reports actual absence with the shared missing-file error", async () => {
    native.exists.mockResolvedValue(false);
    await expect(vault.readBinaryFile("gone.md")).rejects.toBeInstanceOf(VaultFileNotFoundError);
    expect(fs.readFile).not.toHaveBeenCalled();
  });
  it("does not trust an unsupported or malformed native existence response", async () => {
    native.exists.mockResolvedValue(undefined);
    await expect(vault.exists("note.md")).rejects.toThrow("could not be confirmed");
  });
  it("keeps an empty text file distinct from a missing native read", async () => {
    native.text.mockResolvedValue("");
    await expect(vault.readTextFile("empty.md")).resolves.toBe("");
    native.text.mockResolvedValue(null);
    await expect(vault.readTextFile("gone.md")).rejects.toBeInstanceOf(VaultFileNotFoundError);
    native.text.mockResolvedValue(false);
    await expect(vault.readTextFile("unknown.md")).rejects.toThrow("could not be confirmed");
  });
});
