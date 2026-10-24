// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import ts from "typescript";
import {
  BackupVaultAdapter, ConflictAwareVaultAdapter, ConflictError, NotTextFileError, QueueingVaultAdapter, SyncQueue, SyncStateRepository,
  applyTextShape, containsTextChanges, copyFileContent, DEFAULT_TEXT_SHAPE, editorTextOf, isNotTextFileError, mergeEditorText, type IDatabaseAdapter, type IVaultAdapter,
} from "@plainva/core";
import { keepTextBeside, newestConflictCopy, openEditorText } from "@plainva/ui";
import { LocalVaultAdapter } from "../../../../packages/core/src/vault/LocalVaultAdapter";
import { realSqlite } from "../../../../packages/core/test/helpers/realSqlite";
import { RefusingVaultAdapter } from "../../../../packages/core/test/helpers/textReaders";
import { ExternalVaultAdapter } from "../adapters/ExternalVaultAdapter";
import { fakeVaultFolder, folderBytes } from "../adapters/fakeVaultFolder";
import { createSaveCoordinator, type SaveCoordinator } from "./saveCoordinator";
import type { MobileVault } from "./vaultService";

/**
 * The phone and a file whose name says text and whose bytes are not UTF-8 — a
 * `.csv` Excel saved in Windows-1252, a note from an old program (finding
 * 2026-10-11).
 *
 * The phone opened such a file wherever its reader replaces what is not UTF-8
 * — the sandbox on Android, a folder the user picked, which is decoded in
 * JavaScript —, with replacement characters, and its first save wrote that
 * reading over the file. A duplicate was the reading too. Where the reader
 * refuses (the sandbox on iOS), the screen called the file missing.
 *
 * These tests run the phone's actual code — the read of a file for its
 * editor, its note saver, its duplicate — over the vault's real chain and the
 * three storages a phone reads through, and read what lies there afterwards
 * as bytes. The screens' answer to the refusal is the note screen's
 * "not text" state (`e2e-prod/not-text.spec.ts`).
 */

const sourceOf = (file: string) => ts.createSourceFile(file, readFileSync(resolve(file), "utf8"), ts.ScriptTarget.Latest, true);
function all<T extends ts.Node>(root: ts.Node, is: (node: ts.Node) => node is T): T[] {
  const found: T[] = [];
  (function visit(node: ts.Node) {
    if (is(node)) found.push(node);
    ts.forEachChild(node, visit);
  })(root);
  return found;
}
const serviceFile = sourceOf("src/services/vaultService.ts");
const methods = all(serviceFile, ts.isMethodDeclaration).filter((m) => ["readEditor", "duplicateNote", "save"].includes(m.name.getText(serviceFile)));
const saver = all(serviceFile, ts.isVariableDeclaration).find((d) => d.name.getText(serviceFile) === "noteSaver")?.initializer;
const remember = all(serviceFile, ts.isFunctionDeclaration).find((f) => f.name?.text === "rememberPersistedText");
const forget = all(serviceFile, ts.isFunctionDeclaration).find((f) => f.name?.text === "forgetKeptText");
if (methods.length !== 3 || !saver || !remember || !forget) throw new Error("the phone's read, duplicate and note saver moved — re-point this harness");
const serviceCode = ts.transpileModule(
  "const lastPersistedText = new Map(); const editorBaseText = new Map(); const editorTextShape = new Map(); const keptTexts = new Map();\n" +
  `${remember.getText(serviceFile).replace(/^export /, "")}\n` +
  `${forget.getText(serviceFile).replace(/^export /, "")}\n` +
  `const vaultOps = {${methods.map((m) => m.getText(serviceFile)).join(",\n")}}; const noteSaver = ${saver.getText(serviceFile)};`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;

interface Phone {
  vaultOps: {
    readEditor(v: MobileVault, path: string): Promise<string>;
    duplicateNote(v: MobileVault, path: string): Promise<string>;
  };
  noteSaver: SaveCoordinator<MobileVault>;
  rememberPersistedText(v: MobileVault, path: string, text: string): void;
  forgetKeptText(v: MobileVault, path: string): void;
}

// What the note screen does once the context sheet changed the note — a
// property written, a version restored (`readAgain`).
const screenFile = ts.createSourceFile("NoteScreen.tsx", readFileSync(resolve("src/screens/NoteScreen.tsx"), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const readAgainCall = all(screenFile, ts.isVariableDeclaration).find((d) => d.name.getText(screenFile) === "readAgain")?.initializer;
if (!readAgainCall || !ts.isCallExpression(readAgainCall) || !readAgainCall.arguments[0]) throw new Error("the note screen's read after a change moved — re-point this harness");
const readAgainCode = ts.transpileModule(`const readAgain = ${readAgainCall.arguments[0].getText(screenFile)};`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;

/** The note screen's `readAgain` over the phone's own read, with its state setters watched. */
function noteScreenOver(vault: MobileVault, phone: Phone, path: string) {
  const set = { doc: vi.fn(), reloadTick: vi.fn(), editing: vi.fn(), notText: vi.fn(), loadError: vi.fn(), loadAgain: vi.fn(), error: vi.fn() };
  const knownIdentityRef = { current: null as unknown };
  const scope = {
    vaultOps: phone.vaultOps, vault, path, NotTextFileError, console: { error: set.error },
    setDoc: set.doc, setReloadTick: set.reloadTick, setEditing: set.editing, setNotText: set.notText, setLoadError: set.loadError, setLoadAgain: set.loadAgain,
    readIndexedIdentity: async (_db: unknown, p: string) => ({ path: p, known: true }), knownIdentityRef,
  };
  const readAgain = new Function(...Object.keys(scope), `${readAgainCode}\nreturn readAgain;`)(...Object.values(scope)) as () => void;
  return { readAgain, set, knownIdentityRef };
}

// What the note screen's load does when the read fails (`.catch` of the load):
// for a file that is no text, the state, the leftover draft, the card.
const loadFailedCall = all(screenFile, ts.isArrowFunction).find((fn) => ts.isCallExpression(fn.parent)
  && fn.parent.expression.getText(screenFile).endsWith(".catch") && fn.getText(screenFile).includes("takeLeftoverDraft(vault, path)"));
if (!loadFailedCall) throw new Error("the note screen's failed load moved — re-point this harness");
const loadFailedCode = ts.transpileModule(`const loadFailed = ${loadFailedCall.getText(screenFile)};`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;

interface Draft { text: string; ts: number; revision?: number }

function gateOf() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

/**
 * The note screen's failed load over a vault: with a leftover draft of an
 * earlier run in the journal, or none, and a draft on offer, or none. Two
 * loads of one screen share its offer and its claims (`screen`); `hold` keeps
 * the load waiting at the journal.
 */
function failedLoadOver(vault: MobileVault, path: string, leftover: Draft | null, offered: Draft | null = null,
  screen = { offeredDraftRef: { current: offered }, claimedOffersRef: { current: new WeakSet<Draft>() } }, hold: Promise<void> = Promise.resolve()) {
  const set = { notText: vi.fn(), loadError: vi.fn(), draft: vi.fn(), warning: vi.fn(), error: vi.fn(), clearDraftIf: vi.fn(), release: vi.fn() };
  const noted = new Map<string, string>();
  let handed = leftover;
  const scope = {
    stale: false, vault, path, NotTextFileError, setNotText: set.notText, setLoadError: set.loadError, setDraft: set.draft,
    offeredDraftRef: screen.offeredDraftRef, claimedOffersRef: screen.claimedOffersRef, editorTextOf,
    takeLeftoverDraft: async () => { await hold; const draft = handed; handed = null; return draft; },
    releaseLeftoverDraft: set.release,
    keepTextBeside, clearDraftIf: set.clearDraftIf, newestConflictCopy,
    noteConflict: (p: string, copy: string) => { noted.set(p, copy); },
    getConflict: (p: string) => (noted.has(p) ? { path: p, copyPath: noted.get(p)! } : null),
    toast: { warning: set.warning }, t: (key: string, values?: { path?: string }) => (values?.path ? `${key} ${values.path}` : key),
    console: { error: set.error },
  };
  const loadFailed = new Function(...Object.keys(scope), `${loadFailedCode}\nreturn loadFailed;`)(...Object.values(scope)) as (error: unknown) => void;
  /** What the offer shows once the load's updates ran, starting from what it showed before. */
  const offerAfter = (before: Draft | null) =>
    set.draft.mock.calls.reduce<Draft | null>((state, [next]) => (typeof next === "function" ? next(state) : next), before);
  return { loadFailed, set, noted, offerAfter, screen };
}

// What "Restore" on the note screen's draft banner does (an inline handler in its markup).
const restoreCall = all(screenFile, ts.isArrowFunction).filter((fn) => fn.getText(screenFile).includes("noteSaver.schedule(vault, path, d.text)"))
  .sort((a, b) => a.getWidth(screenFile) - b.getWidth(screenFile))[0];
if (!restoreCall) throw new Error("the note screen's draft restore moved — re-point this harness");
const restoreCode = ts.transpileModule(`const restoreDraft = ${restoreCall.getText(screenFile)};`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;

// And what "Discard" there does.
const discardCall = all(screenFile, ts.isArrowFunction).filter((fn) => {
  const text = fn.getText(screenFile);
  return text.includes("claimedOffersRef.current.has(draft)") && text.includes("clearDraft(vault, path);");
}).sort((a, b) => a.getWidth(screenFile) - b.getWidth(screenFile))[0];
if (!discardCall) throw new Error("the note screen's draft discard moved — re-point this harness");
const discardCode = ts.transpileModule(`const discardDraft = ${discardCall.getText(screenFile)};`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;

describe("the note screen's draft banner while its draft is kept beside a file that is no text", () => {
  it("ignores Restore and Discard on an offer the load is keeping that very moment — kept once, and not against the reader's word", () => {
    const claimed = { path: "Alt.md", text: "kept right now\n", ts: 1 };
    const spies = {
      setDraft: vi.fn(), setDoc: vi.fn(), setReloadTick: vi.fn(), forgetKeptText: vi.fn(), clearDraft: vi.fn(),
      noteSaver: { schedule: vi.fn(), withWriteLock: vi.fn() },
    };
    const scope = { ...spies, draft: claimed, claimedOffersRef: { current: new WeakSet([claimed]) }, vault: { vaultId: "phone-vault" }, path: "Alt.md" };
    for (const [code, name] of [[restoreCode, "restoreDraft"], [discardCode, "discardDraft"]] as const) {
      (new Function(...Object.keys(scope), `${code}\nreturn ${name};`)(...Object.values(scope)) as () => void)();
    }
    for (const spy of [spies.setDraft, spies.setDoc, spies.setReloadTick, spies.forgetKeptText, spies.clearDraft, spies.noteSaver.schedule, spies.noteSaver.withWriteLock]) {
      expect(spy).not.toHaveBeenCalled();
    }
    // An offer nobody is keeping is restored and discarded as ever.
    const free = { ...scope, claimedOffersRef: { current: new WeakSet() } };
    (new Function(...Object.keys(free), `${discardCode}\nreturn discardDraft;`)(...Object.values(free)) as () => void)();
    expect(spies.clearDraft).toHaveBeenCalledWith(free.vault, "Alt.md");
    expect(spies.setDraft).toHaveBeenCalledWith(null);
  });
});

/** The note screen's draft restore, for a draft on offer, over the phone's own saver. */
function restoreOver(vault: MobileVault, phone: Phone, path: string, draft: Draft & { path: string }) {
  const scope = {
    draft, setDraft: vi.fn(), setDoc: vi.fn(), setReloadTick: vi.fn(), forgetKeptText: phone.forgetKeptText, noteSaver: phone.noteSaver, vault, path,
    claimedOffersRef: { current: new WeakSet() },
  };
  return new Function(...Object.keys(scope), `${restoreCode}\nreturn restoreDraft;`)(...Object.values(scope)) as () => void;
}

/** The conflict copies beside `path` that are not in `except`. */
async function copiesBeside(vault: MobileVault, path: string, except: string[] = []): Promise<string[]> {
  const stem = path.replace(/\.[^.]+$/, "");
  return (await vault.files.listDir("", false)).map((entry) => entry.path)
    .filter((entry) => entry.startsWith(`${stem}.CONFLICT-`) && !except.includes(entry)).sort();
}

const utf8 = (text: string) => [...new TextEncoder().encode(text)];
const windows1252 = (text: string) => [...text].map((char) => char.charCodeAt(0));
const NOTE = windows1252("---\nstatus: offen\n---\n# Grüße\r\n\r\neins\r\n");
const TABLE = windows1252("id;name\r\n1;Grün\r\n2;Blau\r\n");

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  while (closers.length > 0) await closers.pop()!();
});

/** A storage of the phone: what it reads through, how another program puts bytes there, and the bytes that lie there. */
interface Storage { raw: IVaultAdapter; put(path: string, bytes: number[]): Promise<void>; bytes(path: string): Promise<number[]> }

async function onDisk(kind: "replaces" | "refuses"): Promise<Storage> {
  const root = await mkdtemp(join(tmpdir(), "plainva-phone-not-text-"));
  closers.push(() => rm(root, { recursive: true, force: true }));
  const raw = kind === "refuses" ? new RefusingVaultAdapter(root) : new LocalVaultAdapter(root);
  await raw.initialize();
  return {
    raw,
    put: (path, bytes) => writeFile(join(root, path), new Uint8Array(bytes)),
    bytes: async (path) => [...await readFile(join(root, path))],
  };
}

async function pickedFolder(): Promise<Storage> {
  const files = new Map<string, string | Uint8Array>();
  const raw = new ExternalVaultAdapter(fakeVaultFolder(files).plugin, "folder");
  await raw.initialize();
  return {
    raw,
    put: async (path, bytes) => { files.set(path, new Uint8Array(bytes)); },
    bytes: async (path) => folderBytes(files, path),
  };
}

const STORAGES = [
  { name: "the app's storage, read by a reader that replaces (Android, and the iPhone since 2026-10-20)", make: () => onDisk("replaces") },
  { name: "the app's storage, read by a reader that refuses (the iPhone until 2026-10-20)", make: () => onDisk("refuses") },
  { name: "a folder the user picked, decoded in JavaScript", make: () => pickedFolder() },
] as const;

/** The vault `boot` builds over a storage, and the phone's code over it. */
async function phoneOver(storage: Storage) {
  const db: IDatabaseAdapter = await realSqlite();
  closers.push(() => db.close());
  const backup = new BackupVaultAdapter(storage.raw);
  const files = new ConflictAwareVaultAdapter(new QueueingVaultAdapter(backup, new SyncQueue(db)), new SyncStateRepository(db));
  const vault = { vaultId: "phone-vault", adapter: storage.raw, files, backup, db, indexer: null, reindexPaths: async () => {} } as unknown as MobileVault;
  const warnings: string[] = [];
  const conflicts: Array<{ path: string; copyPath: string }> = [];
  const events: Array<{ type: string; path?: string; kept?: string }> = [];
  const window = new EventTarget();
  window.addEventListener("m-note-not-text", (event) => {
    const { path, kept } = (event as CustomEvent<{ path?: string; kept?: string }>).detail;
    events.push({ type: event.type, path, kept });
  });
  // The note saver's keep beside the file can be held.
  const hooks = { beforeKeep: async () => {} };
  const scope = {
    createSaveCoordinator, ConflictError, NotTextFileError, mergeEditorText, containsTextChanges, applyTextShape, editorTextOf, DEFAULT_TEXT_SHAPE,
    openEditorText, copyFileContent, isNotTextFileError,
    keepTextBeside: async (...args: Parameters<typeof keepTextBeside>) => { await hooks.beforeKeep(); return keepTextBeside(...args); },
    writeDraft: () => {}, clearDraft: () => {}, reportCreated: () => {},
    noteConflict: (path: string, copyPath: string) => { conflicts.push({ path, copyPath }); },
    conflictCopyPath: () => { throw new Error("actual conflict path required"); },
    syncSoon: () => {}, toast: { warning: (message: string) => { warnings.push(message); }, error: () => {} },
    i18n: { t: (key: string, values?: { path?: string }) => (values?.path ? `${key} ${values.path}` : key) },
    window, CustomEvent, console: { error: () => {}, warn: () => {} },
  };
  const phone = new Function(...Object.keys(scope), `${serviceCode}\nreturn { vaultOps, noteSaver, rememberPersistedText, forgetKeptText };`)(...Object.values(scope)) as Phone;
  return { vault, phone, warnings, conflicts, events, hooks };
}

for (const storage of STORAGES) {
  describe(`the phone and a file in another encoding — ${storage.name}`, () => {
    it("does not open a note or a table in Windows-1252 for its editor, and leaves both as they lie there", async () => {
      const disk = await storage.make();
      const { vault, phone } = await phoneOver(disk);
      await disk.put("Alt.md", NOTE);
      await disk.put("Data.csv", TABLE);
      // The refusal the note screen shows as "not text" — for the note too,
      // which the first bytes alone never refused.
      await expect(phone.vaultOps.readEditor(vault, "Alt.md")).rejects.toBeInstanceOf(NotTextFileError);
      await expect(phone.vaultOps.readEditor(vault, "Data.csv")).rejects.toBeInstanceOf(NotTextFileError);
      expect(await disk.bytes("Alt.md")).toEqual(NOTE);
      expect(await disk.bytes("Data.csv")).toEqual(TABLE);
    });

    it("keeps the save of an open note whose file another program saved in another encoding beside it, as a conflict copy — the note keeps its bytes", async () => {
      const disk = await storage.make();
      const { vault, phone, warnings, conflicts, events } = await phoneOver(disk);
      await disk.put("Alt.md", utf8("# Alt\r\n\r\neins\r\n"));
      const text = await phone.vaultOps.readEditor(vault, "Alt.md");
      phone.rememberPersistedText(vault, "Alt.md", text);
      // Meanwhile another program writes the note back in Windows-1252.
      await disk.put("Alt.md", NOTE);
      phone.noteSaver.schedule(vault, "Alt.md", `${text}zwei\n`);
      await phone.noteSaver.flush("Alt.md", vault);
      expect(await disk.bytes("Alt.md")).toEqual(NOTE);
      // The text lies beside it, in the shape the note was read in; the note
      // gets its card, the screen hears where the text went, and it is said once.
      expect(conflicts).toHaveLength(1);
      const [{ path, copyPath }] = conflicts;
      expect(path).toBe("Alt.md");
      expect(copyPath).toMatch(/^Alt\.CONFLICT-[^/]+\.md$/);
      expect(await disk.bytes(copyPath)).toEqual(utf8("# Alt\r\n\r\neins\r\nzwei\r\n"));
      expect(events).toEqual([{ type: "m-note-not-text", path: "Alt.md", kept: copyPath }]);
      expect(warnings).toEqual([`dialogs.conflictSavedMsg ${copyPath}`]);
      expect(await vault.files.listConflictSessions!()).toEqual([]);
      // The same text once more — the editor's next save — makes no second copy and is not said again.
      phone.noteSaver.schedule(vault, "Alt.md", `${text}zwei\n`);
      await phone.noteSaver.flush("Alt.md", vault);
      expect(new Set(conflicts.map((c) => c.copyPath))).toEqual(new Set([copyPath]));
      expect(warnings).toHaveLength(1);
      expect((await vault.files.listDir("", false)).filter((entry) => entry.path.includes(".CONFLICT-")).map((entry) => entry.path)).toEqual([copyPath]);
      expect(await disk.bytes(copyPath)).toEqual(utf8("# Alt\r\n\r\neins\r\nzwei\r\n"));
      expect(await disk.bytes("Alt.md")).toEqual(NOTE);
    });

    it("keeps typing that went on in the copy kept before, also across the open editor's re-read — and a text of the next load in a copy of its own", async () => {
      const disk = await storage.make();
      const { vault, phone, conflicts, warnings } = await phoneOver(disk);
      await disk.put("Alt.md", utf8("# Alt\n\neins\n"));
      const text = await phone.vaultOps.readEditor(vault, "Alt.md");
      phone.rememberPersistedText(vault, "Alt.md", text);
      await disk.put("Alt.md", NOTE);
      phone.noteSaver.schedule(vault, "Alt.md", `${text}zwei\n`);
      await phone.noteSaver.flush("Alt.md", vault);
      // The open editor reads the file again when it hears of a change — it is
      // still no text —, and the saver holds a newer revision of the same buffer.
      await expect(phone.vaultOps.readEditor(vault, "Alt.md")).rejects.toBeInstanceOf(NotTextFileError);
      phone.noteSaver.schedule(vault, "Alt.md", `${text}zwei\ndrei\n`);
      await phone.noteSaver.flush("Alt.md", vault);
      expect(new Set(conflicts.map((c) => c.copyPath)).size).toBe(1);
      const [{ copyPath: first }] = conflicts;
      expect(await disk.bytes(first)).toEqual(utf8("# Alt\n\neins\nzwei\ndrei\n"));
      expect(warnings).toHaveLength(1);
      // The next load: the file is text again, an editor opens it — and it
      // turns into no text once more while that editor holds changes. Its text
      // is another one, kept in a copy of its own.
      await disk.put("Alt.md", utf8("# Neu\n"));
      const again = await phone.vaultOps.readEditor(vault, "Alt.md");
      phone.rememberPersistedText(vault, "Alt.md", again);
      await disk.put("Alt.md", NOTE);
      phone.noteSaver.schedule(vault, "Alt.md", "# Neu\n\nvier\n");
      await phone.noteSaver.flush("Alt.md", vault);
      expect(new Set(conflicts.map((c) => c.copyPath)).size).toBe(2);
      expect(await disk.bytes(first)).toEqual(utf8("# Alt\n\neins\nzwei\ndrei\n"));
      expect(await disk.bytes(conflicts[conflicts.length - 1].copyPath)).toEqual(utf8("# Neu\n\nvier\n"));
      expect(await disk.bytes("Alt.md")).toEqual(NOTE);
    });

    it("brings all of the typing into a file that is text again by the next save — merged against what the editor loaded, as on the desktop; the copy keeps what was kept", async () => {
      const disk = await storage.make();
      const { vault, phone, conflicts } = await phoneOver(disk);
      await disk.put("Alt.md", utf8("a\nb\nc\nd\ne\n"));
      const text = await phone.vaultOps.readEditor(vault, "Alt.md");
      phone.rememberPersistedText(vault, "Alt.md", text);
      await disk.put("Alt.md", NOTE);
      phone.noteSaver.schedule(vault, "Alt.md", "a!\nb\nc\nd\ne\n");
      await phone.noteSaver.flush("Alt.md", vault);
      const [{ copyPath }] = conflicts;
      // The other program saves it as UTF-8 again, with a change of its own, while typing went on.
      await disk.put("Alt.md", utf8("a\nb\nc\nd\ne!\n"));
      phone.noteSaver.schedule(vault, "Alt.md", "a!\nb!\nc\nd\ne\n");
      await phone.noteSaver.flush("Alt.md", vault);
      expect(await disk.bytes("Alt.md")).toEqual(utf8("a!\nb!\nc\nd\ne!\n"));
      expect(await disk.bytes(copyPath)).toEqual(utf8("a!\nb\nc\nd\ne\n"));
      // The file took the text: a later keep makes a copy of its own, and the first one stays as it is.
      await disk.put("Alt.md", NOTE);
      phone.noteSaver.schedule(vault, "Alt.md", "a!\nb!\nc!\nd\ne!\n");
      await phone.noteSaver.flush("Alt.md", vault);
      expect(new Set(conflicts.map((c) => c.copyPath)).size).toBe(2);
      expect(await disk.bytes(copyPath)).toEqual(utf8("a!\nb\nc\nd\ne\n"));
    });

    it("shows a version restored from the context sheet as what it is — no text — instead of the text the screen held", async () => {
      const disk = await storage.make();
      const { vault, phone } = await phoneOver(disk);
      await disk.put("Alt.md", utf8("# Alt\n"));
      const { readAgain, set, knownIdentityRef } = noteScreenOver(vault, phone, "Alt.md");
      // A version of the note in Windows-1252 is put back.
      await disk.put("Alt.md", NOTE);
      readAgain();
      await vi.waitFor(() => expect(set.notText).toHaveBeenCalledWith(true));
      expect(set.doc).toHaveBeenLastCalledWith(null);
      expect(set.editing).toHaveBeenCalledWith(false);
      // The load's own way follows, which also looks beside the file.
      expect(set.loadAgain).toHaveBeenCalledTimes(1);
      expect(set.error).not.toHaveBeenCalled();
      expect(knownIdentityRef.current).toBeNull();
      // A version that is text shows as ever — and the screen is a text's
      // again, not one that loads anew at every change.
      await disk.put("Alt.md", utf8("# Alt\n\nzwei\n"));
      readAgain();
      await vi.waitFor(() => expect(set.doc).toHaveBeenLastCalledWith("# Alt\n\nzwei\n"));
      expect(set.reloadTick).toHaveBeenCalledTimes(1);
      expect(set.notText).toHaveBeenLastCalledWith(false);
      expect(set.loadError).toHaveBeenLastCalledWith(false);
      expect(set.loadAgain).toHaveBeenCalledTimes(1);
      // What was read is remembered for the day the file vanishes, as after a load.
      await vi.waitFor(() => expect(knownIdentityRef.current).toEqual({ path: "Alt.md", known: true }));
      expect(await disk.bytes("Alt.md")).toEqual(utf8("# Alt\n\nzwei\n"));
    });

    it("leads from a file that is no text to the newest copy beside it, kept from an earlier run or left by the sync — and keeps the draft on offer only once, where it is that one", async () => {
      const disk = await storage.make();
      const { vault } = await phoneOver(disk);
      await disk.put("Data.csv", TABLE);
      // What a sync left beside it earlier.
      const synced = "Data.CONFLICT-2026-10-19T08-00-00-000Z.csv";
      await disk.put(synced, TABLE);
      // An editor of an earlier run held changes when the app went, and the
      // screen offered that draft while the file was still text.
      const leftover = { text: "id;name\n1;Grün\n", ts: 1, revision: 3 };
      const onOffer = { ...leftover };
      const { loadFailed, set, noted, offerAfter } = failedLoadOver(vault, "Data.csv", leftover, onOffer);
      loadFailed(new NotTextFileError("Data.csv"));
      expect(set.notText).toHaveBeenCalledWith(true);
      expect(set.loadError).toHaveBeenCalledWith(false);
      // The offer is down at once, while it is kept.
      expect(offerAfter(onOffer)).toBeNull();
      await vi.waitFor(() => expect(noted.size).toBe(1));
      // One copy for the one draft, said once; the card leads to it.
      const copies = await copiesBeside(vault, "Data.csv", [synced]);
      expect(copies).toHaveLength(1);
      const [kept] = copies;
      expect(noted.get("Data.csv")).toBe(kept);
      expect(await disk.bytes(kept)).toEqual(utf8("id;name\n1;Grün\n"));
      expect(set.warning).toHaveBeenCalledTimes(1);
      expect(set.warning).toHaveBeenCalledWith(`dialogs.conflictSavedMsg ${kept}`);
      // Its journal entry goes while it is still that draft — asked by time and revision, not by revision alone.
      expect(set.clearDraftIf).toHaveBeenCalledTimes(1);
      expect(set.clearDraftIf).toHaveBeenCalledWith(vault, "Data.csv", leftover);
      // The next load: nothing left to keep and nothing on offer; the card stays on the copy it leads to.
      const again = failedLoadOver(vault, "Data.csv", null);
      again.noted.set("Data.csv", kept);
      again.loadFailed(new NotTextFileError("Data.csv"));
      await new Promise((done) => setTimeout(done, 50));
      expect(again.noted.get("Data.csv")).toBe(kept);
      expect(again.set.warning).not.toHaveBeenCalled();
      expect(again.set.draft).not.toHaveBeenCalled();
      expect(await copiesBeside(vault, "Data.csv", [synced])).toEqual([kept]);
      // A screen that has noted nothing: the newest copy beside the file.
      const fresh = failedLoadOver(vault, "Data.csv", null);
      fresh.loadFailed(new NotTextFileError("Data.csv"));
      await vi.waitFor(() => expect(fresh.noted.get("Data.csv")).toBe([kept, synced].sort().pop()));
      // A file that is gone is no "not text", and nothing is looked up beside it.
      const gone = failedLoadOver(vault, "Gone.csv", { text: "x\n", ts: 1 }, { text: "y\n", ts: 2 });
      gone.loadFailed(new Error("not found"));
      await new Promise((done) => setTimeout(done, 50));
      expect(gone.set.notText).toHaveBeenCalledWith(false);
      expect(gone.set.loadError).toHaveBeenCalledWith(true);
      expect(gone.set.draft).not.toHaveBeenCalled();
      expect(gone.noted.size).toBe(0);
    });

    it("keeps a draft on offer beside a file that turned into no text though the journal holds it no more — with the offer down while it is kept, and back where it could not be", async () => {
      const disk = await storage.make();
      const { vault } = await phoneOver(disk);
      await disk.put("Data.csv", TABLE);
      // Offered while the file was text; typing since overwrote the journal, a save cleared it.
      const offered = { text: "id;name\n1;Rot\n", ts: 5, revision: 2 };
      const one = failedLoadOver(vault, "Data.csv", null, offered);
      one.loadFailed(new NotTextFileError("Data.csv"));
      // Down at once: restored or discarded while it is kept, it was kept twice or against the reader's word.
      expect(one.offerAfter(offered)).toBeNull();
      await vi.waitFor(() => expect(one.set.warning).toHaveBeenCalledTimes(1));
      const [first] = await copiesBeside(vault, "Data.csv");
      expect(await disk.bytes(first)).toEqual(utf8("id;name\n1;Rot\n"));
      expect(one.set.warning).toHaveBeenCalledTimes(1);
      // Its journal entry, should it still be there, goes — that one and no other.
      expect(one.set.clearDraftIf).toHaveBeenCalledWith(vault, "Data.csv", offered);
      // A newer offer for another screen of the note is not taken away by this load.
      const newer = { text: "newer\n", ts: 9 };
      expect(one.offerAfter(newer)).toBe(newer);
      // Two loads of one screen that fail at once keep the offer once.
      const twice = { text: "id;name\n1;Lila\n", ts: 8 };
      const held = gateOf();
      const firstLoad = failedLoadOver(vault, "Data.csv", null, twice, undefined, held.promise);
      const secondLoad = failedLoadOver(vault, "Data.csv", null, twice, firstLoad.screen);
      firstLoad.loadFailed(new NotTextFileError("Data.csv"));
      secondLoad.loadFailed(new NotTextFileError("Data.csv"));
      held.resolve();
      await vi.waitFor(() => expect(firstLoad.set.warning).toHaveBeenCalledTimes(1));
      await new Promise((done) => setTimeout(done, 50));
      expect(secondLoad.set.warning).not.toHaveBeenCalled();
      expect(firstLoad.offerAfter(twice)).toBeNull();
      // A leftover of an earlier run that is another draft than the one on offer: both are kept.
      const leftover = { text: "id;name\n1;Blau\n", ts: 1, revision: 1 };
      const earlier = await copiesBeside(vault, "Data.csv");
      const both = failedLoadOver(vault, "Data.csv", leftover, { text: "id;name\n1;Gelb\n", ts: 6 });
      both.loadFailed(new NotTextFileError("Data.csv"));
      await vi.waitFor(() => expect(both.set.warning).toHaveBeenCalledTimes(2));
      const texts = await Promise.all((await copiesBeside(vault, "Data.csv", earlier)).map(async (copy) => new TextDecoder().decode(new Uint8Array(await disk.bytes(copy)))));
      expect(texts.sort()).toEqual(["id;name\n1;Blau\n", "id;name\n1;Gelb\n"]);
      // A draft kept in the shape the editor holds: line ends and the mark of an old journal do not come along.
      const shaped = failedLoadOver(vault, "Data.csv", { text: `${String.fromCharCode(0xfeff)}id;name\r\n1;Weiß\r\n`, ts: 3, revision: 5 });
      const beforeShaped = await copiesBeside(vault, "Data.csv");
      shaped.loadFailed(new NotTextFileError("Data.csv"));
      await vi.waitFor(() => expect(shaped.set.warning).toHaveBeenCalledTimes(1));
      const [shapedCopy] = await copiesBeside(vault, "Data.csv", beforeShaped);
      expect(await disk.bytes(shapedCopy)).toEqual(utf8("id;name\n1;Weiß\n"));
      // Where the text cannot be laid beside the file, the offer comes back — restoring it is still the way —
      // and the journal hands its draft out again for a later load.
      vi.spyOn(vault.files, "writeTextFile").mockRejectedValue(new Error("disk full"));
      const notKept = { text: "kept on offer\n", ts: 7 };
      const failing = failedLoadOver(vault, "Data.csv", null, notKept);
      failing.loadFailed(new NotTextFileError("Data.csv"));
      await vi.waitFor(() => expect(failing.set.error).toHaveBeenCalled());
      expect(failing.offerAfter(notKept)).toBe(notKept);
      // …and does not push aside an offer that came meanwhile.
      const meanwhile = { text: "a newer offer\n", ts: 11 };
      expect(failing.set.draft.mock.calls.reduce<Draft | null>((state, [next]) => next(state), meanwhile)).toBe(meanwhile);
      const leftoverFailing = { text: "left, not kept\n", ts: 4, revision: 6 };
      const failingLeftover = failedLoadOver(vault, "Data.csv", leftoverFailing);
      failingLeftover.loadFailed(new NotTextFileError("Data.csv"));
      await vi.waitFor(() => expect(failingLeftover.set.error).toHaveBeenCalled());
      expect(failingLeftover.set.release).toHaveBeenCalledWith(vault, "Data.csv", leftoverFailing);
      expect(failingLeftover.set.clearDraftIf).not.toHaveBeenCalled();
      // The same screen's next load may try the offer once more: its claim went with the failure.
      const retry = failedLoadOver(vault, "Data.csv", null, null, failing.screen);
      vi.mocked(vault.files.writeTextFile).mockRestore();
      retry.loadFailed(new NotTextFileError("Data.csv"));
      await vi.waitFor(() => expect(retry.set.warning).toHaveBeenCalledTimes(1));
    });

    it("lets go of what it kept though a later step fails — the leftover is not handed out again, a kept offer does not come back", async () => {
      const disk = await storage.make();
      const { vault } = await phoneOver(disk);
      await disk.put("Data.csv", TABLE);
      // The leftover is kept, the offer — another draft — is not: the second write fails.
      const write = vault.files.writeTextFile.bind(vault.files);
      let writes = 0;
      const failingSecond = vi.spyOn(vault.files, "writeTextFile").mockImplementation(async (p: string, text: string) => {
        writes += 1;
        if (writes === 2) throw new Error("disk full");
        return write(p, text);
      });
      const leftover = { text: "id;name\n1;Blau\n", ts: 1, revision: 1 };
      const offer = { text: "id;name\n1;Gelb\n", ts: 6 };
      const half = failedLoadOver(vault, "Data.csv", leftover, offer);
      half.loadFailed(new NotTextFileError("Data.csv"));
      await vi.waitFor(() => expect(half.set.error).toHaveBeenCalled());
      expect(half.set.release).not.toHaveBeenCalled();
      expect(half.set.clearDraftIf).toHaveBeenCalledTimes(1);
      expect(half.set.clearDraftIf).toHaveBeenCalledWith(vault, "Data.csv", leftover);
      expect(half.offerAfter(offer)).toBe(offer);
      failingSecond.mockRestore();
      // The offer is the leftover, kept — and the look for the newest copy fails after: it stays down, nothing is handed out again.
      vi.spyOn(vault.files, "listDir").mockRejectedValue(new Error("unreadable folder"));
      const same = { text: "id;name\n1;Grau\n", ts: 2, revision: 2 };
      const late = failedLoadOver(vault, "Data.csv", same, same);
      late.loadFailed(new NotTextFileError("Data.csv"));
      await vi.waitFor(() => expect(late.set.error).toHaveBeenCalled());
      expect(late.set.warning).toHaveBeenCalledTimes(1);
      expect(late.set.release).not.toHaveBeenCalled();
      expect(late.offerAfter(same)).toBeNull();
    });

    it("keeps a draft restored over a file that is no text in a copy of its own — not in the copy kept for the typing before", async () => {
      const disk = await storage.make();
      const { vault, phone, conflicts } = await phoneOver(disk);
      await disk.put("Alt.md", utf8("# Alt\n"));
      const text = await phone.vaultOps.readEditor(vault, "Alt.md");
      phone.rememberPersistedText(vault, "Alt.md", text);
      await disk.put("Alt.md", NOTE);
      phone.noteSaver.schedule(vault, "Alt.md", "# Alt\n\ntyped\n");
      await phone.noteSaver.flush("Alt.md", vault);
      const [{ copyPath: typed }] = conflicts;
      // The draft the screen offered is restored now.
      restoreOver(vault, phone, "Alt.md", { path: "Alt.md", text: "# Alt\n\nthe draft\n", ts: 1 })();
      await phone.noteSaver.flush("Alt.md", vault);
      expect(await disk.bytes(typed)).toEqual(utf8("# Alt\n\ntyped\n"));
      const copies = [...new Set(conflicts.map((c) => c.copyPath))];
      expect(copies).toHaveLength(2);
      expect(await disk.bytes(copies.find((copy) => copy !== typed)!)).toEqual(utf8("# Alt\n\nthe draft\n"));
      expect(await disk.bytes("Alt.md")).toEqual(NOTE);
    });

    it("lets go of the copy only after a keep of the typing still under way has set it — a draft restored meanwhile gets a copy of its own", async () => {
      const disk = await storage.make();
      const { vault, phone, conflicts, hooks } = await phoneOver(disk);
      await disk.put("Alt.md", utf8("# Alt\n"));
      const text = await phone.vaultOps.readEditor(vault, "Alt.md");
      phone.rememberPersistedText(vault, "Alt.md", text);
      await disk.put("Alt.md", NOTE);
      const entered = gateOf(), release = gateOf();
      hooks.beforeKeep = async () => { entered.resolve(); await release.promise; };
      phone.noteSaver.schedule(vault, "Alt.md", "# Alt\n\ntyped\n");
      const typing = phone.noteSaver.flush("Alt.md", vault);
      await entered.promise;
      hooks.beforeKeep = async () => {};
      restoreOver(vault, phone, "Alt.md", { path: "Alt.md", text: "# Alt\n\nthe draft\n", ts: 1 })();
      release.resolve();
      await typing;
      await phone.noteSaver.flush("Alt.md", vault);
      const copies = [...new Set(conflicts.map((c) => c.copyPath))];
      expect(copies).toHaveLength(2);
      const texts = await Promise.all(copies.map(async (copy) => new TextDecoder().decode(new Uint8Array(await disk.bytes(copy)))));
      expect(texts.sort()).toEqual(["# Alt\n\nthe draft\n", "# Alt\n\ntyped\n"]);
    });

    it("duplicates such a note byte for byte", async () => {
      const disk = await storage.make();
      const { vault, phone } = await phoneOver(disk);
      await disk.put("Alt.md", NOTE);
      const copy = await phone.vaultOps.duplicateNote(vault, "Alt.md");
      expect(copy).toBe("Alt 2.md");
      expect(await disk.bytes(copy)).toEqual(NOTE);
      expect(await disk.bytes("Alt.md")).toEqual(NOTE);
    });
  });
}
