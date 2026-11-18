// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";
import {
  BackupVaultAdapter, ConflictAwareVaultAdapter, DEFAULT_BACKUP_RETENTION, QueueingVaultAdapter, SyncQueue, SyncStateRepository,
  VaultIndexer, VersionHistoryService, isOpenTaskState, resolveTaskOrdinal, updateVaultText, type IDatabaseAdapter, type SqlStatements, type TaskRecord,
} from "@plainva/core";
import { BaseConfigChangeRefusedError, TaskMutationGate, bulkSetProperty, composeLineage, errorText, lineageBetween, loadBaseConfigText, serializeBaseConfig, toggleTaskAtIndex, writeBaseConfigChange, writeNoteProperty, type BulkSetResult } from "@plainva/ui";
import { LocalVaultAdapter } from "../../../packages/core/src/vault/LocalVaultAdapter";
import { realSqlite } from "../../../packages/core/test/helpers/realSqlite";
import { sourceFile } from "./test-sourceTree";

/**
 * A writer that reads a note, changes one place and writes it back has just
 * read the file — the desktop's side (finding 2026-10-12; the phone's is in
 * `apps/mobile/src/services/vaultChainWrites.test.ts`).
 *
 * A cell of a database, a value set across a selection and a tick in the task
 * overview all read the note, change a property or a line and write the note
 * back through the vault's chain. The chain was built for an editor, which
 * holds a text that may be minutes old: it compares the file on disk with what
 * it knew last and was never told which text such a writer started from. Two
 * things followed, and both are read here from the vault itself — real files,
 * a real SQLite, the chain put together the way the vault context does it, and
 * the functions the three surfaces run, taken from their sources:
 *
 * - a note with an open conflict lost what the user had typed: the writer read
 *   the note (the other side's text) and the chain put what it wrote in place
 *   of the working copy;
 * - a note changed below the chain — by another program — was refused as a
 *   conflict, with a conflict copy of a note the user had not edited.
 */

const tsx = (rel: string) => ts.createSourceFile(rel, sourceFile(rel), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function all<T extends ts.Node>(root: ts.Node, is: (node: ts.Node) => node is T): T[] {
  const found: T[] = [];
  (function visit(node: ts.Node) {
    if (is(node)) found.push(node);
    ts.forEachChild(node, visit);
  })(root);
  return found;
}
const js = (code: string) => ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
/** Runs source taken from the desktop with what it names, and hands back `answer`. */
const run = <T>(code: string, answer: string, scope: Record<string, unknown>) =>
  new Function(...Object.keys(scope), `${js(code)}\nreturn ${answer};`)(...Object.values(scope)) as T;
const declared = (file: ts.SourceFile, name: string) => all(file, ts.isVariableDeclaration).find((d) => d.name.getText(file) === name)?.initializer;
/** A callback a component declares with `useCallback`: the function itself, as it stands there. */
function callback(file: ts.SourceFile, name: string): string {
  const call = declared(file, name);
  if (!call || !ts.isCallExpression(call) || call.expression.getText(file) !== "useCallback" || !call.arguments[0]) {
    throw new Error(`${file.fileName} declares no callback ${name} — re-point this harness`);
  }
  return call.arguments[0].getText(file);
}

// One cell: the function the cell layer of the database commits a value with.
const cellsFile = tsx("apps/desktop/src/components/base/useBaseCells.tsx");
const cellSource = declared(cellsFile, "commitCellValue");
if (!cellSource || !ts.isArrowFunction(cellSource)) throw new Error("the cell layer's commit moved — re-point this harness");
const cellCode = `const commitCellValue = ${cellSource.getText(cellsFile)};`;

// A selection: the statement the database view runs for it.
const viewer = tsx("apps/desktop/src/components/BaseViewer.tsx");
const applySource = declared(viewer, "applyBulkSet");
const outcomeSource = applySource && all(applySource, ts.isVariableDeclaration).find((d) => d.name.getText(viewer) === "result")?.initializer;
if (!outcomeSource || !ts.isAwaitExpression(outcomeSource)) throw new Error("the database view's write for a selection moved — re-point this harness");
const selectionCode = `const outcome = ${outcomeSource.expression.getText(viewer)};`;

// A tick: the two callbacks of the task overview.
const tasksFile = tsx("apps/desktop/src/components/tasks/TasksView.tsx");
const tickCode = `const mutateCheckbox = ${callback(tasksFile, "mutateCheckbox")};\nconst toggle = ${callback(tasksFile, "toggle")};`;

const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const nameOf = (path: string) => path.split("/").pop()!.replace(/\.md$/, "");

/** The desktop's database adapter queues its transactions (`TauriDatabaseAdapter`). */
function queueing(db: IDatabaseAdapter): IDatabaseAdapter {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    ...db,
    transaction<T>(fn: (tx: SqlStatements) => Promise<T>): Promise<T> {
      const turn = tail.then(() => db.transaction(fn));
      tail = turn.catch(() => {});
      return turn;
    },
  };
}

let root: string, raw: LocalVaultAdapter, db: IDatabaseAdapter, vaultAdapter: ConflictAwareVaultAdapter, repo: SyncStateRepository;
let indexer: VaultIndexer, history: VersionHistoryService, merged: string[], foreign: string[];
/** The versions layer's clock: a version is taken at most once per interval. */
let clock: number;
/** What a surface told the user, in order: `error: …`, `info: …` — and `console: …` for what only reached the console. */
let shown: string[];
/** The rows a database view shows, as its cell layer holds them. */
let rows: Record<string, unknown>[];

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "plainva-desktop-rcw-"));
  raw = new LocalVaultAdapter(root);
  await raw.initialize();
  db = queueing(await realSqlite());
  merged = []; foreign = []; shown = []; rows = []; clock = Date.now();
  // VaultContext: the files, above them versions, the sync queue and the conflict check.
  const backup = new BackupVaultAdapter(raw, { policy: DEFAULT_BACKUP_RETENTION, now: () => clock });
  repo = new SyncStateRepository(db, backup, "desktop-a");
  vaultAdapter = new ConflictAwareVaultAdapter(new QueueingVaultAdapter(backup, new SyncQueue(db)), repo, (path) => { merged.push(path); }, repo, "external-folder");
  indexer = new VaultIndexer(vaultAdapter, db, {
    isOwnWrite: (path, sha256) => vaultAdapter.wasWrittenByUs(path, sha256),
    onExternalModification: (path) => { foreign.push(path); },
  });
  history = new VersionHistoryService(raw);
});
afterEach(async () => {
  await db.close();
  await rm(root, { recursive: true, force: true });
});

/** A vault as it stands after it was opened: its notes on disk, each known to the index and to the chain. */
async function openVault(texts: Record<string, string>): Promise<void> {
  for (const [path, text] of Object.entries(texts)) await raw.writeTextFile(path, text);
  await indexer.indexVaultFull("open, empty index");
  rows = Object.keys(texts).map((path) => ({ "file.path": path }));
}

const surface = {
  toast: {
    error: (message: string) => { shown.push(`error: ${message}`); },
    info: (message: string) => { shown.push(`info: ${message}`); },
    warning: (message: string) => { shown.push(`warning: ${message}`); },
  },
  t: (key: string, values?: Record<string, unknown>) => (values ? `${key} ${JSON.stringify(values)}` : key),
  console: {
    error: (...said: unknown[]) => {
      const error = said.find((part): part is Error => part instanceof Error);
      shown.push(`console: ${String(said[0])} ${error?.message ?? ""}`.trim());
    },
    warn: () => {}, log: () => {},
  },
};
/** One cell, the way the database's cell layer commits it. */
function writeCell(path: string, col: string, value: unknown): Promise<boolean> {
  return run<(path: string, col: string, value: unknown) => Promise<boolean>>(cellCode, "commitCellValue", {
    vaultAdapter, dbData: rows, settledRef: { current: new Map() },
    setDbData: (change: (prev: Record<string, unknown>[]) => Record<string, unknown>[]) => { rows = change(rows); },
    writeNoteProperty, errorText, ...surface,
  })(path, col, value);
}
/** The statement of the database view for a selection, run with what it names there. */
function setAcrossSelection(paths: string[], column: string, value: unknown): Promise<BulkSetResult> {
  return run<Promise<BulkSetResult>>(selectionCode, "outcome", {
    vaultAdapter, paths, column, value, setBulkBusy: () => {}, bulkCancelRef: { current: false }, bulkSetProperty,
  });
}
/** A tick in the task overview: its two callbacks, with what they name there. */
function tick(task: Pick<TaskRecord, "path" | "ordinal" | "text" | "state">): Promise<void> {
  return run<(task: unknown) => Promise<void>>(tickCode, "toggle", {
    vaultAdapter, taskMutationGate: new TaskMutationGate(), resolveTaskOrdinal, isOpenTaskState, toggleTaskAtIndex, updateVaultText,
    setRefreshTick: () => {}, setTasks: () => {}, indexer, triggerFileTreeUpdate: () => {},
    // `applyIndexChanges` of the desktop, for the one thing it is asked here: the written note into the index.
    applyIndexChanges: async (index: VaultIndexer, changes: { added?: string[] }) => { for (const path of changes.added ?? []) await index.indexPath(path); return { leftBehind: [] }; },
    ...surface,
  })(task);
}
/** What another device or another program left reaches the disk below the chain — as a pull writes it, or a second app. */
const landedFromOutside = (path: string, text: string) => raw.writeTextFile(path, text);
const versionsOf = async (path: string) => Promise.all((await history.listVersions(path)).map((v) => history.readVersionText(v.backupPath)));
const knownToChain = async (path: string) => (await repo.getSyncState(path))?.local_sha256 === sha(await raw.readTextFile(path));
const conflictCopies = async (folder: string) => (await readdir(join(root, folder))).filter((name) => name.includes(".CONFLICT"));

const ALPHA = "Projects/Alpha.md";
const BETA = "Projects/Beta.md";
const withLine = (line: string, name = "Alpha") => `---\nstatus: open\nowner: Ada\n---\n# ${name}\n\n${line}\n\n- [ ] Call Ada\n`;
const SYNCED = withLine("Text of Alpha.");
const THEIRS = withLine("Text of Alpha, as another device left it.");
const MINE = withLine("Text of Alpha, as it was typed at this desk.");
const CALL_ADA = { path: ALPHA, ordinal: 0, text: "Call Ada", state: "open" as const };

/**
 * Alpha with an open conflict: the note was open in the editor when another
 * device's version arrived, and both had changed the same line. The editor's
 * save is `writeEditorText` with the text it was opened with (Editor.tsx).
 * The note now carries the other device's text, the working copy what was
 * typed here.
 */
async function openConflict(): Promise<string> {
  await openVault({ [ALPHA]: SYNCED, [BETA]: withLine("Text of Beta.", "Beta") });
  await landedFromOutside(ALPHA, THEIRS);
  const saved = await vaultAdapter.writeEditorText(ALPHA, MINE, SYNCED);
  if (!saved.session) throw new Error("the save did not open a conflict");
  expect(await raw.readTextFile(ALPHA)).toBe(THEIRS);
  expect(await raw.readTextFile(saved.session.workingCopyPath)).toBe(MINE);
  return saved.session.workingCopyPath;
}

describe("the editor's save is the call this harness opens a conflict with", () => {
  it("writeEditorText, with the text the editor was opened with", () => {
    // The editor hands its text and the text it started from to the save step both shells share (stability plan R6)…
    expect(sourceFile("apps/desktop/src/components/Editor.tsx")).toMatch(/writeEditorSave\(\{\s*files: vaultAdapter, path, text: val, base: saveState\.baseInput,/);
    // …which is this call.
    expect(sourceFile("packages/ui/src/lib/editorSave.ts")).toMatch(/await files\.writeEditorText\(path, shaped\(text\), base === null \? null : shaped\(base\)\)/);
  });
});

/** What both versions of Alpha read after a change that was made to each of them (decision E1: into the note AND into the user's own version). */
const inBoth = async (copy: string, change: (text: string) => string) => {
  expect(await raw.readTextFile(ALPHA)).toBe(change(THEIRS));
  expect(await raw.readTextFile(copy)).toBe(change(MINE));
  // The conflict stays what it is — two versions of one line — until the user decides it.
  expect((await vaultAdapter.getConflictSession(ALPHA))?.workingCopyPath).toBe(copy);
  expect(await conflictCopies("Projects")).toEqual([copy.split("/").pop()]);
};
const done = (text: string) => text.replace("status: open", "status: done");
const ticked = (text: string) => text.replace("- [ ] Call Ada", "- [x] Call Ada");

describe("a note with an open conflict: what was typed at this desk stays in its working copy, and a change lands in both versions", () => {
  it("through a cell written in the note's row", async () => {
    const copy = await openConflict();
    // It used to be refused, with the other device's text and `status: done` in place of the working
    // copy: the writer read the note, which carries their side, and the chain put what it wrote there.
    expect(await writeCell(ALPHA, "status", "done")).toBe(true);
    expect(shown).toEqual([]);
    await inBoth(copy, done);
    // The cell keeps the value it was given: the note carries it.
    expect(rows.find((row) => row["file.path"] === ALPHA)?.status).toBe("done");
  });

  it("through a value set across a selection the note is part of", async () => {
    const copy = await openConflict();
    const result = await setAcrossSelection([ALPHA, BETA], "status", "done");
    // It used to be one note counted as failed.
    expect(result.failed).toEqual([]);
    expect([...result.written].sort()).toEqual([ALPHA, BETA]);
    await inBoth(copy, done);
    expect(await raw.readTextFile(BETA)).toBe(done(withLine("Text of Beta.", "Beta")));
  });

  it("through a tick in the task overview", async () => {
    const copy = await openConflict();
    await tick(CALL_ADA);
    // It used to fail without a word: the overview wrote the refusal to the console and nowhere else.
    expect(shown).toEqual([]);
    await inBoth(copy, ticked);
  });

  it("a task that reads differently in the working copy is ticked in the note alone", async () => {
    await openVault({ [ALPHA]: SYNCED });
    await landedFromOutside(ALPHA, THEIRS);
    // Typed here: the line above, and the task's wording.
    const reworded = MINE.replace("- [ ] Call Ada", "- [ ] Call Ada on Monday");
    const saved = await vaultAdapter.writeEditorText(ALPHA, reworded, SYNCED);
    const copy = saved.session!.workingCopyPath;
    await tick(CALL_ADA);
    expect(shown).toEqual([]);
    expect(await raw.readTextFile(ALPHA)).toBe(ticked(THEIRS));
    // Not guessed at: the working copy has no task of that wording, so it stays as it was typed.
    expect(await raw.readTextFile(copy)).toBe(reworded);
  });

  it("and so does the sentence typed half a minute before — the one no version holds", async () => {
    const copy = await openConflict();
    // Ten minutes later the user types on, in the conflict; that save takes a version of the working copy as it was.
    clock += 10 * 60_000;
    const sentence = "A sentence typed half a minute ago.";
    await vaultAdapter.writeEditorText(ALPHA, MINE.replace("\n\n- [ ]", `\n\n${sentence}\n\n- [ ]`), MINE);
    expect(await raw.readTextFile(copy)).toContain(sentence);
    expect(await versionsOf(copy)).toEqual([MINE]);
    // Half a minute later, a cell: within the two minutes in which the versions layer takes no second version.
    clock += 30_000;
    await writeCell(ALPHA, "status", "done");
    expect(await raw.readTextFile(copy)).toContain(sentence);
    expect(await raw.readTextFile(copy)).toContain("as it was typed at this desk");
    expect(await raw.readTextFile(copy)).toContain("status: done");
    expect(await raw.readTextFile(ALPHA)).toBe(done(THEIRS));
  });

  it("the row of the working copy itself changes the working copy alone", async () => {
    const copy = await openConflict();
    rows.push({ "file.path": copy });
    expect(await writeCell(copy, "status", "done")).toBe(true);
    expect(shown).toEqual([]);
    expect(await raw.readTextFile(copy)).toBe(done(MINE));
    expect(await raw.readTextFile(ALPHA)).toBe(THEIRS);
    expect((await vaultAdapter.getConflictSession(ALPHA))?.workingCopyPath).toBe(copy);
  });
});

/**
 * A database view saves a change of its configuration — since B20 of the
 * 0.9.0 defect list as a change: what it changed against the configuration it
 * showed is set on the file as it lies there, through the chain's entry for a
 * change. Before, it saved the whole configuration it held, a writer the
 * chain could not hand the file as it lies there; at a database with an open
 * conflict that write was refused (decision E2), and a database changed below
 * the chain was refused as a conflict. Now the change is a writer like a
 * cell's (decision E2 = K3): at an open conflict it lands in the file and in
 * the user's own version, each as it lies there; where one of them no longer
 * has the view it changes, nothing is written and the save is said.
 */
const BASE = "Projects/Projects.base";
const baseText = (name: string, extra: string[] = []) =>
  [`filters:`, `  and:`, `    - file.folder == "Projects"`, `views:`, `  - type: table`, `    name: ${name}`, ...extra, ``].join("\n");
/** The same database with a second view: a database of one view holds the same view on both sides, whatever each did to it. */
const twoViews = (name: string, extra: string[] = []) => `${baseText(name, extra)}  - type: cards\n    name: Other\n`;
const sortLines = (direction: string) => [`    sort:`, `      - property: file.name`, `        direction: ${direction}`];
const loaded = (text: string) => loadBaseConfigText(text);
/** A change of the first view as the view makes it: a copy of the configuration with that view replaced. */
const withFirstView = (config: any, patch: Record<string, unknown>) => ({ ...config, views: config.views.map((v: any, i: number) => (i === 0 ? { ...v, ...patch } : v)) });

// Every change of a database's configuration: the function the view saves it with.
const saveSource = declared(viewer, "saveConfig");
if (!saveSource || !ts.isArrowFunction(saveSource)) throw new Error("the database view's config save moved — re-point this harness");
const saveCode = `const saveConfig = ${saveSource.getText(viewer)};`;
/** The view's save of a configuration, with what it names there. */
function saveConfig(config: unknown, scope: Record<string, unknown> = {}, options?: { park?: boolean; views?: unknown }): Promise<boolean> {
  return run<(config: unknown, options?: { park?: boolean; views?: unknown }) => Promise<boolean>>(saveCode, "saveConfig", {
    vaultAdapter, activePath: BASE, embedded: false, indexer: null, queryService: null, activeViewIndex: 0, dbConfig: null, content: "",
    serializeBaseConfig, writeBaseConfigChange, BaseConfigChangeRefusedError, lineageBetween, composeLineage, setReloadTick: () => {}, setActiveViewIndex: () => {},
    setContent: () => {}, setDbConfig: () => {}, setPendingConfig: () => {}, setDbData: () => {},
    assertFileStillThere: async () => {}, isFileNotFound: () => false, lookForFile: () => {}, applyIndexChanges: async () => ({ leftBehind: [] }), rememberFile: () => {},
    queryForActiveView: async () => [], errorText, saveTurn: { current: 0 }, showViewLayout: () => true, ...surface, ...scope,
  })(config, options);
}

/** What a view shows, held the way React holds it: a value, or an update of the one before. */
function viewState(config: unknown, text: string) {
  const state = { config, text, pending: null as { shown: unknown; next: unknown } | null, lookedFor: 0, reloaded: 0, activeView: 0 };
  const apply = <T>(was: T, next: T | ((was: T) => T)) => (typeof next === "function" ? (next as (was: T) => T)(was) : next);
  return {
    state,
    scope: {
      dbConfig: config,
      content: text,
      setDbConfig: (next: unknown) => { state.config = apply(state.config, next as any); },
      setContent: (next: string | ((was: string) => string)) => { state.text = apply(state.text, next); },
      setPendingConfig: (next: any) => { state.pending = apply(state.pending, next); },
      setActiveViewIndex: (next: number | ((was: number) => number)) => { state.activeView = apply(state.activeView, next); },
      lookForFile: () => { state.lookedFor += 1; },
      setReloadTick: () => { state.reloaded += 1; },
    },
  };
}

describe("a database view's change lands on the file as it lies there, at an open conflict in both versions (B20)", () => {
  /** An open conflict: the file has the other side's sort, the user's own version their own. */
  async function conflictOverSort(): Promise<string> {
    await openVault({ [BASE]: baseText("Table") });
    await landedFromOutside(BASE, baseText("Table", sortLines("DESC")));
    const saved = await vaultAdapter.writeEditorText(BASE, baseText("Table", sortLines("ASC")), baseText("Table"));
    return saved.session!.workingCopyPath;
  }

  it("at an open conflict the change lands in the file and in the user's own version, each keeping its own sort", async () => {
    const copy = await conflictOverSort();
    // The view shows the database as the file reads — the other side's — and changes its columns.
    const shownConfig = loaded(baseText("Table", sortLines("DESC")));
    const view = viewState(shownConfig, baseText("Table", sortLines("DESC")));
    expect(await saveConfig(withFirstView(shownConfig, { order: ["file.name", "note.status"] }), view.scope)).toBe(true);
    for (const text of [await raw.readTextFile(BASE), await raw.readTextFile(copy)]) {
      expect(loaded(text).views[0].order).toEqual(["file.name", "note.status"]);
    }
    expect(loaded(await raw.readTextFile(BASE)).views[0].sort).toEqual([{ property: "file.name", direction: "DESC" }]);
    // The user's own version: their sort stayed.
    expect(loaded(await raw.readTextFile(copy)).views[0].sort).toEqual([{ property: "file.name", direction: "ASC" }]);
    expect(shown).toEqual([]);
  });

  it("at an open conflict the view goes on with the file's version, not the user's own", async () => {
    // Loaded before either side changed it.
    await openVault({ [BASE]: baseText("Table") });
    const shownConfig = loaded(baseText("Table"));
    await landedFromOutside(BASE, baseText("Table", sortLines("DESC")));
    const saved = await vaultAdapter.writeEditorText(BASE, baseText("Table", sortLines("ASC")), baseText("Table"));
    const copy = saved.session!.workingCopyPath;
    const view = viewState(shownConfig, baseText("Table"));
    expect(await saveConfig(withFirstView(shownConfig, { order: ["file.name", "note.status"] }), view.scope)).toBe(true);
    expect(loaded(await raw.readTextFile(copy)).views[0].sort).toEqual([{ property: "file.name", direction: "ASC" }]);
    // The view shows what the file holds — its text and its config agree.
    expect((view.state.config as any).views[0].sort).toEqual([{ property: "file.name", direction: "DESC" }]);
    expect((view.state.config as any).views[0].order).toEqual(["file.name", "note.status"]);
    expect(view.state.text).toBe(await raw.readTextFile(BASE));
  });

  it("the active view follows its view where the file moved the views meanwhile", async () => {
    const two = (first: string, second: string) => [`views:`, `  - type: table`, `    name: ${first}`, `  - type: table`, `    name: ${second}`, ``].join("\n");
    await openVault({ [BASE]: two("A", "B") });
    const shownConfig = loaded(two("A", "B"));
    await landedFromOutside(BASE, two("B", "A"));
    const view = viewState(shownConfig, two("A", "B"));
    expect(await saveConfig(withFirstView(shownConfig, { order: ["note.status"] }), view.scope)).toBe(true);
    expect(loaded(await raw.readTextFile(BASE)).views.map((v: any) => v.name)).toEqual(["B", "A"]);
    expect(view.state.activeView).toBe(1);
  });

  it("a database with a byte order mark and CRLF line ends keeps its shape", async () => {
    const shaped = (text: string) => "\uFEFF" + text.replace(/\n/g, "\r\n");
    await openVault({ [BASE]: shaped(baseText("Table")) });
    const shownConfig = loaded(shaped(baseText("Table")));
    // Changed elsewhere too, so the change is merged, not written whole.
    await landedFromOutside(BASE, shaped(baseText("Table", sortLines("DESC"))));
    expect(await saveConfig(withFirstView(shownConfig, { order: ["file.name", "note.status"] }), viewState(shownConfig, shaped(baseText("Table"))).scope)).toBe(true);
    const now = await raw.readTextFile(BASE);
    expect(now.startsWith("\uFEFF")).toBe(true);
    expect(now.replace(/\r\n/g, "")).not.toContain("\n");
    expect(loaded(now).views[0].sort).toEqual([{ property: "file.name", direction: "DESC" }]);
  });

  it("at an open conflict a change the user's own version has no place for lands in the file alone; that version stays as it is", async () => {
    await openVault({ [BASE]: twoViews("Table") });
    await landedFromOutside(BASE, twoViews("Their table"));
    // The user's own version renamed AND sorted the view: no certain match for "Their table" there.
    const saved = await vaultAdapter.writeEditorText(BASE, twoViews("My table", sortLines("ASC")), twoViews("Table"));
    const copy = saved.session!.workingCopyPath;
    const shownConfig = loaded(twoViews("Their table"));
    const view = viewState(shownConfig, twoViews("Their table"));
    expect(await saveConfig(withFirstView(shownConfig, { order: ["note.status"] }), view.scope)).toBe(true);
    expect(loaded(await raw.readTextFile(BASE)).views[0].order).toEqual(["note.status"]);
    expect(await raw.readTextFile(copy)).toBe(twoViews("My table", sortLines("ASC")));
  });

  it("a change to a view deleted or renamed elsewhere meanwhile writes nothing, is said, and the view goes back to what it showed", async () => {
    await openVault({ [BASE]: twoViews("Table") });
    const shownConfig = loaded(twoViews("Table"));
    // Renamed and sorted by another device after the view loaded it: no certain match.
    await landedFromOutside(BASE, twoViews("Renamed", sortLines("DESC")));
    const shownAgain: unknown[] = [];
    const view = viewState(shownConfig, twoViews("Table"));
    const layout = { showViewLayout: (config: unknown) => { shownAgain.push(config); return true; }, saveTurn: { current: 0 } };
    expect(await saveConfig(withFirstView(shownConfig, { order: ["note.status"] }), { ...view.scope, ...layout })).toBe(false);
    expect(await raw.readTextFile(BASE)).toBe(twoViews("Renamed", sortLines("DESC")));
    expect(await vaultAdapter.getConflictSession(BASE)).toBeNull();
    expect(view.state.config).toBe(shownConfig);
    expect(view.state.text).toBe(twoViews("Table"));
    expect(view.state.pending).toBeNull();
    // What the file holds now is loaded.
    expect(view.state.reloaded).toBe(1);
    expect(shownAgain).toEqual([shownConfig]);
    expect(shown).toHaveLength(2);
    expect(shown[1]).toMatch(/^error: writeFailed\.databaseSave .*Table/);
    // A save that started after this one owns the view: the refused one leaves its layout alone.
    shownAgain.length = 0;
    const later = { ...layout, saveTurn: { get current() { return 7; }, set current(_value: number) { /* a later save took the turn */ } } };
    expect(await saveConfig(withFirstView(shownConfig, { order: ["note.status"] }), { ...view.scope, ...later })).toBe(false);
    expect(shownAgain).toEqual([]);
  });

  it("a database changed below the chain takes the change as it lies there: no conflict, nothing undone", async () => {
    await openVault({ [BASE]: baseText("Table") });
    const shownConfig = loaded(baseText("Table"));
    // Another program sorted it meanwhile.
    await landedFromOutside(BASE, baseText("Table", sortLines("DESC")));
    const view = viewState(shownConfig, baseText("Table"));
    expect(await saveConfig(withFirstView(shownConfig, { order: ["file.name", "note.status"] }), view.scope)).toBe(true);
    expect(await vaultAdapter.getConflictSession(BASE)).toBeNull();
    const now = loaded(await raw.readTextFile(BASE)).views[0];
    expect(now.order).toEqual(["file.name", "note.status"]);
    expect(now.sort).toEqual([{ property: "file.name", direction: "DESC" }]);
    // The view shows what the file holds now.
    expect((view.state.config as any).views[0].sort).toEqual([{ property: "file.name", direction: "DESC" }]);
    expect(view.state.text).toBe(await raw.readTextFile(BASE));
  });

  it("where nobody else changed the file, the text written is the whole configuration's", async () => {
    await openVault({ [BASE]: baseText("Table") });
    const shownConfig = loaded(baseText("Table"));
    const next = withFirstView(shownConfig, { order: ["file.name", "note.status"] });
    expect(await saveConfig(next, viewState(shownConfig, baseText("Table")).scope)).toBe(true);
    expect(await raw.readTextFile(BASE)).toBe(serializeBaseConfig(next));
  });

  it("a change other files follow is not kept for a database that has moved", async () => {
    // A setting of the view waits for the file and goes with it once it is
    // found; a rename does not, since its notes would not wait with it.
    await openVault({ [BASE]: baseText("Table") });
    const gone = { assertFileStillThere: async () => { throw Object.assign(new Error("gone"), { code: "FILE_NOT_FOUND" }); }, isFileNotFound: (e: unknown) => (e as { code?: string }).code === "FILE_NOT_FOUND" };
    const shownConfig = loaded(baseText("Table"));
    const sorted = withFirstView(shownConfig, { order: ["note.status"] });
    const setting = viewState(shownConfig, baseText("Table"));
    expect(await saveConfig(sorted, { ...setting.scope, ...gone })).toBe(false);
    // What waits is the change: the config shown before it, and the config now (B20).
    expect(setting.state).toMatchObject({ config: sorted, pending: { shown: shownConfig, next: sorted }, lookedFor: 1 });
    const rename = viewState(shownConfig, baseText("Table"));
    expect(await saveConfig(withFirstView(shownConfig, { name: "Renamed" }), { ...rename.scope, ...gone }, { park: false })).toBe(false);
    expect(rename.state).toMatchObject({ config: shownConfig, text: baseText("Table"), pending: null, lookedFor: 1 });
    expect(await raw.readTextFile(BASE)).toBe(baseText("Table"));
    // Changes that wait one after the other keep which view is which (B20): a
    // view removed and a new one added under its name are two views.
    const two = loaded(twoViews("Table"));
    const parked = viewState(two, twoViews("Table"));
    const mid = { ...two, views: [two.views[1]] };
    expect(await saveConfig(mid, { ...parked.scope, ...gone }, { views: { remove: 0 } })).toBe(false);
    const again = { ...mid, views: [...mid.views, { type: "table", name: "Table" }] };
    expect(await saveConfig(again, { ...parked.scope, dbConfig: mid, ...gone }, { views: { add: 1 } })).toBe(false);
    expect(parked.state.pending).toMatchObject({ shown: two, next: again, lineage: [1, null] });
  });
});

/**
 * A note changed below the chain is one the chain no longer knows — on the
 * desktop that is another program writing into the vault's folder. An index
 * run reports it as changed from outside and, on purpose, does not put right
 * what the chain knows (that would take the merge base from the sync). So it
 * stays unknown until it is opened in an editor or pushed, and in a vault
 * without a sync provider that is never by itself.
 */
const FOUR = ["Alpha", "Beta", "Gamma", "Delta"].map((name) => `Projects/${name}.md`);
const five = (name: string, set: Partial<Record<"status" | "owner" | "area", string>> = {}) =>
  `---\nstatus: ${set.status ?? "open"}\nowner: ${set.owner ?? "Ada"}\ndue: 2026-10-20\narea: ${set.area ?? "Lab"}\neffort: 3\n---\n# ${name}\n\nText of ${name}.\n`;

/** Four notes whose `status` was set below the chain, and the index run that follows. */
async function changedBelowTheChain(): Promise<void> {
  await openVault(Object.fromEntries(FOUR.map((path) => [path, five(nameOf(path))])));
  // The shared loop over the storage below the chain: what another program does, with the app's own writer.
  const below = await bulkSetProperty(raw, FOUR, "status", "waiting");
  expect(below.failed).toEqual([]);
  for (const path of FOUR) expect(await raw.readTextFile(path), path).toBe(five(nameOf(path), { status: "waiting" }));
  await indexer.indexVaultFull("watcher");
  expect([...foreign].sort()).toEqual([...FOUR].sort());
  for (const path of FOUR) expect(await knownToChain(path), path).toBe(false);
}

describe("a note changed below the chain is written again like any other", () => {
  it("the same property with another value, the property on the next line, one three lines away, the same value", async () => {
    await changedBelowTheChain();
    const landed = [
      await writeCell("Projects/Alpha.md", "status", "done"),
      await writeCell("Projects/Beta.md", "owner", "Grace"),
      await writeCell("Projects/Gamma.md", "area", "Office"),
      await writeCell("Projects/Delta.md", "status", "waiting"),
    ];
    // It used to be refused for the first two ("conflicting changes"), each with a conflict copy of a
    // note the user had not edited; the third was merged, the fourth written. In all four the writer
    // had read exactly the text that stood on disk.
    expect(shown).toEqual([]);
    expect(landed).toEqual([true, true, true, true]);
    expect(await raw.readTextFile("Projects/Alpha.md")).toBe(five("Alpha", { status: "done" }));
    expect(await raw.readTextFile("Projects/Beta.md")).toBe(five("Beta", { status: "waiting", owner: "Grace" }));
    expect(await raw.readTextFile("Projects/Gamma.md")).toBe(five("Gamma", { status: "waiting", area: "Office" }));
    expect(await raw.readTextFile("Projects/Delta.md")).toBe(five("Delta", { status: "waiting" }));
    expect(merged).toEqual([]);
    expect(await vaultAdapter.listConflictSessions()).toEqual([]);
    expect(await conflictCopies("Projects")).toEqual([]);
    // What the sync merges against stays what it was: the text both sides last agreed on.
    for (const path of FOUR) expect((await repo.getSyncState(path))?.base_text, path).toBe(five(nameOf(path)));
  });

  it("a value set across the selection lands on every one of them", async () => {
    await changedBelowTheChain();
    const result = await setAcrossSelection(FOUR, "status", "done");
    // It used to be four notes counted as failed, and four conflict copies.
    expect(result.failed).toEqual([]);
    expect([...result.written].sort()).toEqual([...FOUR].sort());
    for (const path of FOUR) expect(await raw.readTextFile(path), path).toBe(five(nameOf(path), { status: "done" }));
    expect(await conflictCopies("Projects")).toEqual([]);
    for (const path of FOUR) expect(await knownToChain(path), path).toBe(true);
  });

  it("a tick lands in a note that was saved here and then changed by another program", async () => {
    await openVault({ [ALPHA]: SYNCED });
    // Saved from the editor: the chain knows the new text, and no sync has taken it as the merge base.
    const edited = withLine("Text of Alpha, edited at this desk.");
    await vaultAdapter.writeEditorText(ALPHA, edited, SYNCED);
    await landedFromOutside(ALPHA, `${edited}\nA line another program added.\n`);
    await tick(CALL_ADA);
    // It used to be "base version not found" and a conflict copy, although the other program's line
    // stands at the far end of the note: for the text the chain knew, no copy was kept to merge against.
    expect(shown).toEqual([]);
    expect(await raw.readTextFile(ALPHA)).toBe(`${edited.replace("- [ ] Call Ada", "- [x] Call Ada")}\nA line another program added.\n`);
    expect(await vaultAdapter.listConflictSessions()).toEqual([]);
    expect(await conflictCopies("Projects")).toEqual([]);
  });
});
