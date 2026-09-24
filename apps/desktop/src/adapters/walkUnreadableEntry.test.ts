import { describe, expect, it, vi } from "vitest";

/**
 * Issue 110 (E8): ONE entry the walk cannot use — a name with a backslash,
 * which macOS allows; a file whose metadata cannot be read; a socket — used to
 * fail its whole folder. The folder then counted as unreadable, and the index
 * refused every deletion under it: every file moved out of that folder stayed
 * in the tree for good. Now the entry is reported on its own and the rest of
 * the folder is listed.
 */

type NativeEntry = Record<string, unknown>;
let listing: NativeEntry[] = [];

vi.mock("@tauri-apps/plugin-fs", () => ({
  readDir: async () => [],
  stat: async (p: string) => ({
    isDirectory: p === "/vault" || p === "/vault/docs", isFile: false, size: 0,
    mtime: new Date(1), birthtime: new Date(1), dev: null, ino: null,
  }),
  exists: async () => true,
  readTextFile: async () => "",
  readFile: async () => new Uint8Array(),
  remove: async () => {},
  rename: async () => {},
  mkdir: async () => {},
}));
vi.mock("@tauri-apps/api/path", () => ({
  join: async (...parts: string[]) => parts.filter(Boolean).join("/"),
  normalize: async (p: string) => p.replace(/\/+$/, ""),
  sep: () => "/",
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: async (command: string, args: { relPath: string }) => {
  if (command === "register_write_root") return "root-1";
  if (command === "checked_read_dir") return args.relPath === "docs" ? listing : [{ name: "docs", isDirectory: true, isFile: false, isSymlink: false }];
  throw new Error("Unexpected filesystem command");
} }));

import { TauriVaultAdapter } from "./TauriVaultAdapter";

const file = (name: string): NativeEntry => ({ name, isFile: true, isDirectory: false, isSymlink: false, metadata: { size: 1, mtime: 5, ctime: 5 } });

describe("one entry the walk cannot use", () => {
  it("is skipped on its own; its siblings are still listed", async () => {
    listing = [
      file("keep.md"),
      // Named by the native side: metadata failed for this one file.
      { name: "locked.md", isFile: false, isDirectory: false, isSymlink: false, unreadable: "cannot inspect file metadata: denied" },
      // A legal name on macOS that the vault's path scheme cannot address.
      file("a\\b.md"),
      // A socket: neither file, folder nor link.
      { name: "agent.sock", isFile: false, isDirectory: false, isSymlink: false, metadata: null },
      file("other.md"),
    ];
    const report = await new TauriVaultAdapter("/vault").listDirReport("", true);
    expect(report.files.filter((f) => !f.isDirectory).map((f) => f.path).sort()).toEqual(["docs/keep.md", "docs/other.md"]);
    expect(report.skipped.map((s) => s.path).sort()).toEqual(["docs/a\\b.md", "docs/agent.sock", "docs/locked.md"]);
    // Never the folder itself: that is what kept every deletion under it away.
    expect(report.skipped.some((s) => s.path === "docs")).toBe(false);
  });

  it("a malformed response still fails the folder — that is the bridge, not the disk", async () => {
    listing = [file("keep.md"), { name: "x/y.md", isFile: true, isDirectory: false, isSymlink: false }];
    const report = await new TauriVaultAdapter("/vault").listDirReport("", true);
    expect(report.skipped).toEqual([{ path: "docs", reason: "unreadable" }]);
  });
});
