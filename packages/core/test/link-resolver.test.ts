import { describe, it, expect } from "vitest";
import { resolveLinkTarget, buildLinkTargetIndex, resolveLinkTargetIndexed, wikiTargetForPath, wikiTargetForFile } from "../src/vault/LinkResolver.js";

describe("LinkResolver", () => {
  const corpus = ["Notes/Alpha.md", "Beta.md", "Deep/Sub/Gamma.md", "Other/Gamma.md", "Tasks.base"];

  it("resolves exact paths, bare names and path-qualified targets", () => {
    expect(resolveLinkTarget("x.md", "Beta", corpus)).toBe("Beta.md");
    expect(resolveLinkTarget("x.md", "Notes/Alpha", corpus)).toBe("Notes/Alpha.md");
    expect(resolveLinkTarget("x.md", "Tasks.base", corpus)).toBe("Tasks.base");
    expect(resolveLinkTarget("x.md", "Missing", corpus)).toBeNull();
  });

  it("prefers the source folder on ambiguous basenames, then the shortest path", () => {
    expect(resolveLinkTarget("Other/src.md", "Gamma", corpus)).toBe("Other/Gamma.md");
    expect(resolveLinkTarget("Elsewhere/src.md", "Gamma", corpus)).toBe("Other/Gamma.md"); // shortest
  });

  it("the indexed variant behaves identically on a shared index", () => {
    const index = buildLinkTargetIndex(corpus);
    expect(resolveLinkTargetIndexed("x.md", "Beta", index)).toBe("Beta.md");
    expect(resolveLinkTargetIndexed("Other/src.md", "Gamma", index)).toBe("Other/Gamma.md");
    expect(resolveLinkTargetIndexed("x.md", "Missing", index)).toBeNull();
  });

  it("resolves explicit non-.md targets (.base) by bare name and suffix — the backlink/rename prerequisite", () => {
    const paths = ["db/Tasks.base", "Notes/A.md"];
    expect(resolveLinkTarget("x.md", "Tasks.base", paths)).toBe("db/Tasks.base");
    expect(resolveLinkTarget("x.md", "db/Tasks.base", paths)).toBe("db/Tasks.base");
    expect(resolveLinkTarget("x.md", "Other.base", paths)).toBeNull();
    // Extension-less targets never hit the raw fallback (notes-only world stays identical).
    expect(resolveLinkTarget("x.md", "Tasks", paths)).toBeNull();
  });

  it("never lets the raw-extension fallback shadow `.md` resolution", () => {
    // "v1.2" looks extension-qualified but must keep resolving to "v1.2.md".
    expect(resolveLinkTarget("x.md", "v1.2", ["v1.2.md"])).toBe("v1.2.md");
  });

  describe("NFC/NFD unicode forms (macOS file names, P3.7)", () => {
    // "Käse": NFC uses U+00E4, NFD uses "a" + U+0308 — byte-different, same text.
    const nfcName = "Käse";
    const nfdName = "Käse";

    it("a typed NFC link resolves a file stored under an NFD name", () => {
      const paths = [`Rezepte/${nfdName}.md`];
      expect(resolveLinkTarget("x.md", nfcName, paths)).toBe(`Rezepte/${nfdName}.md`);
      expect(resolveLinkTarget("x.md", `Rezepte/${nfcName}`, paths)).toBe(`Rezepte/${nfdName}.md`);
    });

    it("an NFD link (pasted from a Mac) resolves an NFC-named file", () => {
      const paths = [`Rezepte/${nfcName}.md`];
      expect(resolveLinkTarget("x.md", nfdName, paths)).toBe(`Rezepte/${nfcName}.md`);
    });

    it("always returns the ORIGINAL stored path form, never a normalized copy", () => {
      const paths = [`${nfdName}.md`];
      const resolved = resolveLinkTarget("x.md", nfcName, paths);
      expect(resolved).toBe(`${nfdName}.md`); // byte-identical to the corpus entry
    });

    it("wikiTargetForPath detects collisions across unicode forms", () => {
      const target = wikiTargetForPath(`A/${nfcName}.md`, [`A/${nfcName}.md`, `B/${nfdName}.md`]);
      expect(target).toBe(`A/${nfcName}`); // qualified, because the basename collides
    });
  });

  describe("wikiTargetForFile (extension-preserving targets, e.g. .base)", () => {
    it("returns the bare file name — WITH extension — when unique vault-wide", () => {
      expect(wikiTargetForFile("Projects/Tasks.base", ["Projects/Tasks.base", "Notes/Tasks.md"])).toBe("Tasks.base");
      expect(wikiTargetForFile("Tasks.base", ["Tasks.base"])).toBe("Tasks.base");
    });

    it("qualifies when another file shares the basename (case-/unicode-insensitive)", () => {
      expect(
        wikiTargetForFile("Projects/Tasks.base", ["Projects/Tasks.base", "Archive/tasks.BASE"])
      ).toBe("Projects/Tasks.base");
      const nfc = "Käse.base";
      const nfd = "Käse.base";
      expect(wikiTargetForFile(`A/${nfc}`, [`A/${nfc}`, `B/${nfd}`])).toBe(`A/${nfc}`);
    });
  });
});
