// @vitest-environment jsdom
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import ts from "typescript";
import { EditorState } from "@codemirror/state";
import { applyTextShape, decideDirtyExternalUpdate, editorTextOf, openEditorText } from "@plainva/ui";
import { LocalVaultAdapter } from "../../../../packages/core/src/vault/LocalVaultAdapter";
import { ConflictAwareVaultAdapter } from "../../../../packages/core/src/vault/ConflictAwareVaultAdapter";
import { SyncStateRepository } from "../../../../packages/core/src/vault/SyncStateRepository";
import { realSqlite } from "../../../../packages/core/test/helpers/realSqlite";
import type { IDatabaseAdapter } from "@plainva/core";
import { EditorSaveLifetime } from "./editorSaveLifetime";
import { dirtyStore } from "./dirtyStore";
import { withPendingWrite, resetPendingWritesForTests } from "./pendingWrites";

/**
 * The editor's reaction to a file that changed under it, run as it is written:
 * the original handler of Editor.tsx against real files, with a real CodeMirror
 * state. Its decision is tested as a pure function elsewhere; what stands here
 * is the part no pure test sees — that the file from disk and the editor's text
 * meet in ONE text space, and what the save shape does afterwards (finding
 * 2026-10-08; the phone's twin is editorTextSpace.test.ts in apps/mobile).
 */
const source = readFileSync(resolve("src/components/Editor.tsx"), "utf8");
const file = ts.createSourceFile("Editor.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const effects: ts.Block[] = [];
(function visit(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(file) === "handleExternalUpdate") effects.push(node.parent.parent.parent as ts.Block);
  ts.forEachChild(node, visit);
})(file);
if (effects.length !== 1) throw new Error("Original external-update handler missing");
// The handler and the two helpers it closes over, from the same effect.
const wanted = ["applyExternalText", "current", "handleExternalUpdate"];
const statements = effects[0].statements.filter((statement) => ts.isVariableStatement(statement)
  && statement.declarationList.declarations.some((declaration) => wanted.includes(declaration.name.getText(file))));
if (statements.length !== wanted.length) throw new Error("The external-update effect changed its shape — re-point this harness");
const compiled = ts.transpileModule(statements.map((statement) => statement.getText(file)).join("\n")
  .split('import("../services/draftJournal")').join("loadJournal()"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;

// Built at run time: the mark is never typed into this file.
const MARK = String.fromCharCode(0xfeff);
let root: string, raw: LocalVaultAdapter;
let db: IDatabaseAdapter, files: ConflictAwareVaultAdapter;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "plainva-desktop-external-"));
  raw = new LocalVaultAdapter(root);
  await raw.initialize();
  db = await realSqlite(); files = new ConflictAwareVaultAdapter(raw, new SyncStateRepository(db));
  resetPendingWritesForTests(); dirtyStore.clearAll();
});
afterEach(async () => { vi.restoreAllMocks(); await db.close(); await rm(root, { recursive: true, force: true }); });
const bytes = async (path: string) => (await readFile(join(root, path))).toString("utf8");

/** An editor that has just loaded `path` — the load's own lines, through the one opener. */
async function opened(path: string) {
  const loaded = openEditorText(path, await files.readTextFile(path))!;
  const lifetime = new EditorSaveLifetime(root, path, files);
  lifetime.activate(); lifetime.shape = loaded.shape; lifetime.baseInput = loaded.text; lifetime.persisted = loaded.text;
  const session = {
    view: { state: EditorState.create({ doc: loaded.text }) },
    applyExternalText(text: string) {
      if (this.view.state.doc.toString() === text) return false;
      this.view.state = EditorState.create({ doc: text });
      return true;
    },
  };
  const runs: Promise<unknown>[] = [];
  const ui = { content: vi.fn(), conflict: vi.fn(), error: vi.fn() };
  const deps = {
    activePath: path, vaultPath: root, vaultAdapter: files, saveState: lifetime, sessionRef: { current: session }, contentRef: { current: loaded.text },
    withPendingWrite: (vault: string, target: string, work: () => Promise<void>) => { const run = withPendingWrite(vault, target, work); runs.push(run.catch(() => {})); return run; },
    decideDirtyExternalUpdate, applyTextShape, editorTextOf, openEditorText, dirtyStore,
    loadJournal: async () => ({ clearDraft: async () => {} }),
    setContent: ui.content, setConflictInfo: ui.conflict, setSaveError: ui.error,
    saveTimeoutRef: { current: null }, draftTimerRef: { current: null }, vanishCheckRef: { current: null },
    window, console: { log: () => {}, error: vi.fn() },
  };
  const handle = new Function(...Object.keys(deps), compiled + "\nreturn handleExternalUpdate;")(...Object.values(deps)) as (event: Event) => void;
  /** The watcher's report, and everything it set in motion. */
  async function changedOnDisk() {
    handle(new CustomEvent("plainva-external-update", { detail: { path, vaultPath: root } }));
    await Promise.all(runs);
    await new Promise((done) => setTimeout(done, 0));
  }
  function type(text: string) {
    session.view.state = EditorState.create({ doc: text }); deps.contentRef.current = text;
    lifetime.dirty = true; lifetime.nextRevision(); dirtyStore.set(path, true, lifetime.id);
  }
  return { lifetime, session, ui, changedOnDisk, type };
}

describe("original desktop reaction to a file that changed on disk", () => {
  it("adopts a rewritten note with \\r\\n and a mark quietly, in the editor's text", async () => {
    await raw.writeTextFile("Note.md", `${MARK}one\r\ntwo\r\n`);
    const h = await opened("Note.md");
    expect(h.session.view.state.doc.toString()).toBe("one\ntwo\n");
    await raw.writeTextFile("Note.md", `${MARK}one\r\ntwo\r\nthree from elsewhere\r\n`);
    await h.changedOnDisk();
    expect(h.session.view.state.doc.toString()).toBe("one\ntwo\nthree from elsewhere\n");
    expect(h.lifetime.persisted).toBe("one\ntwo\nthree from elsewhere\n");
    expect(h.lifetime.dirty).toBe(false);
    expect(await files.getConflictSession("Note.md")).toBeNull();
    expect(h.ui.error).not.toHaveBeenCalled();
  });

  it("stays silent when the file was only written again with the same text", async () => {
    await raw.writeTextFile("Note.md", "one\r\ntwo\r\n");
    const h = await opened("Note.md");
    await raw.writeTextFile("Note.md", "one\r\ntwo\r\n");
    await h.changedOnDisk();
    // The read view is not re-parsed for a file that says what it said.
    expect(h.ui.content).not.toHaveBeenCalled();
    expect(await files.getConflictSession("Note.md")).toBeNull();
  });

  it("saves in the shape of the version it adopted, not of the one it first opened", async () => {
    await raw.writeTextFile("Data.csv", "id;name\r\n1;Ada\r\n");
    const h = await opened("Data.csv");
    expect(h.lifetime.shape).toEqual({ eol: "\r\n", bom: false });
    // Another program rewrote the file with "\n" and a mark, and added a row.
    await raw.writeTextFile("Data.csv", `${MARK}id;name\n1;Ada\n2;Grace\n`);
    await h.changedOnDisk();
    expect(h.session.view.state.doc.toString()).toBe("id;name\n1;Ada\n2;Grace\n");
    expect(h.lifetime.shape).toEqual({ eol: "\n", bom: true });
  });

  it("keeps unsaved typing as a conflict copy in the file's own shape when another version arrives", async () => {
    await raw.writeTextFile("Settings.ini", `${MARK}[a]\r\nx=1\r\n`);
    const h = await opened("Settings.ini");
    h.type("[a]\nx=typed here\n");
    await raw.writeTextFile("Settings.ini", `${MARK}[a]\r\nx=from elsewhere\r\n`);
    await h.changedOnDisk();
    const conflict = await files.getConflictSession("Settings.ini");
    expect(conflict).not.toBeNull();
    expect(await bytes(conflict!.workingCopyPath)).toBe(`${MARK}[a]\r\nx=typed here\r\n`);
    expect(await bytes("Settings.ini")).toBe(`${MARK}[a]\r\nx=from elsewhere\r\n`);
    // The editor keeps what was typed.
    expect(h.session.view.state.doc.toString()).toBe("[a]\nx=typed here\n");
  });
});
