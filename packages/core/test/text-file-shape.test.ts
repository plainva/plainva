import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LocalVaultAdapter } from "../src/vault/LocalVaultAdapter.js";
import { ConflictAwareVaultAdapter } from "../src/vault/ConflictAwareVaultAdapter.js";
import { SyncStateRepository } from "../src/vault/SyncStateRepository.js";
import { applyTextShape, editorTextFiles, editorTextOf, inShapeOf, readTextShape } from "../src/textFileShape.js";
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

  it("brings a merged text to the shape of the text that was to be written", () => {
    // A merge joins with "\n" whatever went in.
    expect(inShapeOf(`${MARK}a\r\nb\r\n`, "a\nb changed\n")).toBe(`${MARK}a\r\nb changed\r\n`);
    // …and a note's "\n" stays "\n" when the other side carried "\r\n" in.
    expect(inShapeOf("a\nb\n", "a\r\nb changed\r\n")).toBe("a\nb changed\n");
    // Never a second mark, never a lost one.
    expect(inShapeOf(`${MARK}a\n`, `${MARK}a changed\n`)).toBe(`${MARK}a changed\n`);
    expect(inShapeOf("a\n", `${MARK}a changed\n`)).toBe("a changed\n");
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

  it("a text handed over with \\n is written with \\n, whatever the file had — a note's house form", async () => {
    // The shells save a note with "\n" (openEditorText); the adapter follows the text it is given.
    await files.writeTextFile("Note.md", "a\r\nb\r\nc\r\n");
    const stored = await adapter.writeEditorText("Note.md", "a!\nb\nc\n", "a\nb\nc\n");
    expect(stored.session).toBeNull();
    expect(await bytes("Note.md")).toBe("a!\nb\nc\n");
    // …also when the file changed elsewhere meanwhile.
    await files.writeTextFile("Note.md", "a!\r\nb\r\nc from elsewhere\r\n");
    await adapter.writeEditorText("Note.md", "a!!\nb\nc\n", "a!\nb\nc\n");
    expect(await bytes("Note.md")).toBe("a!!\nb\nc from elsewhere\n");
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
