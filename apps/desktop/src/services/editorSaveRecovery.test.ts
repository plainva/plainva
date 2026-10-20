// @vitest-environment jsdom
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import ts from "typescript";
import { EditorState } from "@codemirror/state";
import { ConflictError, containsTextChanges, isNotTextFileError, mergeEditorText } from "@plainva/core";
import { applyTextShape, editorTextOf, keepTextBeside, openEditorText, readTextShape } from "@plainva/ui";
import { LocalVaultAdapter } from "../../../../packages/core/src/vault/LocalVaultAdapter";
import { ConflictAwareVaultAdapter } from "../../../../packages/core/src/vault/ConflictAwareVaultAdapter";
import { SyncStateRepository } from "../../../../packages/core/src/vault/SyncStateRepository";
import { realSqlite } from "../../../../packages/core/test/helpers/realSqlite";
import type { IDatabaseAdapter } from "@plainva/core";
import { EditorSaveLifetime } from "./editorSaveLifetime";
import { dirtyStore } from "./dirtyStore";
import { withPendingWrite, resetPendingWritesForTests } from "./pendingWrites";

// Execute the original save function — and the schedule in front of it — with
// real note files and CodeMirror states. The journal import and UI
// notification boundaries are controlled; the separate journal tests cover
// its actual persistence implementation.
const source = readFileSync(resolve("src/components/Editor.tsx"), "utf8");
const file = ts.createSourceFile("Editor.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declared = new Map<string, string>();
function visit(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && ["persistText", "scheduleSave"].includes(node.name.getText(file))) declared.set(node.name.getText(file), node.initializer!.getText(file));
  ts.forEachChild(node, visit);
}
visit(file);
if (declared.size !== 2) throw new Error("Original editor persistence functions missing");
// What "Restore" on the draft banner does (an inline handler in the editor's markup).
let restoreHandler = "";
(function find(node: ts.Node) {
  // The innermost arrow that holds it: the button's own handler.
  if (ts.isArrowFunction(node) && node.getText(file).includes("saveState.recover(offer)")) restoreHandler = node.getText(file);
  ts.forEachChild(node, find);
})(file);
if (!restoreHandler) throw new Error("The draft banner's restore moved");
const restoreCompiled = ts.transpileModule(`const restoreDraft = ${restoreHandler};`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;
const compiled = ts.transpileModule([...declared].map(([name, initializer]) => `const ${name} = ${initializer};`).join("\n")
  .split('import("../services/draftJournal")').join("loadJournal()"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;
function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
let root: string, raw: LocalVaultAdapter;
let db: IDatabaseAdapter, files: ConflictAwareVaultAdapter;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "plainva-desktop-save-"));
  raw = new LocalVaultAdapter(root);
  await raw.initialize();
  await raw.writeTextFile("Note.md", "base\nmiddle\nend");
  db = await realSqlite(); files = new ConflictAwareVaultAdapter(raw, new SyncStateRepository(db));
  resetPendingWritesForTests(); dirtyStore.clearAll();
});
afterEach(async () => { vi.restoreAllMocks(); await db.close(); await rm(root, { recursive: true, force: true }); });
function harness(path = "Note.md", initial = "base\nmiddle\nend") {
  const lifetime = new EditorSaveLifetime(root, path, files);
  lifetime.activate(); lifetime.baseInput = initial; lifetime.persisted = initial;
  const session = {
    view: { state: EditorState.create({ doc: initial }) },
    applyExternalText(text: string) { this.view.state = EditorState.create({ doc: text }); },
  };
  const sessionRef = { current: session };
  const contentRef = { current: initial };
  const journals = new Map<string, { text: string; revision: number }>();
  const recordDraft = vi.fn(async (_vault, _path, text: string, revision: number, id: string) => {
    journals.set(id, { text, revision });
  });
  const clearDraft = vi.fn(async (_vault, _path, revision: number, id: string) => {
    if ((journals.get(id)?.revision ?? Infinity) <= revision) journals.delete(id);
  });
  const ui = { saving: vi.fn(), error: vi.fn(), content: vi.fn(), conflict: vi.fn(), notText: vi.fn(), toast: vi.fn() };
  const loadedPathRef = { current: path as string | null };
  const saveTimeoutRef = { current: null as number | null }, draftTimerRef = { current: null as number | null };
  // A keep beside the file can be held or made to fail.
  const hooks = { beforeKeep: async () => {} };
  const deps = {
    activePath: path, vaultPath: root, vaultAdapter: files, saveState: lifetime, sessionRef, contentRef,
    withPendingWrite, mergeEditorText, containsTextChanges, ConflictError, isNotTextFileError, applyTextShape, editorTextOf, dirtyStore,
    keepTextBeside: async (...args: Parameters<typeof keepTextBeside>) => { await hooks.beforeKeep(); return keepTextBeside(...args); },
    loadJournal: async () => ({ recordDraft, clearDraft }),
    setIsSaving: ui.saving, setSaveError: ui.error, setContent: ui.content, setConflictInfo: ui.conflict, setNotText: ui.notText, loadedPathRef,
    saveTimeoutRef, draftTimerRef,
    indexer: null, triggerFileTreeUpdate: vi.fn(), window, CustomEvent, crypto,
    console: { error: vi.fn() }, toast: { warning: ui.toast }, t: (key: string, values?: Record<string, string>) => (values ? `${key} ${JSON.stringify(values)}` : key),
  };
  const { persist, schedule } = new Function(...Object.keys(deps), compiled + "\nreturn { persist: persistText, schedule: scheduleSave };")(...Object.values(deps)) as {
    persist: (text: string) => Promise<void>; schedule: (getText: () => string) => void;
  };
  function edit(text: string) {
    session.applyExternalText(text); contentRef.current = text;
    lifetime.dirty = true; lifetime.nextRevision(); dirtyStore.set(path, true, lifetime.id);
  }
  return { persist, schedule, edit, hooks, lifetime, session, sessionRef, contentRef, journals, recordDraft, clearDraft, ui, loadedPathRef, saveTimeoutRef, draftTimerRef };
}

describe("original desktop save completion", () => {
  // Twenty saves on real files, a new editor lifetime after ten. Every save
  // after the first takes the same path — one conflict session, one working
  // copy, one remembered write per path — so a hundred proved nothing that
  // twenty do not, and under a loaded commit hook the hundred ran past 20 s
  // (Befunde 2026-09-24, Z2; the core's conflict-session test carries the same).
  const SAVES = 20;
  it(`keeps one working copy through ${SAVES} actual editor saves and a new editor lifetime`, async () => {
    let h = harness();
    await raw.writeTextFile("Note.md", "foreign\nmiddle\nend");
    for (let i = 0; i < SAVES; i++) {
      if (i === SAVES / 2) {
        h.lifetime.deactivate();
        const session = await files.getConflictSession("Note.md");
        h = harness("Note.md", await files.readTextFile(session!.workingCopyPath));
      }
      const text = `local ${i}\nmiddle\nend`;
      h.edit(text); await h.persist(text);
    }
    const sessions = await files.listConflictSessions();
    expect(sessions).toHaveLength(1);
    expect(await raw.readTextFile(sessions[0].workingCopyPath)).toBe(`local ${SAVES - 1}\nmiddle\nend`);
    expect(await raw.readTextFile("Note.md")).toBe("foreign\nmiddle\nend");
    expect(h.ui.conflict).toHaveBeenLastCalledWith(expect.objectContaining({ working: true, conflictPath: sessions[0].workingCopyPath }));
    expect(h.journals.size).toBe(0);
  });
  it("rejects an actual write failure and retains its recovery draft and dirty state", async () => {
    const h = harness(); h.edit("my draft");
    vi.spyOn(raw, "writeTextFile").mockRejectedValueOnce(new Error("disk full"));
    await expect(h.persist("my draft")).rejects.toThrow("disk full");
    expect(h.lifetime.dirty).toBe(true);
    expect(h.journals.get(h.lifetime.id)?.text).toBe("my draft");
    expect(h.clearDraft).not.toHaveBeenCalled();
    expect(await raw.readTextFile("Note.md")).toBe("base\nmiddle\nend");
  });

  // "Größe" and a line end in Windows-1252, laid down after the note was opened.
  const FOREIGN = Uint8Array.from([0x47, 0x72, 0xf6, 0xdf, 0x65, 0x0a]);
  const copiesOf = async (name: string) => (await readdir(root)).filter((entry) => entry.startsWith(`${name}.CONFLICT-`));

  it("keeps a save that a note another program saved in another encoding cannot take beside it, as a conflict copy — the note keeps its bytes", async () => {
    const h = harness(); h.edit("my draft\n");
    // Still scheduled for this revision when the save came: the debounced save and the journal snapshot.
    const scheduled = vi.fn();
    h.saveTimeoutRef.current = window.setTimeout(scheduled, 20);
    h.draftTimerRef.current = window.setTimeout(scheduled, 20);
    await writeFile(join(root, "Note.md"), FOREIGN);
    await h.persist("my draft\n");
    expect([...await readFile(join(root, "Note.md"))]).toEqual([...FOREIGN]);
    const copies = await copiesOf("Note");
    expect(copies).toHaveLength(1);
    expect(await readFile(join(root, copies[0]), "utf8")).toBe("my draft\n");
    // Said where the text went, and the note shows as what it is now.
    expect(h.ui.conflict).toHaveBeenLastCalledWith({ conflictPath: copies[0] });
    expect(h.ui.toast).toHaveBeenCalledWith(`dialogs.conflictSavedMsg ${JSON.stringify({ path: copies[0] })}`);
    expect(h.ui.notText).toHaveBeenCalledWith(true);
    expect(h.loadedPathRef.current).toBeNull();
    expect(h.ui.error).not.toHaveBeenCalledWith(expect.stringMatching(/./));
    expect(h.lifetime.dirty).toBe(false);
    expect(dirtyStore.get().has("Note.md")).toBe(false);
    expect(h.journals.size).toBe(0);
    expect(await files.listConflictSessions()).toHaveLength(0);
    // Nothing of this revision is still scheduled to run.
    expect(h.saveTimeoutRef.current).toBeNull();
    expect(h.draftTimerRef.current).toBeNull();
    await new Promise((done) => setTimeout(done, 40));
    expect(scheduled).not.toHaveBeenCalled();
  });

  it("keeps nothing a second time when a save of the kept revision comes round after the next load — and drops what it journaled", async () => {
    const h = harness(); h.edit("my draft\n");
    await writeFile(join(root, "Note.md"), FOREIGN);
    await h.persist("my draft\n");
    // The next load forgets what the editor held.
    h.lifetime.persisted = null;
    await h.persist("my draft\n");
    expect(await copiesOf("Note")).toHaveLength(1);
    expect(h.journals.size).toBe(0);
    expect(h.ui.toast).toHaveBeenCalledTimes(1);
    // A note that is text again by then is not written over by that save either.
    await raw.writeTextFile("Note.md", "text again\n");
    h.lifetime.baseInput = "text again\n"; h.lifetime.persisted = "text again\n";
    await h.persist("my draft\n");
    expect(await raw.readTextFile("Note.md")).toBe("text again\n");
  });

  /** A note that turns into no text while a save of `typed` is kept, and `more` is typed while that keep runs. */
  async function keepWhileTyping(typed: string, more: string) {
    const h = harness("Note.md", "a\nb\nc\nd\ne\n");
    await raw.writeTextFile("Note.md", "a\nb\nc\nd\ne\n");
    const entered = gate(), release = gate();
    h.hooks.beforeKeep = async () => { entered.resolve(); await release.promise; };
    h.edit(typed);
    await writeFile(join(root, "Note.md"), FOREIGN);
    const kept = h.persist(typed);
    await entered.promise;
    h.edit(more);
    h.hooks.beforeKeep = async () => {};
    release.resolve(); await kept;
    const [copy] = await copiesOf("Note");
    return { h, copy };
  }

  it("keeps typing that went on while a save was kept in the same copy, as long as nothing changed that copy", async () => {
    const { h, copy } = await keepWhileTyping("a!\nb\nc\nd\ne\n", "a!\nb!\nc\nd\ne\n");
    expect(await readFile(join(root, copy), "utf8")).toBe("a!\nb\nc\nd\ne\n");
    // The newer typing is not done with: the editor stays as it is, with it.
    expect(h.ui.notText).not.toHaveBeenCalled();
    expect(h.loadedPathRef.current).toBe("Note.md");
    expect(h.lifetime.dirty).toBe(true);
    expect(h.ui.conflict).toHaveBeenLastCalledWith({ conflictPath: copy });
    // Its save, with the file still no text, goes into the same copy: one copy, said once.
    await h.persist("a!\nb!\nc\nd\ne\n");
    expect(await copiesOf("Note")).toEqual([copy]);
    expect(await readFile(join(root, copy), "utf8")).toBe("a!\nb!\nc\nd\ne\n");
    expect(h.ui.toast).toHaveBeenCalledTimes(1);
    expect(h.ui.notText).toHaveBeenCalledWith(true);
    expect(h.lifetime.dirty).toBe(false);
    // A copy somebody changed meanwhile is left alone: the next text gets its own.
    await raw.writeTextFile(copy, "edited by hand\n");
    h.edit("a!\nb!\nc!\nd\ne\n");
    await h.persist("a!\nb!\nc!\nd\ne\n");
    expect(await readFile(join(root, copy), "utf8")).toBe("edited by hand\n");
    expect(await copiesOf("Note")).toHaveLength(2);
  });

  it("brings all of the typing into a file that is text again by the next save — merged against what the editor loaded, as on the phone; the copy keeps what was kept", async () => {
    const { h, copy } = await keepWhileTyping("a!\nb\nc\nd\ne\n", "a!\nb!\nc\nd\ne\n");
    // The other program saves it as UTF-8 again, with a change of its own.
    await raw.writeTextFile("Note.md", "a\nb\nc\nd\ne!\n");
    await h.persist("a!\nb!\nc\nd\ne\n");
    expect(await raw.readTextFile("Note.md")).toBe("a!\nb!\nc\nd\ne!\n");
    expect(await readFile(join(root, copy), "utf8")).toBe("a!\nb\nc\nd\ne\n");
    // The file took the text: a later keep makes a copy of its own, and the first one stays as it is.
    h.edit("a!\nb!\nc!\nd\ne!\n");
    await writeFile(join(root, "Note.md"), FOREIGN);
    await h.persist("a!\nb!\nc!\nd\ne!\n");
    const copies = await copiesOf("Note");
    expect(copies).toHaveLength(2);
    expect(await readFile(join(root, copy), "utf8")).toBe("a!\nb\nc\nd\ne\n");
    expect(await readFile(join(root, copies.find((c) => c !== copy)!), "utf8")).toBe("a!\nb!\nc!\nd\ne!\n");
  });

  it("stays with typing that came while the kept text's journal entry was cleared: that typing is the next save's, kept into the same copy", async () => {
    const h = harness(); h.edit("my draft\n");
    await writeFile(join(root, "Note.md"), FOREIGN);
    const entered = gate(), release = gate();
    h.clearDraft.mockImplementationOnce(async () => { entered.resolve(); await release.promise; });
    const kept = h.persist("my draft\n");
    await entered.promise;
    h.edit("my draft\nmore\n");
    release.resolve(); await kept;
    // The editor stays as it is, with the newer typing in it.
    expect(h.ui.notText).not.toHaveBeenCalled();
    expect(h.loadedPathRef.current).toBe("Note.md");
    expect(h.lifetime.dirty).toBe(true);
    await h.persist("my draft\nmore\n");
    const copies = await copiesOf("Note");
    expect(copies).toHaveLength(1);
    expect(await readFile(join(root, copies[0]), "utf8")).toBe("my draft\nmore\n");
    expect(h.ui.toast).toHaveBeenCalledTimes(1);
    expect(h.ui.notText).toHaveBeenCalledWith(true);
    expect(h.journals.size).toBe(0);
  });

  /**
   * "Restore" on the draft banner over the "not text" state, where no editor
   * is left: the edit goes the way without a view (`applyNonViewEdit`), whose
   * save is started here. Hands back that save once it has begun.
   */
  function restoreDraft(h: ReturnType<typeof harness>, text: string): () => Promise<void> {
    let saving: Promise<void> = Promise.resolve();
    const deps = {
      draftOffer: { text, savedAt: 1, revision: 9, sessionId: "earlier" }, setDraftOffer: vi.fn(), saveState: h.lifetime, sessionRef: { current: null },
      applyNonViewEdit: (next: string) => { h.edit(next); saving = h.persist(next); },
      withPendingWrite, vaultPath: root, activePath: "Note.md",
    };
    const restore = new Function(...Object.keys(deps), `${restoreCompiled}\nreturn restoreDraft;`)(...Object.values(deps)) as () => void;
    restore();
    return () => saving;
  }

  it("keeps a draft restored over a note that is no text in a copy of its own — not in the copy kept for the typing before", async () => {
    const h = harness(); h.edit("typed first\n");
    await writeFile(join(root, "Note.md"), FOREIGN);
    await h.persist("typed first\n");
    const [typed] = await copiesOf("Note");
    await restoreDraft(h, "the draft\n")();
    const copies = await copiesOf("Note");
    expect(copies).toHaveLength(2);
    expect(await readFile(join(root, typed), "utf8")).toBe("typed first\n");
    expect(await readFile(join(root, copies.find((copy) => copy !== typed)!), "utf8")).toBe("the draft\n");
  });

  it("lets go of the copy only after a keep of the typing still under way has set it — a draft restored meanwhile gets a copy of its own", async () => {
    const h = harness(); h.edit("typed first\n");
    await writeFile(join(root, "Note.md"), FOREIGN);
    const entered = gate(), release = gate();
    h.hooks.beforeKeep = async () => { entered.resolve(); await release.promise; };
    const typing = h.persist("typed first\n");
    await entered.promise;
    h.hooks.beforeKeep = async () => {};
    const restored = restoreDraft(h, "the draft\n");
    release.resolve();
    await typing; await restored();
    const copies = await copiesOf("Note");
    expect(copies).toHaveLength(2);
    const texts = await Promise.all(copies.map((copy) => readFile(join(root, copy), "utf8")));
    expect(texts.sort()).toEqual(["the draft\n", "typed first\n"]);
  });

  it("leaves the pane alone when a keep ends after it moved on to another file: its timers and its banner are that file's", async () => {
    const h = harness(); h.edit("my draft\n");
    await writeFile(join(root, "Note.md"), FOREIGN);
    const entered = gate(), release = gate();
    h.hooks.beforeKeep = async () => { entered.resolve(); await release.promise; };
    const saving = h.persist("my draft\n");
    await entered.promise;
    // The pane shows another file now, which has scheduled its own save and journal snapshot.
    h.lifetime.deactivate();
    const next = vi.fn();
    h.saveTimeoutRef.current = window.setTimeout(next, 20);
    h.draftTimerRef.current = window.setTimeout(next, 20);
    Object.values(h.ui).forEach((spy) => spy.mockClear());
    release.resolve(); await saving;
    const [copy] = await copiesOf("Note");
    expect(await readFile(join(root, copy), "utf8")).toBe("my draft\n");
    // Said wherever the pane went — and nothing else of this file reaches it.
    expect(h.ui.toast).toHaveBeenCalledTimes(1);
    for (const spy of [h.ui.conflict, h.ui.notText, h.ui.error, h.ui.content, h.ui.saving]) expect(spy).not.toHaveBeenCalled();
    expect(h.saveTimeoutRef.current).not.toBeNull();
    expect(h.draftTimerRef.current).not.toBeNull();
    await new Promise((done) => setTimeout(done, 40));
    expect(next).toHaveBeenCalledTimes(2);
    // What was kept belongs to this editor's lifetime, not to the pane.
    expect(h.lifetime.kept?.copy).toBe(copy);
  });

  it("leaves the text in the editor and its journal when it cannot be kept beside the file either, and says why the file did not take it", async () => {
    const h = harness(); h.edit("my draft\n");
    await writeFile(join(root, "Note.md"), FOREIGN);
    h.hooks.beforeKeep = async () => { throw new Error("disk full"); };
    const error = await h.persist("my draft\n").catch((e: unknown) => e);
    expect(isNotTextFileError(error)).toBe(true);
    expect(h.ui.error).toHaveBeenLastCalledWith("editor.notTextTitle");
    expect(h.ui.notText).not.toHaveBeenCalled();
    expect(h.lifetime.dirty).toBe(true);
    expect(h.journals.get(h.lifetime.id)?.text).toBe("my draft\n");
    expect(await copiesOf("Note")).toHaveLength(0);
    expect([...await readFile(join(root, "Note.md"))]).toEqual([...FOREIGN]);
  });

  it("journals nothing for a revision a save covered first: the snapshot comes after Ctrl+S, and the entry would outlive the text it held", async () => {
    const h = harness();
    h.session.applyExternalText("saved at once"); h.contentRef.current = "saved at once"; h.lifetime.dirty = true;
    h.schedule(() => h.session.view.state.doc.toString());
    // Ctrl+S before the snapshot: the flush takes the debounced save over.
    window.clearTimeout(h.saveTimeoutRef.current!); h.saveTimeoutRef.current = null;
    await h.persist("saved at once");
    expect(await raw.readTextFile("Note.md")).toBe("saved at once");
    h.recordDraft.mockClear();
    await new Promise((done) => setTimeout(done, 450));
    expect(h.recordDraft).not.toHaveBeenCalled();
    expect(h.journals.size).toBe(0);
    // Typing that no save covered yet is snapshotted as before.
    h.session.applyExternalText("typed on"); h.lifetime.dirty = true;
    h.schedule(() => h.session.view.state.doc.toString());
    window.clearTimeout(h.saveTimeoutRef.current!); h.saveTimeoutRef.current = null;
    await new Promise((done) => setTimeout(done, 450));
    expect(h.journals.get(h.lifetime.id)?.text).toBe("typed on");
  });

  it("does not clean newer typing after an earlier delayed write", async () => {
    const h = harness(), entered = gate(), release = gate();
    const write = raw.writeTextFile.bind(raw);
    vi.spyOn(raw, "writeTextFile").mockImplementationOnce(async (path, text) => {
      entered.resolve(); await release.promise; await write(path, text);
    });
    h.edit("first"); const first = h.persist("first"); await entered.promise;
    h.edit("newer"); release.resolve(); await first;
    expect(h.session.view.state.doc.toString()).toBe("newer");
    expect(h.lifetime.dirty).toBe(true);
    expect(dirtyStore.get().has("Note.md")).toBe(true);
    await h.persist("newer");
    expect(await raw.readTextFile("Note.md")).toBe("newer");
    expect(h.lifetime.dirty).toBe(false);
  });

  it.each(["success", "failure"] as const)("does not update the next editor after a late %s", async (outcome) => {
    const h = harness(), entered = gate(), release = gate();
    const write = raw.writeTextFile.bind(raw);
    vi.spyOn(raw, "writeTextFile").mockImplementationOnce(async (path, text) => {
      entered.resolve(); await release.promise;
      if (outcome === "failure") throw new Error("late failure");
      await write(path, text);
    });
    h.edit("old note"); const saving = h.persist("old note").catch((error) => error); await entered.promise;
    h.lifetime.deactivate();
    const replacement = { view: { state: EditorState.create({ doc: "other note" }) }, applyExternalText: vi.fn() };
    h.sessionRef.current = replacement;
    Object.values(h.ui).forEach((spy) => spy.mockClear());
    release.resolve(); await saving;
    expect(replacement.view.state.doc.toString()).toBe("other note");
    expect(replacement.applyExternalText).not.toHaveBeenCalled();
    Object.values(h.ui).forEach((spy) => expect(spy).not.toHaveBeenCalled());
  });

  it("captures a foreign file's shape before waiting for an earlier write", async () => {
    const initial = "\ufeffbase\r\nmiddle\r\nend";
    await raw.writeTextFile("Settings.ini", initial);
    const h = harness("Settings.ini"); h.lifetime.shape = readTextShape(initial).shape;
    const release = gate();
    const prior = withPendingWrite(root, "Settings.ini", () => release.promise);
    h.edit("new\nmiddle\nend");
    const saving = h.persist("new\nmiddle\nend");
    h.lifetime.shape = null;
    release.resolve(); await Promise.all([prior, saving]);
    expect(await raw.readTextFile("Settings.ini")).toBe("\ufeffnew\r\nmiddle\r\nend");
  });

  /** What the load does with a file (Editor.tsx): the one opener of both shells. */
  function open(path: string, fileText: string) {
    const opened = openEditorText(path, fileText)!;
    const h = harness(path, opened.text); h.lifetime.shape = opened.shape;
    return h;
  }
  // Built at run time: the mark is never typed into this file.
  const MARK = String.fromCharCode(0xfeff);

  /** The file as it lies on disk, byte for byte. */
  const bytesOf = async (path: string) => [...await readFile(join(root, path))];
  const utf8 = (text: string) => [...new TextEncoder().encode(text)];

  it("saves a note with the line ends and the mark it arrived with: an edit changes the edited line, byte for byte", async () => {
    const windows = `${MARK}base\r\nmiddle\r\nend\r\n`;
    await raw.writeTextFile("Windows.md", windows);
    const before = await bytesOf("Windows.md");
    const h = open("Windows.md", windows);
    // No mark in the buffer (finding 2026-10-08): it used to be the note's
    // first character, while the comment operation read the note without it.
    expect(h.session.view.state.doc.toString()).toBe("base\nmiddle\nend\n");
    h.edit("base\nmiddle!\nend\n"); await h.persist("base\nmiddle!\nend\n");
    // Until 2026-10-09 the note came back as "base\nmiddle!\nend\n" behind its
    // mark: every line end turned by one edit — the whole file, for whoever
    // keeps the vault in Git. Now one byte is new, and every other one stays.
    const after = await bytesOf("Windows.md");
    expect(after).toEqual([0xef, 0xbb, 0xbf, ...utf8("base\r\nmiddle!\r\nend\r\n")]);
    const at = before.length - utf8("\r\nend\r\n").length;
    expect(after.slice(0, at)).toEqual(before.slice(0, at));
    expect(after.slice(at + 1)).toEqual(before.slice(at));
    expect(h.lifetime.persisted).toBe("base\nmiddle!\nend\n");
    expect(h.lifetime.dirty).toBe(false);
    expect(await files.getConflictSession("Windows.md")).toBeNull();
    // What the editor remembers is its own text again, so the next edit starts from it.
    expect(h.lifetime.baseInput).toBe("base\nmiddle!\nend\n");
    h.edit("base\nmiddle!\nend!\n"); await h.persist("base\nmiddle!\nend!\n");
    expect(await bytesOf("Windows.md")).toEqual([0xef, 0xbb, 0xbf, ...utf8("base\r\nmiddle!\r\nend!\r\n")]);
  });

  it("keeps a note's line ends and mark when a change made elsewhere merges into the save", async () => {
    const windows = `${MARK}a\r\nb\r\nc\r\nd\r\n`;
    await raw.writeTextFile("Windows.md", windows);
    const h = open("Windows.md", windows);
    await raw.writeTextFile("Windows.md", `${MARK}a\r\nb\r\nc\r\nd from elsewhere\r\n`);
    h.edit("a!\nb\nc\nd\n"); await h.persist("a!\nb\nc\nd\n");
    expect(await bytesOf("Windows.md")).toEqual([0xef, 0xbb, 0xbf, ...utf8("a!\r\nb\r\nc\r\nd from elsewhere\r\n")]);
    expect(h.session.view.state.doc.toString()).toBe("a!\nb\nc\nd from elsewhere\n");
    expect(await files.getConflictSession("Windows.md")).toBeNull();
  });

  it("writes a note with one stray line end back in its majority — the edited line and that one, not the whole note", async () => {
    const mixed = "a\r\nb\r\nc\nd\r\n";
    await raw.writeTextFile("Windows.md", mixed);
    const h = open("Windows.md", mixed);
    h.edit("a!\nb\nc\nd\n"); await h.persist("a!\nb\nc\nd\n");
    expect(await raw.readTextFile("Windows.md")).toBe("a!\r\nb\r\nc\r\nd\r\n");
  });

  it("saves a note that arrived with \\n with \\n, and a new one too", async () => {
    await raw.writeTextFile("Unix.md", "base\nmiddle\nend\n");
    const h = open("Unix.md", "base\nmiddle\nend\n");
    h.edit("base!\nmiddle\nend\n"); await h.persist("base!\nmiddle\nend\n");
    expect(await bytesOf("Unix.md")).toEqual(utf8("base!\nmiddle\nend\n"));
    // A note Plainva has just created: one line, nothing to count yet.
    await raw.writeTextFile("New.md", "# New");
    const fresh = open("New.md", "# New");
    fresh.edit("# New\n\nFirst line.\n"); await fresh.persist("# New\n\nFirst line.\n");
    expect(await bytesOf("New.md")).toEqual(utf8("# New\n\nFirst line.\n"));
  });

  it("does not write a text that did not change: leaving the suggestion mode costs a note from Windows nothing", async () => {
    const windows = `${MARK}base\r\nmiddle\r\nend\r\n`;
    await raw.writeTextFile("Windows.md", windows);
    const h = open("Windows.md", windows);
    const write = vi.spyOn(raw, "writeTextFile");
    // What the suggestion mode's exit does (and an edit taken back before the
    // save came): the text the note already has, reported as an edit. It used
    // to be written — a version, an upload, and every "\r\n" of the note.
    h.edit("base\nmiddle\nend\n"); await h.persist("base\nmiddle\nend\n");
    expect(write).not.toHaveBeenCalled();
    expect(await raw.readTextFile("Windows.md")).toBe(windows);
    expect(h.lifetime.dirty).toBe(false);
    expect(dirtyStore.get().has("Windows.md")).toBe(false);
    expect(h.journals.size).toBe(0);
    // The first real edit is saved as ever — and leaves the note its shape.
    h.edit("base!\nmiddle\nend\n"); await h.persist("base!\nmiddle\nend\n");
    expect(await raw.readTextFile("Windows.md")).toBe(`${MARK}base!\r\nmiddle\r\nend\r\n`);
  });

  it("writes a foreign file with one stray line end back in its majority — one line of diff, not the whole file", async () => {
    const mixed = "a\r\nb\r\nc\nd\r\n";
    await raw.writeTextFile("Settings.ini", mixed);
    const h = open("Settings.ini", mixed);
    h.edit("a!\nb\nc\nd\n"); await h.persist("a!\nb\nc\nd\n");
    expect(await raw.readTextFile("Settings.ini")).toBe("a!\r\nb\r\nc\r\nd\r\n");
    expect(h.lifetime.dirty).toBe(false);
  });

  it("keeps a foreign file's line ends and mark when a change made elsewhere merges into the save", async () => {
    const windows = `${MARK}a\r\nb\r\nc\r\nd\r\n`;
    await raw.writeTextFile("Settings.ini", windows);
    const h = open("Settings.ini", windows);
    await raw.writeTextFile("Settings.ini", `${MARK}a\r\nb\r\nc\r\nd from elsewhere\r\n`);
    h.edit("a!\nb\nc\nd\n"); await h.persist("a!\nb\nc\nd\n");
    expect(await raw.readTextFile("Settings.ini")).toBe(`${MARK}a!\r\nb\r\nc\r\nd from elsewhere\r\n`);
    // The editor adopts the merge in ITS text.
    expect(h.session.view.state.doc.toString()).toBe("a!\nb\nc\nd from elsewhere\n");
    expect(await files.getConflictSession("Settings.ini")).toBeNull();
  });

  it("keeps the external merge in a later save with further typing", async () => {
    const h = harness(), entered = gate(), release = gate();
    await raw.writeTextFile("Note.md", "base\nmiddle\nexternal");
    const write = raw.writeTextFile.bind(raw);
    vi.spyOn(raw, "writeTextFile").mockImplementationOnce(async (path, text) => {
      entered.resolve(); await release.promise; await write(path, text);
    });
    h.edit("first\nmiddle\nend"); const first = h.persist("first\nmiddle\nend"); await entered.promise;
    h.edit("newer\nmiddle\nend"); const newer = h.persist("newer\nmiddle\nend");
    release.resolve(); await Promise.all([first, newer]);
    expect(await raw.readTextFile("Note.md")).toBe("newer\nmiddle\nexternal");
    expect(h.session.view.state.doc.toString()).toBe("newer\nmiddle\nexternal");
  });

  it("preserves a conflict even if the sync index would already consider the foreign disk current", async () => {
    const h = harness(); await raw.writeTextFile("Note.md", "foreign\nmiddle\nend");
    h.edit("local\nmiddle\nend");
    await h.persist("local\nmiddle\nend");
    const conflict = await files.getConflictSession("Note.md");
    expect(await raw.readTextFile(conflict!.workingCopyPath)).toBe("local\nmiddle\nend");
    expect(await raw.readTextFile("Note.md")).toBe("foreign\nmiddle\nend");
    expect(h.lifetime.dirty).toBe(false);
  });

  it("does not confirm or clear a draft when read-back no longer contains the submitted change", async () => {
    const h = harness(); h.edit("local\nmiddle\nend");
    const write = raw.writeTextFile.bind(raw);
    vi.spyOn(raw, "writeTextFile").mockImplementationOnce(async (path, _text) => write(path, "foreign\nmiddle\nend"));
    await expect(h.persist("local\nmiddle\nend")).rejects.toThrow("could not be confirmed");
    expect(h.journals.get(h.lifetime.id)?.text).toBe("local\nmiddle\nend");
    expect(h.lifetime.dirty).toBe(true);
  });
});
