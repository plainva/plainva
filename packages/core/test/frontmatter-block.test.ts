import { describe, expect, it } from "vitest";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { frontmatterSpan, noteBodyOf } from "../src/frontmatter-surgical.js";
import { composeNote, yamlLinesOf } from "../src/frontmatter-block.js";
import { FRONTMATTER_FORMS, generatedNotes, hasLoneCarriageReturn } from "./fixtures/frontmatterForms.js";

/**
 * The one definition of a note's properties block (finding 2026-10-07).
 *
 * The form that started it is `---` directly on `---`: what the writers left
 * behind when a block lost its last entry, and what no pattern in the code
 * took for a block afterwards.
 */

describe("frontmatterSpan", () => {
  it("gives the block by its offsets", () => {
    const note = "---\ntitle: X\ntags: [a]\n---\n# Body\n";
    const span = frontmatterSpan(note)!;
    expect(span.yaml).toBe("title: X\ntags: [a]");
    expect(note.slice(span.yamlStart, span.yamlStart + span.yaml.length)).toBe(span.yaml);
    expect(note.slice(span.closeAt)).toBe("---\n# Body\n");
    expect(note.slice(span.end)).toBe("# Body\n");
  });

  it("gives the same block with CRLF line endings, without the line break that ends the YAML", () => {
    const note = "---\r\ntitle: X\r\ntags: [a]\r\n---\r\n# Body\r\n";
    const span = frontmatterSpan(note)!;
    expect(span.yaml).toBe("title: X\r\ntags: [a]");
    expect(note.slice(span.closeAt)).toBe("---\r\n# Body\r\n");
    expect(note.slice(span.end)).toBe("# Body\r\n");
  });

  it("takes `---` directly on `---` for a block without entries", () => {
    for (const [note, body] of [
      ["---\n---\n# Single\n", "# Single\n"],
      ["---\r\n---\r\n# Single\r\n", "# Single\r\n"],
      ["---\n---", ""],
      ["---\n---\n", ""],
      ["---\r\n---", ""],
      ["---\n---\r\nText", "Text"],
    ] as const) {
      const span = frontmatterSpan(note);
      expect(span, JSON.stringify(note)).not.toBeNull();
      expect(span!.yaml).toBe("");
      // No line between the fences: the closing one starts where the YAML would.
      expect(span!.closeAt).toBe(span!.yamlStart);
      expect(note.slice(span!.end)).toBe(body);
    }
  });

  it("takes fences with only blank lines between them for a block without entries, too", () => {
    const span = frontmatterSpan("---\n\n---\nBody")!;
    expect(span.yaml).toBe("");
    expect(span.closeAt).toBe(span.yamlStart + 1);
    expect("---\n\n---\nBody".slice(span.end)).toBe("Body");
    expect(frontmatterSpan("---\r\n\r\n\r\n---\r\nBody")!.yaml).toBe("\r\n");
  });

  it("closes an empty block on the very next line, never on a rule further down", () => {
    // What every pattern did before: the lazy group ran across the note's text
    // up to the thematic break and handed that text out as YAML.
    for (const eol of ["\n", "\r\n"]) {
      const body = ["", "title: not a property", "", "---", "", "more text", ""].join(eol);
      const note = `---${eol}---${eol}${body}`;
      const span = frontmatterSpan(note)!;
      expect(span.yaml).toBe("");
      expect(note.slice(span.end)).toBe(body);
    }
    // A rule right behind the block is the first line of the text.
    expect(noteBodyOf("---\n---\n---\nText\n")).toBe("---\nText\n");
  });

  it("closes a block on the first closing fence, whatever follows", () => {
    const note = "---\na: 1\n---\nText\n\n---\n\nMore\n";
    expect(frontmatterSpan(note)!.yaml).toBe("a: 1");
    expect(noteBodyOf(note)).toBe("Text\n\n---\n\nMore\n");
  });

  it("finds no block where the note has none", () => {
    for (const note of [
      "",
      "# Heading\n",
      "# Heading\n\n---\nnot: frontmatter\n---\n",
      "\n---\na: 1\n---\n", // not on the first line
      " ---\na: 1\n---\n", // indented
      "---", // a rule
      "---\n", // a rule
      "---\na: 1\n", // never closed
      "---\na: 1\n ---\n", // the closing fence is indented
      "---\na: 1\n----\n", // four dashes close nothing
      "----\na: 1\n----\n",
      "---a: 1\n---\n",
      "---\na: 1\n...\n", // the YAML document end is not a fence
    ]) {
      expect(frontmatterSpan(note), JSON.stringify(note)).toBeNull();
      expect(noteBodyOf(note)).toBe(note);
    }
  });

  it("allows blanks behind a fence, as the Markdown parser does", () => {
    const note = "--- \na: 1\n---\t \nBody\n";
    const span = frontmatterSpan(note)!;
    expect(span.yaml).toBe("a: 1");
    expect(note.slice(span.end)).toBe("Body\n");
    expect(frontmatterSpan("---  \n---  \nBody")!.yaml).toBe("");
    expect(frontmatterSpan("---\na: 1\n---  ")!.end).toBe("---\na: 1\n---  ".length);
  });

  it("reads a block behind a byte order mark, with offsets into the note as it is", () => {
    const note = "\uFEFF---\na: 1\n---\nBody\n";
    const span = frontmatterSpan(note)!;
    expect(span.yamlStart).toBe(5);
    expect(span.yaml).toBe("a: 1");
    expect(note.slice(span.end)).toBe("Body\n");
    expect(frontmatterSpan("\uFEFF---\n---\nBody")!.yaml).toBe("");
    expect(frontmatterSpan("\uFEFF# Heading\n")).toBeNull();
  });

  it("ends a line at a carriage return of its own, as the Markdown parser does", () => {
    // Every line of a file from a classic Mac ends in one. The definition read
    // such a note as one long line and found no block in it.
    const note = "---\rtitle: X\rtags: [a]\r---\r# Body\r";
    const span = frontmatterSpan(note)!;
    expect(note.slice(span.closeAt)).toBe("---\r# Body\r");
    expect(note.slice(span.end)).toBe("# Body\r");
    expect(noteBodyOf(note)).toBe("# Body\r");
    // The YAML comes with the line breaks the YAML library reads, and with the
    // length of the stretch it stands for: offsets counted on it hold.
    expect(span.yaml).toBe("title: X\ntags: [a]");
    expect(note.slice(span.yamlStart, span.yamlStart + span.yaml.length)).toBe("title: X\rtags: [a]");
  });

  it("takes fences that end in a carriage return of their own for a block without entries", () => {
    for (const [note, body] of [
      ["---\r---\r# Single\r", "# Single\r"],
      ["---\r---", ""],
      ["---\r---\r", ""],
      ["---\r---\nText", "Text"],
      ["---\n---\rText", "Text"],
      ["--- \r---\t\rText", "Text"],
    ] as const) {
      const span = frontmatterSpan(note);
      expect(span, JSON.stringify(note)).not.toBeNull();
      expect(span!.yaml).toBe("");
      expect(span!.closeAt).toBe(span!.yamlStart);
      expect(note.slice(span!.end)).toBe(body);
    }
    // Blank lines between the fences: one gives no YAML, two give the break between them.
    expect(frontmatterSpan("---\r\r---\rBody")!.yaml).toBe("");
    expect(frontmatterSpan("---\r\r\r---\rBody")!.yaml).toBe("\n");
    // A rule right behind the block is the first line of the text.
    expect(noteBodyOf("---\r---\r---\rText\r")).toBe("---\rText\r");
  });

  it("reads a stray carriage return among other line ends as the end of a line", () => {
    // The closing fence stands behind one: for the parser the block ends
    // there, and the definition read on to the end of the note.
    expect(frontmatterSpan("---\na: 1\r---\nBody\n")!.yaml).toBe("a: 1");
    expect(noteBodyOf("---\na: 1\r---\nBody\n")).toBe("Body\n");
    expect(noteBodyOf("---\na: 1\n---\rBody\n")).toBe("Body\n");
    expect(frontmatterSpan("---\na: 1\rb: 2\n---\nBody\n")!.yaml).toBe("a: 1\nb: 2");
    // `\r\n` stays ONE line break and stays as it is in the YAML.
    expect(frontmatterSpan("---\r\na: 1\rb: 2\r\nc: 3\r\n---\r\nBody")!.yaml).toBe("a: 1\nb: 2\r\nc: 3");
    // `\n\r` and `\r\r\n` are two: an empty line stands between the fences.
    for (const note of ["---\n\r---\nBody", "---\r\r\n---\nBody"]) {
      const span = frontmatterSpan(note)!;
      expect(span.yaml, JSON.stringify(note)).toBe("");
      expect(span.closeAt).toBe(span.yamlStart + (note.startsWith("---\r\r\n") ? 2 : 1));
      expect(note.slice(span.end)).toBe("Body");
    }
  });

  it("finds no block in a note without one, whatever ends its lines", () => {
    for (const note of [
      "---\r", // a rule
      "---\ra: 1\r", // never closed
      "\r---\ra: 1\r---\r", // not on the first line
      " ---\ra: 1\r---\r", // indented
      "---\ra: 1\r ---\r", // the closing fence is indented
      "---\ra: 1\r----\r", // four dashes close nothing
      "---a: 1\r---\r",
      "---\ra: 1\r...\r", // the YAML document end is not a fence
      "# Heading\r\r---\rnot: frontmatter\r---\r",
    ]) {
      expect(frontmatterSpan(note), JSON.stringify(note)).toBeNull();
      expect(noteBodyOf(note)).toBe(note);
    }
  });

  // What ends line `i` of a long note. The other kind every thousand lines, and
  // the two in turns: each is looked for again only once it has been passed.
  const LINE_ENDS: ReadonlyArray<readonly [string, (i: number) => string]> = [
    ["line feeds", () => "\n"],
    ["carriage returns and line feeds", () => "\r\n"],
    ["carriage returns of their own", () => "\r"],
    ["a stray carriage return every thousand lines", (i) => (i % 1_000 === 0 ? "\r" : "\n")],
    ["a stray line feed every thousand lines", (i) => (i % 1_000 === 0 ? "\n" : "\r")],
    ["both in turns", (i) => (i % 2 === 0 ? "\r" : "\n")],
  ];

  it.each(LINE_ENDS)("reads a long note without a closing fence in one pass: %s", (_name, lineEnd) => {
    const parts = ["---", lineEnd(0)];
    for (let i = 1; i <= 200_000; i++) parts.push("a line of text that is not a fence", lineEnd(i));
    const note = parts.join("");
    const started = performance.now();
    expect(frontmatterSpan(note)).toBeNull();
    expect(performance.now() - started).toBeLessThan(2_000);
  });
});

describe("yamlLinesOf", () => {
  it("sets a line feed where a line ends in a carriage return of its own, and keeps the length", () => {
    expect(yamlLinesOf("a: 1\rb: 2")).toBe("a: 1\nb: 2");
    expect(yamlLinesOf("a:\r  - x\r  - y")).toBe("a:\n  - x\n  - y");
    expect(yamlLinesOf("\r")).toBe("\n");
    expect(yamlLinesOf("a: 1\rb: 2\r\nc: 3\r")).toBe("a: 1\nb: 2\r\nc: 3\n");
    expect(yamlLinesOf("a: 1\r\r\nb: 2")).toBe("a: 1\n\r\nb: 2");
  });

  it("hands a block with other line ends back as it is", () => {
    for (const yaml of ["", "a: 1", "a: 1\nb: 2", "a: 1\r\nb: 2", "a: |\r\n  one\r\n  two\r\n"]) {
      expect(yamlLinesOf(yaml)).toBe(yaml);
    }
  });
});

/**
 * The definition against the parser that fills the index and the properties
 * panel. Where the two disagree, the app shows properties its writers cannot
 * find — the second block on top is what follows.
 */
describe("frontmatterSpan and the Markdown parser", () => {
  const parser = unified().use(remarkParse).use(remarkGfm).use(remarkFrontmatter, ["yaml"]);

  /** The definition's answer for a note against the parser's; whether the note has a block. */
  const agreesOn = (note: string): boolean => {
    // The parser drops a leading byte order mark before it counts offsets.
    const shift = note.charCodeAt(0) === 0xfeff ? 1 : 0;
    const first = parser.parse(note).children[0] as { type: string; value?: string; position?: { end: { offset?: number } } } | undefined;
    const span = frontmatterSpan(note);

    if (first?.type !== "yaml") {
      expect(span, JSON.stringify(note)).toBeNull();
      return false;
    }
    expect(span, JSON.stringify(note)).not.toBeNull();
    // The parser hands the YAML out as it stands; the definition, with the
    // line breaks the YAML library reads — and nothing else differs.
    expect(span!.yaml, JSON.stringify(note)).toBe(yamlLinesOf(first.value!));
    expect(yamlLinesOf(note.slice(span!.yamlStart, span!.yamlStart + span!.yaml.length)), JSON.stringify(note)).toBe(span!.yaml);
    // The parser's node ends behind the closing fence; the text starts behind its line break.
    const fenceEndsAt = first.position!.end.offset! + shift;
    const lineBreak = note.startsWith("\r\n", fenceEndsAt) ? 2 : note[fenceEndsAt] === "\n" || note[fenceEndsAt] === "\r" ? 1 : 0;
    expect(span!.end, JSON.stringify(note)).toBe(fenceEndsAt + lineBreak);
    return true;
  };

  it.each(FRONTMATTER_FORMS.map((form) => [JSON.stringify(form), form] as const))("agrees on %s", (_label, form) => {
    agreesOn(form);
  });

  // The table names the forms someone thought of. This run asks about the
  // ones nobody did: every line of a note with a line ending of its own.
  it("agrees on 20 000 generated notes, whatever ends their lines", () => {
    const seen = { none: 0, block: 0, classicMac: 0, classicMacBlock: 0, windows: 0, mark: 0 };
    for (const note of generatedNotes(20261011, 20_000)) {
      const block = agreesOn(note);
      if (block) seen.block++;
      else seen.none++;
      if (hasLoneCarriageReturn(note)) {
        seen.classicMac++;
        if (block) seen.classicMacBlock++;
      }
      if (note.includes("\r\n")) seen.windows++;
      if (note.charCodeAt(0) === 0xfeff) seen.mark++;
    }
    // The generator reaches every case, or the run proves nothing.
    expect(seen.none).toBeGreaterThan(5_000);
    expect(seen.block).toBeGreaterThan(5_000);
    expect(seen.classicMac).toBeGreaterThan(5_000);
    expect(seen.classicMacBlock).toBeGreaterThan(2_000);
    expect(seen.windows).toBeGreaterThan(5_000);
    expect(seen.mark).toBeGreaterThan(1_000);
  }, 120_000);
});

/**
 * The definition against the pattern it replaces
 * (`docs/engineering/Text_Scanning.md`, rule 3). Some thirty places carried
 * that pattern or a search built to the same effect; their own tests ran
 * unchanged, and this run says why they could: on a note the old pattern read
 * right, the definition gives the same block. It answers differently only where
 * the old pattern was wrong — the three cases named below.
 *
 * A fourth is not in this run, because its notes carry none: a carriage return
 * of its own. The old pattern read on past one; what the definition does there
 * is held against the Markdown parser, above.
 */
describe("frontmatterSpan against the pattern it replaces", () => {
  const OLD = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;
  const LINES = ["---", "---", "---", "--- ", "---\t ", "----", " ---", "---x", "...", "", "", "a: 1", "b: [x, y]", "# Heading", "text --- text", "- item"];
  const lineOf = (note: string, index: number) => note.split(/\r?\n/)[index];
  const isPadded = (line: string | undefined) => line !== undefined && line !== "---" && /^---[ \t]+$/.test(line);

  it("gives the same block on 20 000 generated notes, and another only for the named cases", () => {
    // mulberry32: the same notes on every machine and every run.
    let state = 20261007;
    const next = (below: number) => {
      state = (state + 0x6d2b79f5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) % below;
    };
    const seen = { same: 0, none: 0, emptyBlock: 0, blanks: 0 };

    for (let run = 0; run < 20_000; run++) {
      // Up to seven lines, each with its own line ending; the last may lack
      // one. Two notes in three open with a fence, or few would have a block.
      const count = next(8);
      let note = "";
      for (let i = 0; i < count; i++) {
        const last = i === count - 1;
        const text = i === 0 && next(3) > 0 ? "---" : LINES[next(LINES.length)];
        note += text + (last && next(2) === 0 ? "" : next(4) === 0 ? "\r\n" : "\n");
      }
      const old = OLD.exec(note);
      const span = frontmatterSpan(note);
      const lines = note.split(/\r?\n/);

      // 1. `---` directly on `---`: the old pattern saw no block there, or one
      //    that ran across the text to a later `---`.
      if (lines[0] === "---" && lines[1] === "---") {
        expect(span, JSON.stringify(note)).not.toBeNull();
        expect(span!.yaml).toBe("");
        expect(span!.closeAt).toBe(span!.yamlStart);
        seen.emptyBlock++;
        continue;
      }
      // 2. Blanks behind a fence, which the Markdown parser allows: on the
      //    opening line, or on a line in front of where the old pattern closed.
      const oldClose = old ? note.slice(0, old.index + old[0].length).split(/\r?\n/).length - (/\n$/.test(old[0]) ? 2 : 1) : lines.length;
      const padded = isPadded(lines[0]) || (lines[0] === "---" && lines.slice(1, oldClose).some(isPadded));
      if (padded) {
        seen.blanks++;
        continue;
      }
      // 3. Everything else: the same answer.
      if (!old) {
        expect(span, JSON.stringify(note)).toBeNull();
        seen.none++;
        continue;
      }
      expect(span, JSON.stringify(note)).not.toBeNull();
      expect(span!.yaml).toBe(old[1]);
      expect(span!.end).toBe(old[0].length);
      expect(lineOf(note.slice(span!.closeAt), 0)).toBe("---");
      seen.same++;
    }

    // The generator reaches every case, or the run proves nothing.
    expect(seen.same).toBeGreaterThan(1_000);
    expect(seen.none).toBeGreaterThan(1_000);
    expect(seen.emptyBlock).toBeGreaterThan(500);
    expect(seen.blanks).toBeGreaterThan(500);
  });
});

describe("composeNote", () => {
  const LF = { byteOrderMark: "", eol: "\n" };

  it("puts the properties between their fences", () => {
    expect(composeNote({ ...LF, yaml: "a: 1", body: "Body\n" })).toBe("---\na: 1\n---\nBody\n");
    expect(composeNote({ byteOrderMark: "\uFEFF", eol: "\r\n", yaml: "a: 1", body: "Body\r\n" })).toBe("\uFEFF---\r\na: 1\r\n---\r\nBody\r\n");
  });

  it("makes no block for no properties: the text is the note", () => {
    expect(composeNote({ ...LF, yaml: "", body: "\n# Heading\n" })).toBe("\n# Heading\n");
    expect(composeNote({ ...LF, yaml: "", body: "" })).toBe("");
    expect(composeNote({ byteOrderMark: "\uFEFF", eol: "\n", yaml: "", body: "Body" })).toBe("\uFEFFBody");
  });

  it("keeps an empty pair of fences in front of a text that opens with a `---` line", () => {
    // Without them the text's own rule would open a block at the top of the
    // file, and "Intro" would be read as its YAML.
    const body = "---\nIntro\n---\nRest\n";
    const note = composeNote({ ...LF, yaml: "", body });
    expect(note).toBe("---\n---\n---\nIntro\n---\nRest\n");
    expect(frontmatterSpan(note)!.yaml).toBe("");
    expect(noteBodyOf(note)).toBe(body);
    // A rule with blanks behind it would open one for the parser as well.
    expect(composeNote({ byteOrderMark: "", eol: "\r\n", yaml: "", body: "--- \r\nIntro\r\n" })).toBe("---\r\n---\r\n--- \r\nIntro\r\n");
    // And so would one that ends in a carriage return of its own.
    expect(composeNote({ ...LF, yaml: "", body: "---\rIntro\r---\rRest\r" })).toBe("---\n---\n---\rIntro\r---\rRest\r");
    expect(noteBodyOf("---\n---\n---\rIntro\r---\rRest\r")).toBe("---\rIntro\r---\rRest\r");
    // A rule further down opens nothing.
    expect(composeNote({ ...LF, yaml: "", body: "\n---\nIntro\n" })).toBe("\n---\nIntro\n");
  });
});
