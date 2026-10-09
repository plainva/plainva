import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LocalVaultAdapter } from "../src/vault/LocalVaultAdapter.js";
import { ConflictAwareVaultAdapter } from "../src/vault/ConflictAwareVaultAdapter.js";
import { SyncStateRepository } from "../src/vault/SyncStateRepository.js";
import { applyTextShape, editInShape, editorTextFiles, editorTextOf, inShapeOf, mergedTextShape, readTextShape, textOfFileBytes } from "../src/textFileShape.js";
import { parseMarkdownAst } from "../src/markdown-parser.js";
import { extractFrontmatter } from "../src/metadata-extractor.js";
import { readFrontmatterPath } from "../src/frontmatter-surgical.js";
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


  it("brings an editor's text into the shape of the file whose place it takes", () => {
    expect(inShapeOf(`${MARK}a\r\nb\r\n`, "a\nb changed\n")).toBe(`${MARK}a\r\nb changed\r\n`);
    expect(inShapeOf("a\nb\n", "a\nb changed\n")).toBe("a\nb changed\n");
    // Never a second mark, never a line end turned twice: the text is read as an editor's first.
    expect(inShapeOf(`${MARK}a\r\n`, `${MARK}a changed\r\n`)).toBe(`${MARK}a changed\r\n`);
    expect(inShapeOf("a\n", `${MARK}a changed\r\n`)).toBe("a changed\n");
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
    }
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
