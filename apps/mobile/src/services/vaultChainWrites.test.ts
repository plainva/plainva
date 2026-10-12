// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import ts from "typescript";
import {
  BackupVaultAdapter, ConflictAwareVaultAdapter, ConflictError, DEFAULT_BACKUP_RETENTION, DEFAULT_TEXT_SHAPE, QueueingVaultAdapter,
  SyncQueue, SyncStateRepository, VaultIndexer, VaultQueryService, VersionHistoryService, applyTextShape, containsTextChanges,
  editorTextOf, mergeEditorText, type IDatabaseAdapter,
} from "@plainva/core";
import {
  bulkSetProperty, combineFilters, createEntryEvent, createInlineBase, createTaskDatabase, createTemplateIn, importAttachment,
  saveNoteAsTemplateIn, writeNoteProperty, type BulkSetResult,
} from "@plainva/ui";
import { LocalVaultAdapter } from "../../../../packages/core/src/vault/LocalVaultAdapter";
import { realSqlite } from "../../../../packages/core/test/helpers/realSqlite";
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

// The phone's read and save of a file, its note saver and what remembers an editor's text.
const serviceFile = sourceOf("src/services/vaultService.ts");
const fileMethods = all(serviceFile, ts.isMethodDeclaration).filter((m) => ["read", "save"].includes(m.name.getText(serviceFile)));
const saverSource = all(serviceFile, ts.isVariableDeclaration).find((d) => d.name.getText(serviceFile) === "noteSaver")?.initializer;
const rememberSource = all(serviceFile, ts.isFunctionDeclaration).find((f) => f.name?.text === "rememberPersistedText");
if (fileMethods.length !== 2 || !saverSource || !rememberSource) throw new Error("the phone's read, save and note saver moved — re-point this harness");
const serviceCode =
  "const lastPersistedText = new Map(); const editorBaseText = new Map(); const editorTextShape = new Map();\n" +
  `${rememberSource.getText(serviceFile).replace(/^export /, "")}\n` +
  `const vaultOps = {${fileMethods.map((m) => m.getText(serviceFile)).join(",\n")}}; const noteSaver = ${saverSource.getText(serviceFile)};`;

// The phone's property writers and the query a database screen runs.
const baseOpsFile = sourceOf("src/services/baseOps.ts");
const baseOpsCode = all(baseOpsFile, ts.isFunctionDeclaration)
  .filter((f) => ["noteFiles", "commitCellValue", "commitBulkValue", "queryView"].includes(f.name?.text ?? ""))
  .map((f) => f.getText(baseOpsFile).replace(/^export /, ""))
  .join("\n");

// What the database screen runs to set one property across its selection: the statement itself.
const screenFile = sourceOf("src/screens/base/BaseScreen.tsx");
const flowSource = all(screenFile, ts.isVariableDeclaration).find((d) => d.name.getText(screenFile) === "bulkSetFlow");
const outcomeSource = flowSource && all(flowSource, ts.isVariableDeclaration).find((d) => d.name.getText(screenFile) === "result")?.initializer;
if (!outcomeSource || !ts.isAwaitExpression(outcomeSource)) throw new Error("the database screen's write for a selection moved — re-point this harness");
const selectionWrite = outcomeSource.expression.getText(screenFile);

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
  vaultOps: { read(v: MobileVault, path: string): Promise<string>; save(v: MobileVault, path: string, text: string): Promise<void> };
  noteSaver: SaveCoordinator<MobileVault>;
  rememberPersistedText(v: MobileVault, path: string, text: string): void;
}
interface PhoneWriters {
  commitCellValue(v: MobileVault, path: string, col: string, value: unknown): Promise<void>;
  queryView(v: MobileVault, config: unknown, viewIndex: number): Promise<Record<string, unknown>[]>;
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

async function openPhone(database: IDatabaseAdapter): Promise<void> {
  root = await mkdtemp(join(tmpdir(), "plainva-phone-chain-"));
  raw = new LocalVaultAdapter(root);
  await raw.initialize();
  db = database;
  clock = Date.now();
  merged = []; foreign = []; kicks = 0; syncing = false; enqueued = Promise.resolve();
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
    createSaveCoordinator, ConflictError, mergeEditorText, containsTextChanges, applyTextShape, editorTextOf, DEFAULT_TEXT_SHAPE,
    writeDraft: () => {}, clearDraft: () => {}, noteConflict: () => {}, conflictCopyPath: () => { throw new Error("actual conflict path required"); },
    syncSoon, toast: { warning: () => {}, error: () => {} }, i18n: { t: (key: string) => key }, window: new EventTarget(), CustomEvent,
    console: { error: () => {}, warn: () => {} },
  });
  writers = run<PhoneWriters>(
    baseOpsCode,
    "{ commitCellValue, queryView, commitBulkValue: typeof commitBulkValue === 'function' ? commitBulkValue : undefined }",
    { ...services, writeNoteProperty, bulkSetProperty, combineFilters, syncSoon },
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
 * The phone's database is ONE connection, and its plugin refuses a second
 * transaction while one is open (`Database.beginTransaction`: "Already in
 * transaction"); the desktop's adapter queues them. Every write through the
 * chain opens one for the sync queue and one for the index — so on the phone
 * the notes of a selection are written one after the other, where the desktop
 * writes six at a time.
 *
 * The chain has a gate of its own, but it only holds apart writes below a
 * common folder (`withPathMutation` locks a path and its ancestors) — and the
 * index is written outside it. A selection reaches across folders as soon as
 * its database is built on a tag, so the notes here share none.
 *
 */
const APART = ["Alpha.md", "Inbox/Beta.md", "Projects/Gamma.md", "Archive/Delta.md"];

/**
 * `node:sqlite` refuses a second BEGIN the way the plugin does, but answers
 * within one turn of the event loop, so two transactions never meet. Here the
 * first one after `arm()` is held open until a second one knocks, or until the
 * wait is over: the bridge to the native side, in the one place where it matters.
 */
function heldOpen(inner: IDatabaseAdapter, waitMs: number) {
  let open = false, armed = false, knock: (() => void) | null = null;
  const counts = { refused: 0 };
  const database: IDatabaseAdapter = {
    initialize: () => inner.initialize(),
    close: () => inner.close(),
    execute: (sql, params) => inner.execute(sql, params),
    query: (sql, params) => inner.query(sql, params),
    queryOne: (sql, params) => inner.queryOne(sql, params),
    async transaction(fn) {
      if (open) {
        counts.refused += 1;
        knock?.();
        throw new Error("Already in transaction");
      }
      open = true;
      try {
        if (armed) {
          armed = false;
          await new Promise<void>((done) => {
            const timer = setTimeout(done, waitMs);
            knock = () => { clearTimeout(timer); done(); };
          });
          knock = null;
        }
        return await inner.transaction(fn);
      } finally {
        open = false;
      }
    },
  };
  return { database, counts, arm: () => { armed = true; } };
}

describe("one connection, one transaction", () => {
  it("the phone writes the notes of a selection one after the other, so none is refused", async () => {
    await closePhone();
    const held = heldOpen(await realSqlite(), 40);
    await openPhone(held.database);
    await syncedVault({}, APART);
    held.arm();
    const result = await setAcrossSelection(APART, "status", "done");
    expect(held.counts.refused).toBe(0);
    expect(result.failed).toEqual([]);
    expect(await queued()).toEqual(APART.map((path) => `write ${path}`).sort());
  });

  it("three at a time is what such a connection refuses — the file changes, and the queue never hears of it", async () => {
    await closePhone();
    const held = heldOpen(await realSqlite(), 5_000);
    await openPhone(held.database);
    await syncedVault({}, APART);
    held.arm();
    // The shared loop with the gate the phone used to give it, over the chain it now gets.
    const result = await bulkSetProperty(
      { readTextFile: (path) => services.vaultOps.read(vault, path), writeTextFile: (path, text) => services.vaultOps.save(vault, path, text) },
      APART.slice(0, 3), "status", "done", { concurrency: 3 },
    );
    expect(held.counts.refused).toBeGreaterThan(0);
    expect(result.failed.map((f) => f.message)).toContain("Already in transaction");
    for (const { path } of result.failed) {
      expect(await raw.readTextFile(path), path).toBe(note(nameOf(path), "done"));
      expect(await queued(), path).not.toContain(`write ${path}`);
    }
  });
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
