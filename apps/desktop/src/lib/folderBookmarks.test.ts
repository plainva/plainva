import { describe, expect, it, vi } from "vitest";
import { VaultFileNotFoundError } from "@plainva/core";
import { applyBookmarkProfileOnDisk, canonicalizeProfileValues, importObsidianBookmarks, parseBookmarksFile, readBookmarksOnDisk,
  renameBookmarksOnDisk, serializeBookmarksFile, setBookmarksLaneScope, toggleBookmarkOnDisk, type BookmarkEntry, type BookmarksIO } from "@plainva/ui";

const file = (path: string): BookmarkEntry => ({ type: "file", path });
const folder = (path: string): BookmarkEntry => ({ type: "folder", path });
function disk(initial: BookmarkEntry[] = []) {
  const files = new Map<string, string>([[".plainva/bookmarks.json", serializeBookmarksFile(initial)]]);
  const io: BookmarksIO = { async readTextFile(path) { if (!files.has(path)) throw new VaultFileNotFoundError(path); return files.get(path)!; },
    async writeTextFile(path, text) { files.set(path, text); } };
  return { io, files };
}
describe("typed folder bookmarks", () => {
  it("imports nested groups once per open adapter, deduplicates types and preserves the Obsidian source", async () => {
    const { io, files } = disk([file("Notes/A.md")]);
    const source = JSON.stringify({ items: [{ type: "group", items: [folder("Notes"), file("Notes/A.md"), folder("Else/Notes"), folder("Notes")] }, { type: "search", query: "word" }] });
    files.set(".obsidian/bookmarks.json", source);
    expect(await importObsidianBookmarks(io)).toEqual([file("Notes/A.md"), folder("Notes"), folder("Else/Notes")]);
    await toggleBookmarkOnDisk(io, "Notes", "folder");
    expect(await importObsidianBookmarks(io)).toEqual([file("Notes/A.md"), folder("Else/Notes")]);
    expect(files.get(".obsidian/bookmarks.json")).toBe(source);
    expect(parseBookmarksFile(files.get(".plainva/bookmarks.json")!).paths).toEqual(["Notes/A.md"]);
  });
  it("takes each of Obsidian's bookmarks over once per vault: removed in Plainva, it stays removed at the next open (§ 3.127 Nr. 2)", async () => {
    const { io, files } = disk([file("Mine.md")]);
    files.set(".obsidian/bookmarks.json", JSON.stringify({ items: [file("Obs/A.md"), folder("Obs")] }));
    expect(await importObsidianBookmarks(io)).toEqual([file("Mine.md"), file("Obs/A.md"), folder("Obs")]);
    await toggleBookmarkOnDisk(io, "Obs/A.md", "file");
    // The next open of the vault: a new adapter over the same files.
    const reopened: BookmarksIO = { readTextFile: (p) => io.readTextFile(p), writeTextFile: (p, t) => io.writeTextFile(p, t) };
    expect(await importObsidianBookmarks(reopened)).toEqual([file("Mine.md"), folder("Obs")]);
    // A bookmark set in Obsidian afterwards still comes over — once.
    files.set(".obsidian/bookmarks.json", JSON.stringify({ items: [file("Obs/A.md"), folder("Obs"), file("Obs/New.md")] }));
    const third: BookmarksIO = { readTextFile: (p) => io.readTextFile(p), writeTextFile: (p, t) => io.writeTextFile(p, t) };
    expect(await importObsidianBookmarks(third)).toEqual([file("Mine.md"), folder("Obs"), file("Obs/New.md")]);
  });
  it("an import whose list did not land is tried again at the next open, not remembered as done", async () => {
    const { io, files } = disk([]);
    files.set(".obsidian/bookmarks.json", JSON.stringify({ items: [file("Obs/A.md")] }));
    const failing: BookmarksIO = { readTextFile: (p) => io.readTextFile(p), writeTextFile: async () => { throw new Error("disk full"); } };
    await expect(importObsidianBookmarks(failing)).rejects.toThrow("disk full");
    expect(files.has(".plainva/obsidian-import.json")).toBe(false);
    const again: BookmarksIO = { readTextFile: (p) => io.readTextFile(p), writeTextFile: (p, t) => io.writeTextFile(p, t) };
    expect(await importObsidianBookmarks(again)).toEqual([file("Obs/A.md")]);
  });
  it("follows folder descendants and exact file renames, keeping unrelated same-name targets", async () => {
    const { io } = disk([folder("Notes"), file("Notes/A.md"), folder("Notes/Sub"), file("Notes/Sub/A.md"), folder("Notes2"), file("Else/A.md")]);
    await renameBookmarksOnDisk(io, "Notes", "Archive/Notes");
    await renameBookmarksOnDisk(io, "Archive/Notes/A.md", "Archive/Notes/B.md");
    expect(await readBookmarksOnDisk(io)).toEqual([folder("Archive/Notes"), file("Archive/Notes/B.md"), folder("Archive/Notes/Sub"), file("Archive/Notes/Sub/A.md"), folder("Notes2"), file("Else/A.md")]);
  });
  it("retains folders through an old profile and distinguishes absent, invalid and explicitly empty channels", async () => {
    const { io } = disk([file("Old.md"), folder("Kept")]);
    await applyBookmarkProfileOnDisk(io, canonicalizeProfileValues({ bookmarks: ["New.md"] }));
    expect(await readBookmarksOnDisk(io)).toEqual([file("New.md"), folder("Kept")]);
    await applyBookmarkProfileOnDisk(io, { bookmarks: ["../unsafe"], bookmarkFolders: ["Other"] });
    expect(await readBookmarksOnDisk(io)).toEqual([file("New.md"), folder("Other")]);
    // Older clients carry unknown fields through their projection. The new
    // channel must survive canonicalization even when it deliberately clears.
    const oldClientRoundTrip = canonicalizeProfileValues({ bookmarks: ["New.md"], bookmarkFolders: [] });
    expect(oldClientRoundTrip.bookmarkFolders).toEqual([]);
    await applyBookmarkProfileOnDisk(io, oldClientRoundTrip);
    expect(await readBookmarksOnDisk(io)).toEqual([file("New.md")]);
    await applyBookmarkProfileOnDisk(io, { bookmarks: ["Changed.md"], bookmarkFolders: ["Folder"] }, new Set(["bookmarks"]));
    expect(await readBookmarksOnDisk(io)).toEqual([file("New.md"), folder("Folder")]);
  });
  it("shares a lane between owner and raw-profile adapters, including a concurrent rename", async () => {
    const { io } = disk([file("A/one.md")]); const alias = { ...io };
    setBookmarksLaneScope(io, "test-folder-lane"); setBookmarksLaneScope(alias, "test-folder-lane");
    await Promise.all([toggleBookmarkOnDisk(io, "A", "folder"), renameBookmarksOnDisk(alias, "A", "B")]);
    expect(await readBookmarksOnDisk(io)).toEqual([file("B/one.md"), folder("B")]);
  });
  it("never replaces a broken or unreadable list and rejects paths outside the vault", async () => {
    const write = vi.fn(async () => {});
    const io = { readTextFile: async () => "{broken", writeTextFile: write };
    await expect(renameBookmarksOnDisk(io, "A", "B")).rejects.toThrow("Unreadable");
    await expect(toggleBookmarkOnDisk(io, "../outside", "folder")).rejects.toThrow("Invalid");
    await expect(applyBookmarkProfileOnDisk(io, { bookmarks: [] })).rejects.toThrow("Unreadable");
    expect(write).not.toHaveBeenCalled();
  });
});
