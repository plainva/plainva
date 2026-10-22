import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LocalVaultAdapter } from "../src/vault/LocalVaultAdapter.js";
import { ConflictAwareVaultAdapter } from "../src/vault/ConflictAwareVaultAdapter.js";
import { SyncStateRepository } from "../src/vault/SyncStateRepository.js";
import { applyTextShape, editInShape, editorOffsetOf, editorTextFiles, editorTextOf, hasUnkeptLineEnds, inShapeOf, mergedTextShape, readTextShape, textOfFileBytes } from "../src/textFileShape.js";
import { parseMarkdownAst } from "../src/markdown-parser.js";
import { extractFrontmatter } from "../src/metadata-extractor.js";
import { readFrontmatterPath, setFrontmatterPath } from "../src/frontmatter-surgical.js";
import { realSqlite } from "./helpers/realSqlite.js";
import type { IDatabaseAdapter } from "../src/db/IDatabaseAdapter.js";

// The byte order mark is built at run time, never typed into this file.
const MARK = String.fromCharCode(0xfeff);

describe("the one text an editor holds", () => {
  it("is the file without its mark and with \\n line ends", () => {
    expect(editorTextOf(`${MARK}one\r\ntwo\r\n`)).toBe("one\ntwo\n");
    expect(editorTextOf("one\ntwo\n")).toBe("one\ntwo\n");
    expect(editorTextOf("")).toBe("");
    // Reading twice changes nothing: what an editor holds is already in that space.
    expect(editorTextOf(editorTextOf(`${MARK}one\r\ntwo`))).toBe("one\ntwo");
  });

  it("is the text in which a note's properties open at the very first character", () => {
    const raw = `${MARK}---\r\ntitle: Marked\r\n---\r\n# Heading\r\n`;
    // The Markdown parser skips a leading mark: the index found these properties all along.
    const indexed = extractFrontmatter(parseMarkdownAst(raw));
    expect(indexed.success && indexed.data).toMatchObject({ title: "Marked" });
    // In the editor's text nothing stands in front of the block. An editor that
    // kept the mark as the first character of its buffer handed every reader a
    // text that opened with the mark, and one that asked for "---" at offset 0
    // found no properties in it.
    const text = editorTextOf(raw);
    expect(text.startsWith("---\n")).toBe(true);
    expect(readFrontmatterPath(text, ["title"])).toBe("Marked");
  });

  it("has \\n where a line of the file ends in a carriage return of its own", () => {
    // Every line of a file from a classic Mac. An editor splits there, and this
    // text kept the "\r": a merge, a writer beside the editor and a comment
    // operation read one long line where the editor showed many.
    expect(editorTextOf("one\rtwo\r")).toBe("one\ntwo\n");
    expect(editorTextOf(`${MARK}one\rtwo`)).toBe("one\ntwo");
    // A stray one among other line ends, and empty lines.
    expect(editorTextOf("one\rtwo\nthree\r\nfour")).toBe("one\ntwo\nthree\nfour");
    expect(editorTextOf("one\r\rtwo")).toBe("one\n\ntwo");
    expect(editorTextOf("one\n\rtwo")).toBe("one\n\ntwo");
    expect(editorTextOf("one\r\n\rtwo")).toBe("one\n\ntwo");
    // "\r\r\n" — line ends from Windows, converted twice — is ONE line end, as
    // it has always been for an editor; a "\r" in front of that is one more.
    expect(editorTextOf("one\r\r\ntwo\r\r\n")).toBe("one\ntwo\n");
    expect(editorTextOf("one\r\r\r\ntwo")).toBe("one\n\ntwo");
    // Reading twice changes nothing here either.
    expect(editorTextOf(editorTextOf("one\rtwo\r\r\nthree"))).toBe("one\ntwo\nthree");
  });

  it("is what an editor has always made of the file: the \\r\\n folded first, then split at what is left", () => {
    // The one pattern that reads the line ends now, against the two steps it
    // stands for — `\r\n` to `\n`, as this module always did, and then the
    // split an editor makes of the result (CodeMirror: at `\r\n`, `\r`, `\n`).
    // What an editor shows for a file is therefore the same as before.
    let seed = 20261012;
    const random = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const pieces = ["a", "b", " ", "\r", "\r", "\n", "\r\n", "\r\r\n", "\r\r", "\n\r", MARK];
    let withReturn = 0;
    for (let i = 0; i < 5000; i++) {
      let raw = "";
      for (let n = Math.floor(random() * 10); n > 0; n--) raw += pieces[Math.floor(random() * pieces.length)];
      const body = raw.startsWith(MARK) ? raw.slice(1) : raw;
      const always = body.replace(/\r\n/g, "\n").split(/\r\n|\r|\n/).join("\n");
      expect(editorTextOf(raw), JSON.stringify(raw)).toBe(always);
      expect(editorTextOf(raw).includes("\r"), JSON.stringify(raw)).toBe(false);
      if (hasUnkeptLineEnds(raw)) withReturn++;
    }
    expect(withReturn).toBeGreaterThan(2000);
  });

  it("brings an editor's text into the shape of the file whose place it takes", () => {
    expect(inShapeOf(`${MARK}a\r\nb\r\n`, "a\nb changed\n")).toBe(`${MARK}a\r\nb changed\r\n`);
    expect(inShapeOf("a\nb\n", "a\nb changed\n")).toBe("a\nb changed\n");
    // Never a second mark, never a line end turned twice: the text is read as an editor's first.
    expect(inShapeOf(`${MARK}a\r\n`, `${MARK}a changed\r\n`)).toBe(`${MARK}a changed\r\n`);
    expect(inShapeOf("a\n", `${MARK}a changed\r\n`)).toBe("a changed\n");
  });
});

describe("a place in a file, as an editor counts it", () => {
  it("leaves out the mark and one character of every \\r\\n in front of the place", () => {
    const raw = `${MARK}one\r\ntwo\r\nthree`;
    const text = editorTextOf(raw);
    for (const word of ["one", "two", "three"]) {
      expect(text.slice(editorOffsetOf(raw, raw.indexOf(word))).startsWith(word), word).toBe(true);
    }
    // The mark and two line ends stand in front of "three": three characters an editor does not hold.
    expect(editorOffsetOf(raw, raw.indexOf("three"))).toBe(raw.indexOf("three") - 3);
    expect(editorOffsetOf(raw, raw.length)).toBe(text.length);
    // In a file as Plainva writes it the place is the same number.
    expect(editorOffsetOf("one\ntwo\n", 4)).toBe(4);
    expect(editorOffsetOf("", 0)).toBe(0);
  });

  it("takes a place inside a line end for the end of that line, and one outside the text for its edge", () => {
    expect(editorOffsetOf("one\r\ntwo", 4)).toBe(3);
    // In front of the mark and behind it is the same place for an editor: its first.
    expect(editorOffsetOf(`${MARK}one`, 0)).toBe(0);
    expect(editorOffsetOf(`${MARK}one`, 1)).toBe(0);
    expect(editorOffsetOf("one\r\n", 99)).toBe(4);
    expect(editorOffsetOf("one\r\n", -1)).toBe(0);
    // A "\r" on its own is one line end in the file and one character for an
    // editor: the number stays. A mark further down is a character like any other.
    expect(editorOffsetOf("one\rtwo", 5)).toBe(5);
    expect(editorOffsetOf("one\rtwo", 4)).toBe(4);
    expect(editorOffsetOf(`one${MARK}two`, 5)).toBe(5);
    // "\r\r\n" is one line end of three characters: both places inside it are
    // the end of the line, and what follows it is two characters nearer.
    expect(editorOffsetOf("one\r\r\ntwo", 4)).toBe(3);
    expect(editorOffsetOf("one\r\r\ntwo", 5)).toBe(3);
    expect(editorOffsetOf("one\r\r\ntwo", 6)).toBe(4);
    expect(editorTextOf("one\r\r\ntwo").slice(editorOffsetOf("one\r\r\ntwo", 6))).toBe("two");
  });

  it("is the one rule of the editor's text: what follows the place there is what follows it in the file", () => {
    let seed = 20261011;
    const random = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const pieces = ["a", "b", " ", "---", "\r\n", "\n", "\r", "\r\n\r\n", "\n\n", "\r\r\n", MARK, "x: y", "# T"];
    let places = 0;
    let shifted = 0;
    let insideLineEnd = 0;
    for (let i = 0; i < 3000; i++) {
      let raw = random() < 0.3 ? MARK : "";
      for (let n = Math.floor(random() * 8); n > 0; n--) raw += pieces[Math.floor(random() * pieces.length)];
      const text = editorTextOf(raw);
      // The places between the characters of one line end, read from the left
      // as an editor reads: `\r\r\n` and `\r\n` are one, any other `\r` is one.
      const inLineEnd = new Set<number>();
      for (let at = raw.startsWith(MARK) ? 1 : 0; at < raw.length; ) {
        const length = raw[at] !== "\r" ? 1 : raw.startsWith("\r\n", at + 1) ? 3 : raw[at + 1] === "\n" ? 2 : 1;
        for (let inside = 1; inside < length; inside++) inLineEnd.add(at + inside);
        at += length;
      }
      let last = 0;
      for (let at = 0; at <= raw.length; at++) {
        const found = editorOffsetOf(raw, at);
        const where = JSON.stringify({ raw, at });
        // Places keep their order, and none leaves the text.
        expect(found, where).toBeGreaterThanOrEqual(last);
        expect(found, where).toBeLessThanOrEqual(text.length);
        last = found;
        const beforeMark = at === 0 && raw.startsWith(MARK);
        // The rest of the file, read the way an editor reads a file: only a mark at the very start is the file's.
        if (!inLineEnd.has(at) && !beforeMark) expect(text.slice(found), where).toBe(raw.slice(at).replace(/\r\n/g, "\n").replace(/\r\n?/g, "\n"));
        // Inside a line end the place is the end of the line in front of it.
        if (inLineEnd.has(at)) { expect(text[found], where).toBe("\n"); insideLineEnd++; }
        if (found !== at) shifted++;
        places++;
      }
    }
    expect(places).toBeGreaterThan(20000);
    // Not a test of files that need no conversion.
    expect(shifted).toBeGreaterThan(10000);
    expect(insideLineEnd).toBeGreaterThan(1000);
  });
});

describe("an edit that thinks in \\n, on a file that does not", () => {
  const addLine = (text: string) => `${text}added\n`;

  it("hands the result back in the file's shape", () => {
    expect(editInShape(`${MARK}one\r\ntwo\r\n`, addLine)).toBe(`${MARK}one\r\ntwo\r\nadded\r\n`);
    expect(editInShape("one\ntwo\n", addLine)).toBe("one\ntwo\nadded\n");
    // The edit never sees a mark or a "\r": it works on what an editor holds.
    const seen: string[] = [];
    editInShape(`${MARK}one\r\ntwo\r\n`, (text) => { seen.push(text); return text; });
    expect(seen).toEqual(["one\ntwo\n"]);
  });

  it("gives the file back byte for byte when the edit changes nothing — uneven line ends and all", () => {
    for (const raw of [`${MARK}one\r\ntwo\nthree\r\n`, "one\r\ntwo", "", `${MARK}`]) {
      expect(editInShape(raw, (text) => text), JSON.stringify(raw)).toBe(raw);
    }
    // A real change brings a file with a stray line end to its majority, as an editor's save does.
    expect(editInShape("one\r\ntwo\nthree\r\n", addLine)).toBe("one\r\ntwo\r\nthree\r\nadded\r\n");
  });

  it("works on the lines of a file from a classic Mac, and leaves the file with \\n once it changed something", () => {
    // The edit used to be handed "one\rtwo\r" — one line for anything that splits at "\n".
    const seen: string[] = [];
    expect(editInShape("one\rtwo\r", (text) => { seen.push(text); return addLine(text); })).toBe("one\ntwo\nadded\n");
    expect(seen).toEqual(["one\ntwo\n"]);
    // Twice-converted line ends from Windows come back as the "\r\n" they were meant to be.
    expect(editInShape("one\r\r\ntwo\r\r\n", addLine)).toBe("one\r\ntwo\r\nadded\r\n");
    // And an edit that changes nothing leaves either file as it is, every "\r" where it was.
    for (const raw of ["one\rtwo\r", `${MARK}one\rtwo`, "one\r\r\ntwo\r\r\n", "one\ntwo\rthree\n"]) {
      expect(editInShape(raw, (text) => text), JSON.stringify(raw)).toBe(raw);
    }
  });
});

describe("the shape a file is read in", () => {
  it("is the line end most of its lines have — every line end counted, the empty lines too", () => {
    expect(readTextShape("a\r\nb\r\nc\nd\r\n").shape.eol).toBe("\r\n");
    expect(readTextShape("a\nb\nc\r\nd\n").shape.eol).toBe("\n");
    // Paragraphs with an empty line between them, and a few lines from the
    // other platform at the end: twelve "\n" against seven "\r\n". The count
    // used to skip the second of two "\n" in a row, saw six against seven and
    // took this for a "\r\n" file — an edit would have turned every line end.
    const paragraphs = "one\n\ntwo\n\nthree\n\nfour\n\nfive\n\nsix\n\n";
    expect(readTextShape(`${paragraphs}a\r\nb\r\nc\r\nd\r\ne\r\nf\r\ng\r\n`).shape.eol).toBe("\n");
    // A text of one line says nothing; what is new starts with "\n".
    expect(readTextShape("one line").shape).toEqual({ eol: "\n", bom: false });
    expect(readTextShape("").shape).toEqual({ eol: "\n", bom: false });
    expect(readTextShape(`${MARK}one line`).shape).toEqual({ eol: "\n", bom: true });
  });

  it("comes back around the text byte for byte", () => {
    for (const raw of [`${MARK}a\r\nb\r\n`, "a\r\n\r\nb", "a\n\nb\n", `${MARK}a\nb`, "single line", "", "\r\n", "\n"]) {
      const { text, shape } = readTextShape(raw);
      expect(applyTextShape(text, shape), JSON.stringify(raw)).toBe(raw);
      expect(hasUnkeptLineEnds(raw), JSON.stringify(raw)).toBe(false);
    }
  });

  it("has no line end for a carriage return of its own: such a file is read, and written in the shape it has otherwise", () => {
    // A file from a classic Mac has none of the two line ends; what is new starts with "\n".
    expect(readTextShape("a\rb\r")).toEqual({ text: "a\nb\n", shape: { eol: "\n", bom: false } });
    expect(readTextShape(`${MARK}a\rb\r`).shape).toEqual({ eol: "\n", bom: true });
    // A stray one does not vote: the file's other line ends decide.
    expect(readTextShape("a\r\nb\rc\r\n").shape.eol).toBe("\r\n");
    expect(readTextShape("a\nb\rc\n").shape.eol).toBe("\n");
    // Twice-converted line ends from Windows are "\r\n" to the count.
    expect(readTextShape("a\r\r\nb\r\r\n")).toEqual({ text: "a\nb\n", shape: { eol: "\r\n", bom: false } });
    // These are the files that do not come back around their text — and the question says which.
    for (const [raw, written] of [["a\rb\r", "a\nb\n"], ["a\r\nb\rc\r\n", "a\r\nb\r\nc\r\n"], ["a\r\r\nb\r\r\n", "a\r\nb\r\n"], [`${MARK}a\rb`, `${MARK}a\nb`]] as const) {
      const { text, shape } = readTextShape(raw);
      expect(applyTextShape(text, shape), JSON.stringify(raw)).toBe(written);
      expect(hasUnkeptLineEnds(raw), JSON.stringify(raw)).toBe(true);
      expect(hasUnkeptLineEnds(written), JSON.stringify(raw)).toBe(false);
    }
    expect(hasUnkeptLineEnds("a\r")).toBe(true);
    expect(hasUnkeptLineEnds("")).toBe(false);
  });
});

describe("the bytes of a text file as its text", () => {
  const bytes = (...parts: Array<number[] | string>) => new Uint8Array(parts.flatMap((part) => typeof part === "string" ? [...new TextEncoder().encode(part)] : part));

  it("keeps the byte order mark as the first character, where a plain decoder drops it", () => {
    const file = bytes([0xef, 0xbb, 0xbf], "id;name\r\n1;Ada\r\n");
    expect(textOfFileBytes(file)).toBe(`${MARK}id;name\r\n1;Ada\r\n`);
    // What this function exists for: the standard decoder does not hand the mark on.
    expect(new TextDecoder().decode(file)).toBe("id;name\r\n1;Ada\r\n");
    // The text encodes back to the bytes it was read from — it can be hashed and written as the file.
    expect([...new TextEncoder().encode(textOfFileBytes(file))]).toEqual([...file]);
  });

  it("reads a file without a mark as it is, every time it is asked", () => {
    expect(textOfFileBytes(bytes("plain\n"))).toBe("plain\n");
    expect(textOfFileBytes(bytes([0xef, 0xbb, 0xbf], "again"))).toBe(`${MARK}again`);
    expect(textOfFileBytes(bytes("plain\n"))).toBe("plain\n");
    expect(textOfFileBytes(new Uint8Array())).toBe("");
  });

  it("refuses bytes that are not UTF-8 when asked to be strict, and keeps the mark there too", () => {
    // What a restore asks for: a text that is about to be written back as the file.
    expect(textOfFileBytes(bytes([0xef, 0xbb, 0xbf], "a\r\n"), { strict: true })).toBe(`${MARK}a\r\n`);
    const latin1 = bytes("Gr", [0xfc], "n");
    expect(() => textOfFileBytes(latin1, { strict: true })).toThrow();
    // Unasked, such a byte is replaced, as every reader of a file's text does.
    expect(textOfFileBytes(latin1)).toBe(`Gr${String.fromCharCode(0xfffd)}n`);
  });
});

describe("the shape a merge leaves", () => {
  const WINDOWS = "a\r\nb\r\n", UNIX = "a\nb\n";

  it("is the shape all three versions have", () => {
    expect(mergedTextShape(WINDOWS, "a!\r\nb\r\n", "a\r\nb!\r\n")).toEqual({ eol: "\r\n", bom: false });
    expect(mergedTextShape(UNIX, "a!\nb\n", "a\nb!\n")).toEqual({ eol: "\n", bom: false });
    expect(mergedTextShape(MARK + WINDOWS, `${MARK}a!\r\nb\r\n`, `${MARK}a\r\nb!\r\n`)).toEqual({ eol: "\r\n", bom: true });
  });

  it("follows the side that changed it, whichever side that is", () => {
    // The other side turned the line ends: turning them back would undo its change.
    expect(mergedTextShape(WINDOWS, "a!\r\nb\r\n", "a\nb!\n").eol).toBe("\n");
    expect(mergedTextShape(UNIX, "a!\nb\n", "a\r\nb!\r\n").eol).toBe("\r\n");
    // This side turned them: the other side's lines merge into the turned file.
    expect(mergedTextShape(WINDOWS, "a!\nb\n", "a\r\nb!\r\n").eol).toBe("\n");
    expect(mergedTextShape(UNIX, "a!\r\nb\r\n", "a\nb!\n").eol).toBe("\r\n");
    // The mark, the same way: taken away or added by one side.
    expect(mergedTextShape(MARK + UNIX, `${MARK}a!\nb\n`, "a\nb!\n").bom).toBe(false);
    expect(mergedTextShape(MARK + UNIX, "a!\nb\n", `${MARK}a\nb!\n`).bom).toBe(false);
    expect(mergedTextShape(UNIX, "a!\nb\n", `${MARK}a\nb!\n`).bom).toBe(true);
    expect(mergedTextShape(UNIX, `${MARK}a!\nb\n`, "a\nb!\n").bom).toBe(true);
    // Both changed it: there is only one way they can have.
    expect(mergedTextShape(WINDOWS, "a!\nb\n", "a\nb!\n")).toEqual({ eol: "\n", bom: false });
  });

  it("does not take a text of one line for a vote", () => {
    // The ancestor had one line; both sides wrote a second one, in the file's line end.
    expect(mergedTextShape("a", "a\r\nb", "a\r\nc").eol).toBe("\r\n");
    // This side cut the file down to one line: that is no change of its line ends.
    expect(mergedTextShape(WINDOWS, "a b", "a\r\nb\r\nc\r\n").eol).toBe("\r\n");
    // The other side did.
    expect(mergedTextShape(WINDOWS, "a\r\nb\r\nc\r\n", "a b").eol).toBe("\r\n");
    // Nobody says anything: what is new starts with "\n".
    expect(mergedTextShape("a", "b", "c")).toEqual({ eol: "\n", bom: false });
  });

  it("is the shape of the version that is already there, where no ancestor says who changed what", () => {
    // `theirs` is the file on disk for a save and the server's version for a
    // sync. A device that joins with the same notes in other line ends takes
    // the ones the others hold — it used to be "yours", and such a device
    // would have uploaded its line ends for every note to all the others.
    expect(mergedTextShape(null, WINDOWS, UNIX)).toEqual({ eol: "\n", bom: false });
    expect(mergedTextShape(null, UNIX, MARK + WINDOWS)).toEqual({ eol: "\r\n", bom: true });
    expect(mergedTextShape(null, MARK + UNIX, WINDOWS)).toEqual({ eol: "\r\n", bom: false });
    expect(mergedTextShape(null, WINDOWS, WINDOWS)).toEqual({ eol: "\r\n", bom: false });
    // This side's line end only where the other has none to show.
    expect(mergedTextShape(null, WINDOWS, "one line").eol).toBe("\r\n");
    expect(mergedTextShape(null, "one line", WINDOWS).eol).toBe("\r\n");
    // An ancestor of one line says as little as none: the editor's "\n" for a
    // file that had no line end is a default, the file on disk is evidence.
    expect(mergedTextShape("a", "x\na", "a\r\nc\r\n").eol).toBe("\r\n");
  });
});

describe("a write that changes one passage of a file", () => {
  function memory(initial: Record<string, string>) {
    const store = new Map(Object.entries(initial));
    const files = editorTextFiles({
      read: async (path) => { const text = store.get(path); if (text === undefined) throw new Error("missing"); return text; },
      write: async (path, text) => { store.set(path, text); },
    });
    return { store, files };
  }

  it("reads what an editor holds and writes back in the shape the file has", async () => {
    const { store, files } = memory({ "windows.md": `${MARK}Old sentence.\r\nKeep this line.\r\n`, "unix.md": "Old sentence.\nKeep this line.\n" });
    for (const path of ["windows.md", "unix.md"]) {
      // The same text for both: the plan is made on it, whatever the file looks like.
      expect(await files.readText(path)).toBe("Old sentence.\nKeep this line.\n");
      await files.writeText(path, "New sentence.\nKeep this line.\n");
      expect(await files.readText(path)).toBe("New sentence.\nKeep this line.\n");
    }
    expect(store.get("windows.md")).toBe(`${MARK}New sentence.\r\nKeep this line.\r\n`);
    expect(store.get("unix.md")).toBe("New sentence.\nKeep this line.\n");
  });

  it("takes the shape from the file as it lies there at the write, not from an earlier look", async () => {
    const { store, files } = memory({ "note.md": "one\r\ntwo\r\n" });
    expect(await files.readText("note.md")).toBe("one\ntwo\n");
    // Another program brought the file to "\n" in between.
    store.set("note.md", "one\ntwo\n");
    await files.writeText("note.md", "one\ntwo!\n");
    expect(store.get("note.md")).toBe("one\ntwo!\n");
  });

  it("gives every consistently-ended file back byte for byte when nothing was changed", async () => {
    for (const raw of [`${MARK}a\r\nb\r\n`, "a\r\nb", "a\nb\n", `${MARK}a\nb`, "single line", ""]) {
      const { store, files } = memory({ "file.txt": raw });
      await files.writeText("file.txt", await files.readText("file.txt"));
      expect(store.get("file.txt"), JSON.stringify(raw)).toBe(raw);
    }
  });

  it("plans on the lines of a note from a classic Mac — the text an editor holds for it", async () => {
    // The plan of a comment operation is made on the editor's text. For this
    // note that text has "\n"; read with its "\r" still in it, the note counted
    // as changed since the plan, and no suggestion on it could be accepted.
    const { store, files } = memory({ "classic.md": "Old sentence.\rKeep this line.\r" });
    expect(await files.readText("classic.md")).toBe("Old sentence.\nKeep this line.\n");
    await files.writeText("classic.md", "New sentence.\nKeep this line.\n");
    expect(store.get("classic.md")).toBe("New sentence.\nKeep this line.\n");
  });
});

describe("an editor's text on its way through the conflict-aware adapter", () => {
  let directory: string, db: IDatabaseAdapter, files: LocalVaultAdapter, adapter: ConflictAwareVaultAdapter;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "plainva-shape-"));
    db = await realSqlite(); files = new LocalVaultAdapter(directory); await files.initialize();
    adapter = new ConflictAwareVaultAdapter(files, new SyncStateRepository(db));
  });
  afterEach(async () => { await db.close(); await rm(directory, { recursive: true, force: true }); });
  const bytes = async (path: string) => (await readFile(join(directory, path))).toString("utf8");

  /** What a shell does for a file it opened: the editor's text out in the remembered shape, the base with it. */
  async function save(path: string, raw: string, edit: (text: string) => string) {
    const opened = readTextShape(raw);
    const text = edit(opened.text);
    const result = await adapter.writeEditorText(path, applyTextShape(text, opened.shape), applyTextShape(opened.text, opened.shape));
    return { result, text };
  }

  it("a file with ONE stray line end comes back in its majority — one line of diff, not the whole file (finding 2026-10-08)", async () => {
    // Three "\r\n" and one lone "\n": the base an editor hands over is uniform,
    // the disk is not, so the adapter takes its merge path. The merge joined
    // with "\n" and the file came back with every line end rewritten.
    const mixed = "a\r\nb\r\nc\nd\r\n";
    await files.writeTextFile("Settings.ini", mixed);
    const { result } = await save("Settings.ini", mixed, (text) => text.replace("a", "a!"));
    expect(result.session).toBeNull();
    expect(await bytes("Settings.ini")).toBe("a!\r\nb\r\nc\r\nd\r\n");
    expect(result.stored).toBe("a!\r\nb\r\nc\r\nd\r\n");
  });

  it("a change made elsewhere merges into a \\r\\n file with a mark, and the file keeps both", async () => {
    const windows = `${MARK}a\r\nb\r\nc\r\nd\r\n`;
    await files.writeTextFile("Settings.ini", windows);
    // Another program changed the last line while the file was open.
    await files.writeTextFile("Settings.ini", `${MARK}a\r\nb\r\nc\r\nd from elsewhere\r\n`);
    const { result } = await save("Settings.ini", windows, (text) => text.replace("a", "a!"));
    expect(result.session).toBeNull();
    expect(await bytes("Settings.ini")).toBe(`${MARK}a!\r\nb\r\nc\r\nd from elsewhere\r\n`);
  });

  it("a note keeps its \\r\\n when an editor saves it — also when the text arrives with \\n", async () => {
    // What both shells do since 2026-10-09: the note's own shape around the editor's text.
    const windows = `${MARK}a\r\nb\r\nc\r\n`;
    await files.writeTextFile("Note.md", windows);
    const { result } = await save("Note.md", windows, (text) => text.replace("a", "a!"));
    expect(result.session).toBeNull();
    expect(await bytes("Note.md")).toBe(`${MARK}a!\r\nb\r\nc\r\n`);
    // A caller that still hands over the editor's "\n" text, with the base it
    // holds, does not turn the file either: for the adapter the file's line
    // ends are something that changed on disk, and that it leaves alone. (It
    // used to follow the text it was given — a note's house form of the time.)
    const stored = await adapter.writeEditorText("Note.md", "a!!\nb\nc\n", "a!\nb\nc\n");
    expect(stored.session).toBeNull();
    expect(await bytes("Note.md")).toBe(`${MARK}a!!\r\nb\r\nc\r\n`);
    // …also when the file changed elsewhere meanwhile.
    await files.writeTextFile("Note.md", `${MARK}a!!\r\nb\r\nc from elsewhere\r\n`);
    await adapter.writeEditorText("Note.md", "a!!!\nb\nc\n", "a!!\nb\nc\n");
    expect(await bytes("Note.md")).toBe(`${MARK}a!!!\r\nb\r\nc from elsewhere\r\n`);
  });

  it("a save does not turn back line ends another program turned while the file was open", async () => {
    const windows = "a\r\nb\r\nc\r\nd\r\n";
    await files.writeTextFile("Note.md", windows);
    // A tool brought the note to "\n" and changed its last line; the editor still holds the "\r\n" it opened.
    await files.writeTextFile("Note.md", "a\nb\nc\nd from elsewhere\n");
    const { result } = await save("Note.md", windows, (text) => text.replace("a", "a!"));
    expect(result.session).toBeNull();
    expect(await bytes("Note.md")).toBe("a!\nb\nc\nd from elsewhere\n");
    // The next save still carries the old shape with it — and still leaves the file as the tool made it.
    const again = await adapter.writeEditorText("Note.md", "a!!\r\nb\r\nc\r\nd from elsewhere\r\n", "a!\r\nb\r\nc\r\nd from elsewhere\r\n");
    expect(again.session).toBeNull();
    expect(await bytes("Note.md")).toBe("a!!\nb\nc\nd from elsewhere\n");
  });

  it("a write outside an editor that meets a change from elsewhere merges in the file's shape", async () => {
    const repo = new SyncStateRepository(db);
    const sha = async (text: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))), (b) => b.toString(16).padStart(2, "0")).join("");
    for (const [path, mark] of [["Note.md", ""], ["Marked.md", MARK], ["Settings.ini", MARK]] as const) {
      const known = `${mark}a\r\nb\r\nc\r\nd\r\n`;
      await files.writeTextFile(path, known);
      // What the index records for a file it met: its hash and its text as the merge base.
      await repo.updateLocalHashAndBaseText(path, await sha(known), known);
      // Another program changed the last line…
      await files.writeTextFile(path, `${mark}a\r\nb\r\nc\r\nd from elsewhere\r\n`);
      // …and a writer of the app (a property edit, a task toggle) changes the first, on the text it read before.
      await adapter.writeTextFile(path, `${mark}a!\r\nb\r\nc\r\nd\r\n`);
      expect(await bytes(path), path).toBe(`${mark}a!\r\nb\r\nc\r\nd from elsewhere\r\n`);
    }
  });

  it("two editors writing into one conflict copy merge in the shape they asked for", async () => {
    const base = "one\r\ntwo\r\nthree\r\n";
    await files.writeTextFile("Settings.ini", "one\r\ntwo\r\nthree elsewhere\r\n");
    // The first write conflicts with the disk and opens the working copy.
    const first = await adapter.writeEditorText("Settings.ini", "one\r\ntwo\r\nthree here\r\n", base);
    expect(first.session).not.toBeNull();
    // A second editor of the same file, still on the old base, changed another line.
    const second = await adapter.writeEditorText("Settings.ini", "one too\r\ntwo\r\nthree\r\n", base);
    expect(second.session?.workingCopyPath).toBe(first.session!.workingCopyPath);
    expect(await bytes(first.session!.workingCopyPath)).toBe("one too\r\ntwo\r\nthree here\r\n");
    expect(await bytes("Settings.ini")).toBe("one\r\ntwo\r\nthree elsewhere\r\n");
  });
});

/**
 * A carriage return of its own is read as a line end and not kept (maintainer,
 * 2026-10-12): the first write that changes such a file leaves it in the line
 * end its shape has, and the top of the chain says so — the one place every
 * write of the app passes, an editor's save and the writers beside it alike.
 */
describe("a file whose lines end in a carriage return of its own, on its way through the conflict-aware adapter", () => {
  let directory: string, db: IDatabaseAdapter, files: LocalVaultAdapter, adapter: ConflictAwareVaultAdapter;
  /** What the chain told the shell: the file, and the line end it has now. */
  let said: Array<[string, string]>;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "plainva-returns-"));
    db = await realSqlite(); files = new LocalVaultAdapter(directory); await files.initialize();
    said = [];
    adapter = new ConflictAwareVaultAdapter(files, new SyncStateRepository(db), undefined, undefined, "local", (path, eol) => { said.push([path, eol]); });
  });
  afterEach(async () => { await db.close(); await rm(directory, { recursive: true, force: true }); });
  const bytes = async (path: string) => (await readFile(join(directory, path))).toString("utf8");

  /** What a shell does for a file it opened: the editor's text out in the remembered shape, the base with it. */
  async function save(path: string, raw: string, edit: (text: string) => string) {
    const opened = readTextShape(raw);
    return adapter.writeEditorText(path, applyTextShape(edit(opened.text), opened.shape), applyTextShape(opened.text, opened.shape));
  }

  it("an editor's save leaves it with \\n and says so — once", async () => {
    const classic = "one\rtwo\rthree\r";
    await files.writeTextFile("Classic.md", classic);
    const result = await save("Classic.md", classic, (text) => text.replace("two", "two!"));
    expect(result.session).toBeNull();
    expect(await bytes("Classic.md")).toBe("one\ntwo!\nthree\n");
    expect(said).toEqual([["Classic.md", "\n"]]);
    // The next save meets a file with "\n": nothing is turned, and nothing is said.
    const again = await adapter.writeEditorText("Classic.md", "one\ntwo!!\nthree\n", "one\ntwo!\nthree\n");
    expect(again.session).toBeNull();
    expect(await bytes("Classic.md")).toBe("one\ntwo!!\nthree\n");
    expect(said).toHaveLength(1);
  });

  it("a change made elsewhere merges into it line by line", async () => {
    // The editor holds lines; the file on disk was one long line for the merge,
    // and a change in two places ended in a conflict copy of the whole file.
    const classic = "one\rtwo\rthree\r";
    await files.writeTextFile("Classic.md", classic);
    await files.writeTextFile("Classic.md", "one\rtwo\rthree from elsewhere\r");
    const result = await save("Classic.md", classic, (text) => text.replace("one", "one!"));
    expect(result.session).toBeNull();
    expect(await bytes("Classic.md")).toBe("one!\ntwo\nthree from elsewhere\n");
    expect(said).toEqual([["Classic.md", "\n"]]);
  });

  it("twice-converted line ends from Windows come back as the \\r\\n they were", async () => {
    const twice = "one\r\r\ntwo\r\r\n";
    await files.writeTextFile("Twice.md", twice);
    const result = await save("Twice.md", twice, (text) => text.replace("one", "one!"));
    expect(result.session).toBeNull();
    expect(await bytes("Twice.md")).toBe("one!\r\ntwo\r\n");
    expect(said).toEqual([["Twice.md", "\r\n"]]);
  });

  it("a writer beside the editor turns them as well, a property that changes one place of the note included", async () => {
    const classic = "---\rstage: open\r---\r- [ ] one\rText\r";
    await files.writeTextFile("Tasks.md", classic);
    // A property written into the note: the writer puts one entry in its place,
    // with "\n", and leaves every other line as it was — the chain writes the
    // note in its shape's line end, every line of it, and says so.
    const withOwner = setFrontmatterPath(classic, ["owner"], "Anna");
    expect(withOwner).toBe("---\rstage: open\rowner: Anna\n---\r- [ ] one\rText\r");
    await adapter.writeTextFile("Tasks.md", withOwner);
    expect(await bytes("Tasks.md")).toBe("---\nstage: open\nowner: Anna\n---\n- [ ] one\nText\n");
    expect(said).toEqual([["Tasks.md", "\n"]]);
    // The next writer meets a note with "\n": nothing is turned, and nothing more is said.
    await adapter.writeTextFile("Tasks.md", editInShape(await files.readTextFile("Tasks.md"), (text) => `${text}- [ ] two\n`));
    expect(await bytes("Tasks.md")).toBe("---\nstage: open\nowner: Anna\n---\n- [ ] one\nText\n- [ ] two\n");
    expect(said).toHaveLength(1);
  });

  it("a change through the chain's one entry turns them as well — a property or a task's box", async () => {
    // The way a cell, a task's box or the journal writes since ADR 0031: the
    // chain reads the file inside its gate and hands the text to the change,
    // which changes one place and leaves the rest as it was.
    const classic = "---\rstage: open\r---\r- [ ] one\rText\r";
    await files.writeTextFile("Board.md", classic);
    const property = await adapter.updateTextFile("Board.md", (raw) => setFrontmatterPath(raw, ["owner"], "Anna"));
    expect(property).toMatchObject({ before: classic, text: "---\nstage: open\nowner: Anna\n---\n- [ ] one\nText\n", changed: true });
    expect(await bytes("Board.md")).toBe(property.text);
    expect(said).toEqual([["Board.md", "\n"]]);
    // A task's box ticked in place, in a note nobody has written yet.
    await files.writeTextFile("Box.md", "- [ ] one\r- [ ] two\r");
    const ticked = await adapter.updateTextFile("Box.md", (raw) => raw.replace("- [ ] two", "- [x] two"));
    expect(ticked.changed).toBe(true);
    expect(await bytes("Box.md")).toBe("- [ ] one\n- [x] two\n");
    expect(said).toEqual([["Board.md", "\n"], ["Box.md", "\n"]]);
  });

  it("takes a text that differs from the file only in those line ends for no change", async () => {
    // A listing written anew over the one that is there, with the same lines:
    // the overview of a folder, refreshed. It used to turn the file, unasked.
    const classic = "# Folder\r\r- [[One]]\r- [[Two]]\r";
    await files.writeTextFile("index.md", classic);
    await adapter.writeTextFile("index.md", inShapeOf(classic, editorTextOf(classic)));
    expect(await bytes("index.md")).toBe(classic);
    const same = await adapter.updateTextFile("index.md", (raw) => inShapeOf(raw, editorTextOf(raw)));
    expect(same.changed).toBe(false);
    expect(await bytes("index.md")).toBe(classic);
    // A change that changes nothing at all, through either way in.
    await adapter.writeTextFile("index.md", classic);
    expect((await adapter.updateTextFile("index.md", (raw) => editInShape(raw, (text) => text))).changed).toBe(false);
    expect(await bytes("index.md")).toBe(classic);
    expect(said).toEqual([]);
  });

  it("gives a version put back its bytes where the file it goes over has no such line ends", async () => {
    // An earlier write turned the file; the version from before is put back —
    // a restore, an undo, a copy taken over: byte for byte, and nothing is said.
    const classic = "one\rtwo\r";
    await files.writeTextFile("Turned.md", "one\ntwo!\n");
    await adapter.writeTextFile("Turned.md", classic);
    expect(await bytes("Turned.md")).toBe(classic);
    await files.writeTextFile("Windows.md", "one\r\ntwo!\r\n");
    await adapter.writeTextFile("Windows.md", classic);
    expect(await bytes("Windows.md")).toBe(classic);
    expect(said).toEqual([]);
    // Over a file that has them, it is a write like any other: turned, and said.
    await files.writeTextFile("Still.md", classic);
    await adapter.writeTextFile("Still.md", "one\rtwo\rthree\r");
    expect(await bytes("Still.md")).toBe("one\ntwo\nthree\n");
    expect(said).toEqual([["Still.md", "\n"]]);
  });

  it("a whole text that meets a change from elsewhere is merged, turned and said once", async () => {
    // The merge branch of a whole text: the chain knew the file, another
    // program changed it in the old line ends, and a writer that names no
    // starting text writes over it.
    const repo = new SyncStateRepository(db);
    const sha = async (text: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))), (b) => b.toString(16).padStart(2, "0")).join("");
    const known = "one\rtwo\rthree\r";
    await files.writeTextFile("Merged.md", known);
    // What the index records for a file it met: its hash and its text as the merge base.
    await repo.updateLocalHashAndBaseText("Merged.md", await sha(known), known);
    await files.writeTextFile("Merged.md", "one\rtwo\rthree from elsewhere\r");
    await adapter.writeTextFile("Merged.md", "one!\ntwo\nthree\n");
    expect(await bytes("Merged.md")).toBe("one!\ntwo\nthree from elsewhere\n");
    expect(said).toEqual([["Merged.md", "\n"]]);
  });

  it("leaves what the app writes to its own files under .plainva as it is handed in, and says nothing", async () => {
    await files.writeTextFile(".plainva/bookmarks.json", "[\"a\"]\r");
    await adapter.writeTextFile(".plainva/bookmarks.json", "[\"a\",\"b\"]\r");
    expect(await bytes(".plainva/bookmarks.json")).toBe("[\"a\",\"b\"]\r");
    expect(said).toEqual([]);
  });

  it("says nothing for a file that keeps its line ends or is new, and a notice that fails does not fail the write", async () => {
    const windows = "a\r\nb\r\n";
    await files.writeTextFile("Windows.md", windows);
    await save("Windows.md", windows, (text) => text.replace("a", "a!"));
    expect(await bytes("Windows.md")).toBe("a!\r\nb\r\n");
    // A file that is written for the first time had no line ends to turn.
    await adapter.writeTextFile("New.md", "one\rtwo\r");
    expect(said).toEqual([]);

    const failing = new ConflictAwareVaultAdapter(files, new SyncStateRepository(db), undefined, undefined, "local", () => { throw new Error("nobody to tell"); });
    await files.writeTextFile("Classic.md", "one\rtwo\r");
    await failing.writeTextFile("Classic.md", "one\ntwo!\n");
    expect(await bytes("Classic.md")).toBe("one\ntwo!\n");
  });
});
