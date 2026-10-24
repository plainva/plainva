// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";
import {
  BackupVaultAdapter, ConflictAwareVaultAdapter, ConflictSessions, DEFAULT_BACKUP_RETENTION, QueueingVaultAdapter, SyncQueue, SyncStateRepository,
  type IDatabaseAdapter, type IVaultAdapter,
} from "@plainva/core";
import {
  applyBookmarkProfileOnDisk, parseBookmarksFile, parseRecentsFile, serializeBookmarksFile, serializeRecentsFile, setBookmarksLaneScope, setPlatformServices, toast,
  toggleBookmarkOnDisk, type BookmarksIO, type ISettingsStore,
} from "@plainva/ui";
import { LocalVaultAdapter } from "../../../packages/core/src/vault/LocalVaultAdapter";
import { realSqlite } from "../../../packages/core/test/helpers/realSqlite";
import { CountingSyncTarget, MemoryProfileVault, runProfileCycle, type ProfileHarnessDevice } from "../../../packages/core/test/support/settingsSyncHarness";
import { sourceFile } from "./test-sourceTree";
import { useWindowBookmarks } from "./hooks/useWindowBookmarks";
import { bindBookmarkVault, retargetDesktopBookmarks } from "./services/bookmarks";
import { getGraphState } from "./services/graphState";
import { pushRecent } from "./services/recents";
import { createDesktopProfilePort } from "./services/settingsProfile";

/**
 * The app's own files under `.plainva` and the vault's chain — the desktop's
 * side (finding 2026-10-12; the phone's is `services/ownFilesChain.test.ts`
 * there).
 *
 * The sidebar writes `.plainva/bookmarks.json` through the top of the chain;
 * a settings profile that arrives from another device writes the same file
 * through the chain's lowest link. The chain kept, for every file it wrote,
 * what it had written last — for the app's own files as well. So after a
 * profile had brought a bookmark from the phone, the next star set on the
 * desktop met a file the chain did not know: no text to merge against, a
 * conflict copy `.plainva/bookmarks.CONFLICT-….json`, and every star after it
 * refused as well — until a conflict was resolved that only the dialog of
 * sync errors listed, under the name of a file the person never sees. The
 * pins of the map and the notes opened last met the same in a vault folder a
 * second computer writes to, without a word: their writes fail in silence.
 *
 * What is run here is the desktop's own code — the hook behind the sidebar
 * with what `AppShell` hands it, the profile port with what the vault context
 * hands it, in a real cycle of the settings sync, the statement the owner
 * window runs for a star set in another window, the retargeting after a
 * rename, the store behind every view of the map with what those views hand
 * it — over real files, a real SQLite and the chain put together the way the
 * vault context does it.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let store: ISettingsStore;
vi.mock("./services/settingsStore", () => ({
  STORE_KEY: "own-files-chain.json",
  getSettingsStore: async () => store,
}));

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

// ── What the desktop's sources hand over ─────────────────────────────────────

const parsed = (rel: string) => ts.createSourceFile(rel, sourceFile(rel), ts.ScriptTarget.Latest, true, rel.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
function all<T extends ts.Node>(root: ts.Node, is: (node: ts.Node) => node is T): T[] {
  const found: T[] = [];
  (function visit(node: ts.Node) {
    if (is(node)) found.push(node);
    ts.forEachChild(node, visit);
  })(root);
  return found;
}
/** The first argument of every call of a function in a file of the desktop. */
function firstArguments(rel: string, callee: string): string[] {
  const source = parsed(rel);
  const calls = all(source, ts.isCallExpression).filter((call) => call.expression.getText(source) === callee);
  if (calls.length === 0) throw new Error(`${rel} no longer calls ${callee} — re-point this harness`);
  return calls.map((call) => call.arguments[0].getText(source));
}
/** What a file puts into an object under a name, at every place. */
function propertyValues(rel: string, name: string): string[] {
  const source = parsed(rel);
  const values = all(source, ts.isPropertyAssignment).filter((p) => p.name.getText(source) === name).map((p) => p.initializer.getText(source));
  if (values.length === 0) throw new Error(`${rel} no longer names ${name} — re-point this harness`);
  return values;
}

const CONTEXT = "apps/desktop/src/contexts/VaultContext.tsx";
const SIDEBAR_HANDS = firstArguments("apps/desktop/src/AppShell.tsx", "useWindowBookmarks");
const PROFILE_HANDS = propertyValues(CONTEXT, "rawVault");
const OTHER_WINDOW_HANDS = firstArguments("apps/desktop/src/services/ownerBus.ts", "toggleBookmarkOnDisk");
const RENAME_HANDS = firstArguments("apps/desktop/src/services/ownerBus.ts", "retargetDesktopBookmarks");
const RECENTS_HANDS = firstArguments("apps/desktop/src/AppShell.tsx", "m.pushRecent");
/** Every view of the map: the vault's map, a database's map, the map beside a note, its clean-up panel. */
const GRAPH_VIEWS = ["base/BaseGraphView", "graph/CleanupPanel", "graph/GraphContextSection", "graph/VaultGraphView"].map((name) => `apps/desktop/src/components/${name}.tsx`);
const GRAPH_HANDS = GRAPH_VIEWS.flatMap((rel) => firstArguments(rel, "getGraphState"));

// ── The vault ────────────────────────────────────────────────────────────────

const VAULT = "C:/Vaults/Own Files";
const BOOKMARKS = ".plainva/bookmarks.json";
const RECENTS = ".plainva/recents.json";
const GRAPH = ".plainva/graph.json";
const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

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

let root: string, raw: LocalVaultAdapter, db: IDatabaseAdapter, versions: BackupVaultAdapter, repo: SyncStateRepository, top: ConflictAwareVaultAdapter;
/** How often the app said a bookmark could not be saved (`sidebar.bookmarkSaveFailed`). */
let refusals: () => number;

/** The chain as the vault context builds it when a vault opens — again after a restart, over the same files and the same database. */
function openChain(): void {
  versions = new BackupVaultAdapter(raw, { policy: DEFAULT_BACKUP_RETENTION });
  repo = new SyncStateRepository(db, versions, "desktop-a");
  top = new ConflictAwareVaultAdapter(new QueueingVaultAdapter(versions, new SyncQueue(db)), repo, () => {}, repo, "external-folder");
}

/** The names the desktop's sources know the two levels by. */
const handedOut = () => ({
  vaultAdapter: top,
  backupAdapter: versions,
  backupVaultAdapter: versions,
  state: { vaultAdapter: top, backupAdapter: versions },
  deps: { vaultAdapter: top },
});
function named<T>(expression: string): T {
  const scope = handedOut();
  return new Function(...Object.keys(scope), `return (${expression});`)(...Object.values(scope)) as T;
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "plainva-desktop-own-files-"));
  raw = new LocalVaultAdapter(root);
  await raw.initialize();
  await raw.createDir(".plainva");
  db = queueing(await realSqlite());
  openChain();
  store = memoryStore();
  setPlatformServices({
    loadSettings: async () => store,
    credentials: { readSecret: async () => null, writeSecret: async () => {}, removeSecret: async () => {} },
    openExternal: async () => {},
  });
  const notice = vi.spyOn(toast, "error");
  refusals = () => notice.mock.calls.length;
});
afterEach(async () => {
  await closeSidebar();
  // What a write started in the background is through before the database and the folder go.
  await top.endOwnFileConflicts();
  vi.restoreAllMocks();
  toast.clearAll();
  await db.close();
  await rm(root, { recursive: true, force: true });
});

const onDisk = async () => parseBookmarksFile(await readFile(join(root, BOOKMARKS), "utf8")).entries.map((entry) => entry.path);
const conflictCopies = async () => (await readdir(join(root, ".plainva"))).filter((name) => name.includes(".CONFLICT"));
/** Where the conflict sessions keep what they set aside. */
const setAside = async () => (await raw.exists(".plainva/conflict-revisions")) ? (await readdir(join(root, ".plainva", "conflict-revisions"))).map((name) => `.plainva/conflict-revisions/${name}`) : [];
/**
 * The conflicts the store holds, listed or not: the vault's list leaves out
 * any a write of the app opened on an own file, so whether one was opened is
 * asked here.
 */
const opened = async () => (await repo.listConflictSessions()).map((session) => session.originalPath);

// ── The sidebar ──────────────────────────────────────────────────────────────

type SidebarBookmarks = ReturnType<typeof useWindowBookmarks>;
let sidebar: SidebarBookmarks;
let mounted: { root: Root; host: HTMLDivElement } | null = null;
/** The hook behind the sidebar, with what it returns handed out after every drawing. */
function Sidebar({ io, drawn }: { io: BookmarksIO; drawn: (bookmarks: SidebarBookmarks) => void }) {
  const bookmarks = useWindowBookmarks(io, VAULT);
  useEffect(() => { drawn(bookmarks); });
  return null;
}
async function openSidebar(): Promise<void> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const reactRoot = createRoot(host);
  mounted = { root: reactRoot, host };
  // What `AppShell` hands the hook, under the name it has there.
  const io = named<BookmarksIO>(SIDEBAR_HANDS[0]);
  await act(async () => { reactRoot.render(<Sidebar io={io} drawn={(bookmarks) => { sidebar = bookmarks; }} />); });
}
async function closeSidebar(): Promise<void> {
  if (!mounted) return;
  const { root: reactRoot, host } = mounted;
  mounted = null;
  await act(async () => reactRoot.unmount());
  host.remove();
}
const shows = (path: string) => sidebar.bookmarks.some((entry) => entry.path === path);
/** Lets the hook's reads and writes run and React draw what they set, until the sidebar is where it is waited for. */
async function until(reached: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!reached()) {
    if (Date.now() > deadline) throw new Error(what);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
  }
}
/** The star in the sidebar, and the wait until the list shows it — or the notice that it could not be saved. */
async function star(path: string): Promise<void> {
  const before = shows(path), refusedBefore = refusals();
  await act(async () => { sidebar.toggleBookmark(path); });
  await until(() => refusals() > refusedBefore || shows(path) !== before, `the star on ${path} has not settled`);
}

// ── A second device ──────────────────────────────────────────────────────────

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

/** The desktop as the settings sync sees it: its own port, with what the vault context hands it, and the files the sync's steps read. */
function desktopDevice(): ProfileHarnessDevice {
  const rawVault = named<IVaultAdapter>(PROFILE_HANDS[0]);
  return {
    deviceId: "desktop-a",
    port: createDesktopProfilePort(VAULT, { rawVault, onSkipped: () => {} }),
    vault: rawVault as unknown as MemoryProfileVault,
    exchanges: [],
  };
}

/**
 * Two stars on the desktop, then a third one set on the phone that the
 * settings sync brings here. Returns once the sidebar shows all three.
 */
async function aBookmarkArrivesFromThePhone(): Promise<void> {
  await openSidebar();
  await star("Alpha.md");
  await star("Beta.md");
  const target = new CountingSyncTarget();
  const desktop = desktopDevice();
  const phone = secondDevice("phone-b");
  await runProfileCycle(target, desktop, "2026-10-12T08:00:00.000Z");
  await runProfileCycle(target, phone, "2026-10-12T08:01:00.000Z");
  expect(phone.values.bookmarks).toEqual(["Alpha.md", "Beta.md"]);
  phone.values = { ...phone.values, bookmarks: ["Alpha.md", "Beta.md", "Gamma.md"] };
  await runProfileCycle(target, phone, "2026-10-12T08:02:00.000Z");
  await act(async () => { await runProfileCycle(target, desktop, "2026-10-12T08:03:00.000Z"); });
  await until(() => shows("Gamma.md"), "the sidebar has not read the arrived list");
  expect(await onDisk()).toEqual(["Alpha.md", "Beta.md", "Gamma.md"]);
  expect(refusals()).toBe(0);
}

describe("the desktop's wiring", () => {
  it("the sidebar is handed the chain's top, the profile its lowest link", () => {
    expect(SIDEBAR_HANDS).toHaveLength(1);
    expect(named(SIDEBAR_HANDS[0])).toBe(top);
    // Every place the vault context builds or rebuilds the settings sync at.
    expect(PROFILE_HANDS.length).toBeGreaterThanOrEqual(5);
    for (const handed of PROFILE_HANDS) expect(named(handed), handed).toBe(versions);
    expect(GRAPH_HANDS).toHaveLength(GRAPH_VIEWS.length);
    for (const handed of [...OTHER_WINDOW_HANDS, ...RENAME_HANDS, ...RECENTS_HANDS, ...GRAPH_HANDS]) expect(named(handed), handed).toBe(top);
  });

  it("…under the names this harness gives them", () => {
    const context = sourceFile(CONTEXT);
    // What a component reads as `backupAdapter` is the versions layer, and the owner window's handlers get the chain's top.
    expect(context).toMatch(/\n\s+backupAdapter: backupVaultAdapter,\n/);
    expect(context).toMatch(/const backupVaultAdapter = new BackupVaultAdapter\(tauriVaultAdapter,/);
    expect(context).toMatch(/const syncRepo = new SyncStateRepository\(dbAdapter, backupVaultAdapter,/);
    expect(context).toMatch(/installOwnerBus\(\{[^}]*?\n\s+vaultAdapter: state\.vaultAdapter,/);
    expect(all(parsed(CONTEXT), ts.isVariableDeclaration).filter((d) => d.name.getText() === "backupAdapter").map((d) => d.initializer?.getText())).toEqual(["state.backupAdapter", "state.backupAdapter"]);
    // What a component reads as `vaultAdapter` is the chain's top — the views of the map take it from the vault context.
    expect(context).toMatch(/const vaultAdapter = new ConflictAwareVaultAdapter\(/);
    for (const rel of GRAPH_VIEWS) expect(sourceFile(rel), rel).toMatch(/const \{[^}]*\bvaultAdapter\b[^}]*\} = useVault\(\);/);
  });
});

describe("a bookmark set on the desktop after a settings profile brought one", () => {
  it("is saved, in the sidebar", async () => {
    await aBookmarkArrivesFromThePhone();
    await star("Delta.md");
    expect(refusals()).toBe(0);
    expect(await onDisk()).toEqual(["Alpha.md", "Beta.md", "Gamma.md", "Delta.md"]);
    expect(sidebar.bookmarks.map((entry) => entry.path)).toEqual(["Alpha.md", "Beta.md", "Gamma.md", "Delta.md"]);
    expect(await conflictCopies()).toEqual([]);
    expect(await opened()).toEqual([]);
    // …and the star can be taken away again.
    await star("Delta.md");
    await star("Alpha.md");
    expect(refusals()).toBe(0);
    expect(await onDisk()).toEqual(["Beta.md", "Gamma.md"]);
  });

  it("is saved when it is set in another window", async () => {
    await aBookmarkArrivesFromThePhone();
    // The owner window's answer to `toggle-bookmark`.
    for (const handed of OTHER_WINDOW_HANDS) await toggleBookmarkOnDisk(named<BookmarksIO>(handed), "Delta.md", "file");
    expect(await onDisk()).toEqual(OTHER_WINDOW_HANDS.length % 2 ? ["Alpha.md", "Beta.md", "Gamma.md", "Delta.md"] : ["Alpha.md", "Beta.md", "Gamma.md"]);
    expect(await conflictCopies()).toEqual([]);
  });

  it("follows a note that is renamed", async () => {
    await aBookmarkArrivesFromThePhone();
    await retargetDesktopBookmarks(named<BookmarksIO>(RENAME_HANDS[0]), "Gamma.md", "Projects/Gamma.md");
    // The retargeting reports a failure as a notice and goes on: the file has moved by then.
    expect(refusals()).toBe(0);
    expect(await onDisk()).toEqual(["Alpha.md", "Beta.md", "Projects/Gamma.md"]);
    expect(await conflictCopies()).toEqual([]);
  });

  it("the profile that goes up next carries it", async () => {
    await aBookmarkArrivesFromThePhone();
    await star("Delta.md");
    const values = await desktopDevice().port.exportValues();
    expect(values.bookmarks).toEqual(["Alpha.md", "Beta.md", "Gamma.md", "Delta.md"]);
  });
});

describe("a vault an older version left in that conflict", () => {
  /**
   * What the run above left behind before the chain let the app's own files
   * be: the list the profile wrote, the row with what the chain had written
   * before it, the open conflict, and its working copy with the list of the
   * star that was refused.
   */
  async function leftInConflict(): Promise<string> {
    const written = serializeBookmarksFile(["Alpha.md", "Beta.md"]);
    await raw.writeTextFile(BOOKMARKS, serializeBookmarksFile(["Alpha.md", "Beta.md", "Gamma.md"]));
    await repo.updateLocalHash(BOOKMARKS, sha(written));
    const sessions = new ConflictSessions(versions, repo, repo);
    const session = await sessions.withMutation(BOOKMARKS, async (gate) =>
      sessions.preserveLocked(gate, {
        path: BOOKMARKS, text: serializeBookmarksFile(["Alpha.md", "Beta.md", "Gamma.md", "Delta.md"]), base: null,
        external: await raw.readTextFile(BOOKMARKS), writer: "adapter",
      }));
    expect(await raw.exists(session.workingCopyPath)).toBe(true);
    return session.workingCopyPath;
  }

  /**
   * Once the app ended the old conflict in the background: what the working
   * copy held — the list of the star that was refused — is set aside where the
   * sessions keep such texts, and the store holds no conflict any more.
   */
  async function setAsideOnce(): Promise<void> {
    await top.endOwnFileConflicts();
    expect(await opened()).toEqual([]);
    const aside = await setAside();
    expect(aside).toHaveLength(1);
    expect(parseBookmarksFile(await raw.readTextFile(aside[0])).entries.map((entry) => entry.path)).toEqual(["Alpha.md", "Beta.md", "Gamma.md", "Delta.md"]);
  }

  it("comes out of it with the next star, and keeps the list it shows", async () => {
    const workingCopy = await leftInConflict();
    vi.spyOn(console, "info").mockImplementation(() => {});
    openChain(); // the app starts again
    await openSidebar();
    await until(() => shows("Gamma.md"), "the sidebar has not read the list");
    expect(sidebar.bookmarks.map((entry) => entry.path)).toEqual(["Alpha.md", "Beta.md", "Gamma.md"]);
    await star("Epsilon.md");
    expect(refusals()).toBe(0);
    expect(await onDisk()).toEqual(["Alpha.md", "Beta.md", "Gamma.md", "Epsilon.md"]);
    await setAsideOnce();
    expect(await raw.exists(workingCopy)).toBe(false);
    expect(await conflictCopies()).toEqual([]);
  });

  it("is not listed as a conflict to resolve, even before anything is written", async () => {
    const workingCopy = await leftInConflict();
    vi.spyOn(console, "info").mockImplementation(() => {});
    openChain();
    // What the dialog of sync errors asks for, and what it opens a listed copy with.
    expect(await top.listConflictSessions()).toEqual([]);
    expect(await top.getConflictSession(BOOKMARKS)).toBeNull();
    await setAsideOnce();
    expect(await raw.exists(workingCopy)).toBe(false);
    expect(await onDisk()).toEqual(["Alpha.md", "Beta.md", "Gamma.md"]);
  });
});

describe("a star and an arriving list at the same moment", () => {
  it("take turns on the one lane the owner bus and the profile bind — neither is lost", async () => {
    // What `installOwnerBus` binds the sidebar's adapter to, and what the profile port binds its own to before it applies a list.
    expect(sourceFile("apps/desktop/src/services/ownerBus.ts")).toMatch(/bindBookmarkVault\(deps\.vaultAdapter, deps\.vaultPath\)/);
    expect(sourceFile("apps/desktop/src/services/bookmarks.ts")).toMatch(/setBookmarksLaneScope\(io, `desktop:\$\{vaultPath\}`\)/);
    expect(sourceFile("apps/desktop/src/services/settingsProfile.ts")).toMatch(/setBookmarksLaneScope\(context\.rawVault, `desktop:\$\{vaultPath\}`\);\s*await applyBookmarkProfileOnDisk\(context\.rawVault, /);
    const sidebarIo = named<BookmarksIO>(SIDEBAR_HANDS[0]);
    const profileIo = named<BookmarksIO>(PROFILE_HANDS[0]);
    bindBookmarkVault(sidebarIo, VAULT);
    setBookmarksLaneScope(profileIo, `desktop:${VAULT}`);
    await toggleBookmarkOnDisk(sidebarIo, "Alpha.md", "file");
    await toggleBookmarkOnDisk(sidebarIo, "Beta.md", "file");
    // The chain no longer turns a write between another's read and write into a conflict: the lane keeps the two apart.
    // The list that came first goes first; the star reads what it wrote.
    await Promise.all([
      applyBookmarkProfileOnDisk(profileIo, { bookmarks: ["Alpha.md", "Beta.md", "Gamma.md"] }),
      toggleBookmarkOnDisk(sidebarIo, "Delta.md", "file"),
    ]);
    expect(await onDisk()).toEqual(["Alpha.md", "Beta.md", "Gamma.md", "Delta.md"]);
    expect(await conflictCopies()).toEqual([]);
    expect(await opened()).toEqual([]);
  });
});

describe("a vault folder two computers share", () => {
  it("a bookmark is saved after the other computer set one — no settings sync is needed for it", async () => {
    await openSidebar();
    await star("Alpha.md");
    await star("Beta.md");
    // A folder that a file service carries to a second computer brings that computer's list.
    await raw.writeTextFile(BOOKMARKS, serializeBookmarksFile(["Alpha.md", "Beta.md", "Elsewhere.md"]));
    await star("Delta.md");
    expect(refusals()).toBe(0);
    expect(await onDisk()).toEqual(["Alpha.md", "Beta.md", "Elsewhere.md", "Delta.md"]);
    expect(await conflictCopies()).toEqual([]);
  });

  it("the notes opened last go on being remembered after the other computer wrote the list", async () => {
    // `.plainva/recents.json` is written through the chain's top, and only there.
    const recents = named<IVaultAdapter>(RECENTS_HANDS[0]);
    expect(await pushRecent(recents, "Alpha.md", 1)).toEqual(["Alpha.md"]);
    expect(await pushRecent(recents, "Beta.md", 2)).toEqual(["Beta.md", "Alpha.md"]);
    // A folder that a file service carries to a second computer brings that computer's list.
    await raw.writeTextFile(RECENTS, serializeRecentsFile([{ path: "Elsewhere.md", openedAt: 3 }]));
    expect(await pushRecent(recents, "Gamma.md", 4)).toEqual(["Gamma.md", "Elsewhere.md"]);
    // The list is read before each write: it goes on from what the other computer left.
    expect(parseRecentsFile(await readFile(join(root, RECENTS), "utf8")).map((entry) => entry.path)).toEqual(["Gamma.md", "Elsewhere.md"]);
    expect(await conflictCopies()).toEqual([]);
    expect(await opened()).toEqual([]);
  });

  it("the pins of the map go on being kept after the other computer wrote its own", async () => {
    // `.plainva/graph.json` is written through the chain's top, by the one store every view of the map shares.
    const pins = getGraphState(named<IVaultAdapter>(GRAPH_HANDS[0]));
    await pins.load();
    pins.setPin("vault", "Alpha.md", { x: 1, y: 2 });
    await pins.flush();
    pins.setPin("vault", "Beta.md", { x: 3, y: 4 });
    await pins.flush();
    // A folder that a file service carries to a second computer brings that computer's pins.
    await raw.writeTextFile(GRAPH, JSON.stringify({ version: 1, pins: { vault: { "Elsewhere.md": { x: 5, y: 6 } } }, dismissedSuggestions: [] }));
    pins.setPin("vault", "Gamma.md", { x: 7, y: 8 });
    await pins.flush();
    // The store writes what it holds, this computer's pins: the one that writes last has the file, as below the chain.
    expect(Object.keys(JSON.parse(await readFile(join(root, GRAPH), "utf8")).pins.vault)).toEqual(["Alpha.md", "Beta.md", "Gamma.md"]);
    expect(await conflictCopies()).toEqual([]);
    expect(await opened()).toEqual([]);
  });
});
