import { describe, expect, it } from "vitest";
import {
  BOOKMARKS_FILE,
  parseBookmarksFile,
  removeBookmarksOnDisk,
  serializeBookmarksFile,
  toggleBookmarkOnDisk,
  type BookmarksIO,
} from "@plainva/ui";

/** Shared .plainva/bookmarks.json contract (plan Mobile M3E 2026-07-12, A5). */
describe("bookmarksFile", () => {
  it("parses the canonical desktop object shape", () => {
    const raw = JSON.stringify({ items: [{ type: "file", path: "A.md" }, { type: "file", path: "B/C.md" }] });
    expect(parseBookmarksFile(raw)).toEqual({ paths: ["A.md", "B/C.md"], existed: true });
  });

  it("parses the legacy mobile bare-array shape", () => {
    expect(parseBookmarksFile('["A.md", "B.md"]')).toEqual({ paths: ["A.md", "B.md"], existed: true });
  });

  it("tolerates string items inside the object shape and drops junk entries", () => {
    const raw = JSON.stringify({ items: ["A.md", { path: "B.md" }, { type: "file" }, 7, null] });
    expect(parseBookmarksFile(raw).paths).toEqual(["A.md", "B.md"]);
  });

  it("drops non-string entries from the bare-array shape", () => {
    expect(parseBookmarksFile('["A.md", 5, {"path":"x"}]').paths).toEqual(["A.md"]);
  });

  it("reports foreign or broken JSON as not existed", () => {
    expect(parseBookmarksFile("not json")).toEqual({ paths: [], existed: false });
    expect(parseBookmarksFile('{"foo": 1}')).toEqual({ paths: [], existed: false });
    expect(parseBookmarksFile('{"items": "nope"}')).toEqual({ paths: [], existed: false });
  });

  it("serializes to the canonical object shape and round-trips", () => {
    const out = serializeBookmarksFile(["A.md", "B/C.md"]);
    expect(JSON.parse(out)).toEqual({ items: [{ type: "file", path: "A.md" }, { type: "file", path: "B/C.md" }] });
    expect(parseBookmarksFile(out)).toEqual({ paths: ["A.md", "B/C.md"], existed: true });
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
  it("keeps what the other window added", async () => {
    const disk = createDisk(["A.md"]);
    // Window 1 stars B while window 2 still believes the list is ["A.md"].
    await toggleBookmarkOnDisk(disk.io, "B.md");

    // Window 2 stars C. It must read first: writing its own snapshot would drop B.
    const after = await toggleBookmarkOnDisk(disk.io, "C.md");

    expect(after).toEqual(["A.md", "B.md", "C.md"]);
    expect(disk.read()).toEqual(["A.md", "B.md", "C.md"]);
  });

  it("keeps what the other window removed", async () => {
    const disk = createDisk(["A.md", "B.md"]);
    await toggleBookmarkOnDisk(disk.io, "A.md"); // window 1 unstars A

    const after = await toggleBookmarkOnDisk(disk.io, "C.md"); // window 2 stars C

    // A stays gone: the second write must not resurrect it from a stale list.
    expect(after).toEqual(["B.md", "C.md"]);
  });

  it("drops only the deleted files on a cascade delete", async () => {
    const disk = createDisk(["A.md", "B.md", "C.md"]);
    const after = await removeBookmarksOnDisk(disk.io, ["B.md", "Missing.md"]);
    expect(after).toEqual(["A.md", "C.md"]);
  });

  it("creates the file on the first bookmark", async () => {
    let text: string | null = null;
    const io: BookmarksIO = {
      readTextFile: async () => {
        throw new Error("not found");
      },
      writeTextFile: async (path, content) => {
        expect(path).toBe(BOOKMARKS_FILE);
        text = content;
      },
    };
    expect(await toggleBookmarkOnDisk(io, "A.md")).toEqual(["A.md"]);
    expect(parseBookmarksFile(text ?? "")).toEqual({ paths: ["A.md"], existed: true });
  });
});
