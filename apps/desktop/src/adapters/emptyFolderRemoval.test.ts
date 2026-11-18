import { beforeEach, describe, expect, it, vi } from "vitest";
import { TauriVaultAdapter } from "./TauriVaultAdapter";

/**
 * `removeEmptyDir` on the desktop (F44, third review): the sync takes a
 * folder another device deleted away here only while it holds nothing at all.
 * The desktop's walk does not enter `.git`, `.obsidian` and the like, so
 * "empty" is asked of the raw directory read, and the folder goes by `remove`
 * without `recursive` — never into the trash, never with what it holds. The
 * phone's twin: apps/mobile/src/adapters/emptyFolderRemoval.test.ts.
 */

const native = vi.hoisted(() => ({ readDir: vi.fn(), trash: vi.fn() }));
const fs = vi.hoisted(() => ({ remove: vi.fn(), exists: vi.fn(), readFile: vi.fn(), stat: vi.fn(), rename: vi.fn(), mkdir: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  Channel: class {},
  invoke: async (command: string, args: { relPath?: string }) => {
    if (command === "register_write_root") return "root";
    if (command === "checked_read_dir") return native.readDir(args.relPath);
    if (command === "move_to_trash") return native.trash(args);
    throw new Error(`Unexpected filesystem command ${command}`);
  },
}));
vi.mock("@tauri-apps/plugin-fs", () => fs);
vi.mock("@tauri-apps/api/path", () => ({
  join: async (...parts: string[]) => parts.join("/"), normalize: async (path: string) => path, sep: () => "/",
}));

const entry = (name: string, isDirectory: boolean) => ({ name, isFile: !isDirectory, isDirectory, isSymlink: false, metadata: null });

describe("an empty folder, and only an empty one, goes", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    fs.remove.mockResolvedValue(undefined);
  });

  it("keeps a folder that holds only what the walk leaves out (.git), and asks no trash", async () => {
    native.readDir.mockResolvedValue([entry(".git", true)]);
    const vault = new TauriVaultAdapter("/vault");
    await expect(vault.removeEmptyDir("Projekt")).resolves.toBe(false);
    expect(fs.remove).not.toHaveBeenCalled();
    expect(native.trash).not.toHaveBeenCalled();
  });

  it("keeps a folder that holds a dot file", async () => {
    native.readDir.mockResolvedValue([entry(".DS_Store", false)]);
    await expect(new TauriVaultAdapter("/vault").removeEmptyDir("Projekt")).resolves.toBe(false);
    expect(fs.remove).not.toHaveBeenCalled();
  });

  it("removes a folder that holds nothing, without recursion and without the trash", async () => {
    native.readDir.mockResolvedValue([]);
    await expect(new TauriVaultAdapter("/vault").removeEmptyDir("Leer")).resolves.toBe(true);
    expect(fs.remove).toHaveBeenCalledWith("/vault/Leer", { recursive: false });
    expect(native.trash).not.toHaveBeenCalled();
  });

  it("a folder that is not there is gone; one the system refuses to remove stays", async () => {
    native.readDir.mockResolvedValue(null);
    await expect(new TauriVaultAdapter("/vault").removeEmptyDir("Fehlt")).resolves.toBe(true);
    native.readDir.mockResolvedValue([]);
    fs.remove.mockRejectedValue(new Error("Directory not empty (os error 39)"));
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(new TauriVaultAdapter("/vault").removeEmptyDir("Neu")).resolves.toBe(false);
  });
});
