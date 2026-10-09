import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { adoptedCopyText, compareLines, compareStats, conflictCopyStamp, editorTextOf, lineCount, versionCopyPath, versionStamp } from "@plainva/ui";

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

  it("does not count a byte order mark only one side carries as a changed first line", () => {
    // Built at run time: the mark is never typed into this file.
    const MARK = String.fromCharCode(0xfeff);
    expect(compareStats(`${MARK}a\r\nb`, "a\nb")).toEqual({ added: 0, removed: 0, same: 2, hunks: 0 });
    expect(compareLines(`${MARK}a\nb`, "a\nB")).toEqual([
      { type: "same", text: "a" },
      { type: "del", text: "b" },
      { type: "add", text: "B" },
    ]);
  });

  it("says so (null) beyond the diff cap instead of pretending", () => {
    const big = Array.from({ length: 2001 }, (_, i) => `l${i}`).join("\n");
    expect(compareLines(big, "x")).toBeNull();
    expect(compareStats(big, "x")).toBeNull();
  });
});

describe("compareVersions — the side that is adopted", () => {
  const MARK = String.fromCharCode(0xfeff);
  // What the comparison shows for a copy: the text an editor holds.
  const shown = (copy: string) => editorTextOf(copy);

  it("is the copy itself, byte for byte, where nothing was changed on it", () => {
    for (const copy of [`${MARK}one\r\ntwo\r\n`, "one\r\ntwo", "one\ntwo\n", "one\r\ntwo\nthree\r\n", ""]) {
      expect(adoptedCopyText(copy, shown(copy)), JSON.stringify(copy)).toBe(copy);
    }
  });

  it("is the reader's text in the copy's shape where they worked on the right side first", () => {
    // The right side of the desktop's comparison is an editor: "\n", no mark.
    // Its text used to be written as it stood, and a note that lies there with
    // "\r\n" came back from a merged conflict with every line end turned.
    const copy = `${MARK}one\r\ntwo\r\nthree\r\n`;
    expect(adoptedCopyText(copy, "one\ntwo from the note\nthree\n")).toBe(`${MARK}one\r\ntwo from the note\r\nthree\r\n`);
    expect(adoptedCopyText("one\ntwo\n", "one\ntwo!\n")).toBe("one\ntwo!\n");
    // A copy with one stray line end leaves in its majority, as an editor's save does.
    expect(adoptedCopyText("one\r\ntwo\nthree\r\n", "one!\ntwo\nthree\n")).toBe("one!\r\ntwo\r\nthree\r\n");
  });
});

describe("compareVersions — where the comparison is wired", () => {
  it("the desktop's modal writes the adopted side through adoptedCopyText and shows both sides in the editor's text", () => {
    const source = readFileSync(resolve("src/components/CompareModal.tsx"), "utf8");
    // The one place the adopted text is made…
    expect(source.match(/adoptedCopyText\(/g)).toHaveLength(1);
    expect(source).toMatch(/const merged = adoptedCopyText\(copySnapshot\.current,/);
    // …and it is what both write paths of the adoption get.
    expect(source).toMatch(/resolveConflict\(originalOfConflict, \{ originalText: originalSnapshot\.current, copyText: copySnapshot\.current!, content: merged \}\)/);
    expect(source).toMatch(/writeTextFile\(originalOfConflict, merged\)/);
    // No normalisation of its own, and no decoder that drops a mark.
    expect(source).not.toMatch(/replace\(\/\\r/);
    expect(source).not.toMatch(/new TextDecoder/);
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
