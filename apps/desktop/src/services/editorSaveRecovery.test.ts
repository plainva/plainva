// @vitest-environment jsdom
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import ts from "typescript";
import { EditorState } from "@codemirror/state";
import { ConflictError, containsTextChanges, mergeEditorText } from "@plainva/core";
import { applyTextShape, readTextShape } from "@plainva/ui";
import { LocalVaultAdapter } from "../../../../packages/core/src/vault/LocalVaultAdapter";
import { ConflictAwareVaultAdapter } from "../../../../packages/core/src/vault/ConflictAwareVaultAdapter";
import { SyncStateRepository } from "../../../../packages/core/src/vault/SyncStateRepository";
import { realSqlite } from "../../../../packages/core/test/helpers/realSqlite";
import type { IDatabaseAdapter } from "@plainva/core";
import { EditorSaveLifetime } from "./editorSaveLifetime";
import { dirtyStore } from "./dirtyStore";
import { withPendingWrite, resetPendingWritesForTests } from "./pendingWrites";

// Execute the original save function with real note files and CodeMirror
// states. The journal import and UI notification boundaries are controlled;
// the separate journal tests cover its actual persistence implementation.
const source = readFileSync(resolve("src/components/Editor.tsx"), "utf8");
const file = ts.createSourceFile("Editor.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let initializer = "";
function visit(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(file) === "persistText") initializer = node.initializer!.getText(file);
  ts.forEachChild(node, visit);
}
visit(file);
if (!initializer) throw new Error("Original editor persistence function missing");
const compiled = ts.transpileModule("const persistText = " + initializer.split('import("../services/draftJournal")').join("loadJournal()"), {
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
  const ui = { saving: vi.fn(), error: vi.fn(), content: vi.fn(), conflict: vi.fn() };
  const deps = {
    activePath: path, vaultPath: root, vaultAdapter: files, saveState: lifetime, sessionRef, contentRef,
    withPendingWrite, mergeEditorText, containsTextChanges, ConflictError, applyTextShape, readTextShape, dirtyStore,
    loadJournal: async () => ({ recordDraft, clearDraft }),
    setIsSaving: ui.saving, setSaveError: ui.error, setContent: ui.content, setConflictInfo: ui.conflict,
    indexer: null, triggerFileTreeUpdate: vi.fn(), window, CustomEvent, crypto,
    console: { error: vi.fn() }, toast: { warning: vi.fn() }, t: (key: string) => key,
  };
  const persist = new Function(...Object.keys(deps), compiled + "\nreturn persistText;")(...Object.values(deps)) as (text: string) => Promise<void>;
  function edit(text: string) {
    session.applyExternalText(text); contentRef.current = text;
    lifetime.dirty = true; lifetime.nextRevision(); dirtyStore.set(path, true, lifetime.id);
  }
  return { persist, edit, lifetime, session, sessionRef, contentRef, journals, clearDraft, ui };
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
