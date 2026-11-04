import { describe, expect, it } from "vitest";
import { CHUNK_BUDGET, chunkNote, chunkTextWeight, SPACELESS_WEIGHT } from "./chunks.js";

const body = (text: string) => text.split("\n\n").slice(1).join("\n\n");

describe("chunkNote", () => {
  it("leads every chunk with the title and its heading chain", () => {
    const content = "Intro line.\n\n## Costs\n\nRent is high.\n\n### 2026\n\nWe pay more.\n";
    const chunks = chunkNote("Budget", content);
    expect(chunks.map((chunk) => chunk.text)).toEqual([
      "Budget\n\nIntro line.",
      "Budget › Costs\n\nRent is high.",
      "Budget › Costs › 2026\n\nWe pay more.",
    ]);
    expect(chunks.map((chunk) => chunk.chain)).toEqual(["", "Costs", "Costs > 2026"]);
    expect(chunks.map((chunk) => chunk.ordinal)).toEqual([0, 1, 2]);
  });

  it("does not repeat a first heading that is the title", () => {
    const chunks = chunkNote("Budget", "# Budget\n\nOverview.\n\n## Costs\n\nRent.");
    expect(chunks.map((chunk) => chunk.text)).toEqual(["Budget\n\nOverview.", "Budget › Costs\n\nRent."]);
    expect(chunks[1]!.chain).toBe("Budget > Costs");
  });

  it("takes no heading from fenced code and keeps the code", () => {
    const content = "## Setup\n\n```sh\n# not a heading\n```\n\nDone.";
    const chunks = chunkNote("Guide", content);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.text).toBe("Guide › Setup\n\n```sh\n# not a heading\n```\n\nDone.");
  });

  it("reads the body without its frontmatter and points into the whole content", () => {
    const content = "---\ntags: [a]\n---\nFirst paragraph.\n\nSecond one.";
    const [chunk] = chunkNote("Note", content);
    expect(chunk!.text).toBe("Note\n\nFirst paragraph.\n\nSecond one.");
    expect(content.slice(chunk!.from, chunk!.to)).toBe("First paragraph.\n\nSecond one.");
  });

  it("packs paragraphs up to the budget", () => {
    const paragraph = "word ".repeat(100).trim(); // 499 characters
    const content = [paragraph, paragraph, paragraph].join("\n\n");
    const chunks = chunkNote("T", content);
    expect(chunks).toHaveLength(2);
    expect(body(chunks[0]!.text)).toBe(`${paragraph}\n\n${paragraph}`);
    expect(body(chunks[1]!.text)).toBe(paragraph);
  });

  // The spike cut a long paragraph at 2,400 characters; nothing may be lost.
  it("splits a paragraph heavier than the budget at sentence ends, losing nothing", () => {
    const sentence = "This sentence is exactly fifty characters long ok. ";
    const paragraph = sentence.repeat(60).trim();
    const chunks = chunkNote("T", paragraph);
    expect(chunks.length).toBeGreaterThan(2);
    for (const chunk of chunks) {
      expect(chunkTextWeight(body(chunk.text))).toBeLessThanOrEqual(CHUNK_BUDGET);
      expect(body(chunk.text).endsWith(".")).toBe(true);
    }
    expect(chunks.map((chunk) => body(chunk.text)).join(" ")).toBe(paragraph);
  });

  it("cuts at a space when there is no sentence end", () => {
    const paragraph = "lorem ".repeat(400).trim();
    const chunks = chunkNote("T", paragraph);
    for (const chunk of chunks) expect(body(chunk.text)).toMatch(/^lorem( lorem)*$/);
    expect(chunks.map((chunk) => body(chunk.text)).join(" ")).toBe(paragraph);
  });

  // 0.5-0.8 tokens per Chinese or Japanese character against 0.22-0.32 per letter.
  it("weighs characters of scripts without spaces three times", () => {
    expect(chunkTextWeight("abc")).toBe(3);
    expect(chunkTextWeight("会議")).toBe(2 * SPACELESS_WEIGHT);
    const fits = "会".repeat(CHUNK_BUDGET / SPACELESS_WEIGHT);
    expect(chunkNote("T", fits)).toHaveLength(1);
    const japanese = "会議の議事録を読みました。".repeat(40); // 520 characters, weight 1,560
    const chunks = chunkNote("T", japanese);
    expect(chunks).toHaveLength(2);
    expect(body(chunks[0]!.text).endsWith("。")).toBe(true);
    expect(chunks.map((chunk) => body(chunk.text)).join("")).toBe(japanese);
  });

  // No spaces and no sentence ends: hard cuts, placed so the budget ends
  // between a character and its mark (and inside an emoji's surrogate pair).
  it("never parts a character from its combining mark or a surrogate pair", () => {
    for (const text of ["ก" + "ก่".repeat(700), "x" + "😀️".repeat(700)]) {
      const chunks = chunkNote("T", text);
      expect(chunks.length).toBeGreaterThan(1);
      for (const chunk of chunks) expect(body(chunk.text)).not.toMatch(/^[\p{M}\uDC00-\uDFFF]|[\uD800-\uDBFF]$/u);
      expect(chunks.map((chunk) => body(chunk.text)).join("")).toBe(text);
    }
  });

  it("gives equal text an equal hash, so an edit touches only its chunk", () => {
    const before = "## A\n\nAlpha.\n\n## B\n\nBeta.";
    const after = "## A\n\nAlpha.\n\n## B\n\nBeta, revised.";
    const [a1, b1] = chunkNote("T", before);
    const [a2, b2] = chunkNote("T", after);
    expect(a2!.hash).toBe(a1!.hash);
    expect(b2!.hash).not.toBe(b1!.hash);
    expect(a1!.hash).toMatch(/^[0-9a-f]{32}$/);
    // A new title is new text: every chunk changes.
    expect(chunkNote("Renamed", before)[0]!.hash).not.toBe(a1!.hash);
  });

  it("reads line breaks the same whatever the note was saved with", () => {
    const lf = chunkNote("T", "## A\n\nOne\ntwo.\n\nThree.");
    const crlf = chunkNote("T", "## A\r\n\r\nOne\r\ntwo.\r\n\r\nThree.");
    expect(crlf.map((chunk) => chunk.text)).toEqual(lf.map((chunk) => chunk.text));
  });

  it("makes a note without text one chunk of its title", () => {
    expect(chunkNote("Empty note", "---\na: 1\n---\n\n   \n")).toEqual([
      expect.objectContaining({ ordinal: 0, text: "Empty note", chain: "" }),
    ]);
    expect(chunkNote("", "")).toEqual([]);
    expect(chunkNote("Only headings", "# One\n\n## Two\n")).toHaveLength(1);
  });
});
