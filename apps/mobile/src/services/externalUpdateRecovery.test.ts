import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import ts from "typescript";
import { LocalVaultAdapter } from "../../../../packages/core/src/vault/LocalVaultAdapter";
import { ConflictAwareVaultAdapter } from "../../../../packages/core/src/vault/ConflictAwareVaultAdapter";
import { SyncStateRepository } from "../../../../packages/core/src/vault/SyncStateRepository";
import { realSqlite } from "../../../../packages/core/test/helpers/realSqlite";
import type { IDatabaseAdapter } from "@plainva/core";
import { createSaveCoordinator, type SaveCoordinator } from "./saveCoordinator";
import type { MobileVault } from "./vaultService";

const source = readFileSync(resolve("src/EditorHost.tsx"), "utf8");
const file = ts.createSourceFile("EditorHost.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let handler = "";
function visit(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(file) === "handleExternalUpdate") handler = node.initializer!.getText(file);
  ts.forEachChild(node, visit);
}
visit(file);
if (!handler) throw new Error("original external-update callback missing");
const compiled = ts.transpileModule("const handle = " + handler, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;
function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
function editor(text: string) {
  return {
    text,
    view: { state: { doc: { toString: () => text } } },
    applyExternalText(next: string) { text = next; this.text = next; },
  };
}
let root: string, raw: LocalVaultAdapter, vault: MobileVault, saver: SaveCoordinator<MobileVault>;
let db: IDatabaseAdapter;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "plainva-editor-recovery-"));
  raw = new LocalVaultAdapter(root);
  await raw.initialize();
  await raw.writeTextFile("Note.md", "foreign disk");
  db = await realSqlite();
  vault = { vaultId: root, files: new ConflictAwareVaultAdapter(raw, new SyncStateRepository(db)) } as unknown as MobileVault;
  saver = createSaveCoordinator({ contextKey: (v: MobileVault) => v.vaultId, debounceMs: 60_000,
    write: async (v, path, text) => { await v.files.writeEditorText!(path, text, "base"); } });
});
afterEach(async () => {
  saver.discard("Note.md", vault);
  await saver.flushAll();
  vi.restoreAllMocks();
  await db.close();
  await rm(root, { recursive: true, force: true });
});
function createHandler() {
  const session = editor("my draft");
  const sessionRef = { current: session };
  const errors = vi.fn(), conflicts = vi.fn();
  const events = new EventTarget();
  const documents: unknown[] = [];
  events.addEventListener("m-editor-document", (event) => documents.push((event as CustomEvent).detail));
  const deps = {
    noteSaver: saver, path: "Note.md", vault, session, sessionRef,
    vaultOps: { readEditor: async (v: MobileVault, path: string) => v.files.readTextFile((await v.files.getConflictSession!(path))?.workingCopyPath ?? path) },
    getLastPersistedText: () => "base",
    rememberPersistedText: vi.fn(),
    // These files have no shape to put back; editorTextSpace.test.ts runs the real one.
    editorDiskText: (_vault: MobileVault, _path: string, text: string) => text,
    decideDirtyExternalUpdate: () => "preserve-conflict",
    conflictCopyPath: () => "Note.CONFLICT-test.md",
    toast: { error: errors }, t: (s: string) => s, noteConflict: conflicts,
    console: { error: () => {} }, window: events, CustomEvent,
  };
  const handle = new Function(...Object.keys(deps), compiled + "\nreturn handle;")(...Object.values(deps)) as () => Promise<void>;
  saver.schedule(vault, "Note.md", "my draft");
  return { handle, session, sessionRef, errors, conflicts, documents };
}
describe("original mobile external-update callback with real recovery files", () => {
  it("keeps the buffer and pending save when writing the conflict copy fails", async () => {
    const h = createHandler();
    vi.spyOn(raw, "writeTextFile").mockRejectedValueOnce(new Error("no room for copy"));
    await h.handle();
    expect(h.session.text).toBe("my draft");
    expect(saver.hasPending("Note.md", vault)).toBe(true);
    expect(h.documents).toEqual([]);
    expect(await raw.readTextFile("Note.md")).toBe("foreign disk");
    expect(h.errors).toHaveBeenCalledOnce();
    expect(h.conflicts).not.toHaveBeenCalled();
  });

  it("keeps editing the durable copy and retains the pending save", async () => {
    const h = createHandler();
    await h.handle();
    const conflict = await vault.files.getConflictSession!("Note.md");
    expect(await raw.readTextFile(conflict!.workingCopyPath)).toBe("my draft");
    expect(h.session.text).toBe("my draft");
    expect(h.documents).toEqual([]);
    expect(saver.hasPending("Note.md", vault)).toBe(true);
    expect(h.conflicts).toHaveBeenCalledWith("Note.md", conflict!.workingCopyPath, vault.vaultId, conflict);
  });

  it.each(["typing", "navigation"] as const)("does not replace %s that arrived while preserving a conflict", async (action) => {
    const h = createHandler();
    const entered = gate(), release = gate();
    const write = raw.writeTextFile.bind(raw);
    vi.spyOn(raw, "writeTextFile").mockImplementationOnce(async (path, text) => {
      entered.resolve();
      await release.promise;
      await write(path, text);
    });
    const run = h.handle();
    await entered.promise;
    if (action === "typing") {
      h.session.applyExternalText("newer typing");
      saver.schedule(vault, "Note.md", "newer typing");
    } else {
      h.sessionRef.current = editor("another note or vault");
    }
    release.resolve();
    await run;
    expect(h.sessionRef.current.text).toBe(action === "typing" ? "newer typing" : "another note or vault");
    expect(saver.hasPending("Note.md", vault)).toBe(true);
    expect(await raw.readTextFile((await vault.files.getConflictSession!("Note.md"))!.workingCopyPath)).toBe("my draft");
  });
});
