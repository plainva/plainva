import { describe, it, expect } from "vitest";
import { buildWikiTargetSet, isWikiTargetResolved, wikiTargetToPath } from "@plainva/ui";

// The rows as the index holds them: a note's title is its file's name unless
// its properties say otherwise; any other file's title is its name, extension
// included. The rule itself — and that this drawing agrees with a click — is
// pinned against a real index in wikiLinkOneRule.test.ts.
const files = [
  { title: "Alpha", path: "Alpha.md" },
  { title: "Beta", path: "Notes/Beta.md" },
  { title: "Offer letter", path: "Notes/Letter.md" },
  { title: "Tasks.base", path: "Tasks.base" },
];

describe("isWikiTargetResolved", () => {
  const set = buildWikiTargetSet(files);

  it("resolves by file name (case-insensitive)", () => {
    expect(isWikiTargetResolved("Alpha", set)).toBe(true);
    expect(isWikiTargetResolved("alpha", set)).toBe(true);
  });

  it("resolves a folder path via the .md suffix, and a note anywhere by its name", () => {
    expect(isWikiTargetResolved("Notes/Beta", set)).toBe(true); // matches path Notes/Beta.md
    expect(isWikiTargetResolved("Beta", set)).toBe(true); // the file's name, wherever it lies
  });

  it("resolves a note with a title of its own by its file name and by that title", () => {
    expect(isWikiTargetResolved("Letter", set)).toBe(true);
    expect(isWikiTargetResolved("offer letter", set)).toBe(true);
  });

  it("resolves a .base target by its name with the extension — without it the target names a note", () => {
    expect(isWikiTargetResolved("Tasks.base", set)).toBe(true);
    expect(isWikiTargetResolved("Tasks", set)).toBe(false);
  });

  it("reads a target that names a path from the note it stands in", () => {
    expect(isWikiTargetResolved("./Beta", set, "Notes/Host.md")).toBe(true);
    expect(isWikiTargetResolved("./Beta", set, "Host.md")).toBe(false);
    expect(isWikiTargetResolved("../Alpha", set, "Notes/Host.md")).toBe(true);
    expect(isWikiTargetResolved("/Notes/Beta", set, "Elsewhere/Host.md")).toBe(true);
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
