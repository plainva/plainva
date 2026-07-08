import { describe, it, expect } from "vitest";
import { sameTreeFiles } from "./treeFiles";

describe("sameTreeFiles (autosave-lag fix)", () => {
  it("treats identical lists as equal so a content save skips the tree rebuild", () => {
    const a = [{ path: "a.md", title: "A", mode: "okf" }, { path: "b.md", title: "B" }];
    const b = [{ path: "a.md", title: "A", mode: "okf" }, { path: "b.md", title: "B" }];
    expect(sameTreeFiles(a, b)).toBe(true);
  });

  it("detects a title change (rename / new frontmatter title)", () => {
    expect(sameTreeFiles([{ path: "a.md", title: "A" }], [{ path: "a.md", title: "A2" }])).toBe(false);
  });

  it("detects added/removed files and mode/isDir changes", () => {
    expect(sameTreeFiles([{ path: "a.md", title: "A" }], [{ path: "a.md", title: "A" }, { path: "b.md", title: "B" }])).toBe(false);
    expect(sameTreeFiles([{ path: "a.md", title: "A", mode: "okf" }], [{ path: "a.md", title: "A", mode: "obsidian" }])).toBe(false);
    expect(sameTreeFiles([{ path: "d", title: "d", isDir: true }], [{ path: "d", title: "d" }])).toBe(false);
  });

  it("ignores snippet/titleHl, which are not part of the plain tree", () => {
    expect(sameTreeFiles([{ path: "a.md", title: "A", snippet: "x" }], [{ path: "a.md", title: "A", snippet: "y" }])).toBe(true);
  });
});
