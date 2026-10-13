// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";
import {
  BackupVaultAdapter, ConflictAwareVaultAdapter, DEFAULT_BACKUP_RETENTION, QueueingVaultAdapter, SyncQueue, SyncStateRepository,
  VaultIndexer, VersionHistoryService, isOpenTaskState, resolveTaskOrdinal, updateVaultText, type IDatabaseAdapter, type TaskRecord,
} from "@plainva/core";
import { TaskMutationGate, bulkSetProperty, errorText, toggleTaskAtIndex, writeNoteProperty, type BulkSetResult } from "@plainva/ui";
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
    transaction<T>(fn: () => Promise<T>): Promise<T> {
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
    applyIndexChanges: async (index: VaultIndexer, changes: { added?: string[] }) => { for (const path of changes.added ?? []) await index.indexPath(path); },
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
    expect(sourceFile("apps/desktop/src/components/Editor.tsx")).toMatch(/await vaultAdapter\.writeEditorText\(path, shape \? applyTextShape\(val, shape\) : val,/);
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
 * A database view holds its configuration and saves it whole, without saying
 * which text it started from — a writer the chain cannot hand the file as it
 * lies there. At a database with an open conflict such a write used to go in
 * place of the user's own version of the configuration, like a cell's did. It
 * is refused now, unless the working copy is what such a write left there
 * itself (decision E2).
 */
const BASE = "Projects/Projects.base";
const baseText = (extra: string) => `filters:\n  and:\n    - file.folder == "Projects"\nviews:\n  - type: table\n    name: ${extra}\n`;

// Every change of a database's configuration: the function the view saves it with.
const saveSource = declared(viewer, "saveConfig");
if (!saveSource || !ts.isArrowFunction(saveSource)) throw new Error("the database view's config save moved — re-point this harness");
const saveCode = `const saveConfig = ${saveSource.getText(viewer)};`;
/** The view's save of a configuration, with what it names there; the configuration is handed over as its text. */
function saveConfig(text: string): Promise<void> {
  return run<(config: unknown) => Promise<void>>(saveCode, "saveConfig", {
    vaultAdapter, activePath: BASE, embedded: false, indexer: null, queryService: null, activeViewIndex: 0,
    serializeBaseConfig: (config: string) => config, setContent: () => {}, setDbConfig: () => {}, setPendingConfig: () => {}, setDbData: () => {},
    assertFileStillThere: async () => {}, isFileNotFound: () => false, lookForFile: () => {}, applyIndexChanges: async () => {}, rememberFile: () => {},
    queryForActiveView: async () => [], ...surface,
  })(text);
}

describe("a database with an open conflict: its view's save does not go in place of the user's own version", () => {
  it("the configuration as it was changed here stays in the working copy; the save is refused", async () => {
    await openVault({ [BASE]: baseText("Table") });
    await landedFromOutside(BASE, baseText("Their table"));
    const saved = await vaultAdapter.writeEditorText(BASE, baseText("My table"), baseText("Table"));
    const copy = saved.session!.workingCopyPath;
    // The view shows the database as the file reads — the other side's — and saves a change of that.
    await saveConfig(baseText("Their table, sorted"));
    // It used to be written in place of the working copy: "My table" was gone.
    expect(await raw.readTextFile(copy)).toBe(baseText("My table"));
    expect(await raw.readTextFile(BASE)).toBe(baseText("Their table"));
    expect(shown).toEqual(["console: Failed to save database config The file has an open conflict; nothing was written. Resolve the conflict first"]);
  });

  it("a working copy that such a save left there itself takes the next one", async () => {
    await openVault({ [BASE]: baseText("Table") });
    // Changed below the chain, on the line the view changes next: the view's save cannot be merged and is kept as a working copy.
    await landedFromOutside(BASE, baseText("Their table"));
    await saveConfig(baseText("My table"));
    const copy = (await vaultAdapter.getConflictSession(BASE))!.workingCopyPath;
    expect(await raw.readTextFile(copy)).toBe(baseText("My table"));
    // The view saves on: its newer configuration replaces its own older one, nobody else's.
    await saveConfig(baseText("My table, sorted"));
    expect(await raw.readTextFile(copy)).toBe(baseText("My table, sorted"));
    expect(await raw.readTextFile(BASE)).toBe(baseText("Their table"));
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
