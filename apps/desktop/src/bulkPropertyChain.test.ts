// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";
import {
  BackupVaultAdapter, ConflictAwareVaultAdapter, DEFAULT_BACKUP_RETENTION, QueueingVaultAdapter, SyncQueue, SyncStateRepository,
  VaultIndexer, VersionHistoryService, type IDatabaseAdapter,
} from "@plainva/core";
import { bulkSetProperty, writeNoteProperty, type BulkSetResult } from "@plainva/ui";
import { LocalVaultAdapter } from "../../../packages/core/src/vault/LocalVaultAdapter";
import { realSqlite } from "../../../packages/core/test/helpers/realSqlite";
import { sourceFile } from "./test-sourceTree";

/**
 * A property set across the selection of a database goes through the vault's
 * chain — the desktop's side, and the reference for the phone's (finding
 * 2026-10-09, `apps/mobile/src/services/vaultChainWrites.test.ts`).
 *
 * The phone handed the shared loop the storage below its chain: no version of
 * the notes it changed, no entry in the sync queue, and a file on disk the
 * chain did not know. The desktop hands it `vaultAdapter`, the chain's top.
 * What that gives a selection is read here from the vault — the statement the
 * database view runs, over real files, a real SQLite and the chain put
 * together the way the vault context does it.
 */

const viewer = ts.createSourceFile("BaseViewer.tsx", sourceFile("apps/desktop/src/components/BaseViewer.tsx"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function all<T extends ts.Node>(root: ts.Node, is: (node: ts.Node) => node is T): T[] {
  const found: T[] = [];
  (function visit(node: ts.Node) {
    if (is(node)) found.push(node);
    ts.forEachChild(node, visit);
  })(root);
  return found;
}
const applySource = all(viewer, ts.isVariableDeclaration).find((d) => d.name.getText(viewer) === "applyBulkSet");
const outcomeSource = applySource && all(applySource, ts.isVariableDeclaration).find((d) => d.name.getText(viewer) === "result")?.initializer;
if (!outcomeSource || !ts.isAwaitExpression(outcomeSource)) throw new Error("the database view's write for a selection moved — re-point this harness");
const selectionWrite = outcomeSource.expression.getText(viewer);
const selectionCode = ts.transpileModule(`const outcome = ${selectionWrite};`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;

const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const NAMES = ["Alpha", "Beta", "Gamma", "Delta", "Epsilon", "Zeta", "Eta", "Theta"];
const NOTES = NAMES.map((name) => `Projects/${name}.md`);
const note = (name: string, status = "open", owner = "Ada") => `---\nstatus: ${status}\nowner: ${owner}\n---\n# ${name}\n\nText of ${name}.\n`;
const nameOf = (path: string) => path.split("/").pop()!.replace(/\.md$/, "");

/** The desktop's database adapter queues its transactions, so six notes at a time never meet in one (`TauriDatabaseAdapter`). */
function queueing(db: IDatabaseAdapter): IDatabaseAdapter {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    ...db,
    transaction<T>(fn: () => Promise<T>): Promise<T> {
      const turn = tail.then(() => db.transaction(fn));
      tail = turn.catch(() => {});
      return turn;
    },
  };
}

let root: string, raw: LocalVaultAdapter, db: IDatabaseAdapter, vaultAdapter: ConflictAwareVaultAdapter, repo: SyncStateRepository;
let indexer: VaultIndexer, history: VersionHistoryService, merged: string[], foreign: string[];

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "plainva-desktop-chain-"));
  raw = new LocalVaultAdapter(root);
  await raw.initialize();
  db = queueing(await realSqlite());
  merged = []; foreign = [];
  // VaultContext: the files, above them versions, the sync queue and the conflict check.
  const backup = new BackupVaultAdapter(raw, { policy: DEFAULT_BACKUP_RETENTION });
  repo = new SyncStateRepository(db, backup, "desktop-a");
  vaultAdapter = new ConflictAwareVaultAdapter(new QueueingVaultAdapter(backup, new SyncQueue(db)), repo, (path) => { merged.push(path); }, repo, "external-folder");
  indexer = new VaultIndexer(vaultAdapter, db, {
    isOwnWrite: (path, sha256) => vaultAdapter.wasWrittenByUs(path, sha256),
    onExternalModification: (path) => { foreign.push(path); },
  });
  history = new VersionHistoryService(raw);
  for (const path of NOTES) await raw.writeTextFile(path, note(nameOf(path)));
  await indexer.indexVaultFull("open, empty index");
});
afterEach(async () => {
  await db.close();
  await rm(root, { recursive: true, force: true });
});

/** The statement of the database view, run with what it names there. */
function setAcrossSelection(paths: string[], column: string, value: unknown): Promise<BulkSetResult> {
  const scope = { vaultAdapter, paths, column, value, setBulkBusy: () => {}, bulkCancelRef: { current: false }, bulkSetProperty };
  return new Function(...Object.keys(scope), `${selectionCode}\nreturn outcome;`)(...Object.values(scope)) as Promise<BulkSetResult>;
}
const queued = async () =>
  (await db.query<{ file_path: string; operation: string }>("SELECT file_path, operation FROM offline_queue ORDER BY id")).map((r) => `${r.operation} ${r.file_path}`).sort();
const versionsOf = async (path: string) => Promise.all((await history.listVersions(path)).map((v) => history.readVersionText(v.backupPath)));

describe("a property set across the selection of a database, on the desktop", () => {
  it("hands the shared loop the chain's top", () => {
    expect(selectionWrite).toMatch(/^bulkSetProperty\(vaultAdapter, paths, column, value, \{/);
  });

  it("takes a version of every note, queues every one of them, and leaves each in a state the chain knows", async () => {
    const result = await setAcrossSelection(NOTES, "status", "done");
    expect([...result.written].sort()).toEqual([...NOTES].sort());
    expect(result.failed).toEqual([]);
    for (const path of NOTES) {
      expect(await raw.readTextFile(path), path).toBe(note(nameOf(path), "done"));
      expect(await versionsOf(path), path).toEqual([note(nameOf(path))]);
      expect((await repo.getSyncState(path))?.local_sha256, path).toBe(sha(note(nameOf(path), "done")));
    }
    expect(await queued()).toEqual(NOTES.map((path) => `write ${path}`).sort());
  });

  it("the next change of such a note is an ordinary write, and an index run finds nothing that came from outside", async () => {
    const result = await setAcrossSelection(NOTES, "status", "done");
    // What the view does next: the written notes into the index, one after the other.
    for (const path of result.written) await indexer.indexPath(path);
    await writeNoteProperty(vaultAdapter, "Projects/Alpha.md", "owner", "Grace");
    expect(await raw.readTextFile("Projects/Alpha.md")).toBe(note("Alpha", "done", "Grace"));
    await indexer.indexVaultFull("watcher");
    expect(foreign).toEqual([]);
    expect(merged).toEqual([]);
    expect(await vaultAdapter.listConflictSessions()).toEqual([]);
    expect((await readdir(join(root, "Projects"))).filter((name) => name.includes(".CONFLICT"))).toEqual([]);
  });
});
