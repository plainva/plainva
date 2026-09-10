import { describe, it, expect } from "vitest";
import { createSlugger, parseHeadings, resolveAnchor, splitLinkAnchor, isBlockAnchor } from "@plainva/ui";

/**
 * Anchor links (issue #92, plan Kalender, Anker-Links, Dependabot 2026-09-10,
 * P5). The core kept the anchor; six places above it threw it away. What is
 * pinned here is the split and the resolution — both spellings, the block
 * reference, duplicates, and what a miss looks like.
 */

const DOC = [
  "---",
  "title: X",
  "---",
  "# Intro",
  "",
  "## Cool Header",
  "",
  "Some text ^abc12",
  "",
  "```",
  "## not a heading",
  "```",
  "",
  "## Über Ärger & Ähnliches",
  "",
  "## Cool Header",
  "",
  "### Setup: Part (one)",
].join("\n");

describe("splitLinkAnchor", () => {
  it("splits at the first # or ^ and keeps the marker", () => {
    expect(splitLinkAnchor("Note#Cool Header")).toEqual({ target: "Note", anchor: "#Cool Header" });
    expect(splitLinkAnchor("Note#^abc12")).toEqual({ target: "Note", anchor: "#^abc12" });
    expect(splitLinkAnchor("Note^abc12")).toEqual({ target: "Note", anchor: "^abc12" });
    expect(splitLinkAnchor("#cool-header")).toEqual({ target: "", anchor: "#cool-header" });
    expect(splitLinkAnchor("other.md#cool-header")).toEqual({ target: "other.md", anchor: "#cool-header" });
    expect(splitLinkAnchor("  Note  ")).toEqual({ target: "Note", anchor: null });
    // A trailing bare marker is not an anchor.
    expect(splitLinkAnchor("Note#")).toEqual({ target: "Note", anchor: null });
  });

  it("tells a block from a heading", () => {
    expect(isBlockAnchor("^abc")).toBe(true);
    expect(isBlockAnchor("#^abc")).toBe(true);
    expect(isBlockAnchor("#abc")).toBe(false);
  });
});

describe("resolveAnchor", () => {
  it("finds a heading by its literal text, case-insensitively (Obsidian)", () => {
    expect(resolveAnchor(DOC, "#Cool Header")).toEqual({ line: 6, slug: "cool-header", kind: "heading" });
    expect(resolveAnchor(DOC, "#cool header")).toEqual({ line: 6, slug: "cool-header", kind: "heading" });
  });

  it("finds a heading by its GitHub slug, punctuation dropped", () => {
    expect(resolveAnchor(DOC, "#cool-header")).toEqual({ line: 6, slug: "cool-header", kind: "heading" });
    expect(resolveAnchor(DOC, "#setup-part-one")).toEqual({ line: 18, slug: "setup-part-one", kind: "heading" });
    expect(resolveAnchor(DOC, "#über-ärger-ähnliches")).toEqual({ line: 14, slug: "über-ärger-ähnliches", kind: "heading" });
  });

  it("reaches the second of two equal headings through the -1 suffix", () => {
    expect(resolveAnchor(DOC, "#cool-header-1")).toEqual({ line: 16, slug: "cool-header-1", kind: "heading" });
  });

  it("takes the innermost part of a nested Obsidian anchor and decodes an encoded one", () => {
    expect(resolveAnchor(DOC, "#Intro#Cool Header")?.line).toBe(6);
    expect(resolveAnchor(DOC, "#Cool%20Header")?.line).toBe(6);
  });

  it("finds a block by its id at the end of a line", () => {
    expect(resolveAnchor(DOC, "^abc12")).toEqual({ line: 8, slug: null, kind: "block" });
    expect(resolveAnchor(DOC, "#^ABC12")).toEqual({ line: 8, slug: null, kind: "block" });
  });

  it("ignores headings inside code fences and says so on a miss", () => {
    expect(resolveAnchor(DOC, "#not a heading")).toBeNull();
    expect(resolveAnchor(DOC, "#nowhere")).toBeNull();
    expect(resolveAnchor(DOC, "^zzz")).toBeNull();
    expect(resolveAnchor(DOC, "#")).toBeNull();
  });
});

describe("the outline's slugs are unique like GitHub's", () => {
  it("numbers repeated headings from the second occurrence", () => {
    expect(parseHeadings(DOC).map((h) => h.slug)).toEqual([
      "intro",
      "cool-header",
      "über-ärger-ähnliches",
      "cool-header-1",
      "setup-part-one",
    ]);
    const slug = createSlugger();
    expect([slug("A"), slug("A"), slug("A"), slug("B")]).toEqual(["a", "a-1", "a-2", "b"]);
  });
});
