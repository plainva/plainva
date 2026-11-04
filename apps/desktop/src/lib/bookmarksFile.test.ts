import { describe, expect, it } from "vitest";
import { VaultFileNotFoundError } from "@plainva/core";
import {
  BOOKMARKS_FILE,
  parseBookmarksFile,
  removeBookmarksOnDisk,
  restoreBookmarksFile,
  serializeBookmarksFile,
  setBookmarksLaneScope,
  snapshotBookmarksFile,
  toggleBookmarkOnDisk,
  type BookmarksFileIO,
  type BookmarksIO,
} from "@plainva/ui";

/** Shared .plainva/bookmarks.json contract (plan Mobile M3E 2026-07-12, A5). */
describe("bookmarksFile", () => {
  it("parses the canonical desktop object shape", () => {
    const raw = JSON.stringify({ items: [{ type: "file", path: "A.md" }, { type: "file", path: "B/C.md" }] });
    expect(parseBookmarksFile(raw)).toMatchObject({ paths: ["A.md", "B/C.md"], existed: true });
  });

  it("parses the legacy mobile bare-array shape", () => {
    expect(parseBookmarksFile('["A.md", "B.md"]')).toMatchObject({ paths: ["A.md", "B.md"], existed: true });
  });

  it("tolerates string items inside the object shape and drops junk entries", () => {
    const raw = JSON.stringify({ items: ["A.md", { path: "B.md" }, { type: "file" }, 7, null] });
    expect(parseBookmarksFile(raw).paths).toEqual(["A.md", "B.md"]);
  });

  it("drops non-string entries from the bare-array shape", () => {
    expect(parseBookmarksFile('["A.md", 5, {"path":"x"}]').paths).toEqual(["A.md"]);
  });

  it("reports foreign or broken JSON as not existed", () => {
    expect(parseBookmarksFile("not json")).toMatchObject({ paths: [], existed: false });
    expect(parseBookmarksFile('{"foo": 1}')).toMatchObject({ paths: [], existed: false });
    expect(parseBookmarksFile('{"items": "nope"}')).toMatchObject({ paths: [], existed: false });
  });

  it("serializes to the canonical object shape and round-trips", () => {
    const out = serializeBookmarksFile(["A.md", "B/C.md"]);
    expect(JSON.parse(out)).toEqual({ items: [{ type: "file", path: "A.md" }, { type: "file", path: "B/C.md" }] });
    expect(parseBookmarksFile(out)).toMatchObject({ paths: ["A.md", "B/C.md"], existed: true });
    // The legacy mobile shape round-trips into the canonical one.
    expect(parseBookmarksFile(serializeBookmarksFile(parseBookmarksFile('["A.md"]').paths)).paths).toEqual(["A.md"]);
  });
});

/** A file on disk plus a window that may hold a stale view of it. */
function createDisk(initial: string[]) {
  let text = serializeBookmarksFile(initial);
  const io: BookmarksIO = {
    readTextFile: async () => text,
    writeTextFile: async (_p, content) => {
      text = content;
    },
  };
  return { io, read: () => parseBookmarksFile(text).paths };
}

describe("changing bookmarks with two windows open (multi-window C1)", () => {
  it("serializes simultaneous read-modify-write requests", async () => {
    const disk = createDisk(["A.md"]);
    await Promise.all([toggleBookmarkOnDisk(disk.io, "B.md"), toggleBookmarkOnDisk(disk.io, "C.md")]);
    expect(disk.read()).toEqual(["A.md", "B.md", "C.md"]);
  });

  it("keeps an existing file intact when its read fails or its contents are invalid", async () => {
    const writes: string[] = [];
    const io: BookmarksIO = { readTextFile: async () => { throw new Error("permission denied"); }, writeTextFile: async (_path, text) => { writes.push(text); } };
    await expect(toggleBookmarkOnDisk(io, "New.md")).rejects.toThrow("permission denied");
    io.readTextFile = async () => "{invalid";
    await expect(toggleBookmarkOnDisk(io, "New.md")).rejects.toThrow("Unreadable bookmarks");
    expect(writes).toEqual([]);
  });

  it("keeps what the other window added", async () => {
    const disk = createDisk(["A.md"]);
    // Window 1 stars B while window 2 still believes the list is ["A.md"].
    await toggleBookmarkOnDisk(disk.io, "B.md");

    // Window 2 stars C. It must read first: writing its own snapshot would drop B.
    const after = await toggleBookmarkOnDisk(disk.io, "C.md");

    expect(after.map((e) => e.path)).toEqual(["A.md", "B.md", "C.md"]);
    expect(disk.read()).toEqual(["A.md", "B.md", "C.md"]);
  });

  it("keeps what the other window removed", async () => {
    const disk = createDisk(["A.md", "B.md"]);
    await toggleBookmarkOnDisk(disk.io, "A.md"); // window 1 unstars A

    const after = await toggleBookmarkOnDisk(disk.io, "C.md"); // window 2 stars C

    // A stays gone: the second write must not resurrect it from a stale list.
    expect(after.map((e) => e.path)).toEqual(["B.md", "C.md"]);
  });

  it("removes only explicitly requested bookmark paths", async () => {
    const disk = createDisk(["A.md", "B.md", "C.md"]);
    const after = await removeBookmarksOnDisk(disk.io, ["B.md", "Missing.md"]);
    expect(after.map((e) => e.path)).toEqual(["A.md", "C.md"]);
  });

  it("creates the file on the first bookmark", async () => {
    let text: string | null = null;
    const io: BookmarksIO = {
      readTextFile: async () => {
        throw new VaultFileNotFoundError(BOOKMARKS_FILE);
      },
      writeTextFile: async (path, content) => {
        expect(path).toBe(BOOKMARKS_FILE);
        text = content;
      },
    };
    expect(await toggleBookmarkOnDisk(io, "A.md")).toEqual([{ type: "file", path: "A.md" }]);
    expect(parseBookmarksFile(text ?? "")).toMatchObject({ paths: ["A.md"], existed: true });
  });
});

/**
 * The way back out of a settings import (Sammelplan § 3.127 Nr. 1): both
 * shells snapshot the bookmarks file before the import and put it back when
 * the import does not finish.
 */
describe("the bookmarks file before and after a settings import", () => {
  function fileDisk(initial?: string) {
    const files = new Map<string, string>();
    if (initial !== undefined) files.set(BOOKMARKS_FILE, initial);
    let gate: Promise<void> | null = null;
    const io: BookmarksFileIO = {
      readTextFile: async (p) => {
        const text = files.get(p);
        if (text === undefined) throw new VaultFileNotFoundError(p);
        return text;
      },
      writeTextFile: async (p, text) => {
        const held = gate; gate = null;
        if (held) await held;
        files.set(p, text);
      },
      exists: async (p) => files.has(p),
      deleteItem: async (p) => { files.delete(p); },
    };
    return { io, files, holdNextWrite: (until: Promise<void>) => { gate = until; } };
  }
  const before = JSON.stringify({ items: [{ type: "folder", path: "Projects" }, { type: "file", path: "A.md" }] }, null, 2);

  it("gives back the whole file, folder bookmarks included", async () => {
    const disk = fileDisk(before);
    const snapshot = await snapshotBookmarksFile(disk.io);
    disk.files.set(BOOKMARKS_FILE, serializeBookmarksFile(["Imported.md"]));
    await restoreBookmarksFile(disk.io, snapshot);
    expect(disk.files.get(BOOKMARKS_FILE)).toBe(before);
  });

  it("gives back \"there was no file\" as no file", async () => {
    const disk = fileDisk();
    const snapshot = await snapshotBookmarksFile(disk.io);
    expect(snapshot).toEqual({ existed: false });
    disk.files.set(BOOKMARKS_FILE, serializeBookmarksFile(["Imported.md"]));
    await restoreBookmarksFile(disk.io, snapshot);
    expect(disk.files.has(BOOKMARKS_FILE)).toBe(false);
  });

  it("reads the old phone form (file bookmarks only) and leaves the folders it never saw", async () => {
    const disk = fileDisk(JSON.stringify({ items: [{ type: "folder", path: "Projects" }, { type: "file", path: "Imported.md" }] }));
    await restoreBookmarksFile(disk.io, { existed: true, paths: ["A.md"] });
    expect(parseBookmarksFile(disk.files.get(BOOKMARKS_FILE)!).entries).toEqual([
      { type: "file", path: "A.md" },
      { type: "folder", path: "Projects" },
    ]);
  });

  it("waits for a star click that is half done, on the lane the desktop's writers share", async () => {
    const disk = fileDisk(before);
    // The desktop names its lane by the vault, so every adapter of it queues together.
    setBookmarksLaneScope(disk.io, "desktop:lane-test");
    const snapshot = await snapshotBookmarksFile(disk.io);
    disk.files.set(BOOKMARKS_FILE, serializeBookmarksFile(["Imported.md"]));
    let release!: () => void;
    disk.holdNextWrite(new Promise<void>((resolve) => { release = resolve; }));
    const star = toggleBookmarkOnDisk(disk.io, "Star.md");
    await Promise.resolve();
    const rollback = restoreBookmarksFile(disk.io, snapshot);
    release();
    await Promise.all([star, rollback]);
    expect(disk.files.get(BOOKMARKS_FILE)).toBe(before);
  });
});
