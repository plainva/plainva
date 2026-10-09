// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { IVaultAdapter, VaultQueryService } from "@plainva/core";
import {
  appendJournalEntry,
  appendTaskLine,
  appendWikiLink,
  applyFieldsToNote,
  applyLinkUpdates,
  applyPinboardEntryTitle,
  generateIndexForFolder,
  adoptFileAsIndex,
  parseBaseConfig,
  replaceCheckboxWithLink,
  serializeBaseConfig,
  setPlatformServices,
  writeNoteProperty,
} from "@plainva/ui";
import { LocalVaultAdapter } from "../../../packages/core/src/vault/LocalVaultAdapter";

/**
 * A note keeps its line ends, whoever writes it (maintainer, 2026-10-09).
 *
 * The editor's save and the merges are held to that in their own tests
 * (editorSaveRecovery.test.ts, the phone's editorTextSpace.test.ts, the core's
 * text-file-shape and text-shape-sync tests). This file is about the writers
 * BESIDE an editor, which both shells share: each of them read a note, built
 * one new line with `\n`, and wrote the note back — one line of the other
 * kind per write in a note that lies there with `\r\n`, and in a short note
 * enough of them to tip the count, after which the next save from an editor
 * turned every line end. Two more wrote the whole text anew, `\n` throughout
 * and without the file's mark.
 *
 * Real files, read back as bytes. What is asserted is always the same: the
 * bytes that were not edited are the bytes that were there.
 */

// Built at run time: the mark is never typed into this file.
const MARK = String.fromCharCode(0xfeff);
const MARK_BYTES = [0xef, 0xbb, 0xbf];
const utf8 = (text: string) => [...new TextEncoder().encode(text)];
/** What the file has to be: its mark, then this text. */
const marked = (text: string) => [...MARK_BYTES, ...utf8(text)];
/** No line ends with a bare "\n". */
const onlyWindowsLineEnds = (text: string) => !/(^|[^\r])\n/.test(text);

let root: string, files: LocalVaultAdapter;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "plainva-note-line-ends-"));
  files = new LocalVaultAdapter(root);
  await files.initialize();
  setPlatformServices({
    loadSettings: async () => ({}) as never,
    credentials: {} as never,
    openExternal: async () => {},
    flushPendingSave: async () => {},
  } as never);
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
const bytes = async (path: string) => [...await readFile(join(root, path))];

/** The index, as far as these writers ask it: which notes there are, and what they are called. */
function indexOf(paths: string[]): VaultQueryService {
  const rows = paths.map((path) => ({ path, title: path.split("/").pop()!.replace(/\.md$/i, "") }));
  return {
    listNotes: async () => rows,
    linkTargets: async () => paths,
    getBacklinks: async () => [],
    db: { query: async (sql: string) => (sql.includes("p.key = 'description'") ? [] : rows) },
  } as unknown as VaultQueryService;
}

describe("a line added to a note ends the way the note's lines end", () => {
  it("a link appended from the graph", async () => {
    await files.writeTextFile("Source.md", `${MARK}# Source\r\n\r\nSome text.\r\n`);
    await files.writeTextFile("Target.md", "# Target\n");
    const link = await appendWikiLink(files as unknown as IVaultAdapter, indexOf(["Source.md", "Target.md"]), "Source.md", "Target.md");
    expect(link).toBe("[[Target]]");
    // It used to end "…Some text.\r\n\n[[Target]]\n".
    expect(await bytes("Source.md")).toEqual(marked("# Source\r\n\r\nSome text.\r\n\r\n[[Target]]\r\n"));
    // A second link goes under the first, an empty line apart, as in a "\n" note.
    await files.writeTextFile("Other.md", "# Other\n");
    await appendWikiLink(files as unknown as IVaultAdapter, indexOf(["Source.md", "Target.md", "Other.md"]), "Source.md", "Other.md");
    expect(await bytes("Source.md")).toEqual(marked("# Source\r\n\r\nSome text.\r\n\r\n[[Target]]\r\n\r\n[[Other]]\r\n"));
  });

  it("a link appended to a note without a last line end, and to one with \\n", async () => {
    await files.writeTextFile("Open.md", "one\r\ntwo");
    await files.writeTextFile("Unix.md", "one\ntwo\n");
    await files.writeTextFile("Target.md", "# Target\n");
    const index = indexOf(["Open.md", "Unix.md", "Target.md"]);
    await appendWikiLink(files as unknown as IVaultAdapter, index, "Open.md", "Target.md");
    await appendWikiLink(files as unknown as IVaultAdapter, index, "Unix.md", "Target.md");
    expect(await bytes("Open.md")).toEqual(utf8("one\r\ntwo\r\n\r\n[[Target]]\r\n"));
    expect(await bytes("Unix.md")).toEqual(utf8("one\ntwo\n\n[[Target]]\n"));
  });

  it("a checkbox added on a card", () => {
    const note = `${MARK}# Card\r\n\r\n- [x] one\r\n- [ ] two\r\n\r\ntext\r\n`;
    // It used to come back "…- [ ] two\r\n- [ ] three\n\r\ntext\r\n".
    expect(appendTaskLine(note, "three")).toBe(`${MARK}# Card\r\n\r\n- [x] one\r\n- [ ] two\r\n- [ ] three\r\n\r\ntext\r\n`);
    // …at the end where the note has no checkbox yet, with or without a last line end.
    expect(appendTaskLine("text\r\nmore\r\n", "first")).toBe("text\r\nmore\r\n- [ ] first\r\n");
    expect(appendTaskLine("text\r\nmore", "first")).toBe("text\r\nmore\r\n- [ ] first\r\n");
    // A nested list keeps its indentation, and the last checkbox may be the last line.
    expect(appendTaskLine("- a\r\n  - [ ] one", "two")).toBe("- a\r\n  - [ ] one\r\n  - [ ] two");
    // A "\n" note is written as before.
    expect(appendTaskLine("- [ ] one\n", "two")).toBe("- [ ] one\n- [ ] two\n");
    // Nothing to add: the note comes back byte for byte, uneven line ends and all.
    const uneven = "- [ ] one\r\ntext\nmore\r\n";
    expect(appendTaskLine(uneven, "  ")).toBe(uneven);
  });

  it("a checkbox that became a task leaves its line as it was, link in place", () => {
    const note = `${MARK}- [ ] call the workshop\r\n- [ ] second\r\n\r\ntext\r\n`;
    // It used to come back "- [[Call]]\n- [ ] second\r\n…": the replaced line had lost its "\r".
    expect(replaceCheckboxWithLink(note, 0, "Call", "call the workshop"))
      .toEqual({ content: `${MARK}- [[Call|call the workshop]]\r\n- [ ] second\r\n\r\ntext\r\n`, changed: true });
    expect(replaceCheckboxWithLink(note, 1, "Second").content).toBe(`${MARK}- [ ] call the workshop\r\n- [[Second]]\r\n\r\ntext\r\n`);
    expect(replaceCheckboxWithLink("- [ ] one\n- [ ] two\n", 1, "Two").content).toBe("- [ ] one\n- [[Two]]\n");
    // No such checkbox: the note is handed back untouched.
    expect(replaceCheckboxWithLink(note, 7, "X")).toEqual({ content: note, changed: false });
  });

  it("a title the provider sent for a mirrored task that has no heading yet", () => {
    const fields = (title: string) => ({ title, due: null, completed: false });
    // A task database without a date column and without a "done" convention: only the title is at stake.
    const db = { dueKey: null, completion: null };
    const note = `${MARK}---\r\ntype: task\r\n---\r\nBody only\r\n`;
    // It used to come back "…---\r\n# Renamed\nBody only\r\n".
    expect(applyFieldsToNote(note, fields("Renamed"), fields("Old"), db)).toBe(`${MARK}---\r\ntype: task\r\n---\r\n# Renamed\r\nBody only\r\n`);
    // With a heading there, the heading is replaced where it stands.
    expect(applyFieldsToNote(`---\r\ntype: task\r\n---\r\n# Old\r\nBody\r\n`, fields("Renamed"), fields("Old"), db)).toBe(`---\r\ntype: task\r\n---\r\n# Renamed\r\nBody\r\n`);
    // A heading never ends up in front of a mark…
    expect(applyFieldsToNote(`${MARK}Body only\r\n`, fields("Renamed"), fields("Old"), db)).toBe(`${MARK}# Renamed\r\nBody only\r\n`);
    // …and a heading that stands on the first line, directly behind the mark,
    // is found there and replaced. Read as part of that line, the mark hid
    // it, and the title was written as a second heading above the first.
    expect(applyFieldsToNote(`${MARK}# Old\r\nBody\r\n`, fields("Renamed"), fields("Old"), db)).toBe(`${MARK}# Renamed\r\nBody\r\n`);
    expect(applyFieldsToNote("Body only\n", fields("Renamed"), fields("Old"), db)).toBe("# Renamed\nBody only\n");
  });

  it("the title typed for a new pinboard entry whose template came from Windows", () => {
    const draft = "---\r\ntype: note\r\n---\r\nbody text\r\n";
    // It used to come back "…---\r\n# My title\n\nbody text\r\n".
    expect(applyPinboardEntryTitle(draft, "My title", "2026-10-09 1200")).toBe("---\r\ntype: note\r\n---\r\n# My title\r\n\r\nbody text\r\n");
    expect(applyPinboardEntryTitle(`${MARK}body text\r\n`, "My title", "stem")).toBe(`${MARK}# My title\r\n\r\nbody text\r\n`);
    // A heading that mirrors the draft's name is taken over where it stands — also behind a mark.
    expect(applyPinboardEntryTitle(`${MARK}# stem\r\nbody\r\n`, "My title", "stem")).toBe(`${MARK}# My title\r\nbody\r\n`);
    expect(applyPinboardEntryTitle("---\ntype: note\n---\nbody text\n", "My title", "stem")).toBe("---\ntype: note\n---\n# My title\n\nbody text\n");
  });

  it("does not tip a short note: after such a write an editor still finds the line ends the note had", async () => {
    // Two lines with "\r\n", and two writes that each added lines. With "\n"
    // on the new lines the note counted three against two, and the next save
    // from an editor would have turned all of it.
    await files.writeTextFile("Short.md", "- [ ] one\r\ntext\r\n");
    await files.writeTextFile("Target.md", "# Target\n");
    await files.writeTextFile("Short.md", appendTaskLine(await files.readTextFile("Short.md"), "two"));
    await appendWikiLink(files as unknown as IVaultAdapter, indexOf(["Short.md", "Target.md"]), "Short.md", "Target.md");
    const after = await files.readTextFile("Short.md");
    expect(after).toBe("- [ ] one\r\n- [ ] two\r\ntext\r\n\r\n[[Target]]\r\n");
    expect(onlyWindowsLineEnds(after)).toBe(true);
  });
});

describe("a note that is written anew keeps the shape it has", () => {
  it("the overview of a folder, refreshed", async () => {
    await files.writeTextFile("Projects/Alpha.md", "# Alpha\n");
    await files.writeTextFile("Projects/Beta.md", "# Beta\n");
    const index = indexOf(["Projects/Alpha.md", "Projects/Beta.md"]);
    const generate = () => generateIndexForFolder({ adapter: files, queryService: index, folder: "Projects", heading: "Projects", subfoldersHeading: "Folders", skipBackup: true });
    // A new overview starts with "\n" and without a mark, like everything Plainva creates.
    await generate();
    const fresh = await files.readTextFile("Projects/index.md");
    expect(fresh.includes("\r")).toBe(false);
    expect(fresh.charCodeAt(0)).not.toBe(0xfeff);
    expect(fresh).toContain("[Alpha](Alpha.md)");
    // The same overview as it lies in a vault that came from Windows…
    const windows = MARK + fresh.replace(/\n/g, "\r\n");
    await files.writeTextFile("Projects/index.md", windows);
    const before = await bytes("Projects/index.md");
    // …is refreshed by itself whenever the folder changes. Nothing changed: not a byte moves.
    await generate();
    expect(await bytes("Projects/index.md")).toEqual(before);
    // A note is added: the listing gains its line, and every line still ends with "\r\n".
    await files.writeTextFile("Projects/Gamma.md", "# Gamma\n");
    await generateIndexForFolder({ adapter: files, queryService: indexOf(["Projects/Alpha.md", "Projects/Beta.md", "Projects/Gamma.md"]), folder: "Projects", heading: "Projects", subfoldersHeading: "Folders", skipBackup: true });
    const refreshed = await files.readTextFile("Projects/index.md");
    expect(refreshed.charCodeAt(0)).toBe(0xfeff);
    expect(refreshed).toContain("[Gamma](Gamma.md)");
    expect(onlyWindowsLineEnds(refreshed)).toBe(true);
    expect(refreshed.replace(/^.*Gamma.*\r\n/m, "")).toBe(windows);
  });

  it("a note whose links were retargeted after a rename", async () => {
    const note = `${MARK}---\r\ntitle: A\r\n---\r\n# A\r\n\r\nSee [[Old]] here\r\nand more text.\r\n\r\n- one\r\n- two\r\n`;
    await files.writeTextFile("A.md", note);
    const result = await applyLinkUpdates(files, { sources: [{ path: "A.md", body: [{ raw: "Old", target: "New" }], frontmatter: [] }] } as never);
    expect(result).toMatchObject({ renamedLinks: 1, changedFiles: 1, failed: false });
    const after = await files.readTextFile("A.md");
    expect(after).toContain("See [[New]] here");
    // The rewrite goes through the Markdown serializer, which writes "\n"
    // between its blocks and no mark: the note came back with both kinds of
    // line end, and without the mark it had.
    expect(after.charCodeAt(0)).toBe(0xfeff);
    expect(onlyWindowsLineEnds(after)).toBe(true);
    expect((await bytes("A.md")).slice(0, 3)).toEqual(MARK_BYTES);
    // A "\n" note comes back as a "\n" note.
    await files.writeTextFile("B.md", "# B\n\nSee [[Old]].\n");
    await applyLinkUpdates(files, { sources: [{ path: "B.md", body: [{ raw: "Old", target: "New" }], frontmatter: [] }] } as never);
    expect(await files.readTextFile("B.md")).toBe("# B\n\nSee [[New]].\n");
  });

  it("a note adopted as the overview of its folder, prepared for it", async () => {
    const note = `${MARK}---\r\ntype: note\r\n---\r\n# Map\r\n\r\n- [[Alpha]]\r\n- [[Beta]]\r\n`;
    await files.writeTextFile("Projects/Map.md", note);
    await files.writeTextFile("Projects/Alpha.md", "# Alpha\n");
    await files.writeTextFile("Projects/Beta.md", "# Beta\n");
    const index = indexOf(["Projects/Map.md", "Projects/Alpha.md", "Projects/Beta.md"]);
    const result = await adoptFileAsIndex({ adapter: files, queryService: index, candidatePath: "Projects/Map.md", folder: "Projects", prepare: true });
    expect(result.indexPath).toBe("Projects/index.md");
    const adopted = await files.readTextFile("Projects/index.md");
    expect(adopted).toContain("[Alpha](Alpha.md)");
    expect(adopted.charCodeAt(0)).toBe(0xfeff);
    expect(onlyWindowsLineEnds(adopted)).toBe(true);
  });
});

describe("what was right already, held here so that it stays", () => {
  it("a property set from a database cell rewrites the block, in the note's line ends, and no byte of the text", async () => {
    const note = `${MARK}---\r\ntitle: A\r\nstatus: open\r\n---\r\n# A\r\n\r\nText with a line\nof the other kind.\r\n`;
    await files.writeTextFile("Note.md", note);
    await writeNoteProperty(files, "Note.md", "status", "done");
    expect(await bytes("Note.md")).toEqual(marked("---\r\ntitle: A\r\nstatus: done\r\n---\r\n# A\r\n\r\nText with a line\nof the other kind.\r\n"));
    // A note with "\n" gets its block with "\n".
    await files.writeTextFile("Unix.md", "---\ntitle: A\n---\n# A\n");
    await writeNoteProperty(files, "Unix.md", "status", "done");
    expect(await bytes("Unix.md")).toEqual(utf8("---\ntitle: A\nstatus: done\n---\n# A\n"));
    // One definition of a note's line end — what most of its lines have. A
    // single "\r\n" anywhere used to decide for the block (finding 2026-10-09).
    await files.writeTextFile("Mostly.md", "---\ntitle: A\n---\n# A\n\none\ntwo\nthree\r\nfour\n");
    await writeNoteProperty(files, "Mostly.md", "status", "done");
    expect(await bytes("Mostly.md")).toEqual(utf8("---\ntitle: A\nstatus: done\n---\n# A\n\none\ntwo\nthree\r\nfour\n"));
  });

  it("a journal entry is written with the line end of the lines around it", async () => {
    const day = "# 2026-10-09\r\n\r\n## Journal\r\n\r\n- 08:00 breakfast\r\n\r\n## Notes\r\n\r\ntext\r\n";
    await files.writeTextFile("2026-10-09.md", day);
    const result = await appendJournalEntry({
      ensureDailyNote: async () => ({ path: "2026-10-09.md", created: false }),
      readTextFile: (path) => files.readTextFile(path),
      writeTextFile: (path, content) => files.writeTextFile(path, content),
    }, { date: new Date(2026, 9, 9), text: "on the train", heading: "Journal", time: "09:10" });
    expect(result.ok).toBe(true);
    expect(await bytes("2026-10-09.md")).toEqual(utf8("# 2026-10-09\r\n\r\n## Journal\r\n\r\n- 08:00 breakfast\r\n- 09:10 on the train\r\n\r\n## Notes\r\n\r\ntext\r\n"));
  });

  it("a database file is the one that is written anew: with \\n and without a mark, whatever it had", () => {
    // Stated in the guide (File Format Reference, "Encoding"). A `.base` is
    // serialised from its configuration; it is not a text that was edited.
    const base = `${MARK}filters:\r\n  and:\r\n    - file.ext == "md"\r\nviews:\r\n  - type: table\r\n    name: Table\r\n`;
    const written = serializeBaseConfig(parseBaseConfig(base));
    expect(written.includes("\r")).toBe(false);
    expect(written.charCodeAt(0)).not.toBe(0xfeff);
    expect(written).toContain("name: Table");
  });
});

describe("where these writers are wired", () => {
  it("the desktop hands an unlocked overview back in the shape its file has, as the phone does", () => {
    const desktop = readFileSync(resolve("src/components/Editor.tsx"), "utf8");
    const unlock = desktop.slice(desktop.indexOf("const unlockManagedIndex"), desktop.indexOf("const toggleWidth"));
    expect(unlock).toContain("stripPlainvaIndexMarker(content)");
    // The editor's text never reaches the file as it stands.
    expect(unlock).toMatch(/writeTextFile\(activePath, inShapeOf\(await vaultAdapter\.readTextFile\(activePath\), stripped\)\)/);
    expect(unlock).not.toMatch(/writeTextFile\(activePath, stripped\)/);
    const phone = readFileSync(resolve("../mobile/src/screens/NoteScreen.tsx"), "utf8");
    expect(phone).toMatch(/const stripped = stripPlainvaIndexMarker\(doc\);\s+await vaultOps\.saveEditorText\(vault, path, stripped\);/);
  });
});
