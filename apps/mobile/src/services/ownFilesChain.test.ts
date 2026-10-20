// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import ts from "typescript";
import {
  BackupVaultAdapter, ConflictAwareVaultAdapter, ConflictSessions, DEFAULT_BACKUP_RETENTION, QueueingVaultAdapter, SyncQueue, SyncStateRepository,
  type IDatabaseAdapter, type IVaultAdapter,
} from "@plainva/core";
import {
  getGraphState, importObsidianBookmarks, moveBookmarkOnDisk, parseBookmarksFile, removeBookmarksOnDisk, renameBookmarksOnDisk, setPlatformServices,
  toggleBookmarkOnDisk, type BookmarkEntry, type BookmarksIO, type ISettingsStore,
} from "@plainva/ui";
import { LocalVaultAdapter } from "../../../../packages/core/src/vault/LocalVaultAdapter";
import { realSqlite } from "../../../../packages/core/test/helpers/realSqlite";
import { CountingSyncTarget, MemoryProfileVault, runProfileCycle, type ProfileHarnessDevice } from "../../../../packages/core/test/support/settingsSyncHarness";

/**
 * The app's own files under `.plainva` and the vault's chain — the phone's
 * side (finding 2026-10-12; the desktop's is `ownFilesChain.test.tsx` there).
 *
 * On the desktop a bookmark could no longer be set once a settings profile
 * had brought one from another device: the sidebar wrote the list through the
 * chain's top, the profile below it, and the chain refused the next star as a
 * conflict. The phone writes the list on one level in both places — the first
 * half of this file runs the same course with the phone's own statements and
 * finds it sound, as it was before.
 *
 * The second half is the same finding where the phone did have it. The pins of
 * the map and the suggestions a person turned down are kept in
 * `.plainva/graph.json`, written through `vault.files`. In a vault folder that
 * a second device writes to as well — a folder the person picked, carried by a
 * file service — the chain met a file it had not written, and from then on no
 * pin was saved, with an open conflict in the list of the vault's conflicts.
 * A vault that still carries such a conflict comes out of it as well.
 *
 * The statements are the phone's: the bookmark methods of `vaultOps`, the
 * profile port in a real cycle of the settings sync, the store each graph
 * surface asks for — over real files, a real SQLite and the chain as `boot`
 * puts it together. Only the native edge is replaced.
 */

vi.mock("./pim/pimService", () => ({
  isPimRuntimeReady: () => true,
  listPimAccounts: async () => [],
}));
const journalFiles = new Map<string, string>();
vi.mock("@capacitor/filesystem", () => ({
  Directory: { Data: "DATA" },
  Encoding: { UTF8: "utf8" },
  Filesystem: {
    writeFile: vi.fn(async ({ path, data }: { path: string; data: string }) => { journalFiles.set(path, data); }),
    readFile: vi.fn(async ({ path }: { path: string }) => {
      if (!journalFiles.has(path)) throw new Error("not found");
      return { data: journalFiles.get(path)! };
    }),
    deleteFile: vi.fn(async ({ path }: { path: string }) => { journalFiles.delete(path); }),
    readdir: vi.fn(async () => ({ files: [] })),
  },
}));
vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => false },
  registerPlugin: () => ({}),
}));
vi.mock("./pim/pimCredentials", () => ({
  getPimCredentials: async () => null,
  pimSecretKey: (vaultId: string, accountId: string) => `pim_${vaultId}_${accountId}`,
}));

import { createMobileProfilePort } from "./mobileSettingsSync";
import type { MobileVault } from "./vaultService";

// ── What the phone's sources run and hand over ───────────────────────────────

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
/** The first argument of every call of a function in a file of the phone. */
function firstArguments(file: string, callee: string): string[] {
  const source = sourceOf(file);
  const calls = all(source, ts.isCallExpression).filter((call) => call.expression.getText(source) === callee);
  if (calls.length === 0) throw new Error(`${file} no longer calls ${callee} — re-point this harness`);
  return calls.map((call) => call.arguments[0].getText(source));
}
/** What a screen of the phone hands a component under a name, at every place it draws it. */
function attributeValues(file: string, component: string, name: string): string[] {
  const source = sourceOf(file);
  const elements = [...all(source, ts.isJsxSelfClosingElement), ...all(source, ts.isJsxOpeningElement)].filter((element) => element.tagName.getText(source) === component);
  const values = elements.flatMap((element) => element.attributes.properties.filter(ts.isJsxAttribute).filter((attribute) => attribute.name.getText(source) === name)
    .map((attribute) => (attribute.initializer && ts.isJsxExpression(attribute.initializer) && attribute.initializer.expression ? attribute.initializer.expression.getText(source) : "")));
  if (values.length === 0) throw new Error(`${file} no longer hands ${component} its ${name} — re-point this harness`);
  return values;
}

// The phone's bookmark methods, as its service has them.
const serviceFile = sourceOf("src/services/vaultService.ts");
const BOOKMARK_METHODS = ["getBookmarks", "toggleBookmark", "moveBookmark", "removeBookmark"];
const bookmarkMethods = all(serviceFile, ts.isMethodDeclaration).filter((m) => BOOKMARK_METHODS.includes(m.name.getText(serviceFile)));
if (bookmarkMethods.length !== BOOKMARK_METHODS.length) throw new Error("the phone's bookmark methods moved — re-point this harness");
const bookmarkCode = `const vaultOps = {${bookmarkMethods.map((m) => m.getText(serviceFile)).join(",\n")}};`;

const RENAME_HANDS = firstArguments("src/services/vaultService.ts", "renameBookmarksOnDisk");
const SIDEBAND_HANDS = all(sourceOf("src/services/syncService.ts"), ts.isCallExpression)
  .filter((call) => call.expression.getText() === "settingsSync.run")
  .map((call) => call.arguments[1].getText());
const GRAPH_HANDS = [
  ...firstArguments("src/screens/GraphScreen.tsx", "getGraphState"),
  ...firstArguments("src/components/ContextGraph.tsx", "getGraphState"),
  ...firstArguments("src/screens/CleanupScreen.tsx", "getGraphState"),
];
// A database's map asks for the store with the adapter the database screen hands it.
const BASE_GRAPH_ASKS = firstArguments("src/screens/base/MobileBaseGraph.tsx", "getGraphState");
const BASE_GRAPH_HANDS = attributeValues("src/screens/base/BaseScreen.tsx", "MobileBaseGraph", "adapter");

interface PhoneBookmarks {
  getBookmarks(v: MobileVault): Promise<BookmarkEntry[]>;
  toggleBookmark(v: MobileVault, path: string, type?: BookmarkEntry["type"]): Promise<boolean>;
  moveBookmark(v: MobileVault, key: string, beforeKey: string | null): Promise<BookmarkEntry[]>;
  removeBookmark(v: MobileVault, path: string): Promise<void>;
}

// ── The vault ────────────────────────────────────────────────────────────────

const BOOKMARKS = ".plainva/bookmarks.json";
const GRAPH = ".plainva/graph.json";

function memoryStore(): ISettingsStore {
  const map = new Map<string, unknown>();
  return {
    async get<T>(key: string) { return map.get(key) as T | undefined; },
    async set(key: string, value: unknown) { map.set(key, structuredClone(value)); },
    async delete(key: string) { return map.delete(key); },
    async keys() { return [...map.keys()]; },
    async save() {},
  };
}

let root: string, raw: LocalVaultAdapter, db: IDatabaseAdapter, backup: BackupVaultAdapter, repo: SyncStateRepository, chain: ConflictAwareVaultAdapter, vault: MobileVault, vaultOps: PhoneBookmarks;

/** `boot()`: storage, above it versions, the sync queue and the conflict check — again for "the app starts again", over the same files and database. */
function openChain(): void {
  backup = new BackupVaultAdapter(raw, { policy: DEFAULT_BACKUP_RETENTION, snapshotRecursiveDeletes: true });
  repo = new SyncStateRepository(db, raw, "phone-a");
  chain = new ConflictAwareVaultAdapter(new QueueingVaultAdapter(backup, new SyncQueue(db)), repo, () => {}, repo, "external-folder");
  // `db` stays out of the stand-in: the profile port would start the calendar cache on it.
  vault = { vaultId: "phone-vault", adapter: raw, files: chain, backup, syncRepo: repo, db: null } as unknown as MobileVault;
}
const named = <T>(expression: string) => run<T>(`const handed = ${expression};`, "handed", { vault, v: vault });

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "plainva-phone-own-files-"));
  raw = new LocalVaultAdapter(root);
  await raw.initialize();
  db = await realSqlite();
  openChain();
  journalFiles.clear();
  const store = memoryStore();
  setPlatformServices({
    loadSettings: async () => store,
    credentials: { readSecret: async () => null, writeSecret: async () => {}, removeSecret: async () => {} },
    openExternal: async () => {},
  });
  vaultOps = run<PhoneBookmarks>(bookmarkCode, "vaultOps", {
    importObsidianBookmarks, toggleBookmarkOnDisk, moveBookmarkOnDisk, removeBookmarksOnDisk, window, CustomEvent,
  });
});
afterEach(async () => {
  // What a write started in the background is through before the database and the folder go.
  await chain.endOwnFileConflicts();
  vi.restoreAllMocks();
  await db.close();
  await rm(root, { recursive: true, force: true });
});

const bookmarksOnDisk = async () => parseBookmarksFile(await readFile(join(root, BOOKMARKS), "utf8")).entries.map((entry) => entry.path);
const conflictCopies = async () => (await readdir(join(root, ".plainva"))).filter((name) => name.includes(".CONFLICT"));
const pinsOnDisk = async () => Object.keys((JSON.parse(await readFile(join(root, GRAPH), "utf8")) as { pins: Record<string, Record<string, unknown>> }).pins.vault ?? {});
/** Where the conflict sessions keep what they set aside. */
const setAside = async () => (await raw.exists(".plainva/conflict-revisions")) ? (await readdir(join(root, ".plainva", "conflict-revisions"))).map((name) => `.plainva/conflict-revisions/${name}`) : [];
/**
 * The conflicts the store holds, listed or not: the vault's list leaves out
 * any a write of the app opened on an own file, so whether one was opened is
 * asked here.
 */
const opened = async () => (await repo.listConflictSessions()).map((session) => session.originalPath);

/** Another device of the same person: it holds what its last cycle left it, and what its user changed since. */
type SecondDevice = ProfileHarnessDevice & { values: Record<string, unknown> };
function secondDevice(deviceId: string): SecondDevice {
  const device: SecondDevice = {
    deviceId,
    values: {},
    vault: new MemoryProfileVault(),
    exchanges: [],
    port: {
      exportValues: async () => structuredClone(device.values),
      applyValues: async (values) => { device.values = structuredClone(values); },
    },
  };
  return device;
}

describe("a bookmark set on the phone after a settings profile brought one", () => {
  it("is saved, as before: the phone writes the list on one level in both places", async () => {
    expect(await vaultOps.toggleBookmark(vault, "Alpha.md")).toBe(true);
    expect(await vaultOps.toggleBookmark(vault, "Beta.md")).toBe(true);

    // The settings sync, with the phone's own port and the files its steps are handed.
    expect(SIDEBAND_HANDS).toHaveLength(1);
    const phone: ProfileHarnessDevice = {
      deviceId: "phone-a",
      port: createMobileProfilePort(vault),
      vault: named<MemoryProfileVault>(SIDEBAND_HANDS[0]),
      exchanges: [],
    };
    const desktop = secondDevice("desktop-b");
    const target = new CountingSyncTarget();
    await runProfileCycle(target, phone, "2026-10-12T08:00:00.000Z");
    await runProfileCycle(target, desktop, "2026-10-12T08:01:00.000Z");
    expect(desktop.values.bookmarks).toEqual(["Alpha.md", "Beta.md"]);
    desktop.values = { ...desktop.values, bookmarks: ["Alpha.md", "Beta.md", "Gamma.md"] };
    await runProfileCycle(target, desktop, "2026-10-12T08:02:00.000Z");
    await runProfileCycle(target, phone, "2026-10-12T08:03:00.000Z");
    expect(await bookmarksOnDisk()).toEqual(["Alpha.md", "Beta.md", "Gamma.md"]);

    expect(await vaultOps.toggleBookmark(vault, "Delta.md")).toBe(true);
    expect((await vaultOps.getBookmarks(vault)).map((entry) => entry.path)).toEqual(["Alpha.md", "Beta.md", "Gamma.md", "Delta.md"]);
    // A renamed note keeps its star, and a star can be taken away.
    for (const handed of RENAME_HANDS.slice(0, 1)) await renameBookmarksOnDisk(named<BookmarksIO>(handed), "Gamma.md", "Projects/Gamma.md");
    await vaultOps.removeBookmark(vault, "Alpha.md");
    expect(await bookmarksOnDisk()).toEqual(["Beta.md", "Projects/Gamma.md", "Delta.md"]);
    expect(await conflictCopies()).toEqual([]);
    expect(await opened()).toEqual([]);
  });
});

describe("the pins of the map, in a vault folder a second device writes to", () => {
  it("every graph surface asks for the store of the chain's top", () => {
    expect(GRAPH_HANDS.length).toBeGreaterThanOrEqual(3);
    expect(BASE_GRAPH_ASKS).toEqual(["adapter"]);
    for (const handed of [...GRAPH_HANDS, ...BASE_GRAPH_HANDS]) expect(named(handed), handed).toBe(chain);
  });

  it("go on being saved after the other device wrote its own", async () => {
    const store = getGraphState(named<IVaultAdapter>(GRAPH_HANDS[0]));
    await store.load();
    store.setPin("vault", "Alpha.md", { x: 10, y: 20 });
    await store.flush();
    store.setPin("vault", "Beta.md", { x: 30, y: 40 });
    await store.flush();
    expect(await pinsOnDisk()).toEqual(["Alpha.md", "Beta.md"]);

    // The folder is shared: the other device's file arrives under this one.
    await raw.writeTextFile(GRAPH, JSON.stringify({ version: 1, vaultLayout: 2, pins: { vault: { "Elsewhere.md": { x: 1, y: 2 } } }, dismissedSuggestions: [] }, null, 2));

    store.setPin("vault", "Gamma.md", { x: 50, y: 60 });
    await store.flush();
    // The store writes what it holds, this device's pins — the one that writes last has the file, as below the
    // chain. A failed write is swallowed there ("a cache"), so the file is what tells.
    expect(await pinsOnDisk()).toEqual(["Alpha.md", "Beta.md", "Gamma.md"]);
    expect(await conflictCopies()).toEqual([]);
    expect(await opened()).toEqual([]);
  });
});

describe("a vault an older version left with a conflict on the pins", () => {
  it("counts no conflict, saves the next pin, and sets aside what the conflict held", async () => {
    // What the run above left behind before the chain let the app's own files be: the other device's pins in the
    // file, an open conflict opened by the app's own write, and its working copy with the pins that were not saved.
    const theirs = JSON.stringify({ version: 1, vaultLayout: 2, pins: { vault: { "Elsewhere.md": { x: 1, y: 2 } } }, dismissedSuggestions: [] }, null, 2);
    const refused = JSON.stringify({ version: 1, vaultLayout: 2, pins: { vault: { "Alpha.md": { x: 10, y: 20 } } }, dismissedSuggestions: [] }, null, 2);
    await raw.writeTextFile(GRAPH, theirs);
    const sessions = new ConflictSessions(backup, repo, repo);
    const left = await sessions.withMutation(GRAPH, async (gate) =>
      sessions.preserveLocked(gate, { path: GRAPH, text: refused, base: null, external: theirs, writer: "adapter" }));
    vi.spyOn(console, "info").mockImplementation(() => {});

    openChain(); // the app starts again
    // What the vault's first screen counts.
    expect(await vault.files.listConflictSessions?.()).toEqual([]);
    const store = getGraphState(named<IVaultAdapter>(GRAPH_HANDS[0]));
    await store.load();
    store.setPin("vault", "Gamma.md", { x: 50, y: 60 });
    await store.flush();
    expect(await pinsOnDisk()).toEqual(["Elsewhere.md", "Gamma.md"]);

    await chain.endOwnFileConflicts();
    expect(await opened()).toEqual([]);
    expect(await raw.exists(left.workingCopyPath)).toBe(false);
    const aside = await setAside();
    expect(aside).toHaveLength(1);
    expect(await raw.readTextFile(aside[0])).toBe(refused);
  });
});
