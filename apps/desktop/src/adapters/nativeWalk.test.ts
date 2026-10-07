import { beforeEach, describe, expect, it, vi } from "vitest";
import { INTERNAL_PATH_RULES } from "@plainva/core";

/**
 * Issue 122: the vault walk is ONE native command (`vault_walk`), not two IPC
 * round-trips per folder from the frontend. The adapter has to hand over the
 * internal-path rules it holds (there must be one list), take the answer only
 * when it is a complete, well-formed listing, and fall back to its own walker
 * wherever the command is missing or failed — the index must not be able to
 * tell which of the two ran.
 */

type Call = { command: string; args: Record<string, unknown> };
const calls: Call[] = [];
let walkAnswer: (args: Record<string, unknown>) => unknown = () => null;
let dirs: Record<string, Array<{ name: string; isDirectory: boolean }>> = {};

vi.mock("@tauri-apps/plugin-fs", () => ({
  stat: async (p: string) => {
    const rel = p === "/vault" ? "" : p.replace("/vault/", "");
    if (!(rel in dirs)) throw new Error(`ENOENT ${p}`);
    return { isDirectory: true, isFile: false, size: 0, mtime: new Date(1), birthtime: new Date(1), dev: null, ino: null };
  },
  exists: async () => true,
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
vi.mock("@tauri-apps/api/core", () => ({
  Channel: class {},
  invoke: async (command: string, args: Record<string, unknown>) => {
    calls.push({ command, args });
    if (command === "register_write_root") return "root-1";
    if (command === "vault_walk") return walkAnswer(args);
    if (command === "vault_walk_cancel") return null;
    if (command === "checked_read_dir") {
      const entries = dirs[String(args.relPath)];
      if (!entries) return null;
      return entries.map((e) => ({
        name: e.name, isDirectory: e.isDirectory, isFile: !e.isDirectory, isSymlink: false,
        metadata: e.isDirectory ? null : { size: 7, mtime: 42, ctime: 13 },
      }));
    }
    throw new Error(`Unexpected command ${command}`);
  },
}));

import { TauriVaultAdapter, parseNativeWalk } from "./TauriVaultAdapter";

const walkCalls = () => calls.filter((c) => c.command === "vault_walk");
const folderReads = () => calls.filter((c) => c.command === "checked_read_dir").length;

beforeEach(() => {
  calls.length = 0;
  walkAnswer = () => null;
  dirs = {
    "": [{ name: "Projects", isDirectory: true }, { name: "top.md", isDirectory: false }],
    Projects: [{ name: "note.md", isDirectory: false }],
  };
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("the native vault walk", () => {
  it("lists the vault in one call, with the rules the frontend holds", async () => {
    walkAnswer = () => ({
      entries: [["Projects", true, 0, null, 0], ["Projects/note.md", false, 42, 13, 7], ["top.md", false, 43, null, 9]],
      skipped: [{ path: "Projects/loop", reason: "cycle" }],
    });
    const listing = await new TauriVaultAdapter("/vault").listDirReport("", true);

    expect(walkCalls()).toHaveLength(1);
    expect(walkCalls()[0].args).toMatchObject({
      rootId: "root-1", relPath: "", recursive: true, insideInternal: false, rules: INTERNAL_PATH_RULES,
    });
    expect(folderReads(), "no folder is read from the frontend").toBe(0);
    expect(listing.files.map((f) => [f.path, f.name, f.isDirectory])).toEqual([
      ["Projects", "Projects", true], ["Projects/note.md", "note.md", false], ["top.md", "top.md", false],
    ]);
    expect(listing.files[1]).toMatchObject({ mtime: 42, ctime: 13, size: 7 });
    expect(listing.files[2].ctime).toBeUndefined();
    expect(listing.skipped).toEqual([{ path: "Projects/loop", reason: "cycle" }]);
  });

  it("walks inside an internal folder only when that folder was asked for", async () => {
    walkAnswer = () => ({ entries: [], skipped: [] });
    const adapter = new TauriVaultAdapter("/vault");
    await adapter.listDirReport(".plainva/backups", true);
    await adapter.listDirReport("Projects", false);
    expect(walkCalls().map((c) => [c.args.relPath, c.args.recursive, c.args.insideInternal])).toEqual([
      [".plainva/backups", true, true], ["Projects", false, false],
    ]);
  });

  it("a host without the command is asked once, then the frontend walker is in charge", async () => {
    // The browser fixtures and the E2E mock answer an unknown command with nothing.
    const adapter = new TauriVaultAdapter("/vault");
    const first = await adapter.listDirReport("", true);
    const second = await adapter.listDirReport("", true);
    expect(walkCalls()).toHaveLength(1);
    for (const listing of [first, second]) {
      expect(listing.files.map((f) => f.path).sort()).toEqual(["Projects", "Projects/note.md", "top.md"]);
    }
  });

  it("a call that fails falls back for that call, and the command is tried again next time", async () => {
    walkAnswer = () => {
      throw new Error("vault walk failed: thread panicked");
    };
    const adapter = new TauriVaultAdapter("/vault");
    const listing = await adapter.listDirReport("", true);
    expect(listing.files.map((f) => f.path).sort()).toEqual(["Projects", "Projects/note.md", "top.md"]);
    walkAnswer = () => ({ entries: [["only.md", false, 1, null, 1]], skipped: [] });
    expect((await adapter.listDirReport("", true)).files.map((f) => f.path)).toEqual(["only.md"]);
    expect(walkCalls()).toHaveLength(2);
  });

  it("an answer that is not a complete listing is not used at all", async () => {
    // What is missing from a listing reads as deleted; a half-understood one is worse than none.
    for (const answer of [
      { entries: [["a.md", false, 1, null, 1], ["b.md", "no", 1, null, 1]], skipped: [] },
      { entries: [["a.md", false, -1, null, 1]], skipped: [] },
      { entries: [["", false, 1, null, 1]], skipped: [] },
      { entries: [["dir/", true, 0, null, 0]], skipped: [] },
      { entries: [["a.md", false, 1, null, 1]], skipped: [{ path: "x", reason: "bored" }] },
      { entries: "none", skipped: [] },
      {},
    ]) {
      expect(await parseNativeWalk(answer), JSON.stringify(answer)).toBeNull();
    }
    walkAnswer = () => ({ entries: [["a.md", false, 1.5, null, 1]], skipped: [] });
    const listing = await new TauriVaultAdapter("/vault").listDirReport("", true);
    expect(listing.files.map((f) => f.path).sort()).toEqual(["Projects", "Projects/note.md", "top.md"]);
  });

  it("an aborted listing cancels the native walk and reports the abort", async () => {
    const abort = new AbortController();
    walkAnswer = () => {
      abort.abort(new Error("vault closed"));
      return { entries: [], skipped: [] };
    };
    await expect(new TauriVaultAdapter("/vault").listDirReport("", true, { signal: abort.signal })).rejects.toThrow("vault closed");
    expect(calls.some((c) => c.command === "vault_walk_cancel")).toBe(true);
  });
});
