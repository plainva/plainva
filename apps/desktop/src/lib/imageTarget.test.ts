import { describe, expect, it } from "vitest";
import { findImageEmbeds, imageBasename, imageCandidates, isImageTarget, parseWikiImageTarget } from "@plainva/ui";

/** TestFlight feedback Build 91, P3: one resolution rule for image embeds. */
describe("imageTarget", () => {
  it("parses Obsidian's width and alt suffixes", () => {
    expect(parseWikiImageTarget("foto.png")).toEqual({ target: "foto.png", width: null, alt: null });
    expect(parseWikiImageTarget("foto.png|300")).toEqual({ target: "foto.png", width: 300, alt: null });
    expect(parseWikiImageTarget("foto.png|300x200")).toEqual({ target: "foto.png", width: 300, alt: null });
    expect(parseWikiImageTarget("foto.png|Ein Foto")).toEqual({ target: "foto.png", width: null, alt: "Ein Foto" });
    expect(parseWikiImageTarget("Anhänge/foto.png#x|200").target).toBe("Anhänge/foto.png");
    expect(isImageTarget("foto.png|300")).toBe(false);
    expect(isImageTarget(parseWikiImageTarget("foto.png|300").target)).toBe(true);
  });

  it("tries the literal path, beside the note, the attachment folder — in that order, once each", () => {
    expect(imageCandidates("foto.png", { notePath: "Tagebuch/26.08.31.md", attachmentFolder: "Attachments" })).toEqual([
      "foto.png",
      "Tagebuch/foto.png",
      "Attachments/foto.png",
    ]);
    // A full path needs no folder guessing beyond the note's own.
    expect(imageCandidates("Anhänge/foto.png", { notePath: "Tagebuch/x.md", attachmentFolder: "/Anhänge/" })).toEqual([
      "Anhänge/foto.png",
      "Tagebuch/Anhänge/foto.png",
    ]);
    // Root note, no attachment folder configured.
    expect(imageCandidates("foto.png", { notePath: "x.md" })).toEqual(["foto.png"]);
  });

  it("refuses targets that escape the vault and normalises to NFC", () => {
    expect(imageCandidates("../../etc/passwd.png", { notePath: "a/b.md" })).toEqual([]);
    expect(imageCandidates("C:/x.png", { notePath: "a/b.md" })).toEqual([]);
    const nfd = "Anha\u0308nge/foto.png";
    expect(imageCandidates(nfd, { notePath: "x.md" })[0]).toBe("Anhänge/foto.png".normalize("NFC"));
    expect(imageBasename("../x.png")).toBeNull();
    expect(imageBasename("Anhänge/foto.png")).toBe("foto.png");
  });

  it("finds each embed on its own — a link after it is not swallowed", () => {
    const line = "- foto ![[foto.png]] und [Plainva](https://plainva.com) und ![[foto.png|300]] ![alt](pics/a.png \"t\")";
    const found = findImageEmbeds(line);
    expect(found.map((f) => [f.target, f.width, f.syntax])).toEqual([
      ["foto.png", null, "wiki"],
      ["foto.png", 300, "wiki"],
      ["pics/a.png", null, "markdown"],
    ]);
    expect(line.slice(found[0].start, found[0].end)).toBe("![[foto.png]]");
    expect(line.slice(found[1].start, found[1].end)).toBe("![[foto.png|300]]");
  });

  it("leaves note embeds to the note-embed plugin", () => {
    expect(findImageEmbeds("![[Some Note]] ![[Other#heading]]")).toEqual([]);
  });
});
