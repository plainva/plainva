import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import ts from "typescript";
import { BackupVaultAdapter, ConflictAwareVaultAdapter, ConflictError, QueueingVaultAdapter, SyncQueue, SyncStateRepository, mergeText, containsTextChanges, type IDatabaseAdapter } from "@plainva/core";
import { LocalVaultAdapter } from "../../../../packages/core/src/vault/LocalVaultAdapter";
import { realSqlite } from "../../../../packages/core/test/helpers/realSqlite";
import { createSaveCoordinator, type SaveCoordinator } from "./saveCoordinator";
import type { MobileVault } from "./vaultService";

// Run the actual factory, note-save method and vault lifecycle functions.
// Only native boot/registry/notifications are replaced; files, conflict
// detection, backup layer, queued writes and SQLite are the real components.
const source = readFileSync(resolve("src/services/vaultService.ts"), "utf8");
const file = ts.createSourceFile("vaultService.ts", source, ts.ScriptTarget.Latest, true);
const parts: string[] = [];
let saveMethod = "", saverInit = "";
function visit(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) && node.name &&
      ["switchVault", "reloadActiveMobileVault", "deleteVault", "rememberPersistedText", "getLastPersistedText"].includes(node.name.text)) {
    parts.push(node.getText(file).replace(/^export /, ""));
  }
  if (ts.isMethodDeclaration(node) && node.name.getText(file) === "save") saveMethod = node.getText(file);
  if (ts.isVariableDeclaration(node) && node.name.getText(file) === "noteSaver") saverInit = node.initializer!.getText(file);
  ts.forEachChild(node, visit);
}
visit(file);
if (!saveMethod || !saverInit || parts.length !== 5) throw new Error("mobile save/lifecycle definitions missing");
const compiled = ts.transpileModule(
  "let bootPromise = Promise.resolve(vault); const lastPersistedText = new Map(); const editorBaseText = new Map();\n" +
  "const vaultOps = {" + saveMethod + "}; const noteSaver = " + saverInit + ";\n" + parts.join("\n"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  },
).outputText;

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
let roots: string[], databases: IDatabaseAdapter[], savers: SaveCoordinator<MobileVault>[];
beforeEach(() => { roots = []; databases = []; savers = []; });
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(savers.map((s) => s.flushAll()));
  await Promise.all(databases.map((db) => db.close()));
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});
async function makeVault() {
  const root = await mkdtemp(join(tmpdir(), "plainva-save-recovery-"));
  roots.push(root);
  const raw = new LocalVaultAdapter(root);
  await raw.initialize();
  // An editor saves a note it already opened; creation has its own write path.
  await raw.writeTextFile("Note.md", "");
  const db = await realSqlite();
  databases.push(db);
  const queue = new SyncQueue(db);
  const repo = new SyncStateRepository(db);
  const files = new ConflictAwareVaultAdapter(new QueueingVaultAdapter(new BackupVaultAdapter(raw), queue), repo);
  const vault = { vaultId: root, adapter: raw, files, db, indexer: null, dispose: vi.fn(async () => {}) } as unknown as MobileVault;
  return { vault, raw, db, repo };
}
function harness(vault: MobileVault) {
  const drafts = new Map<string, { text: string; revision: number }>();
  const conflicts: Array<{ path: string; copy: string; vaultId: string }> = [];
  const stopped = vi.fn(async () => {});
  const activated = vi.fn(async () => {});
  const deps = {
    vault, createSaveCoordinator, ConflictError, mergeText, containsTextChanges,
    writeDraft: (v: MobileVault, path: string, text: string, revision: number) =>
      drafts.set(JSON.stringify([v.vaultId, path]), { text, revision }),
    clearDraft: (v: MobileVault, path: string, revision: number) => {
      const key = JSON.stringify([v.vaultId, path]);
      if ((drafts.get(key)?.revision ?? Infinity) <= revision) drafts.delete(key);
    },
    noteConflict: (path: string, copy: string, vaultId: string) => { conflicts.push({ path, copy, vaultId }); },
    conflictCopyPath: () => { throw new Error("actual conflict path required"); },
    syncSoon: () => {}, toast: { warning: () => {} }, i18n: { t: (s: string) => s },
    stopSyncAndDrain: stopped, setActiveVault: activated, reloadMobileSettingsForActiveVault: async () => {},
    window: { dispatchEvent: () => {} }, CustomEvent: class {},
    LOCAL_VAULT_ID: "local",
    console: { error: () => {} },
  };
  const result = new Function(...Object.keys(deps), compiled +
    "\nreturn {noteSaver,switchVault,reloadActiveMobileVault,deleteVault,getLastPersistedText,rememberPersistedText};")(...Object.values(deps)) as {
      noteSaver: SaveCoordinator<MobileVault>;
      switchVault(id: string): Promise<void>;
      reloadActiveMobileVault(): Promise<void>;
      deleteVault(id: string): Promise<void>;
      getLastPersistedText(v: MobileVault, path: string): string | null;
      rememberPersistedText(v: MobileVault, path: string, text: string): void;
    };
  savers.push(result.noteSaver);
  return { ...result, drafts, conflicts, stopped, activated };
}

describe("mobile saves through the actual adapter and lifecycle chain", () => {
  it("writes two vaults with the same path to separate files and SQLite queues", async () => {
    const a = await makeVault(), b = await makeVault();
    const h = harness(a.vault);
    h.noteSaver.schedule(a.vault, "Note.md", "alpha");
    h.noteSaver.schedule(b.vault, "Note.md", "beta");
    await h.noteSaver.flushAll();
    expect(await a.raw.readTextFile("Note.md")).toBe("alpha");
    expect(await b.raw.readTextFile("Note.md")).toBe("beta");
    expect(h.getLastPersistedText(a.vault, "Note.md")).toBe("alpha");
    expect(h.getLastPersistedText(b.vault, "Note.md")).toBe("beta");
    for (const { db } of [a, b]) expect(await db.query("SELECT file_path FROM offline_queue")).toEqual([{ file_path: "Note.md" }]);
    expect(h.drafts.size).toBe(0);
  });

  it.each(["switch", "reload", "delete"] as const)("%s retains the current vault after a failed actual write, then allows retry", async (action) => {
    const a = await makeVault();
    const h = harness(a.vault);
    const realWrite = a.raw.writeTextFile.bind(a.raw);
    vi.spyOn(a.raw, "writeTextFile").mockImplementation(async (path, text) => {
      if (path === "Note.md") throw new Error("disk full");
      await realWrite(path, text);
    });
    h.noteSaver.schedule(a.vault, "Note.md", "keep this");
    const run = () => action === "switch" ? h.switchVault("other") :
      action === "reload" ? h.reloadActiveMobileVault() : h.deleteVault(a.vault.vaultId);
    await expect(run()).rejects.toThrow("disk full");
    expect(h.stopped).not.toHaveBeenCalled();
    expect(h.activated).not.toHaveBeenCalled();
    expect(a.vault.dispose).not.toHaveBeenCalled();
    expect(h.noteSaver.hasPending("Note.md", a.vault)).toBe(true);
    expect([...h.drafts.values()]).toEqual([{ text: "keep this", revision: 1 }]);
    vi.mocked(a.raw.writeTextFile).mockImplementation(realWrite);
    if (action === "delete") await h.noteSaver.flushAll();
    else await run();
    expect(await a.raw.readTextFile("Note.md")).toBe("keep this");
    if (action !== "delete") expect(a.vault.dispose).toHaveBeenCalledOnce();
    expect(h.drafts.size).toBe(0);
  });

  it("preserves both actual conflict snapshots when typing continues during the first copy", async () => {
    const a = await makeVault();
    await a.raw.writeTextFile("Note.md", "foreign");
    await a.repo.updateLocalHashAndBaseText("Note.md", createHash("sha256").update("base").digest("hex"), "base");
    const entered = gate(), release = gate();
    const write = a.raw.writeTextFile.bind(a.raw);
    let first = true;
    vi.spyOn(a.raw, "writeTextFile").mockImplementation(async (path, text) => {
      if (path.includes(".CONFLICT") && first) {
        first = false;
        entered.resolve();
        await release.promise;
      }
      await write(path, text);
    });
    const h = harness(a.vault);
    h.noteSaver.schedule(a.vault, "Note.md", "first local");
    const flushed = expect(h.noteSaver.flushAll()).rejects.toBeInstanceOf(ConflictError);
    await entered.promise;
    h.noteSaver.schedule(a.vault, "Note.md", "newer local");
    await new Promise((done) => setTimeout(done, 5)); // two distinct native copy timestamps
    release.resolve();
    await flushed;
    expect(h.conflicts).toHaveLength(2);
    expect(await a.raw.readTextFile(h.conflicts[0].copy)).toBe("first local");
    expect(await a.raw.readTextFile(h.conflicts[1].copy)).toBe("newer local");
    expect(await a.raw.readTextFile("Note.md")).toBe("foreign");
    expect(h.conflicts.every((c) => c.vaultId === a.vault.vaultId)).toBe(true);
    expect([...h.drafts.values()]).toEqual([{ text: "newer local", revision: 2 }]);
    expect(h.noteSaver.hasPending()).toBe(false);
  });

  it("retains a pulled change when more typing is queued behind a delayed merged save", async () => {
    const a = await makeVault(), h = harness(a.vault);
    h.rememberPersistedText(a.vault, "Note.md", "base\nmiddle\nend");
    await a.raw.writeTextFile("Note.md", "base\nmiddle\nexternal");
    const entered = gate(), release = gate(), write = a.raw.writeTextFile.bind(a.raw);
    let held = false;
    vi.spyOn(a.raw, "writeTextFile").mockImplementation(async (path, text) => {
      if (path === "Note.md" && !held) { held = true; entered.resolve(); await release.promise; }
      await write(path, text);
    });
    h.noteSaver.schedule(a.vault, "Note.md", "first\nmiddle\nend");
    const saving = h.noteSaver.flushAll(); await entered.promise;
    h.noteSaver.schedule(a.vault, "Note.md", "newer\nmiddle\nend");
    release.resolve(); await saving;
    expect(await a.raw.readTextFile("Note.md")).toBe("newer\nmiddle\nexternal");
    expect(h.getLastPersistedText(a.vault, "Note.md")).toBe("newer\nmiddle\nexternal");
    expect(h.drafts.size).toBe(0);
  });

  it("uses the editor base even when the sync index already records the conflicting disk", async () => {
    const a = await makeVault(), h = harness(a.vault);
    h.rememberPersistedText(a.vault, "Note.md", "base");
    await a.raw.writeTextFile("Note.md", "foreign");
    await a.repo.updateLocalHashAndBaseText("Note.md", createHash("sha256").update("foreign").digest("hex"), "foreign");
    h.noteSaver.schedule(a.vault, "Note.md", "local");
    await expect(h.noteSaver.flushAll()).rejects.toBeInstanceOf(ConflictError);
    expect(await a.raw.readTextFile("Note.md")).toBe("foreign");
    expect(await a.raw.readTextFile(h.conflicts[0].copy)).toBe("local");
    expect(h.drafts.size).toBe(1);
  });

  it("retains recovery when a successful native return has an incompatible read-back", async () => {
    const a = await makeVault(), h = harness(a.vault), write = a.raw.writeTextFile.bind(a.raw);
    h.rememberPersistedText(a.vault, "Note.md", "");
    vi.spyOn(a.raw, "writeTextFile").mockImplementation(async (path, text) => {
      await write(path, path === "Note.md" ? "foreign" : text);
    });
    h.noteSaver.schedule(a.vault, "Note.md", "local");
    await expect(h.noteSaver.flushAll()).rejects.toThrow("could not be confirmed");
    expect(h.drafts.size).toBe(1);
    expect(h.noteSaver.hasPending("Note.md", a.vault)).toBe(true);
    h.noteSaver.discard("Note.md", a.vault);
  });
});
