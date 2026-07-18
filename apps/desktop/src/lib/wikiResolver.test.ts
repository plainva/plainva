import { describe, it, expect } from "vitest";
import { buildWikiTargetSet, isWikiTargetResolved, wikiTargetToPath } from "@plainva/ui";

const files = [
  { title: "Alpha", path: "Alpha.md" },
  { title: "Beta", path: "Notes/Beta.md" },
  { title: "Tasks", path: "Tasks.base" },
];

describe("isWikiTargetResolved", () => {
  const set = buildWikiTargetSet(files);

  it("resolves by title (case-insensitive)", () => {
    expect(isWikiTargetResolved("Alpha", set)).toBe(true);
    expect(isWikiTargetResolved("alpha", set)).toBe(true);
  });

  it("resolves a folder path via the .md suffix", () => {
    expect(isWikiTargetResolved("Notes/Beta", set)).toBe(true); // matches path Notes/Beta.md
    expect(isWikiTargetResolved("Beta", set)).toBe(true); // matches title
  });

  it("resolves a .base target by its path", () => {
    expect(isWikiTargetResolved("Tasks.base", set)).toBe(true);
    expect(isWikiTargetResolved("Tasks", set)).toBe(true); // title
  });

  it("ignores header and alias", () => {
    expect(isWikiTargetResolved("Alpha#Section", set)).toBe(true);
    expect(isWikiTargetResolved("Alpha|shown text", set)).toBe(true);
  });

  it("flags a non-existent target", () => {
    expect(isWikiTargetResolved("Ghost", set)).toBe(false);
    expect(isWikiTargetResolved("Notes/Ghost", set)).toBe(false);
  });

  it("treats null set / empty target as resolved (don't flag before index loads)", () => {
    expect(isWikiTargetResolved("Ghost", null)).toBe(true);
    expect(isWikiTargetResolved("", set)).toBe(true);
    expect(isWikiTargetResolved("   ", set)).toBe(true);
  });
});

describe("wikiTargetToPath", () => {
  it("bare target lands in the host note's folder", () => {
    expect(wikiTargetToPath("Ideas", "Projects/Plan.md")).toEqual({ path: "Projects/Ideas.md", title: "Ideas" });
  });

  it("bare target with a root host lands in the vault root", () => {
    expect(wikiTargetToPath("Ideas", "Plan.md")).toEqual({ path: "Ideas.md", title: "Ideas" });
    expect(wikiTargetToPath("Ideas")).toEqual({ path: "Ideas.md", title: "Ideas" });
  });

  it("explicit folder path creates exactly there; title is the basename", () => {
    expect(wikiTargetToPath("Area/Sub/Note", "Projects/Plan.md")).toEqual({
      path: "Area/Sub/Note.md",
      title: "Note",
    });
  });

  it("strips header, alias and a trailing .md", () => {
    expect(wikiTargetToPath("Ideas#Section|Shown", "Plan.md")).toEqual({ path: "Ideas.md", title: "Ideas" });
    expect(wikiTargetToPath("Ideas.md", "Plan.md")).toEqual({ path: "Ideas.md", title: "Ideas" });
  });
});
