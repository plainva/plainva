// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import ts from "typescript";
import { BackupVaultAdapter, ConflictAwareVaultAdapter, ConflictError, QueueingVaultAdapter, SyncQueue, SyncStateRepository, VersionHistoryService, applyTextShape, containsTextChanges, DEFAULT_TEXT_SHAPE, editorTextOf, mergeEditorText, type IDatabaseAdapter } from "@plainva/core";
import { decideDirtyExternalUpdate, openEditorText } from "@plainva/ui";
import { LocalVaultAdapter } from "../../../../packages/core/src/vault/LocalVaultAdapter";
import { realSqlite } from "../../../../packages/core/test/helpers/realSqlite";
import { createSaveCoordinator, type SaveCoordinator } from "./saveCoordinator";
import type { MobileVault } from "./vaultService";

/**
 * The phone and a file that does not lie there the way an editor holds it:
 * `\r\n` line ends, a byte order mark (finding 2026-10-08).
 *
 * The phone used to hand the RAW file to its screens and its editor. The
 * editor holds a file without `\r`, so two texts for one file stood side by
 * side, and everything that compared them was wrong for a note from Windows:
 * it counted as edited the moment it was opened, a version from elsewhere
 * ended in a conflict copy, comment marks sat further right with every line,
 * no suggestion could be accepted — and a foreign text file was written back
 * with every line end turned.
 *
 * These tests run the phone's actual code — the one read of a file for an
 * editor, its saver, the editor host's reaction to a changed file — against
 * real files, a real SQLite and the real adapter chain. Only the native boot,
 * registry and notifications are replaced. (The comment operation has its own
 * real chain in commentOperationJournal.test.ts; the desktop's twins are
 * editorSaveRecovery.test.ts and editorExternalUpdate.test.ts.)
 */
type TestEditorState = { doc: { toString(): string } };
const { EditorState } = createRequire(resolve("../../packages/ui/package.json"))("@codemirror/state") as {
  EditorState: { create(spec: { doc: string }): TestEditorState };
};

const serviceSource = readFileSync(resolve("src/services/vaultService.ts"), "utf8");
const serviceFile = ts.createSourceFile("vaultService.ts", serviceSource, ts.ScriptTarget.Latest, true);
const functions = ["editorDiskText", "keepTextShape", "rememberPersistedText", "rememberCommentWrite", "getLastPersistedText"];
const methods = ["readEditor", "saveEditorText", "save"];
const found = { functions: [] as string[], methods: [] as string[], refusal: "", saver: "" };
(function visit(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) && node.name && functions.includes(node.name.text)) found.functions.push(node.getText(serviceFile).replace(/^export /, ""));
  if (ts.isClassDeclaration(node) && node.name?.text === "NotTextFileError") found.refusal = node.getText(serviceFile).replace(/^export /, "");
  if (ts.isMethodDeclaration(node) && methods.includes(node.name.getText(serviceFile))) found.methods.push(node.getText(serviceFile));
  if (ts.isVariableDeclaration(node) && node.name.getText(serviceFile) === "noteSaver") found.saver = node.initializer!.getText(serviceFile);
  ts.forEachChild(node, visit);
})(serviceFile);
if (found.functions.length !== functions.length || found.methods.length !== methods.length || !found.refusal || !found.saver) throw new Error("the phone's editor read/save definitions moved — re-point this harness");
const serviceCompiled = ts.transpileModule(
  "const lastPersistedText = new Map(); const editorBaseText = new Map(); const editorTextShape = new Map();\n" +
  found.refusal + "\n" + found.functions.join("\n") + "\n" +
  "const vaultOps = {" + found.methods.join(",\n") + "}; const noteSaver = " + found.saver + ";\n",
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;

const hostFile = ts.createSourceFile("EditorHost.tsx", readFileSync(resolve("src/EditorHost.tsx"), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let handler = "";
(function visit(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(hostFile) === "handleExternalUpdate") handler = node.initializer!.getText(hostFile);
  ts.forEachChild(node, visit);
})(hostFile);
if (!handler) throw new Error("original external-update callback missing");
const handlerCompiled = ts.transpileModule("const handle = " + handler, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;

// Built at run time: neither character is typed into this file.
const MARK = String.fromCharCode(0xfeff), NUL = String.fromCharCode(0);

interface Phone {
  vaultOps: { readEditor(v: MobileVault, path: string): Promise<string>; saveEditorText(v: MobileVault, path: string, text: string): Promise<void> };
  noteSaver: SaveCoordinator<MobileVault>;
  getLastPersistedText(v: MobileVault, path: string): string | null;
  rememberPersistedText(v: MobileVault, path: string, text: string): void;
  keepTextShape(v: MobileVault, from: string, to: string): void;
  editorDiskText(v: MobileVault, path: string, text: string): string;
  NotTextFileError: new (path: string) => Error;
}

let root: string, raw: LocalVaultAdapter, db: IDatabaseAdapter, backup: BackupVaultAdapter, vault: MobileVault, phone: Phone;
let conflicts: string[], events: EventTarget;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "plainva-phone-text-"));
  raw = new LocalVaultAdapter(root); await raw.initialize();
  db = await realSqlite();
  backup = new BackupVaultAdapter(raw);
  const files = new ConflictAwareVaultAdapter(new QueueingVaultAdapter(backup, new SyncQueue(db)), new SyncStateRepository(db));
  vault = { vaultId: "vault-a", adapter: raw, files, backup, db, indexer: null, reindexPaths: async () => {} } as unknown as MobileVault;
  conflicts = []; events = new EventTarget();
  const deps = {
    createSaveCoordinator, ConflictError, mergeEditorText, containsTextChanges, applyTextShape, editorTextOf, DEFAULT_TEXT_SHAPE, openEditorText,
    writeDraft: () => {}, clearDraft: () => {}, noteConflict: (path: string) => { conflicts.push(path); },
    conflictCopyPath: () => { throw new Error("actual conflict path required"); },
    syncSoon: () => {}, toast: { warning: () => {} }, i18n: { t: (key: string) => key }, window: events, CustomEvent, console: { error: () => {} },
  };
  phone = new Function(...Object.keys(deps), serviceCompiled +
    "\nreturn {vaultOps,noteSaver,getLastPersistedText,rememberPersistedText,keepTextShape,editorDiskText,NotTextFileError};")(...Object.values(deps)) as Phone;
});
afterEach(async () => {
  await phone.noteSaver.flushAll().catch(() => {});
  vi.restoreAllMocks();
  await db.close();
  await rm(root, { recursive: true, force: true });
});
const bytes = async (path: string) => (await readFile(join(root, path))).toString("utf8");
/** The file as it lies on disk, byte for byte. */
const rawBytes = async (path: string) => [...await readFile(join(root, path))];
const utf8 = (text: string) => [...new TextEncoder().encode(text)];

/** What the note screen and its editor host do when a file is opened. */
async function open(path: string) {
  const doc = await phone.vaultOps.readEditor(vault, path);
  let text = EditorState.create({ doc }).doc.toString();
  const session = { view: { state: { doc: { toString: () => text } } }, applyExternalText(next: string) { text = next; } };
  // EditorHost: the load-time snapshot IS the persisted state.
  phone.rememberPersistedText(vault, path, doc);
  const sessionRef = { current: session };
  const documents: string[] = [];
  events.addEventListener("m-editor-document", (event) => documents.push((event as CustomEvent<{ text: string }>).detail.text));
  const deps = {
    noteSaver: phone.noteSaver, path, vault, session, sessionRef, vaultOps: phone.vaultOps,
    getLastPersistedText: phone.getLastPersistedText, rememberPersistedText: phone.rememberPersistedText, editorDiskText: phone.editorDiskText,
    decideDirtyExternalUpdate, onVanishedRef: { current: null }, toast: { error: () => {} }, t: (key: string) => key,
    noteConflict: (target: string) => { conflicts.push(target); }, console: { error: () => {} }, window: events, CustomEvent,
  };
  const changedOnDisk = new Function(...Object.keys(deps), handlerCompiled + "\nreturn handle;")(...Object.values(deps)) as () => Promise<void>;
  return {
    doc, documents, changedOnDisk,
    get text() { return text; },
    /** Typing: the editor's text changes and the save is scheduled. */
    type(next: string) { text = next; phone.noteSaver.schedule(vault, path, next); },
    /** Typing that has not reached the saver yet. */
    hold(next: string) { text = next; },
  };
}

describe("the phone holds a file the way its editor does", () => {
  it("hands the screen and the editor ONE text for a note with \\r\\n and a mark", async () => {
    await raw.writeTextFile("Note.md", `${MARK}one\r\ntwo\r\nthree\r\n`);
    const note = await open("Note.md");
    expect(note.doc).toBe("one\ntwo\nthree\n");
    // The screen resolves comment anchors on `doc`, the editor draws them at
    // those offsets: they are offsets into the same string now.
    expect(note.text).toBe(note.doc);
    expect(phone.getLastPersistedText(vault, "Note.md")).toBe(note.text);
  });

  it("does not take an untouched note with \\r\\n for edited: a version from elsewhere is adopted quietly", async () => {
    await raw.writeTextFile("Note.md", "one\r\ntwo\r\n");
    const note = await open("Note.md");
    // A pull, or another program, rewrote the file. Nobody typed here.
    await raw.writeTextFile("Note.md", "one\r\ntwo\r\nthree from elsewhere\r\n");
    await note.changedOnDisk();
    expect(note.text).toBe("one\ntwo\nthree from elsewhere\n");
    expect(note.documents).toEqual(["one\ntwo\nthree from elsewhere\n"]);
    expect(phone.getLastPersistedText(vault, "Note.md")).toBe("one\ntwo\nthree from elsewhere\n");
    // It used to end here: a conflict copy of text nobody had written.
    expect(await vault.files.getConflictSession!("Note.md")).toBeNull();
    expect(conflicts).toEqual([]);
  });

  it("keeps unsaved typing as a conflict copy in the file's own shape when another version arrives", async () => {
    await raw.writeTextFile("Settings.ini", `${MARK}[a]\r\nx=1\r\n`);
    const file = await open("Settings.ini");
    file.hold("[a]\nx=typed here\n");
    await raw.writeTextFile("Settings.ini", `${MARK}[a]\r\nx=from elsewhere\r\n`);
    await file.changedOnDisk();
    const conflict = await vault.files.getConflictSession!("Settings.ini");
    expect(conflict).not.toBeNull();
    expect(await bytes(conflict!.workingCopyPath)).toBe(`${MARK}[a]\r\nx=typed here\r\n`);
    expect(await bytes("Settings.ini")).toBe(`${MARK}[a]\r\nx=from elsewhere\r\n`);
    expect(file.text).toBe("[a]\nx=typed here\n");
  });
});

describe("the phone writes a file back in its shape", () => {
  it("saves a foreign text file with the line ends and the mark it arrived with", async () => {
    const windows = `${MARK}[section]\r\nkey=1\r\n`;
    await raw.writeTextFile("Settings.ini", windows);
    const file = await open("Settings.ini");
    expect(file.doc).toBe("[section]\nkey=1\n");
    file.type("[section]\nkey=2\n");
    await phone.noteSaver.flushAll();
    // It used to come back as "[section]\nkey=2\n" behind the mark: every line
    // end of a file that is not ours, turned by one edit.
    expect(await bytes("Settings.ini")).toBe(`${MARK}[section]\r\nkey=2\r\n`);
    // What the saver remembers is the editor's text again.
    expect(phone.getLastPersistedText(vault, "Settings.ini")).toBe("[section]\nkey=2\n");
    expect(conflicts).toEqual([]);
    // …so the next edit is an ordinary save, not a merge with itself.
    file.type("[section]\nkey=3\n");
    await phone.noteSaver.flushAll();
    expect(await bytes("Settings.ini")).toBe(`${MARK}[section]\r\nkey=3\r\n`);
  });

  it("saves a note with the line ends and the mark it arrived with: an edit changes the edited line, byte for byte", async () => {
    await raw.writeTextFile("Note.md", `${MARK}one\r\ntwo\r\nthree\r\n`);
    const before = await rawBytes("Note.md");
    const note = await open("Note.md");
    note.type("one\ntwo!\nthree\n");
    await phone.noteSaver.flushAll();
    // Until 2026-10-09 the note came back as "one\ntwo!\nthree\n" behind its
    // mark, on the phone as on the desktop: every line end turned by one edit
    // — the whole file, for whoever keeps the vault in Git. Now one byte is
    // new, and every other one stays.
    const after = await rawBytes("Note.md");
    expect(after).toEqual([0xef, 0xbb, 0xbf, ...utf8("one\r\ntwo!\r\nthree\r\n")]);
    const at = before.length - utf8("\r\nthree\r\n").length;
    expect(after.slice(0, at)).toEqual(before.slice(0, at));
    expect(after.slice(at + 1)).toEqual(before.slice(at));
    expect(phone.getLastPersistedText(vault, "Note.md")).toBe("one\ntwo!\nthree\n");
    expect(conflicts).toEqual([]);
    // What the saver remembers is the editor's text again, so the next edit starts from it.
    note.type("one\ntwo!\nthree!\n");
    await phone.noteSaver.flushAll();
    expect(await rawBytes("Note.md")).toEqual([0xef, 0xbb, 0xbf, ...utf8("one\r\ntwo!\r\nthree!\r\n")]);
    expect(conflicts).toEqual([]);
  });

  it("keeps a note's line ends and mark when a change made elsewhere merges into the save", async () => {
    const windows = `${MARK}a\r\nb\r\nc\r\nd\r\n`;
    await raw.writeTextFile("Note.md", windows);
    const note = await open("Note.md");
    // A pull, or another program, changed the last line; the save comes before the screen heard of it.
    await raw.writeTextFile("Note.md", `${MARK}a\r\nb\r\nc\r\nd from elsewhere\r\n`);
    note.type("a!\nb\nc\nd\n");
    await phone.noteSaver.flushAll();
    expect(await rawBytes("Note.md")).toEqual([0xef, 0xbb, 0xbf, ...utf8("a!\r\nb\r\nc\r\nd from elsewhere\r\n")]);
    expect(phone.getLastPersistedText(vault, "Note.md")).toBe("a!\nb\nc\nd from elsewhere\n");
    expect(conflicts).toEqual([]);
  });

  it("saves a note that arrived with \\n with \\n, and a new one too", async () => {
    await raw.writeTextFile("Unix.md", "one\ntwo\n");
    const note = await open("Unix.md");
    note.type("one\ntwo!\n");
    await phone.noteSaver.flushAll();
    expect(await rawBytes("Unix.md")).toEqual(utf8("one\ntwo!\n"));
    // A note Plainva has just created: one line, nothing to count yet.
    await raw.writeTextFile("New.md", "# New");
    const fresh = await open("New.md");
    fresh.type("# New\n\nFirst line.\n");
    await phone.noteSaver.flushAll();
    expect(await rawBytes("New.md")).toEqual(utf8("# New\n\nFirst line.\n"));
  });

  it("keeps a note's unsaved typing as a conflict copy in the note's own shape", async () => {
    await raw.writeTextFile("Note.md", `${MARK}one\r\ntwo\r\n`);
    const note = await open("Note.md");
    note.hold("one\ntwo typed here\n");
    await raw.writeTextFile("Note.md", `${MARK}one\r\ntwo from elsewhere\r\n`);
    await note.changedOnDisk();
    const conflict = await vault.files.getConflictSession!("Note.md");
    expect(conflict).not.toBeNull();
    expect(await bytes(conflict!.workingCopyPath)).toBe(`${MARK}one\r\ntwo typed here\r\n`);
    expect(await bytes("Note.md")).toBe(`${MARK}one\r\ntwo from elsewhere\r\n`);
  });

  it("does not write a text that did not change: leaving the suggestion mode costs a note from Windows nothing", async () => {
    const windows = `${MARK}one\r\ntwo\r\n`;
    await raw.writeTextFile("Note.md", windows);
    const note = await open("Note.md");
    const write = vi.spyOn(raw, "writeTextFile");
    // What the suggestion mode's exit does (and an edit taken back before the
    // save came): the text the note already has, reported as an edit. It used
    // to be written — a version, an upload, and every "\r\n" of the note.
    note.type(note.doc);
    await phone.noteSaver.flushAll();
    expect(write).not.toHaveBeenCalled();
    expect(await bytes("Note.md")).toBe(windows);
    expect(await db.query("SELECT file_path FROM offline_queue")).toEqual([]);
    // The first real edit is saved as ever — and leaves the note its shape.
    note.type("one\ntwo!\n");
    await phone.noteSaver.flushAll();
    expect(await bytes("Note.md")).toBe(`${MARK}one\r\ntwo!\r\n`);
    expect(await db.query("SELECT file_path FROM offline_queue")).toEqual([{ file_path: "Note.md" }]);
  });

  it("writes a foreign file with one stray line end back in its majority — one line of diff, not the whole file", async () => {
    await raw.writeTextFile("Settings.ini", "a\r\nb\r\nc\nd\r\n");
    const file = await open("Settings.ini");
    file.type("a!\nb\nc\nd\n");
    await phone.noteSaver.flushAll();
    expect(await bytes("Settings.ini")).toBe("a!\r\nb\r\nc\r\nd\r\n");
  });

  it("saves a file that has since been rewritten elsewhere in the shape of the version it adopted", async () => {
    await raw.writeTextFile("Data.csv", "id;name\r\n1;Ada\r\n");
    const file = await open("Data.csv");
    // Another program rewrote it with "\n" and added a row; the editor adopts that.
    await raw.writeTextFile("Data.csv", "id;name\n1;Ada\n2;Grace\n");
    await file.changedOnDisk();
    expect(file.text).toBe("id;name\n1;Ada\n2;Grace\n");
    file.type("id;name\n1;Ada\n2;Grace\n3;Edsger\n");
    await phone.noteSaver.flushAll();
    expect(await bytes("Data.csv")).toBe("id;name\n1;Ada\n2;Grace\n3;Edsger\n");
  });

  it("brings a vanished file back in its shape, and follows a moved one in it", async () => {
    const windows = `${MARK}[a]\r\nx=1\r\n`;
    await raw.writeTextFile("Settings.ini", windows);
    const file = await open("Settings.ini");
    // "Save here again": the file is gone, the reader wants it back where it was.
    await raw.deleteItem("Settings.ini");
    await phone.vaultOps.saveEditorText(vault, "Settings.ini", "[a]\nx=typed\n");
    expect(await bytes("Settings.ini")).toBe(`${MARK}[a]\r\nx=typed\r\n`);
    // The file turns out moved: the unsaved text travels to the new place (NoteScreen.carryAndFollow).
    await raw.writeTextFile("Moved/Settings.ini", windows);
    phone.rememberPersistedText(vault, "Moved/Settings.ini", file.doc);
    phone.keepTextShape(vault, "Settings.ini", "Moved/Settings.ini");
    phone.noteSaver.schedule(vault, "Moved/Settings.ini", "[a]\nx=carried\n");
    await phone.noteSaver.flushAll();
    expect(await bytes("Moved/Settings.ini")).toBe(`${MARK}[a]\r\nx=carried\r\n`);
  });

  it("gives a version restored from the history back byte for byte", async () => {
    // A restore copies a snapshot; no editor text is involved, so there is no
    // shape to put back — and none may be taken away.
    const first = `${MARK}first\r\nversion\r\n`;
    await raw.writeTextFile("Note.md", first);
    await backup.forceBackup("Note.md");
    await vault.files.writeTextFile("Note.md", "second\nversion\n");
    const history = new VersionHistoryService(raw);
    const [snapshot] = await history.listVersions("Note.md");
    await history.restoreVersion({ backupPath: snapshot.backupPath, targetPath: "Note.md", writeAdapter: vault.files });
    expect(await bytes("Note.md")).toBe(first);
    expect(await phone.vaultOps.readEditor(vault, "Note.md")).toBe("first\nversion\n");
  });
});

describe("the phone and a file that is not what its name says", () => {
  it("refuses a text-named file whose bytes are not text, and remembers nothing of it", async () => {
    await raw.writeTextFile("dump.log", `PK${NUL}${NUL}binary`);
    await expect(phone.vaultOps.readEditor(vault, "dump.log")).rejects.toBeInstanceOf(phone.NotTextFileError);
    // Nothing of it reached an editor, so nothing of it can be saved back.
    expect(phone.getLastPersistedText(vault, "dump.log")).toBeNull();
    expect(phone.editorDiskText(vault, "dump.log", "x\ny")).toBe("x\ny");
    expect(await bytes("dump.log")).toBe(`PK${NUL}${NUL}binary`);
    // A note is a note by its name: it opens, as on the desktop.
    await raw.writeTextFile("Odd.md", `a${NUL}b\n`);
    expect(await phone.vaultOps.readEditor(vault, "Odd.md")).toBe(`a${NUL}b\n`);
  });
});
