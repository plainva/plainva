import { describe, it, expect } from "vitest";
import { compareLines, compareStats, conflictCopyStamp, lineCount, versionCopyPath, versionStamp } from "@plainva/ui";

describe("compareVersions — the side rule", () => {
  it("left is the note: a line only in the note is `del`, a line only in the other version is `add`", () => {
    const lines = compareLines("a\nnote-only\nb", "a\nother-only\nb");
    expect(lines).toEqual([
      { type: "same", text: "a" },
      { type: "del", text: "note-only" },
      { type: "add", text: "other-only" },
      { type: "same", text: "b" },
    ]);
  });

  it("counts what taking the other version costs and brings", () => {
    const stats = compareStats("a\nb\nc\nd", "a\nB\nc\nd\ne\nf");
    expect(stats).toEqual({ added: 3, removed: 1, same: 3, hunks: 2 });
  });

  it("normalizes CRLF so a line ending is never a difference", () => {
    expect(compareStats("a\r\nb", "a\nb")).toEqual({ added: 0, removed: 0, same: 2, hunks: 0 });
    expect(lineCount("a\r\nb\r\nc")).toBe(3);
  });

  it("says so (null) beyond the diff cap instead of pretending", () => {
    const big = Array.from({ length: 2001 }, (_, i) => `l${i}`).join("\n");
    expect(compareLines(big, "x")).toBeNull();
    expect(compareStats(big, "x")).toBeNull();
  });
});

describe("compareVersions — names and stamps", () => {
  it("reads the preservation instant out of a conflict copy's name", () => {
    const d = conflictCopyStamp("Notes/a.CONFLICT-2026-07-05T12-30-00-000Z.md");
    expect(d?.toISOString()).toBe("2026-07-05T12:30:00.000Z");
    expect(conflictCopyStamp("Notes/a.md")).toBeNull();
  });

  it("lays a version down next to its note under a name that says what and when", async () => {
    const date = new Date(2026, 8, 2, 14, 35);
    expect(versionStamp(date)).toBe("2026-09-02 14-35");
    const taken = new Set(["Projekte/Migration (Version 2026-09-02 14-35).md"]);
    const path = await versionCopyPath("Projekte/Migration.md", date, async (p) => taken.has(p));
    expect(path).toBe("Projekte/Migration (Version 2026-09-02 14-35 2).md");
    expect(await versionCopyPath("plain", date, async () => false)).toBe("plain (Version 2026-09-02 14-35)");
  });
});
