import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * iOS: the app's own files leave Documents (release list A11, the class of
 * the database move). The move runs against two folder trees in memory; each
 * file carries a marker and the time it was written, so a test sees which
 * copy ended up where. What only a device shows - that the Files app no
 * longer lists `drafts/` or `ai/`, and that the rename of a whole folder
 * works across Documents and Library - is not covered here.
 */

const platform = vi.hoisted(() => ({ kind: "ios" }));
vi.mock("@capacitor/core", () => ({ Capacitor: { getPlatform: () => platform.kind, isNativePlatform: () => platform.kind !== "web" }, registerPlugin: () => ({}) }));

const { moveInternalFilesOutOfDocuments, internalPlace, resetInternalFilesForTests, IOS_INTERNAL_FOLDER } = await import("./internalFiles");
type InternalFolders = import("./internalFiles").InternalFolders;

interface Entry { data: string; mtime: number }

class Trees implements InternalFolders {
  old = new Map<string, Entry>();
  new = new Map<string, Entry>();
  failMove = new Set<string>();
  failStat = false;
  newFolders = new Set<string>();
  private has(tree: Map<string, Entry>, path: string, folders?: Set<string>) {
    if (this.failStat) throw Object.assign(new Error("not permitted"), { code: "OS-PLUG-FILE-0007" });
    return tree.has(path) || [...tree.keys()].some((key) => key.startsWith(`${path}/`)) || (folders?.has(path) ?? false);
  }
  async existsOld(path: string) { return this.has(this.old, path); }
  async existsNew(path: string) { return this.has(this.new, path, this.newFolders); }
  async listOld(folder: string) {
    return [...this.old].filter(([key]) => key.startsWith(`${folder}/`)).map(([key, entry]) => ({ rel: key.slice(folder.length + 1), mtime: entry.mtime }));
  }
  async mtimeNew(path: string) { return this.new.get(path)!.mtime; }
  async makeNewFolder(path: string) { this.newFolders.add(path); }
  async moveToNew(path: string) {
    if (this.failMove.has(path)) throw new Error(`rename ${path} failed`);
    const moving = [...this.old].filter(([key]) => key === path || key.startsWith(`${path}/`));
    if (moving.length === 0) throw new Error(`no ${path}`);
    for (const [key, entry] of moving) {
      if (this.new.has(key)) throw new Error(`${key} exists`);
      this.old.delete(key);
      this.new.set(key, entry);
    }
  }
  async removeOld(path: string) { this.old.delete(path); }
  async removeNew(path: string) { this.new.delete(path); }
  async removeOldFolder(path: string) {
    for (const key of [...this.old.keys()]) if (key.startsWith(`${path}/`)) throw new Error("folder not empty");
  }
}

const at = (data: string, mtime: number): Entry => ({ data, mtime });
const contents = (tree: Map<string, Entry>) => Object.fromEntries([...tree].map(([key, entry]) => [key, entry.data]));

let trees: Trees;
beforeEach(() => {
  trees = new Trees();
  platform.kind = "ios";
  resetInternalFilesForTests();
});

describe("moving the app's own files out of Documents", () => {
  it("renames each folder into place when only Documents holds it", async () => {
    trees.old.set("drafts/v1/a.json", at("draft", 1)).set("drafts/v1/comment-operations/op.json", at("op", 1))
      .set("ai/v1/chat.json", at("chat", 1)).set("okf-journal/v1.json", at("okf", 1)).set("profile-journal/v1.json", at("profile", 1))
      .set("vaults/v1/note.md", at("note", 1));
    const outcome = await moveInternalFilesOutOfDocuments(trees);
    expect(outcome.stayed.size).toBe(0);
    expect(contents(trees.old)).toEqual({ "vaults/v1/note.md": "note" });
    expect(contents(trees.new)).toEqual({
      "drafts/v1/a.json": "draft", "drafts/v1/comment-operations/op.json": "op",
      "ai/v1/chat.json": "chat", "okf-journal/v1.json": "okf", "profile-journal/v1.json": "profile",
    });
  });

  it("keeps the newer of two copies, whichever folder holds it", async () => {
    trees.new.set("drafts/v1/a.json", at("new-older", 1)).set("drafts/v1/b.json", at("new-newer", 9)).set("drafts/v1/c.json", at("same-new", 5));
    trees.old.set("drafts/v1/a.json", at("old-newer", 5)).set("drafts/v1/b.json", at("old-older", 3)).set("drafts/v1/c.json", at("same-old", 5))
      .set("drafts/v1/d.json", at("only-old", 2));
    await moveInternalFilesOutOfDocuments(trees);
    expect(trees.old.size).toBe(0);
    expect(contents(trees.new)).toEqual({ "drafts/v1/a.json": "old-newer", "drafts/v1/b.json": "new-newer", "drafts/v1/c.json": "same-new", "drafts/v1/d.json": "only-old" });
  });

  it("a merge that ends half way loses nothing, and the next start finishes it", async () => {
    trees.new.set("ai/v1/x.json", at("new", 1));
    trees.old.set("ai/v1/x.json", at("old-newer", 5)).set("ai/v1/y.json", at("y", 1));
    trees.failMove.add("ai/v1/x.json");
    expect((await moveInternalFilesOutOfDocuments(trees)).stayed.size).toBe(0);
    // The older copy went first; the newer one is still where it was.
    expect(contents(trees.old)).toEqual({ "ai/v1/x.json": "old-newer" });
    expect(contents(trees.new)).toEqual({ "ai/v1/y.json": "y" });

    trees.failMove.clear();
    await moveInternalFilesOutOfDocuments(trees);
    expect(trees.old.size).toBe(0);
    expect(contents(trees.new)).toEqual({ "ai/v1/x.json": "old-newer", "ai/v1/y.json": "y" });
  });

  it("a folder that could not be renamed stays in Documents for this lifetime, and moves at the next start", async () => {
    trees.old.set("okf-journal/v1.json", at("okf", 1));
    trees.failMove.add("okf-journal");
    expect([...(await moveInternalFilesOutOfDocuments(trees)).stayed]).toEqual(["okf-journal"]);
    expect(contents(trees.old)).toEqual({ "okf-journal/v1.json": "okf" });

    trees.failMove.clear();
    expect((await moveInternalFilesOutOfDocuments(trees)).stayed.size).toBe(0);
    expect(contents(trees.new)).toEqual({ "okf-journal/v1.json": "okf" });
  });

  it("touches nothing when the folders cannot be asked", async () => {
    // Either place is safe then: what lands in the new one meets what stayed
    // in the old one at the next start, and the one written last wins.
    trees.old.set("drafts/v1/a.json", at("draft", 1));
    trees.failStat = true;
    await moveInternalFilesOutOfDocuments(trees);
    expect(contents(trees.old)).toEqual({ "drafts/v1/a.json": "draft" });
    expect(trees.new.size).toBe(0);
  });
});

describe("where an app-owned file lies", () => {
  it("below Library on iOS, after the move, once per lifetime", async () => {
    trees.old.set("drafts/v1/a.json", at("draft", 1));
    expect(await internalPlace("drafts/v1/a.json", trees)).toEqual({ directory: "LIBRARY", path: `${IOS_INTERNAL_FOLDER}/drafts/v1/a.json` });
    trees.old.set("drafts/v1/late.json", at("late", 1));
    await internalPlace("ai/v1/x.json", trees);
    expect(trees.old.has("drafts/v1/late.json")).toBe(true);
  });

  it("in Documents for a folder that stayed there", async () => {
    trees.old.set("ai/v1/x.json", at("chat", 1));
    trees.failMove.add("ai");
    expect(await internalPlace("ai/v1/x.json", trees)).toEqual({ directory: "DATA", path: "ai/v1/x.json" });
  });

  it.each(["android", "web"])("in the data folder on %s, without a move", async (kind) => {
    platform.kind = kind;
    trees.old.set("drafts/v1/a.json", at("draft", 1));
    expect(await internalPlace("drafts/v1/a.json", trees)).toEqual({ directory: "DATA", path: "drafts/v1/a.json" });
    expect(trees.new.size).toBe(0);
  });

  it("refuses a path outside the app's own folders", async () => {
    await expect(internalPlace("vaults/v1/note.md", trees)).rejects.toThrow(/not below/);
  });

  it("the native atomic write can write below Library", () => {
    const swift = readFileSync(new URL("../../ios/App/App/AtomicFilePlugin.swift", import.meta.url), "utf8");
    expect(swift).toMatch(/case "LIBRARY": searchPath = \.libraryDirectory/);
    expect(swift).toMatch(/case "DATA": searchPath = \.documentDirectory/);
  });
});
