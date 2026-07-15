import { describe, it, expect } from "vitest";
import { relativeLinkCandidates } from "./relativeLink";

// Markdown relative links (incl. generated index.md listings) never opened on
// mobile because resolveWikiTarget matched by note TITLE only (maintainer,
// 2026-07-15). The path grammar now lives here, pure and covered directly.
describe("relativeLinkCandidates", () => {
  it("returns nothing for a bare wiki name (those resolve by title)", () => {
    expect(relativeLinkCandidates("My Note")).toEqual([]);
    expect(relativeLinkCandidates("My Note", "Folder/Host.md")).toEqual([]);
    expect(relativeLinkCandidates("Note#heading")).toEqual([]);
  });

  it("resolves a vault-root-relative markdown link", () => {
    expect(relativeLinkCandidates("Projekte/index.md", "index.md")).toContain("Projekte/index.md");
  });

  it("resolves against the host note's folder first, then the vault root", () => {
    const c = relativeLinkCandidates("Beispielprojekt.md", "Projekte/index.md");
    expect(c[0]).toBe("Projekte/Beispielprojekt.md");
    expect(c).toContain("Beispielprojekt.md");
  });

  it("adds .md and .base candidates when the target has no extension", () => {
    expect(relativeLinkCandidates("Notes/Foo", "index.md")).toEqual([
      "Notes/Foo",
      "Notes/Foo.md",
      "Notes/Foo.base",
    ]);
  });

  it("normalizes ./ and ../ segments relative to the host folder", () => {
    expect(relativeLinkCandidates("../Areas/Health.md", "Projects/index.md")).toContain("Areas/Health.md");
    expect(relativeLinkCandidates("./sub/x.md", "a/b/host.md")).toContain("a/b/sub/x.md");
  });

  it("percent-decodes encoded spaces from generated links", () => {
    expect(relativeLinkCandidates("Meine%20Notiz.md", "index.md")).toContain("Meine Notiz.md");
  });

  it("strips an #anchor and |alias before building candidates", () => {
    expect(relativeLinkCandidates("Projekte/index.md#Ziel", "index.md")).toContain("Projekte/index.md");
    expect(relativeLinkCandidates("Projekte/index.md|Label", "index.md")).toContain("Projekte/index.md");
  });

  it("emits no duplicate candidates when the host folder is the vault root", () => {
    const c = relativeLinkCandidates("Projekte/index.md", "index.md");
    expect(new Set(c).size).toBe(c.length);
  });
});
