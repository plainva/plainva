import { describe, expect, it } from "vitest";
import { analyzeNoteOutline, analyzeNoteSource, noteSlugger, prepareReaderSource, selectNoteFragment } from "../src/noteSource.js";
import { mintAnchorMarkerId, openAnchorMarker, closeAnchorMarker } from "../src/workspace/commentAnchor.js";

describe("one original source for anchors and transclusion", () => {
  it("ends a section at its next peer, retaining deeper headings, CRLF and Unicode", () => {
    const text = "---\r\ntitle: 🦊\r\n---\r\n# Start\r\n## Über\r\nÄ 😀\r\n### Detail\r\nBody\r\n## Next\r\nOther";
    const selected = selectNoteFragment(text, "#Über");
    expect(selected).toMatchObject({ status: "found", kind: "heading", range: { line: 5 } });
    if (selected.status === "found") expect(selected.text).toBe("## Über\r\nÄ 😀\r\n### Detail\r\nBody\r\n");
  });

  it("resolves whole paragraphs, list items and a table with a standalone id", () => {
    const text = "First line\nsoft break ^paragraph\n\n- item\n  continuation ^item\n- other\n\n| A |\n| - |\n| B |\n\n^table\n";
    expect(selectNoteFragment(text, "^paragraph")).toMatchObject({ text: "First line\nsoft break ^paragraph", range: { line: 1 } });
    expect(selectNoteFragment(text, "^item")).toMatchObject({ text: "- item\n  continuation ^item", range: { line: 4 } });
    expect(selectNoteFragment(text, "^table")).toMatchObject({ text: "| A |\n| - |\n| B |" });
  });

  it("ignores code ids/headings and respects fence character and length", () => {
    const text = "````md\n# No\ntext ^no\n```\n# Still no\n````\n\n   ~~~\n# No either\n   ~~~\n\n# Yes\n\n`hidden ^inline`";
    expect(analyzeNoteSource(text).headings.map((h) => h.text)).toEqual(["Yes"]);
    expect(selectNoteFragment(text, "^no")).toEqual({ status: "missing" });
    expect(selectNoteFragment(text, "^inline")).toEqual({ status: "missing" });
  });

  it("reports duplicate targets and allows explicit slugs and heading ancestry", () => {
    const text = "# One\n## Same\na\n# Two\n## Same\nb\n\nfirst ^id\n\nsecond ^id";
    expect(selectNoteFragment(text, "#Same")).toEqual({ status: "ambiguous" });
    expect(selectNoteFragment(text, "#same-1")).toMatchObject({ status: "found", range: { line: 5 } });
    expect(selectNoteFragment(text, "#One#Same")).toMatchObject({ status: "found", range: { line: 2 } });
    expect(selectNoteFragment(text, "^id")).toEqual({ status: "ambiguous" });
    const slug = noteSlugger();
    expect([slug("a"), slug("a-1"), slug("a")]).toEqual(["a", "a-1", "a-2"]);
  });

  it("maps marked text after frontmatter, wiki aliases, CRLF and relative dates exactly", () => {
    const id = mintAnchorMarkerId("");
    const raw = `---\r\ntitle: x\r\n---\r\n[[Long Target|Über 😀]] @2026-09-14\r\n${openAnchorMarker(id)}Exact 😀 text${closeAnchorMarker(id)}\r\n`;
    const prepared = prepareReaderSource(raw, { formatDate: () => "Today" });
    const from = raw.indexOf("Exact"), to = from + "Exact 😀 text".length;
    expect(prepared.text.slice(prepared.toRendered(from), prepared.toRendered(to, "end"))).toBe("Exact 😀 text");
    expect(prepared.toOriginal(prepared.toRendered(from))).toBe(from);
    const alias = raw.indexOf("Über");
    expect(prepared.text.slice(prepared.toRendered(alias), prepared.toRendered(alias + "Über 😀".length, "end"))).toBe("Über 😀");
    expect(prepared.text).not.toContain("title:");
    expect(prepared.text).not.toContain("\r");
  });

  describe("a note that starts with a byte order mark", () => {
    // Built at run time: the character is not typed into this file.
    const MARK = String.fromCharCode(0xfeff);
    const NOTES = [
      "---\ntitle: x\n---\n# Start\n\nText ^block\n\n## Über\nÄ 😀\n### Detail\nBody\n## Next\n- item\n  more ^item\n",
      "# Start\r\n\r\nText ^block\r\n\r\n## Über\r\nÄ 😀\r\n### Detail\r\nBody\r\n## Next\r\nOther\r\n",
      "# Only a heading",
      "- [ ] a task first\n\n# Then a heading\n",
    ];
    const further = <T extends { from: number; to: number }>(range: T): T => ({ ...range, from: range.from + 1, to: range.to + 1 });

    it("is read where it stands: every place one character further, every line the same", () => {
      for (const note of NOTES) {
        const marked = MARK + note;
        const plain = analyzeNoteSource(note), read = analyzeNoteSource(marked);
        // The parser counts from behind the mark. Its offsets used to be laid
        // on the note as they came: each block began one character early —
        // for a block at the start of a line, on the line above it.
        expect(read.headings, note).toEqual(plain.headings.map(further));
        expect(read.blocks, note).toEqual(plain.blocks.map((b) => ({ ...further(b), markerFrom: b.markerFrom + 1, markerTo: b.markerTo + 1 })));
        for (const heading of read.headings) expect(marked.slice(heading.from, heading.to)).toBe(note.slice(heading.from - 1, heading.to - 1));
        expect(analyzeNoteOutline(marked), note).toEqual(
          analyzeNoteOutline(note).map((node) => ({ ...further(node), ...(node.items ? { items: node.items.map(further) } : {}) })));
      }
    });

    it("hands out the same section and the same block", () => {
      for (const note of NOTES) {
        for (const anchor of ["#Über", "#Start", "#Then a heading", "^block", "^item"]) {
          const plain = selectNoteFragment(note, anchor), read = selectNoteFragment(MARK + note, anchor);
          expect(read.status, `${anchor} in ${note}`).toBe(plain.status);
          if (plain.status !== "found" || read.status !== "found") continue;
          expect(read.text, `${anchor} in ${note}`).toBe(plain.text);
          expect([read.range.from, read.range.to, read.range.line]).toEqual([plain.range.from + 1, plain.range.to + 1, plain.range.line]);
        }
      }
      // The whole note is the whole file; what is read of it has no mark (below).
      expect(selectNoteFragment(MARK + "# A\n")).toMatchObject({ kind: "note", text: MARK + "# A\n" });
    });

    it("is read without its mark, and nothing is left of its properties block", () => {
      for (const note of NOTES) {
        const plain = prepareReaderSource(note), read = prepareReaderSource(MARK + note);
        // The block was cut out one character early: the mark went with it, and
        // the last `-` of the closing fence stayed as the first line of the text.
        expect(read.text, note).toBe(plain.text);
        for (let at = 0; at <= note.length; at++) {
          expect(read.toRendered(at + 1), `${at} in ${note}`).toBe(plain.toRendered(at));
          expect(read.toRendered(at + 1, "end"), `${at} in ${note}`).toBe(plain.toRendered(at, "end"));
        }
        for (let at = 1; at <= plain.text.length; at++) {
          expect(read.toOriginal(at), `${at} in ${note}`).toBe(plain.toOriginal(at) + 1);
          expect(read.toOriginal(at, "end"), `${at} in ${note}`).toBe(plain.toOriginal(at, "end") + 1);
        }
      }
    });
  });

  it("does not rewrite wiki syntax or dates in code, destinations and escaped prose", () => {
    const raw = "`[[code]] @2026-09-14`\n\n```\n![[literal]]\n```\n\n\\[[escaped]] [label](https://example.test/@2026-09-14)\n\n![[real#Heading]]";
    const result = prepareReaderSource(raw, { formatDate: () => "Today" }).text;
    expect(result).toContain("`[[code]] @2026-09-14`");
    expect(result).toContain("![[literal]]");
    expect(result).toContain("\\[[escaped]]");
    expect(result).toContain("https://example.test/@2026-09-14");
    expect(result).toContain("wiki-embed://real%23Heading");
  });
});
