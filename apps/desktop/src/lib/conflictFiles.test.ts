import { describe, it, expect } from "vitest";
import { conflictCopyPath, conflictCopyStamp, conflictOriginalPath, isConflictCopyPath, keepTextBeside, newestConflictCopy } from "@plainva/ui";

describe("conflict copy path mapping (P3.11)", () => {
  it("maps a conflict copy back to its original", () => {
    expect(conflictOriginalPath("Notes/a.CONFLICT-2026-07-05T12-30-00-000Z.md")).toBe("Notes/a.md");
    expect(conflictOriginalPath("Tasks.CONFLICT-2026-07-05T12-30-00-000Z.base")).toBe("Tasks.base");
    expect(conflictOriginalPath("noext.CONFLICT-2026-07-05T12-30-00-000Z")).toBe("noext");
  });

  it("keeps dots in the base name intact", () => {
    expect(conflictOriginalPath("v1.2/notes.v2.CONFLICT-2026-01-01T00-00-00-000Z.md")).toBe("v1.2/notes.v2.md");
  });

  it("returns null for non-conflict paths", () => {
    expect(conflictOriginalPath("Notes/a.md")).toBeNull();
    expect(conflictOriginalPath("CONFLICT-notes.md")).toBeNull();
  });

  it("detects conflict copies", () => {
    expect(isConflictCopyPath("a.CONFLICT-2026-07-05T12-30-00-000Z.md")).toBe(true);
    expect(isConflictCopyPath("a.md")).toBe(false);
  });

  it("conflictCopyPath builds the worker grammar and round-trips (2026-07-16)", () => {
    const stamp = new Date("2026-07-16T09:15:30.123Z");
    expect(conflictCopyPath("Notes/a.md", stamp)).toBe("Notes/a.CONFLICT-2026-07-16T09-15-30-123Z.md");
    expect(conflictCopyPath("noext", stamp)).toBe("noext.CONFLICT-2026-07-16T09-15-30-123Z");
    for (const p of ["Notes/a.md", "Tasks.base", "noext", "v1.2/notes.v2.md"]) {
      const copy = conflictCopyPath(p, stamp);
      expect(isConflictCopyPath(copy)).toBe(true);
      expect(conflictOriginalPath(copy)).toBe(p);
    }
  });

  it("keeps a text beside its file as a conflict copy of its own, and keeps the same editor's later typing in that copy (finding 2026-10-11)", async () => {
    const stamp = new Date("2026-10-20T08:00:00.000Z");
    const files = new Map<string, string>();
    const store = {
      exists: async (p: string) => files.has(p),
      readTextFile: async (p: string) => files.get(p)!,
      writeTextFile: async (p: string, text: string) => { files.set(p, text); },
    };
    const first = await keepTextBeside(store, "Notes/a.md", "my text\r\n", null, stamp);
    expect(first.copy).toMatch(/^Notes\/a\.CONFLICT-2026-10-20T08-00-00-000Z-[0-9a-f]{8}\.md$/);
    expect(conflictOriginalPath(first.copy)).toBe("Notes/a.md");
    expect(conflictCopyStamp(first.copy)?.toISOString()).toBe(stamp.toISOString());
    expect(files.get(first.copy)).toBe("my text\r\n");
    // Typing that went on goes into the same copy while it holds what was kept there…
    const second = await keepTextBeside(store, "Notes/a.md", "my text\r\nmore\r\n", first, stamp);
    expect(second).toEqual({ copy: first.copy, text: "my text\r\nmore\r\n" });
    expect(files.get(first.copy)).toBe("my text\r\nmore\r\n");
    // …and never into a copy somebody changed meanwhile.
    files.set(first.copy, "edited by hand\n");
    const third = await keepTextBeside(store, "Notes/a.md", "newest\n", second, stamp);
    expect(third.copy).not.toBe(first.copy);
    expect(files.get(first.copy)).toBe("edited by hand\n");
    expect(files.get(third.copy)).toBe("newest\n");
    // Two editors that keep in the same millisecond do not meet in one copy.
    const other = await keepTextBeside(store, "Notes/a.md", "another editor\n", null, stamp);
    expect(other.copy).not.toBe(third.copy);
    expect(files.get(third.copy)).toBe("newest\n");
    // A copy of another file is never written into, whatever was kept there.
    const elsewhere = await keepTextBeside(store, "Notes/b.md", "text of b\n", third, stamp);
    expect(conflictOriginalPath(elsewhere.copy)).toBe("Notes/b.md");
    expect(files.get(third.copy)).toBe("newest\n");
    expect(files.get(elsewhere.copy)).toBe("text of b\n");
  });

  it("finds the newest conflict copy beside a file — kept by an editor or left by the sync — and none of another file's", async () => {
    const entries = [
      "Notes/Data.CONFLICT-2026-10-19T08-00-00-000Z.csv",
      "Notes/Data.CONFLICT-2026-10-20T09-30-00-000Z-0a1b2c3d.csv",
      "Notes/Data.CONFLICT-2026-10-20T08-00-00-000Z.csv",
      "Notes/Data.csv",
      "Notes/Other.CONFLICT-2026-10-21T00-00-00-000Z.csv",
      "Notes/Data.CONFLICT-2026-10-22T00-00-00-000Z.md",
    ];
    const listed: string[] = [];
    const folder = {
      listDir: async (dir: string) => {
        listed.push(dir);
        return [
          ...entries.map((path) => ({ path, name: path.split("/").pop()!, isDirectory: false, mtime: 0, size: 1 })),
          { path: "Notes/Data.CONFLICT-2026-10-23T00-00-00-000Z.csv", name: "x", isDirectory: true, mtime: 0, size: 0 },
        ];
      },
    };
    expect(await newestConflictCopy(folder, "Notes/Data.csv")).toBe("Notes/Data.CONFLICT-2026-10-20T09-30-00-000Z-0a1b2c3d.csv");
    expect(listed).toEqual(["Notes"]);
    expect(await newestConflictCopy(folder, "Notes/Missing.csv")).toBeNull();
    const top = { listDir: async (dir: string) => (dir === "" ? [{ path: "Top.CONFLICT-2026-10-20T08-00-00-000Z.txt", name: "x", isDirectory: false, mtime: 0, size: 1 }] : []) };
    expect(await newestConflictCopy(top, "Top.txt")).toBe("Top.CONFLICT-2026-10-20T08-00-00-000Z.txt");
  });
});
