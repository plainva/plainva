// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import ts from "typescript";
import {
  BackupVaultAdapter, ConflictAwareVaultAdapter, ConflictError, DEFAULT_BACKUP_RETENTION, DEFAULT_TEXT_SHAPE, QueueingVaultAdapter,
  SyncQueue, SyncStateRepository, VaultIndexer, VaultQueryService, VersionHistoryService, applyTextShape, containsTextChanges,
  editorTextOf, initializeSchema, isNotTextFileError, isOpenTaskState, mergeEditorText, resolveTaskOrdinal, updateVaultText, type IDatabaseAdapter, type TaskRecord, type TextChange,
  type TextFileUpdate,
} from "@plainva/core";
import {
  TaskMutationGate, assertFileStillThere, bulkSetProperty, combineFilters, createEntryEvent, createInlineBase, createTaskDatabase, createTemplateIn,
  errorText, importAttachment, keepTextBeside, saveNoteAsTemplateIn, serializeBaseConfig, toggleTaskAtIndex, writeNoteProperty, type BulkSetResult,
} from "@plainva/ui";
import { LocalVaultAdapter } from "../../../../packages/core/src/vault/LocalVaultAdapter";
import { realSqlite } from "../../../../packages/core/test/helpers/realSqlite";
import { phoneSqlite, type PhonePlatform } from "../../../../packages/core/test/helpers/phoneSqlitePlugin";
import { CapacitorSqliteAdapter } from "../adapters/CapacitorSqliteAdapter";
import { createSaveCoordinator, type SaveCoordinator } from "./saveCoordinator";
import type { MobileVault } from "./vaultService";

/**
 * What the phone writes into an open vault reaches it through the vault's
 * chain (finding 2026-10-09).
 *
 * A vault on the phone carries two adapters side by side: `vault.files`, the
 * chain every write of the app goes through — a version of the file as it
 * was, the question whether the file on disk is still the one the app knows,
 * the entry in the sync queue — and `vault.adapter`, the storage below it.
 * Both have the same methods, so a shared writer takes either. Seven writers
 * were handed the one below: a property set across the selection of a
 * database, the anchor of an entry put in the calendar, a database created
 * from the editor, the two ways to make a template, the task database, and a
 * voice memo. The desktop hands every one of them its chain.
 *
 * What that cost is read here from the vault itself: its version history, its
 * sync queue, what the chain knows of the file on disk, and the rows a
 * database queries next. The tests run the phone's actual code — the statement
 * the database screen runs for its selection, the service functions behind it,
 * the note saver, and for each other writer the expression its screen hands to
 * the shared function — against real files, a real SQLite and the real adapter
 * chain, put together the way `boot` does it. Only the native boot, registry
 * and notifications are replaced. (The desktop's twin, with the desktop's own
 * statement, is `bulkPropertyChain.test.ts` there; `rawVaultAdapter.test.ts`
 * keeps the storage below the chain out of every new writer.)
 */

const sourceOf = (file: string) =>
  ts.createSourceFile(file, readFileSync(resolve(file), "utf8"), ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
function all<T extends ts.Node>(root: ts.Node, is: (node: ts.Node) => node is T): T[] {
  const found: T[] = [];
  (function visit(node: ts.Node) {
    if (is(node)) found.push(node);
    ts.forEachChild(node, visit);
  })(root);
  return found;
}
const js = (code: string) => ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
/** Runs source taken from the phone with what it names, and hands back `answer`. */
const run = <T>(code: string, answer: string, scope: Record<string, unknown>) =>
  new Function(...Object.keys(scope), `${js(code)}\nreturn ${answer};`)(...Object.values(scope)) as T;

// The phone's read, save and change of a file, its note saver and what remembers an editor's text.
const serviceFile = sourceOf("src/services/vaultService.ts");
const fileMethods = all(serviceFile, ts.isMethodDeclaration).filter((m) => ["read", "save", "update"].includes(m.name.getText(serviceFile)));
const saverSource = all(serviceFile, ts.isVariableDeclaration).find((d) => d.name.getText(serviceFile) === "noteSaver")?.initializer;
const rememberSource = all(serviceFile, ts.isFunctionDeclaration).find((f) => f.name?.text === "rememberPersistedText");
if (fileMethods.length !== 3 || !saverSource || !rememberSource) throw new Error("the phone's read, save, update and note saver moved — re-point this harness");
const serviceCode =
  "const lastPersistedText = new Map(); const editorBaseText = new Map(); const editorTextShape = new Map(); const keptTexts = new Map();\n" +
  `${rememberSource.getText(serviceFile).replace(/^export /, "")}\n` +
  `const vaultOps = {${fileMethods.map((m) => m.getText(serviceFile)).join(",\n")}}; const noteSaver = ${saverSource.getText(serviceFile)};`;

// The phone's property writers and the query a database screen runs.
const baseOpsFile = sourceOf("src/services/baseOps.ts");
const baseOpsCode = all(baseOpsFile, ts.isFunctionDeclaration)
  .filter((f) => ["noteFiles", "commitCellValue", "commitBulkValue", "queryView", "saveBaseConfig"].includes(f.name?.text ?? ""))
  .map((f) => f.getText(baseOpsFile).replace(/^export /, ""))
  .join("\n");

// What the database screen runs to set one property across its selection: the statement itself.
const screenFile = sourceOf("src/screens/base/BaseScreen.tsx");
const flowSource = all(screenFile, ts.isVariableDeclaration).find((d) => d.name.getText(screenFile) === "bulkSetFlow");
const outcomeSource = flowSource && all(flowSource, ts.isVariableDeclaration).find((d) => d.name.getText(screenFile) === "result")?.initializer;
if (!outcomeSource || !ts.isAwaitExpression(outcomeSource)) throw new Error("the database screen's write for a selection moved — re-point this harness");
const selectionWrite = outcomeSource.expression.getText(screenFile);

/** A callback a screen declares with `useCallback`: the function itself, as it stands there. */
function screenCallback(file: ts.SourceFile, name: string): string {
  const declared = all(file, ts.isVariableDeclaration).find((d) => d.name.getText(file) === name)?.initializer;
  if (!declared || !ts.isCallExpression(declared) || declared.expression.getText(file) !== "useCallback" || !declared.arguments[0]) {
    throw new Error(`${file.fileName} declares no callback ${name} — re-point this harness`);
  }
  return declared.arguments[0].getText(file);
}
// What the database screen runs for one cell, and the task list for a tick.
const cellCode = `const writeCell = ${screenCallback(screenFile, "writeCell")};`;
const tasksFile = sourceOf("src/screens/TasksScreen.tsx");
const tickCode = `const mutateCheckbox = ${screenCallback(tasksFile, "mutateCheckbox")};\nconst toggle = ${screenCallback(tasksFile, "toggle")};`;

/** The expression a file of the phone hands to a shared writer as its vault: an argument by place, or a property of the first one. */
function handedTo(file: string, callee: string, where: number | string): string {
  const source = sourceOf(file);
  const calls = all(source, ts.isCallExpression).filter((c) => c.expression.getText(source) === callee);
  if (calls.length !== 1) throw new Error(`${file} calls ${callee} ${calls.length} times — re-point this harness`);
  const first = calls[0].arguments[0];
  const property = typeof where === "string" && first && ts.isObjectLiteralExpression(first)
    ? first.properties.find((p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && p.name.getText(source) === where)
    : undefined;
  const handed = typeof where === "number" ? calls[0].arguments[where] : property?.initializer;
  if (!handed) throw new Error(`${file} hands ${callee} no ${where} — re-point this harness`);
  return handed.getText(source);
}

interface PhoneServices {
  vaultOps: {
    read(v: MobileVault, path: string): Promise<string>;
    save(v: MobileVault, path: string, text: string): Promise<void>;
    update(v: MobileVault, path: string, change: TextChange): Promise<TextFileUpdate>;
  };
  noteSaver: SaveCoordinator<MobileVault>;
  rememberPersistedText(v: MobileVault, path: string, text: string): void;
}
interface PhoneWriters {
  commitCellValue(v: MobileVault, path: string, col: string, value: unknown): Promise<void>;
  queryView(v: MobileVault, config: unknown, viewIndex: number): Promise<Record<string, unknown>[]>;
  saveBaseConfig(v: MobileVault, path: string, config: unknown): Promise<void>;
  /** The phone's writer for a selection, where its service has one. */
  commitBulkValue: unknown;
}

const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const NAMES = ["Alpha", "Beta", "Gamma", "Delta", "Epsilon"];
const NOTES = NAMES.map((name) => `Projects/${name}.md`);
const note = (name: string, status = "open", owner = "Ada") => `---\nstatus: ${status}\nowner: ${owner}\n---\n# ${name}\n\nText of ${name}.\n`;
const nameOf = (path: string) => path.split("/").pop()!.replace(/\.md$/, "");
const DATABASE = { filters: { and: ['file.folder == "Projects"'] }, views: [{ type: "table", name: "Table" }] };

let root: string, raw: LocalVaultAdapter, db: IDatabaseAdapter, chain: ConflictAwareVaultAdapter, repo: SyncStateRepository;
let indexer: VaultIndexer, history: VersionHistoryService, vault: MobileVault, services: PhoneServices, writers: PhoneWriters;
/** The backup layer's clock: a version is taken at most once per interval, so an earlier edit lies ten minutes back. */
let clock: number;
/** Paths the chain merged for, paths an index run called changed from outside, and how often the sync was told. */
let merged: string[], foreign: string[], kicks: number;
let enqueued: Promise<void>, syncing: boolean;
/** What a screen told the user, in order: `error: …`, `info: …`. */
let shown: string[];

async function openPhone(database: IDatabaseAdapter): Promise<void> {
  root = await mkdtemp(join(tmpdir(), "plainva-phone-chain-"));
  raw = new LocalVaultAdapter(root);
  await raw.initialize();
  db = database;
  clock = Date.now();
  merged = []; foreign = []; kicks = 0; syncing = false; enqueued = Promise.resolve(); shown = [];
  // boot(): storage, above it versions, the sync queue and the conflict check — and the index over all of it.
  const backup = new BackupVaultAdapter(raw, { policy: DEFAULT_BACKUP_RETENTION, now: () => clock, snapshotRecursiveDeletes: true });
  const queue = new SyncQueue(db);
  repo = new SyncStateRepository(db, raw, "phone-a");
  chain = new ConflictAwareVaultAdapter(new QueueingVaultAdapter(backup, queue), repo, (path) => { merged.push(path); }, repo, "container");
  // What an index run finds is queued the way `enqueueLocal` does it once a sync runs — one after the other here.
  const enqueue = (path: string) => {
    if (syncing && !path.startsWith(".plainva") && !path.includes(".CONFLICT")) enqueued = enqueued.then(() => queue.queueWrite(path)).catch(() => {});
  };
  indexer = new VaultIndexer(chain, db, {
    isOwnWrite: (path, sha256) => chain.wasWrittenByUs(path, sha256),
    onExternalModification: (path) => { foreign.push(path); enqueue(path); },
    onNewLocalFile: enqueue,
  });
  history = new VersionHistoryService(raw);
  vault = {
    vaultId: "phone-vault", adapter: raw, files: chain, backup, syncQueue: queue, syncRepo: repo, db, indexer,
    queryService: new VaultQueryService(db),
    reindexPaths: async (paths: string[]) => { for (const path of paths) await indexer.indexPath(path).catch(() => {}); },
  } as unknown as MobileVault;
  const syncSoon = () => { kicks += 1; };
  services = run<PhoneServices>(serviceCode, "{ vaultOps, noteSaver, rememberPersistedText }", {
    createSaveCoordinator, ConflictError, mergeEditorText, containsTextChanges, applyTextShape, editorTextOf, DEFAULT_TEXT_SHAPE, updateVaultText,
    writeDraft: () => {}, clearDraft: () => {}, noteConflict: () => {}, conflictCopyPath: () => { throw new Error("actual conflict path required"); },
    syncSoon, toast: { warning: () => {}, error: () => {} }, i18n: { t: (key: string) => key }, window: new EventTarget(), CustomEvent,
    console: { error: () => {}, warn: () => {} },
    // A failed write goes past the keep for a file that is no text: with these
    // missing, it came out as a ReferenceError instead of its own error.
    isNotTextFileError, keepTextBeside,
  });
  writers = run<PhoneWriters>(
    baseOpsCode,
    "{ commitCellValue, queryView, saveBaseConfig, commitBulkValue: typeof commitBulkValue === 'function' ? commitBulkValue : undefined }",
    { ...services, writeNoteProperty, bulkSetProperty, combineFilters, syncSoon, serializeBaseConfig, assertFileStillThere },
  );
}

/** A vault as a sync left it: its notes on disk, each known to the index and to the chain, nothing waiting. */
async function syncedVault(texts: Record<string, string> = {}, paths: readonly string[] = NOTES): Promise<void> {
  for (const path of paths) await raw.writeTextFile(path, texts[path] ?? note(nameOf(path)));
  await indexer.indexVaultFull("open, empty index");
  syncing = true;
}

async function closePhone(): Promise<void> {
  await services.noteSaver.flushAll().catch(() => {});
  await enqueued;
  await db.close();
  await rm(root, { recursive: true, force: true });
}

beforeEach(async () => { await openPhone(await realSqlite()); });
afterEach(closePhone);

/** The statement of the database screen, run with what it names there. */
function setAcrossSelection(paths: string[], col: string, value: unknown): Promise<BulkSetResult> {
  return run<Promise<BulkSetResult>>(`const outcome = ${selectionWrite};`, "outcome", {
    vault, paths, col, value, setBulkBusy: () => {}, bulkCancelRef: { current: false },
    // Whichever of these two the statement names is the phone's own: its service, or the shared loop it once called itself.
    commitBulkValue: writers.commitBulkValue, bulkSetProperty,
  });
}
const queued = async () =>
  (await db.query<{ file_path: string; operation: string }>("SELECT file_path, operation FROM offline_queue ORDER BY id")).map((r) => `${r.operation} ${r.file_path}`).sort();
const versionsOf = async (path: string) => Promise.all((await history.listVersions(path)).map((v) => history.readVersionText(v.backupPath)));
const knownToChain = async (path: string) => (await repo.getSyncState(path))?.local_sha256 === sha(await raw.readTextFile(path));
const conflictCopies = async (folder: string) => (await readdir(join(root, folder))).filter((name) => name.includes(".CONFLICT"));

/** A screen's toasts, kept as what the user would read: the key and what was put into it. */
const surface = {
  toast: {
    error: (message: string) => { shown.push(`error: ${message}`); },
    info: (message: string) => { shown.push(`info: ${message}`); },
    warning: (message: string) => { shown.push(`warning: ${message}`); },
  },
  t: (key: string, values?: Record<string, unknown>) => (values ? `${key} ${JSON.stringify(values)}` : key),
};
/** One cell, the way the database screen writes it: its own callback, with what it names there. */
function writeCell(path: string, col: string, value: unknown): Promise<boolean> {
  return run<(path: string, col: string, value: unknown) => Promise<boolean>>(cellCode, "writeCell", {
    commitCellValue: writers.commitCellValue, vault, errorText, ...surface,
  })(path, col, value);
}
/** A tick in the task list: the screen's two callbacks, with what they name there. */
function tick(task: Pick<TaskRecord, "path" | "ordinal" | "text" | "state">): Promise<void> {
  return run<(task: unknown) => Promise<void>>(tickCode, "toggle", {
    gate: new TaskMutationGate(), vaultOps: services.vaultOps, vault, resolveTaskOrdinal, isOpenTaskState, toggleTaskAtIndex,
    setTick: () => {}, setTasks: () => {}, ...surface,
  })(task);
}
/** What another device or another program left reaches the disk below the chain — as a pull writes it, or a second app. */
const landedFromOutside = (path: string, text: string) => raw.writeTextFile(path, text);
/** Typing in the note's editor, saved the way the note screen saves it. `opened` is the text the editor was opened with. */
async function typed(path: string, text: string, opened?: string): Promise<void> {
  if (opened !== undefined) services.rememberPersistedText(vault, path, opened);
  services.noteSaver.schedule(vault, path, text);
  await services.noteSaver.flush(path, vault);
}

describe("a property set across the selection of a database, on the phone", () => {
  it("is written by the phone's own writer, not by the shared loop over the storage below the chain", () => {
    expect(selectionWrite).toMatch(/^commitBulkValue\(vault, paths, col, value, \{/);
    expect(selectionWrite).not.toContain("vault.adapter");
  });

  it("takes a version of every note as it was before it changes it", async () => {
    await syncedVault();
    const result = await setAcrossSelection(NOTES, "status", "done");
    expect([...result.written].sort()).toEqual([...NOTES].sort());
    expect(result.failed).toEqual([]);
    for (const path of NOTES) {
      expect(await raw.readTextFile(path), path).toBe(note(nameOf(path), "done"));
      // It used to be none: forty notes changed at once, and the version history of each still empty.
      expect(await versionsOf(path), path).toEqual([note(nameOf(path))]);
    }
  });

  it("queues every changed note for the sync, and tells the sync", async () => {
    await syncedVault();
    expect(await queued()).toEqual([]);
    await setAcrossSelection(NOTES, "status", "done");
    // It used to be nothing: the change went up once an index run came by and took it for someone else's.
    expect(await queued()).toEqual(NOTES.map((path) => `write ${path}`).sort());
    expect(kicks).toBeGreaterThan(0);
  });

  it("leaves no note in a state the chain does not know, and nothing for an index run to call a change from outside", async () => {
    await syncedVault();
    await setAcrossSelection(NOTES, "status", "done");
    for (const path of NOTES) expect(await knownToChain(path), path).toBe(true);
    await indexer.indexVaultFull("resume");
    await enqueued;
    expect(foreign).toEqual([]);
  });

  it("the rows the database queries next carry the new value", async () => {
    await syncedVault();
    await setAcrossSelection(NOTES, "status", "done");
    const rows = await writers.queryView(vault, DATABASE, 0);
    // It used to be "open" five times: the screen asks the index, and the index had not heard of the write.
    expect(rows.map((row) => [row["file.path"], row.status]).sort()).toEqual(NOTES.map((path) => [path, "done"]).sort());
  });

  it("the next change of such a note is an ordinary write: no merge, no conflict copy", async () => {
    await syncedVault();
    // Beta was edited on this phone ten minutes ago and has not been synced since.
    await writers.commitCellValue(vault, "Projects/Beta.md", "owner", "Hedy");
    clock += 10 * 60_000;
    await setAcrossSelection(NOTES, "status", "done");
    expect(await versionsOf("Projects/Beta.md")).toEqual([note("Beta", "open", "Hedy"), note("Beta")]);

    // One more cell of two of the rows, the way the table writes a cell.
    await writers.commitCellValue(vault, "Projects/Alpha.md", "owner", "Grace");
    await writers.commitCellValue(vault, "Projects/Beta.md", "owner", "Grace");
    expect(await raw.readTextFile("Projects/Alpha.md")).toBe(note("Alpha", "done", "Grace"));
    expect(await raw.readTextFile("Projects/Beta.md")).toBe(note("Beta", "done", "Grace"));
    // It used to be refused, both times, and the cell kept its old value: the chain met a file
    // it did not know. Alpha's it tried to merge and could not ("conflicting changes" — the
    // same line changed on both sides), for Beta there was no text left to merge against
    // ("base version not found"). Each got a conflict copy, of a note nobody else had touched.
    expect(merged).toEqual([]);
    expect(await chain.listConflictSessions()).toEqual([]);
    expect(await conflictCopies("Projects")).toEqual([]);
  });

  it("starts from what an editor holds: typing that has not been saved yet lands first", async () => {
    await syncedVault();
    const typed = `${note("Gamma")}\nA line typed a moment ago.\n`;
    services.rememberPersistedText(vault, "Projects/Gamma.md", note("Gamma"));
    services.noteSaver.schedule(vault, "Projects/Gamma.md", typed);
    await setAcrossSelection(NOTES, "status", "done");
    expect(await raw.readTextFile("Projects/Gamma.md")).toBe(typed.replace("status: open", "status: done"));
    expect(services.noteSaver.hasPending("Projects/Gamma.md", vault)).toBe(false);
  });

  it("goes on past a note it cannot write, and that note is left as it was: no version, no queue entry", async () => {
    // An empty `tags:` is a block the reader refuses (finding 2026-10-09): written anyway, every other property was lost.
    const refused = "---\ntags:\nstatus: open\n---\n# Delta\n";
    await syncedVault({ "Projects/Delta.md": refused });
    const result = await setAcrossSelection(NOTES, "status", "done");
    expect(result.failed.map((f) => f.path)).toEqual(["Projects/Delta.md"]);
    expect([...result.written].sort()).toEqual(NOTES.filter((path) => path !== "Projects/Delta.md").sort());
    expect(await raw.readTextFile("Projects/Delta.md")).toBe(refused);
    expect(await versionsOf("Projects/Delta.md")).toEqual([]);
    expect(await queued()).toEqual(NOTES.filter((path) => path !== "Projects/Delta.md").map((path) => `write ${path}`).sort());
  });
});

/**
 * A writer that reads a note, changes one place and writes it back has just
 * read the file: a cell, a value set across a selection, a tick in the task
 * list (finding 2026-10-12). The chain judged it like an editor that holds a
 * text from minutes ago — it was not told which text the writer started from.
 */
const ALPHA = "Projects/Alpha.md";
const withLine = (line: string) => `---\nstatus: open\nowner: Ada\n---\n# Alpha\n\n${line}\n\n- [ ] Call Ada\n`;
const SYNCED = withLine("Text of Alpha.");
const THEIRS = withLine("Text of Alpha, as another device left it.");
const MINE = withLine("Text of Alpha, as it was typed on this phone.");
const CALL_ADA = { path: ALPHA, ordinal: 0, text: "Call Ada", state: "open" as const };

/**
 * Alpha with an open conflict: the note was open in the editor when another
 * device's version arrived, and both had changed the same line. The note now
 * carries the other device's text, the working copy what was typed here.
 */
async function openConflict(): Promise<string> {
  await syncedVault({ [ALPHA]: SYNCED });
  await landedFromOutside(ALPHA, THEIRS);
  await typed(ALPHA, MINE, SYNCED);
  const session = await chain.getConflictSession(ALPHA);
  if (!session) throw new Error("the save did not open a conflict");
  expect(await raw.readTextFile(ALPHA)).toBe(THEIRS);
  expect(await raw.readTextFile(session.workingCopyPath)).toBe(MINE);
  return session.workingCopyPath;
}

/** What both versions of Alpha read after a change that was made to each of them (decision E1: into the note AND into the user's own version). */
const inBoth = async (copy: string, change: (text: string) => string) => {
  expect(await raw.readTextFile(ALPHA)).toBe(change(THEIRS));
  expect(await raw.readTextFile(copy)).toBe(change(MINE));
  // The conflict stays what it is — two versions of one line — until the user decides it.
  expect((await chain.getConflictSession(ALPHA))?.workingCopyPath).toBe(copy);
  expect(await conflictCopies("Projects")).toEqual([copy.split("/").pop()]);
};
const done = (text: string) => text.replace("status: open", "status: done");
const ticked = (text: string) => text.replace("- [ ] Call Ada", "- [x] Call Ada");

describe("a note with an open conflict: what was typed on this phone stays in its working copy, and a change lands in both versions", () => {
  it("through a cell written in the note's row", async () => {
    const copy = await openConflict();
    // It used to be refused, with the other device's text and `status: done` in place of the working
    // copy: the writer read the note, which carries their side, and the chain put what it wrote there.
    expect(await writeCell(ALPHA, "status", "done")).toBe(true);
    expect(shown).toEqual([]);
    await inBoth(copy, done);
    // The row the table shows next carries the value: it reads the note.
    const rows = await writers.queryView(vault, DATABASE, 0);
    expect(rows.find((row) => row["file.path"] === ALPHA)?.status).toBe("done");
  });

  it("through a value set across a selection the note is part of", async () => {
    const copy = await openConflict();
    const result = await setAcrossSelection([ALPHA, "Projects/Beta.md"], "status", "done");
    // It used to be one note counted as failed.
    expect(result.failed).toEqual([]);
    expect([...result.written].sort()).toEqual([ALPHA, "Projects/Beta.md"]);
    await inBoth(copy, done);
    expect(await raw.readTextFile("Projects/Beta.md")).toBe(note("Beta", "done"));
  });

  it("through a tick in the task list", async () => {
    const copy = await openConflict();
    await tick(CALL_ADA);
    expect(shown).toEqual([]);
    await inBoth(copy, ticked);
  });

  it("a task that reads differently in the working copy is ticked in the note alone", async () => {
    await syncedVault({ [ALPHA]: SYNCED });
    await landedFromOutside(ALPHA, THEIRS);
    // Typed here: the line above, and the task's wording.
    const reworded = MINE.replace("- [ ] Call Ada", "- [ ] Call Ada on Monday");
    await typed(ALPHA, reworded, SYNCED);
    const copy = (await chain.getConflictSession(ALPHA))!.workingCopyPath;
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
    await typed(ALPHA, MINE.replace("\n\n- [ ]", `\n\n${sentence}\n\n- [ ]`));
    expect(await raw.readTextFile(copy)).toContain(sentence);
    expect(await versionsOf(copy)).toEqual([MINE]);
    // Half a minute later, a cell: within the two minutes in which the versions layer takes no second version.
    clock += 30_000;
    await writeCell(ALPHA, "status", "done");
    expect(await raw.readTextFile(copy)).toContain(sentence);
    expect(await raw.readTextFile(copy)).toContain("as it was typed on this phone");
    expect(await raw.readTextFile(copy)).toContain("status: done");
    expect(await raw.readTextFile(ALPHA)).toBe(done(THEIRS));
  });

  it("the row of the working copy itself changes the working copy alone", async () => {
    const copy = await openConflict();
    expect(await writeCell(copy, "status", "done")).toBe(true);
    expect(shown).toEqual([]);
    expect(await raw.readTextFile(copy)).toBe(done(MINE));
    expect(await raw.readTextFile(ALPHA)).toBe(THEIRS);
    expect((await chain.getConflictSession(ALPHA))?.workingCopyPath).toBe(copy);
  });
});

/**
 * A database screen holds its configuration and saves it whole, without saying
 * which text it started from — a writer the chain cannot hand the file as it
 * lies there. At a database with an open conflict such a write used to go in
 * place of the user's own version of the configuration, like a cell's did. It
 * is refused now, unless the working copy is what such a write left there
 * itself (decision E2).
 */
const BASE = "Projects/Projects.base";
const database = (name: string) => ({ filters: { and: ['file.folder == "Projects"'] }, views: [{ type: "table", name }] });
const baseText = (name: string) => serializeBaseConfig(database(name));

describe("a database with an open conflict: its screen's save does not go in place of the user's own version", () => {
  it("the configuration as it was changed here stays in the working copy; the save is refused", async () => {
    await syncedVault({ [BASE]: baseText("Table") }, [BASE]);
    await landedFromOutside(BASE, baseText("Their table"));
    const saved = await chain.writeEditorText(BASE, baseText("My table"), baseText("Table"));
    const copy = saved.session!.workingCopyPath;
    // The screen shows the database as the file reads — the other side's — and saves a change of that.
    await expect(writers.saveBaseConfig(vault, BASE, database("Their table, sorted"))).rejects.toThrow("The file has an open conflict; nothing was written");
    // It used to be written in place of the working copy: "My table" was gone.
    expect(await raw.readTextFile(copy)).toBe(baseText("My table"));
    expect(await raw.readTextFile(BASE)).toBe(baseText("Their table"));
  });

  it("a working copy that such a save left there itself takes the next one", async () => {
    await syncedVault({ [BASE]: baseText("Table") }, [BASE]);
    // Changed below the chain, on the line the screen changes next: its save cannot be merged and is kept as a working copy.
    await landedFromOutside(BASE, baseText("Their table"));
    await expect(writers.saveBaseConfig(vault, BASE, database("My table"))).rejects.toThrow();
    const copy = (await chain.getConflictSession(BASE))!.workingCopyPath;
    expect(await raw.readTextFile(copy)).toBe(baseText("My table"));
    // The screen saves on: its newer configuration replaces its own older one, nobody else's.
    await expect(writers.saveBaseConfig(vault, BASE, database("My table, sorted"))).rejects.toThrow();
    expect(await raw.readTextFile(copy)).toBe(baseText("My table, sorted"));
    expect(await raw.readTextFile(BASE)).toBe(baseText("Their table"));
  });
});

/**
 * A note changed below the chain is one the chain no longer knows: by a build
 * of this app from before 2026-10-12 (a value set across a selection, the
 * anchor of an entry put in the calendar), or by another app in a folder the
 * user picked. An index run reports it as changed from outside and, on
 * purpose, does not put right what the chain knows — that would take the merge
 * base from the sync. So it stays unknown until it is opened in an editor or
 * pushed, and in a vault without a sync provider that is never by itself.
 */
const FOUR = NOTES.slice(0, 4);
const five = (name: string, set: Partial<Record<"status" | "owner" | "area", string>> = {}) =>
  `---\nstatus: ${set.status ?? "open"}\nowner: ${set.owner ?? "Ada"}\ndue: 2026-10-20\narea: ${set.area ?? "Lab"}\neffort: 3\n---\n# ${name}\n\nText of ${name}.\n`;

/** Four notes whose `status` was set below the chain, and the index run of the next start. */
async function changedBelowTheChain(): Promise<void> {
  await syncedVault(Object.fromEntries(FOUR.map((path) => [path, five(nameOf(path))])), FOUR);
  // What "Set value…" did on the phone before: the shared loop over the storage below the chain.
  const below = await bulkSetProperty(raw, FOUR, "status", "waiting");
  expect(below.failed).toEqual([]);
  for (const path of FOUR) expect(await raw.readTextFile(path), path).toBe(five(nameOf(path), { status: "waiting" }));
  await indexer.indexVaultFull("resume");
  await enqueued;
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
    // note nobody else had touched; the third was merged, the fourth written. In all four the writer
    // had read exactly the text that stood on disk.
    expect(shown).toEqual([]);
    expect(landed).toEqual([true, true, true, true]);
    expect(await raw.readTextFile("Projects/Alpha.md")).toBe(five("Alpha", { status: "done" }));
    expect(await raw.readTextFile("Projects/Beta.md")).toBe(five("Beta", { status: "waiting", owner: "Grace" }));
    expect(await raw.readTextFile("Projects/Gamma.md")).toBe(five("Gamma", { status: "waiting", area: "Office" }));
    expect(await raw.readTextFile("Projects/Delta.md")).toBe(five("Delta", { status: "waiting" }));
    expect(merged).toEqual([]);
    expect(await chain.listConflictSessions()).toEqual([]);
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

  it("a tick lands in a note that was saved here and then changed by another app", async () => {
    await syncedVault({ [ALPHA]: SYNCED });
    // Saved from the editor: the chain knows the new text, and no sync has taken it as the merge base.
    const edited = withLine("Text of Alpha, edited on this phone.");
    await typed(ALPHA, edited, SYNCED);
    await landedFromOutside(ALPHA, `${edited}\nA line another app added.\n`);
    await tick(CALL_ADA);
    // It used to be "base version not found" and a conflict copy, although the other app's line stands
    // at the far end of the note: for the text the chain knew, no copy was kept to merge against.
    expect(shown).toEqual([]);
    expect(await raw.readTextFile(ALPHA)).toBe(`${edited.replace("- [ ] Call Ada", "- [x] Call Ada")}\nA line another app added.\n`);
    expect(await chain.listConflictSessions()).toEqual([]);
    expect(await conflictCopies("Projects")).toEqual([]);
  });
});

/**
 * The phone's database is ONE connection, and its plugin refuses a second
 * transaction while one is open — Android with "Already in transaction"
 * (`Database.beginTransaction`), iOS with SQLite's own refusal. Every write
 * through the chain opens one for the sync queue and one for the index, and
 * the sync, the index and the calendar open theirs: whichever came second was
 * refused (finding 2026-10-12). A write that met one had its file changed on
 * disk and counted as failed — no entry in the queue, a hash the chain did not
 * know, and in the editor a conflict copy as soon as the person typed on.
 *
 * Here the phone's own database adapter (`CapacitorSqliteAdapter`) runs over a
 * stand-in for the plugin (`phoneSqlitePlugin.ts`): one connection over a real
 * SQLite, served call by call the way the bridge serves the native side, and
 * answering as the plugin's sources say Android and iOS do. The flows are the
 * phone's own: its note saver, its cell writer, its chain.
 */
vi.mock("@capacitor-community/sqlite", async () => (await import("../../../../packages/core/test/helpers/phoneSqlitePlugin")).phoneSqlite.module);

/** Notes in four folders: the chain's own gate holds apart writes below a common folder only. */
const APART = ["Alpha.md", "Inbox/Beta.md", "Projects/Gamma.md", "Archive/Delta.md"];

/** How many transactions the app asked for — the adapter keeps one that has to wait to itself. */
let asked = 0;
let onAsk: (() => void) | null = null;

/** The phone's database as `boot` opens it: its own adapter over the plugin's stand-in, with the schema. */
async function phoneDatabase(platform: PhonePlatform): Promise<IDatabaseAdapter> {
  phoneSqlite.reset(platform);
  const inner = new CapacitorSqliteAdapter("plainva-index");
  await inner.initialize();
  await initializeSchema(inner);
  asked = 0;
  return {
    initialize: () => inner.initialize(),
    close: () => inner.close(),
    execute: (sql, params) => inner.execute(sql, params),
    query: (sql, params) => inner.query(sql, params),
    queryOne: (sql, params) => inner.queryOne(sql, params),
    transaction(fn) {
      asked += 1;
      onAsk?.();
      return inner.transaction(fn);
    },
    runBatch: (statements, options) => inner.runBatch(statements, options),
  };
}

const hops = async (n: number) => {
  for (let i = 0; i < n; i++) await new Promise<void>((resolve) => setImmediate(resolve));
};

/**
 * `holder` opens a transaction, and it stays open while `flow` comes along —
 * as a sync cycle's or an index pass's does while it reads a file between two
 * of its statements. It goes on once `flow` has asked for a transaction of its
 * own (and a refusal, if there were one, has come back), or is through. A
 * holder that is through without opening one fails the test at once.
 */
async function whileOneIsOpen<T>(holder: () => Promise<unknown>, flow: () => Promise<T>): Promise<{ holding: Promise<unknown>; flowing: Promise<T> }> {
  const held = phoneSqlite.holdNextTransaction();
  const holding = holder();
  let open = false;
  await Promise.race([held.opened.then(() => { open = true; }), holding.then(() => {}, () => {})]);
  if (!open) {
    held.release();
    throw new Error("the holder was through without opening a transaction to hold");
  }
  const before = asked;
  const askedOne = new Promise<void>((resolve) => {
    onAsk = () => { if (asked > before) resolve(); };
  });
  const flowing = flow();
  await Promise.race([askedOne, flowing.then(() => {}, () => {})]);
  await hops(8);
  onAsk = null;
  held.release();
  return { holding, flowing };
}

describe.each(["android", "ios"] as const)("one connection, two flows (%s)", (platform) => {
  beforeEach(async () => {
    await closePhone();
    await openPhone(await phoneDatabase(platform));
    await syncedVault();
  });

  it("an editor's save that meets the sync marking an upload done ends with its entry and a state the chain knows — and typing on is an ordinary save", async () => {
    // The worker uploaded Beta and marks it done.
    await vault.syncQueue!.queueWrite("Projects/Beta.md");
    const [upload] = await db.query<{ id: number }>("SELECT id FROM offline_queue");
    const typedText = `${note("Alpha")}\nA line typed a moment ago.\n`;
    services.rememberPersistedText(vault, "Projects/Alpha.md", note("Alpha"));
    const { holding, flowing } = await whileOneIsOpen(
      () => vault.syncQueue!.markSynced(upload.id, "Projects/Beta.md"),
      () => {
        services.noteSaver.schedule(vault, "Projects/Alpha.md", typedText);
        return services.noteSaver.flush("Projects/Alpha.md", vault);
      },
    );
    // It used to be refused here, with the typed text already on disk.
    await flowing;
    await holding;
    expect(phoneSqlite.counts.refused).toBe(0);
    expect(await raw.readTextFile("Projects/Alpha.md")).toBe(typedText);
    expect(await queued()).toEqual(["write Projects/Alpha.md"]);
    expect(await knownToChain("Projects/Alpha.md")).toBe(true);

    // Typing on. The next save used to meet a disk the chain did not know,
    // try to merge two versions of the same line, and leave a conflict copy
    // of a note nobody else had touched.
    const more = typedText.replace("typed a moment ago.", "typed a moment ago, and a few more words.");
    services.noteSaver.schedule(vault, "Projects/Alpha.md", more);
    await services.noteSaver.flush("Projects/Alpha.md", vault);
    expect(await raw.readTextFile("Projects/Alpha.md")).toBe(more);
    expect(merged).toEqual([]);
    expect(await chain.listConflictSessions()).toEqual([]);
    expect(await conflictCopies("Projects")).toEqual([]);
  });

  it("a cell written while the index follows a file a pull brought: written, queued, known, and in the rows the table asks for next", async () => {
    await raw.writeTextFile("Projects/Gamma.md", note("Gamma", "open", "Grace"));
    const { holding, flowing } = await whileOneIsOpen(
      () => indexer.indexPath("Projects/Gamma.md"),
      () => writers.commitCellValue(vault, "Projects/Alpha.md", "status", "done"),
    );
    // It used to be refused, the value on disk, and the table showing the old one.
    await flowing;
    await holding;
    expect(phoneSqlite.counts.refused).toBe(0);
    expect(await raw.readTextFile("Projects/Alpha.md")).toBe(note("Alpha", "done"));
    expect(await queued()).toContain("write Projects/Alpha.md");
    expect(await knownToChain("Projects/Alpha.md")).toBe(true);
    expect(await versionsOf("Projects/Alpha.md")).toEqual([note("Alpha")]);
    const rows = await writers.queryView(vault, DATABASE, 0);
    expect(rows.find((row) => row["file.path"] === "Projects/Alpha.md")?.status).toBe("done");
  });

  it("a new note, a rename, a confirmed deletion, a new folder and an attachment that meet an index pass each get their entry", async () => {
    let pulled = 0;
    // The index follows a file a pull just wrote — a new one each time.
    const indexPass = async () => {
      await raw.writeTextFile("Projects/Gamma.md", note("Gamma", "open", `Grace ${++pulled}`));
      return indexer.indexPath("Projects/Gamma.md");
    };
    const meet = async (flow: () => Promise<unknown>) => {
      const { holding, flowing } = await whileOneIsOpen(indexPass, flow);
      await flowing;
      await holding;
    };
    // Each of these used to be refused after its change was on disk.
    await meet(() => services.vaultOps.save(vault, "Projects/New.md", note("New")));
    await meet(() => chain.renameItem("Projects/Beta.md", "Projects/Bet.md"));
    await meet(() => chain.deleteItem("Projects/Delta.md", false, { confirmed: true }));
    await meet(() => chain.createDir("Inbox"));
    await meet(() => chain.writeBinaryFile("Projects/photo.jpg", new Uint8Array([1, 2, 3])));
    expect(phoneSqlite.counts.refused).toBe(0);
    const entries = await queued();
    for (const entry of ["write Projects/New.md", "rename Projects/Beta.md", "delete Projects/Delta.md", "mkdir Inbox", "write Projects/photo.jpg"]) {
      expect(entries, entry).toContain(entry);
    }
    // The person's confirmation is in the queue, and the rename took the sync row along: a moved note is no new file.
    const deletion = await db.queryOne<{ delete_confirmed_at: number | null }>("SELECT delete_confirmed_at FROM offline_queue WHERE operation = 'delete'");
    expect(deletion?.delete_confirmed_at).not.toBeNull();
    expect(await repo.getSyncState("Projects/Beta.md")).toBeNull();
    expect(await repo.getSyncState("Projects/Bet.md")).not.toBeNull();
  });

  it("the sync marks an upload done while a save's entry is open: it is marked, not left in the queue to go up again", async () => {
    await vault.syncQueue!.queueWrite("Projects/Beta.md");
    const [upload] = await db.query<{ id: number }>("SELECT id FROM offline_queue");
    const { holding, flowing } = await whileOneIsOpen(
      () => vault.syncQueue!.queueWrite("Projects/Alpha.md"),
      () => vault.syncQueue!.markSynced(upload.id, "Projects/Beta.md"),
    );
    await flowing;
    await holding;
    expect(phoneSqlite.counts.refused).toBe(0);
    expect(await queued()).toEqual(["write Projects/Alpha.md"]);
  });

  it("a selection of notes is written several at a time, as on the desktop, and none is refused", async () => {
    // Across folders, so that nothing but the database holds the notes apart.
    for (const path of APART) await raw.writeTextFile(path, note(nameOf(path)));
    await indexer.indexVaultFull("the notes of the selection");
    // A note is under way from its first read to its write: how many were at once.
    const read = raw.readTextFile.bind(raw), write = raw.writeTextFile.bind(raw);
    const begun = new Set<string>(), finished = new Set<string>();
    let mostAtOnce = 0;
    raw.readTextFile = async (path) => {
      if (APART.includes(path) && !begun.has(path)) {
        begun.add(path);
        mostAtOnce = Math.max(mostAtOnce, begun.size - finished.size);
      }
      return read(path);
    };
    raw.writeTextFile = async (path, text) => {
      await write(path, text);
      if (begun.has(path)) finished.add(path);
    };
    const result = await setAcrossSelection(APART, "status", "done");
    // One at a time — the gate the phone had for a while — would be 1 here.
    expect(mostAtOnce).toBeGreaterThan(1);
    await enqueued;
    expect(phoneSqlite.counts.refused).toBe(0);
    expect(result.failed).toEqual([]);
    for (const path of APART) {
      expect(await raw.readTextFile(path), path).toBe(note(nameOf(path), "done"));
      expect(await knownToChain(path), path).toBe(true);
    }
    expect(await queued()).toEqual(APART.map((path) => `write ${path}`).sort());
  });
});

it("boot hands its chain the reporter, as the desktop's vault context does: an entry made up for or given up is a line in the diagnostics", () => {
  const built = all(serviceFile, ts.isNewExpression)
    .filter((node) => node.expression.getText(serviceFile) === "QueueingVaultAdapter")
    .map((node) => node.getText(serviceFile));
  expect(built).toHaveLength(1);
  expect(built[0]).toMatch(/onEntry: \(report\) => logDiagnostic\("sync", formatQueueEntryReport\(report\)\)/);
});

/**
 * The other writers of the phone that hand a vault to a shared function. What
 * is run is the expression the screen hands over — `vault.files`, or what was
 * there before — with the shared function behind it, as the screen calls it.
 */
describe("every writer of the phone hands a shared function the vault's chain", () => {
  const handedVault = <T>(file: string, callee: string, where: number | string) => run<T>(`const handed = ${handedTo(file, callee, where)};`, "handed", { vault });

  it("the anchor of an entry put in the calendar: a version of the note, queued, known", async () => {
    await syncedVault();
    const adapter = handedVault<Parameters<typeof createEntryEvent>[0]["adapter"]>("src/screens/base/BaseScreen.tsx", "createEntryEvent", "adapter");
    const made = await createEntryEvent({
      adapter, createEvent: async () => ({ uid: "evt-1" }), calendarKey: "acc-1 primary",
      notePath: "Projects/Alpha.md", title: "Alpha", day: "2026-10-20", dateField: "due", allPaths: NOTES,
    });
    expect(made.anchored).toBe(true);
    expect(await raw.readTextFile("Projects/Alpha.md")).toContain("uid: evt-1");
    expect(await versionsOf("Projects/Alpha.md")).toEqual([note("Alpha")]);
    expect(await queued()).toEqual(["write Projects/Alpha.md"]);
    expect(await knownToChain("Projects/Alpha.md")).toBe(true);
  });

  it("a database created from the editor is queued by the write that made it", async () => {
    await syncedVault();
    const adapter = handedVault<Parameters<typeof createInlineBase>[0]>("src/EditorHost.tsx", "createInlineBase", 0);
    expect(await createInlineBase(adapter, "Projects", "Database", "Table")).toBe("Projects/Database.base");
    expect(await queued()).toEqual(["write Projects/Database.base"]);
  });

  it("a note saved as a template, and its folder", async () => {
    await syncedVault();
    const adapter = handedVault<Parameters<typeof saveNoteAsTemplateIn>[0]>("src/screens/NoteScreen.tsx", "saveNoteAsTemplateIn", 0);
    expect(await saveNoteAsTemplateIn(adapter, "Templates", "Projects/Alpha.md")).toBe("Templates/Alpha.md");
    expect(await queued()).toEqual(["mkdir Templates", "write Templates/Alpha.md"]);
  });

  it("a new template, and its folder", async () => {
    await syncedVault();
    const adapter = handedVault<Parameters<typeof createTemplateIn>[0]>("src/services/templatePrompt.ts", "createTemplateIn", 0);
    expect(await createTemplateIn(adapter, { folder: "Templates", noteType: "Note" }, "Meeting")).toBe("Templates/Meeting.md");
    expect(await queued()).toEqual(["mkdir Templates", "write Templates/Meeting.md"]);
  });

  it("the task database, and the folder its tasks go to — an empty folder reaches no other device by itself", async () => {
    await syncedVault();
    const adapter = handedVault<Parameters<typeof createTaskDatabase>[0]>("src/screens/SettingsAreaScreens.tsx", "createTaskDatabase", 0);
    const labels: Parameters<typeof createTaskDatabase>[2] = {
      viewTable: "Table", viewBoard: "Board", viewTimeline: "Timeline", doneKey: "done", dueKey: "due", statusOptions: ["open", "doing", "done"],
    };
    expect(await createTaskDatabase(adapter, "Tasks", labels)).toBe("Tasks.base");
    expect(await queued()).toEqual(["mkdir Tasks", "write Tasks.base"]);
  });

  it("a voice memo recorded for the journal, and the attachment folder", async () => {
    await syncedVault();
    const io = handedVault<Parameters<typeof importAttachment>[2]>("src/components/JournalCaptureSheet.tsx", "importAttachment", 2);
    const memo = { name: "Memo.m4a", mime: "audio/mp4", bytes: new Uint8Array([1, 2, 3, 4]) };
    const { path } = await importAttachment(memo, { configuredFolder: "Attachments", noteFolder: "Daily" }, io);
    expect(path).toBe("Attachments/Memo.m4a");
    // It used to be neither: the journal line went up with the next sync, the sound it plays did not.
    expect(await queued()).toEqual(["mkdir Attachments", `write ${path}`]);
  });
});
