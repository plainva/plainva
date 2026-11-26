// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { closeWaitNoteName, parkClosingSyncPlace, toast, waitForClosingVault, type CloudAccountRecord } from "@plainva/ui";
import { vaultEntryName } from "./vaultEntryName";
import { retiredBoot } from "./bootRetirement";

/**
 * The transitions of the phone's runtime on screen and the sync that runs on
 * it, together (review B2, rounds 5 to 7; the table they keep is
 * `docs/engineering/Screen_Runtime_Transitions.md`). The transitions are lifted out of
 * `vaultService.ts` as written; the sync is the real `syncService` with fake
 * workers. Every wait of the stand-ins can be held: the registry, the drafts,
 * the saves, a worker's drain, the close's deadline, the 2 s a retired start
 * is given, the boot at four points, and the screens' start of the sync after
 * a boot.
 *
 * For every pair of participants — a switch, a step on the runtime (its sync
 * stopped within the deadline, or the deadline given up and the vault opened
 * anew), a step that reloads its runtime when its work is done, the same with
 * someone's input elsewhere so that its reload waits, a reload, an index
 * rebuild, a restart of the sync, a step on the vault's sign-ins, the removal
 * of the vault — in both orders, with the deadline kept and with it able to
 * run out, the second begins at every wait of the first. And every wait that
 * can fail in the app (the registry, the saves, the drafts, the settings, the
 * set-aside, a start, a step's or a sign-in's work, the removal) fails once:
 * alone, and where the second begins at it.
 *
 * The measure is the model's own book, never `runtimeOnScreen()`: which start
 * was retired (its signal), which runtime a close began to leave (its settle),
 * which it left for good (its `leaveVault`), which was closed (`dispose`) —
 * and a runtime a turn of the queue began to leave but neither left nor
 * closed is open again when that turn ends. Against it always the same:
 *
 * 1. never two open runtimes at one vault;
 * 2. every runtime that opened and is not on screen at the end was closed
 *    exactly once, and the one on screen not at all;
 * 3. a step goes on only with a runtime the book has open on screen;
 * 4. the runtime on screen belongs to the active vault entry;
 * 5. no worker is built for a runtime the book has retired, left or closed,
 *    and at the end exactly one runs, for the runtime on screen;
 * 6. everything comes to an end, and nothing stays `leaving`;
 * 7. nothing holds a vault's sync at the end, and while something holds the
 *    sync of the vault on screen with nothing of it running, the status says
 *    it is paused;
 * 8. a step's reload leaves only the runtime the step went on with, and no
 *    worker is built for a runtime whose reload waits;
 * 9. nothing of a vault is removed while a step or a sign-in on it runs.
 */

type Runtime = {
  vaultId: string; n: number; disposed: number; retired: boolean; leaving: boolean; left: boolean; external: null; db: object; isEncryptedWorkspace: false;
  dispose(): Promise<void>; callOff(): void; ended(): Promise<void>; flushOwed(): Promise<void>; enableSyncEnqueue(): void;
  [key: string]: unknown;
};
type Api = {
  getMobileVault(): Promise<Runtime>;
  switchVault(id: string): Promise<void>;
  renewAfterSyncGaveUp(left: unknown): Promise<Runtime>;
  reloadActiveMobileVault(own?: string, opts?: unknown): Promise<boolean>;
  rebuildOpenMobileIndexDatabase(): Promise<boolean>;
  runtimeOnScreen(): Runtime | null;
  deleteVault(id: string): Promise<string[]>;
  transitionsSettled(): Promise<void>;
  screenState(): string;
};

const m = vi.hoisted(() => ({
  api: null as null | {
    getMobileVault(): Promise<unknown>; switchVault(id: string): Promise<void>; renewAfterSyncGaveUp(left: unknown): Promise<unknown>; runtimeOnScreen(): unknown;
    reloadActiveMobileVault(own?: unknown, opts?: unknown): Promise<boolean>; transitionsSettled(): Promise<void>;
  },
  /** The wait with this number (counted over the run) fails where it is one that can fail in the app. */
  failHit: null as null | number,
  /** Steps and sign-ins running, by vault (sentence 9). */
  stepsRunning: new Map<string, number>(),
  /** A reload waiting behind someone's input (`takeScreen`), and the runtime it is to replace. */
  deferred: null as null | (() => Promise<void>),
  owedFor: null as unknown,
  /** The runtime the step that reloads went on with, and whether the turn under way is that step's reload. */
  stepOn: null as unknown,
  turnOwner: null as null | string,
  /** A real save coordinator in place of the stand-in's saves (`noteSaver`), where a test sets one. */
  saver: null as null | { flushAll(ctx?: unknown): Promise<void>; pendingPaths(ctx?: unknown): string[] },
  /** One wait of a stand-in: held until the driver lets it go. */
  wait: (async () => {}) as (label: string) => Promise<void>,
  /** Whether the close's deadline can run out in this run (`waitWithDeadline`). */
  deadlineGivesUp: false,
  /** Whether a retired start answers within its 2 s (their mark goes last) or late (it goes first). */
  retiredLate: false,
  active: "notes",
  /** Someone's input on another surface (`foreignInputArmed`). */
  foreignInput: false,
  /** The registry cannot be written (`setActiveVault`). */
  failActive: false,
  /** Which start does not open (by its number). */
  failOpen: null as null | ((n: number) => boolean),
  /** The runtime a start is building a worker for (`enableSyncEnqueue` comes right before the worker). */
  building: null as unknown,
  workers: [] as Array<{ runtime: unknown; running: boolean }>,
}));

vi.mock("@plainva/core", async (original) => {
  class FakeRunning {
    running = false;
    start() { this.running = true; }
    stop() { this.running = false; }
    async stopAndDrain() { this.running = false; await m.wait("worker drain"); }
    triggerImmediate() {}
    async pushSettingsNow() {}
  }
  class FakeWorker extends FakeRunning {
    readonly runtime = m.building;
    constructor() { super(); m.workers.push(this); }
    verifyDeletionJournal() { return Promise.resolve(null); }
  }
  return {
    ...await original<typeof import("@plainva/core")>(),
    SyncWorker: FakeWorker,
    EncryptedWorkspaceWorker: FakeWorker,
    SettingsOnlySync: class extends FakeRunning {},
    SyncEngine: class {},
    DeletionJournal: class {},
    createProviderWorkspaceObjectStore: () => ({ get: async () => null }),
    WebDavSyncTarget: class extends (await original<typeof import("@plainva/core")>()).WebDavSyncTarget {
      override async download(): Promise<Uint8Array | null> { return null; }
    },
  };
});
vi.mock("@plainva/ui", async (original) => ({
  ...await original<typeof import("@plainva/ui")>(),
  isEndpointConfirmedIn: async () => true,
  assertEndpointConfirmedIn: async () => {},
  // The close's deadline: the work, or — where it can run out in this run — whichever comes first, the work or the
  // held wait that stands for the 30 s.
  waitWithDeadline: (work: Promise<unknown>) => Promise.race([
    work.then(() => "done" as const),
    ...(m.deadlineGivesUp ? [m.wait("deadline").then(() => "gave-up" as const)] : []),
  ]),
  getPlatformServices: () => ({
    credentials: {
      readSecret: async (key: string) => (key.startsWith("sync_provider_mobile_") ? { provider: "webdav", creds: { url: "https://dav.example.test/v", user: "u", pass: "p" } } : null),
      writeSecret: async () => undefined,
      removeSecret: async () => undefined,
    },
    loadSettings: async () => ({ get: async () => null, set: async () => {}, delete: async () => {}, save: async () => undefined }),
  }),
}));
vi.mock("./cloudAccountsStore", () => ({
  CLOUD_ACCOUNTS_EVENT: "test-cloud-accounts-changed",
  loadCloudAccounts: async (): Promise<CloudAccountRecord[]> => [{ id: "acct", family: "webdav", label: "Server", services: { files: { provider: "webdav" } } } as CloudAccountRecord],
}));
vi.mock("./vaultRegistry", async (original) => ({
  ...await original<typeof import("./vaultRegistry")>(),
  getActiveVaultEntry: async () => ({ id: m.active }),
  getVaultEntry: async (id: string) => ({ id, name: id, provider: "webdav" }),
  updateVault: async () => undefined,
}));
// The sync reaches the vault through these: here, the lifted functions of the run.
vi.mock("./vaultService", () => ({
  getMobileVault: () => m.api!.getMobileVault(),
  switchVault: (id: string) => m.api!.switchVault(id),
  renewAfterSyncGaveUp: (left: unknown) => m.api!.renewAfterSyncGaveUp(left),
  runtimeOnScreen: () => m.api?.runtimeOnScreen() ?? null,
  reloadActiveMobileVault: (own?: unknown, opts?: unknown) => m.api!.reloadActiveMobileVault(own, opts),
  transitionsSettled: () => m.api!.transitionsSettled(),
}));
vi.mock("./flowVault", () => ({ enterMadeVault: async () => undefined }));
vi.mock("./mobileSettingsSync", () => ({ mobileSyncDeviceId: async () => "phone", prepareMobileSettingsSync: async (_v: unknown, _p: unknown, raw: unknown) => ({ target: raw, runner: { run: async () => undefined } }) }));
vi.mock("./mobileWorkspaceSecurity", () => ({ loadMobilePublicationRuntime: async () => null, getMobileWorkspaceStatus: async () => null }));
vi.mock("../adapters/webdavHttp", () => ({ webdavFetch: vi.fn(), allowHttpOrigin: vi.fn() }));
vi.mock("../adapters/syncUpload", () => ({ createContentRefResolver: () => ({}), mobileSyncUploader: {} }));

import { detachSync, getSyncStatus, restartSyncIfActive, startSyncAfterBoot, startSyncIfConfigured, withRuntimeStep, withVaultSyncStopped } from "./syncService";
import { holdVaultSync, resetSyncHoldsForTests, syncReleased, vaultSyncHeld } from "./syncHolds";
import { waitWithDeadline } from "@plainva/ui";

const source = readFileSync(resolve("src/services/vaultService.ts"), "utf8");
const file = ts.createSourceFile("vaultService.ts", source, ts.ScriptTarget.Latest, true);
const NAMES = ["getMobileVault", "runtimeOnScreen", "leaveScreen", "backOnScreen", "clearScreen", "retireBoot", "retiredStart", "inScreenTransitions", "transitionsSettled", "screenTransition", "switchVault", "switchTo", "closingKeys", "closingAt",
  "settleBeforeClosing", "drainedOnce", "leaveVault", "renewAfterSyncGaveUp", "resumeOnScreen", "reloadActiveMobileVault", "offerReload", "rebuildOpenMobileIndexDatabase", "rebuildOpenIndexDatabaseOf",
  "savesOf", "deleteVault", "removeVaultAndData"];
const parts: string[] = [];
ts.forEachChild(file, (node) => {
  if (ts.isFunctionDeclaration(node) && node.name && NAMES.includes(node.name.text)) parts.push(node.getText(file).replace(/^export /, ""));
});
const compiled = ts.transpileModule(
  "let bootPromise = null; let bootSettled = false; let bootAbort = null; let bootEntry = null; let screen = { state: 'none', of: null, runtime: null }; let screenBoot = null; let deferredReload = null;\n" +
    "let previousVaultId = null; let switching = null; let screenTransitions = Promise.resolve(); const ABANDON_BOOT_AFTER_MS = 2000; const closingVaults = new Map(); const RELOAD_STEP = 'vault-reload';\n" +
    // The module's boot, cut to its waits: before and in the wait for a runtime of the vault still closing (text 7),
    // after the check that the start was not retired, and before it answers.
    "async function boot(entry, signal) { await wait('boot: before the close'); await waitForClosingVault(wait('boot: in the close').then(() => closingAt(entry.id, entry.external)), '', { signal }); if (signal?.aborted) throw retiredStart(); await wait('boot: opening'); return openRuntime(entry, signal); }\n" +
    parts.join("\n") +
    // The book: a close that begins (its settle) marks the runtime it leaves; one that leaves it for good (its
    // `leaveVault`) marks that too; a turn of the queue that ends with a runtime begun to leave and neither left nor
    // closed gives it back (open again by the book).
    "\nconst settleAsWritten = settleBeforeClosing; settleBeforeClosing = (current, taken) => { book.leaving(current); return settleAsWritten(current, taken); };" +
    "\nconst leaveAsWritten = leaveVault; leaveVault = (current, settled) => { book.leaving(current); book.left(current); return leaveAsWritten(current, settled); };" +
    "\nconst queueAsWritten = inScreenTransitions; inScreenTransitions = (run) => queueAsWritten(async () => { try { return await run(); } finally { book.turnEnded(); } });" +
    "\nreturn { getMobileVault, switchVault, renewAfterSyncGaveUp, reloadActiveMobileVault, rebuildOpenMobileIndexDatabase, runtimeOnScreen, deleteVault, transitionsSettled, screenState: () => screen.state };",
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } },
).outputText;

// One turn of the event loop, the quick way (`setImmediate`): the model waits hundreds of them per run.
const tick = () => new Promise<void>((r) => (typeof setImmediate === "function" ? setImmediate(r) : setTimeout(r, 0)));

/** The waits that can fail in the app: the registry, the saves, the drafts, the settings, the set-aside, a start, a step's or a sign-in's work, the removal. */
const FAILABLE = new Set(["registry read", "registry write", "saves", "drafts", "settings", "set aside", "boot: opening", "the step's work", "the sign-in's write", "the removal"]);

function harness() {
  m.active = "notes";
  m.workers.length = 0;
  m.stepsRunning.clear();
  m.deferred = null;
  m.owedFor = null;
  m.stepOn = null;
  m.turnOwner = null;
  let n = 0;
  const runtimes: Runtime[] = [];
  const violations: string[] = [];
  const held: Array<{ label: string; go: () => void }> = [];
  let hits = 0;
  let onHit: ((count: number) => void) | null = null;
  m.wait = (label) => new Promise<void>((go, fail) => {
    hits += 1;
    const failing = m.failHit === hits && FAILABLE.has(label);
    held.push({ label, go: failing ? () => fail(Object.assign(new Error(`${label} failed`), { name: "VaultUnreachableError" })) : go });
    onHit?.(hits);
  });
  const book = {
    leaving: (r: Runtime | null) => {
      if (!r) return;
      // Sentence 8: the turn of a step's reload leaves only the runtime that step went on with.
      if (m.turnOwner === "the step" && r !== m.stepOn) violations.push(`the step's reload left #${r.n} of ${r.vaultId}, not the step's #${(m.stepOn as Runtime | null)?.n}`);
      r.leaving = true;
    },
    left: (r: Runtime | null) => { if (r) r.left = true; },
    /** A turn of the queue ended: a runtime it began to leave and neither left nor closed is open again. */
    turnEnded: () => {
      m.turnOwner = null;
      for (const r of runtimes) if (r.leaving && !r.left && r.disposed === 0 && !r.retired) r.leaving = false;
    },
    /** Open on screen by the book: the latest runtime that opened, while nothing retired, left or closed it. */
    onScreen: (): Runtime | null => {
      const last = runtimes[runtimes.length - 1];
      return last && !last.retired && !last.leaving && last.disposed === 0 ? last : null;
    },
  };
  let api: Api;
  const opened = () => {
    void api.getMobileVault().then(async (v) => {
      await m.wait("the screens' start after the boot");
      await startSyncAfterBoot(v as never);
    }, () => {});
  };
  const deps = {
    // The 2 s a retired start is given end at a held wait, never at a real timer: whether the start answered by then
    // is the model's to choose (`retiredLate`), and what follows is `bootRetirement.ts` as written — answered: closed,
    // and its end parked; late: closed once it answers, its end parked all the same.
    retiredBoot: (pending: Promise<Runtime>, settled: boolean, callOff: () => void, _ms: number, leaving: (left: Promise<Runtime>) => void) => {
      if (settled) return retiredBoot(pending, settled, callOff, 0, leaving);
      callOff();
      let answered: { v: Runtime | null } | null = null;
      pending.then((v) => { answered = { v }; }, () => { answered = { v: null }; });
      return m.wait("2 s for a retired start").then(async () => {
        // Answered within the 2 s: the function as written, the answer already there.
        if (answered) return retiredBoot(Promise.resolve(answered.v as Runtime), !answered.v, () => {}, 10_000, leaving);
        // Late (its branch of `bootRetirement.ts`, taken here without the real timer the function races): closed once
        // it answers, and its end parked.
        const left = pending.then(async (vault) => { await vault.dispose().catch(() => {}); return vault; });
        left.catch(() => {});
        leaving(left);
        return null;
      });
    },
    waitWithDeadline, waitForClosingVault, parkClosingSyncPlace, vaultEntryName, closeWaitNoteName, toast, book,
    wait: (label: string) => m.wait(label),
    noteSaver: {
      flushAll: (ctx?: unknown) => (m.saver ? m.saver.flushAll(ctx) : m.wait("saves")),
      pendingPaths: (ctx?: unknown) => (m.saver ? m.saver.pendingPaths(ctx) : []),
    },
    holdVaultSync, syncReleased, vaultSyncHeld,
    // The removal of a deleted vault (sentence 9: nothing of it while a step or a sign-in on it runs).
    PimCacheRepository: class { async listAccounts() { return []; } },
    readPublicationIds: async () => [],
    isExternalVault: () => false,
    getVaultFolderPlugin: () => ({ release: async () => {} }),
    reportBackground: () => {},
    removeDataFolder: async (folder: string) => {
      const id = folder.replace(/^vaults\//, "");
      if ((m.stepsRunning.get(id) ?? 0) > 0) violations.push(`${id} removed while a step on it runs`);
      await m.wait("the removal");
    },
    forgetVaultData: async () => [],
    removeVault: async () => undefined,
    flushDraftsBeforeClosing: () => m.wait("drafts"),
    getVaultEntry: async (id: string) => { await m.wait("registry read"); return { id, name: id }; },
    reportingTo: () => () => {},
    detachSync,
    setActiveVault: async (id: string) => {
      await m.wait("registry write");
      if (m.failActive) throw new Error("registry unwritable");
      m.active = id;
    },
    reloadMobileSettingsForActiveVault: () => m.wait("settings"),
    getActiveVaultEntry: async () => { await m.wait("registry read"); return { id: m.active, name: m.active }; },
    startSyncIfConfigured,
    foreignInputArmed: (own?: unknown) => {
      if ((Array.isArray(own) ? own : [own]).includes("the step")) m.turnOwner = "the step";
      return m.foreignInput;
    },
    armedLeaveGuards: () => [],
    // The reload's notice: its run waits until the driver lets the input go (`run`), for the runtime it is to replace.
    takeScreen: (_id: string, step: { run: () => Promise<void> }) => {
      m.deferred = step.run;
      m.owedFor = book.onScreen() ?? [...runtimes].reverse().find((r) => r.leaving && !r.left && r.disposed === 0) ?? null;
    },
    setAsideMobileIndexDatabase: async () => { await m.wait("set aside"); return true; },
    LOCAL_VAULT_ID: "local",
    i18n: { t: (k: string) => k },
    openRuntime: async (entry: { id: string }, signal?: AbortSignal) => {
      const v = {
        vaultId: entry.id, n: n++, disposed: 0, retired: !!signal?.aborted, leaving: false, left: false, external: null, db: {}, isEncryptedWorkspace: false,
        dispose: async () => { v.disposed += 1; },
        callOff: () => {},
        // A runtime ends once it is closed (`MobileVault.ended`): the next start of the vault waits for that.
        ended: async () => { while (v.disposed === 0) await tick(); },
        flushOwed: async () => {},
        enableSyncEnqueue: () => { m.building = v; },
        markFirstSyncComplete: () => {},
        sweepOwedToRemote: () => {},
        reindexPaths: async () => {},
        syncQueue: { clearAll: async () => {}, enqueueLocalOnlyFiles: async () => {} },
        syncRepo: { clearAll: async () => {}, hasConfirmedRemoteFiles: async () => false },
        adapter: { sandboxRoot: "" },
        files: {},
        workspaceRuntime: null,
      } as Runtime;
      if (m.failOpen?.(v.n)) throw new Error("the vault did not open");
      signal?.addEventListener("abort", () => { v.retired = true; }, { once: true });
      const open = runtimes.filter((r) => r.vaultId === entry.id && r.disposed === 0);
      if (open.length > 0) violations.push(`two runtimes at ${entry.id}: #${open.map((r) => r.n).join(",")} and #${v.n}`);
      runtimes.push(v);
      return v;
    },
    // The screens (`useVaultBoot`): every switch event opens the vault on screen, and its sync starts after the boot.
    window: { dispatchEvent: () => { opened(); return true; } },
    CustomEvent: class { constructor(public type: string, public init?: unknown) {} },
    console: { error: () => {}, warn: () => {} },
  };
  api = new Function(...Object.keys(deps), compiled)(...Object.values(deps)) as Api;
  m.api = api as never;
  // Every worker built: for which runtime, and whether the book had that one retired, left or closed then.
  const checked = new WeakSet<object>();
  const watchBuilt = () => {
    for (const w of m.workers) {
      if (checked.has(w)) continue;
      checked.add(w);
      const r = w.runtime as Runtime | null;
      if (!r || r.retired || r.leaving || r.disposed > 0) violations.push(`a worker built for runtime #${r?.n} (${r ? (r.retired ? "retired" : r.leaving ? "left" : "closed") : "none"})`);
      else if (m.deferred && r === m.owedFor) violations.push(`a worker built for runtime #${r.n}, whose reload waits`);
    }
  };
  return {
    api, runtimes, violations, book, opened,
    hits: () => hits,
    /** What still waits, for a run that never came to an end. */
    stillHeld: () => held.map((w) => w.label),
    at: (count: number, then: () => void) => { onHit = (now) => { if (now === count) { onHit = null; then(); } }; },
    /** Lets every held wait go, one at a time, until `until` holds and nothing is held for a while; false where it never came. */
    drain: async (until: () => boolean): Promise<boolean> => {
      for (let quiet = 0; quiet < 40;) {
        watchBuilt();
        // Where the deadline can run out, it does: its wait goes first, before the work it races (the drain). A retired
        // start's 2 s go first where it is late, and last where it answers in time.
        const first = held.findIndex((w) => (m.deadlineGivesUp && w.label === "deadline") || (m.retiredLate && w.label === "2 s for a retired start"));
        const others = held.findIndex((w) => m.retiredLate || w.label !== "2 s for a retired start");
        const at = first >= 0 ? first : others >= 0 ? others : 0;
        const next = held.length ? held.splice(at, 1)[0] : undefined;
        if (next) { quiet = 0; next.go(); await tick(); continue; }
        await tick();
        quiet += 1;
        // Rest is nothing held for a while — and, where `until` does not hold yet, a real moment too: a module the
        // sync loads on demand answers on the clock, not on the next turn.
        if (!until() && quiet % 10 === 0) await new Promise((r) => setTimeout(r, 5));
        if (until() && quiet > 4) { watchBuilt(); return true; }
      }
      watchBuilt();
      return false;
    },
  };
}
type H = ReturnType<typeof harness>;

type Kind = "switch" | "step" | "step-reload" | "step-waits" | "reload" | "rebuild" | "restart" | "sign-in" | "delete";
const KINDS: Kind[] = ["switch", "step", "step-reload", "step-waits", "reload", "rebuild", "restart", "sign-in", "delete"];

/** The body of a step or a sign-in on `vaultId` — what may reach the vault's folder — runs for its length (sentence 9). */
function body<T>(vaultId: string, run: () => Promise<T>): Promise<T> {
  m.stepsRunning.set(vaultId, (m.stepsRunning.get(vaultId) ?? 0) + 1);
  return run().finally(() => m.stepsRunning.set(vaultId, (m.stepsRunning.get(vaultId) ?? 1) - 1));
}

/** Begins a participant; a step is for the runtime it has — the one on screen then, or the one it began on. */
function begin(h: H, kind: Kind, first: Runtime, to: string): { done: Promise<unknown>; problems: string[] } {
  const problems: string[] = [];
  const done = (() => {
    switch (kind) {
      case "switch": return h.api.switchVault(to);
      case "reload": return h.api.reloadActiveMobileVault();
      case "rebuild": return h.api.rebuildOpenMobileIndexDatabase();
      case "restart": return restartSyncIfActive(m.active);
      case "sign-in": {
        const vault = m.active;
        return withVaultSyncStopped(vault, () => body(vault, () => m.wait("the sign-in's write")));
      }
      case "delete": return h.api.deleteVault("notes");
      case "step":
      case "step-reload":
      case "step-waits": {
        const runtime = h.api.runtimeOnScreen() ?? first;
        return withRuntimeStep({ vaultId: runtime.vaultId, runtime: runtime as never }, {
          work: (stop) => body(runtime.vaultId, async () => {
            const on = (await stop()) as unknown as Runtime;
            // Read at the very moment the step goes on with it.
            if (h.book.onScreen() !== on) problems.push(`a step went on with #${on.n}, which the book had not open on screen`);
            if (kind !== "step") m.stepOn = on;
            await m.wait("the step's work");
            // Someone begins to type elsewhere as the work ends: the step's reload waits behind it.
            if (kind === "step-waits") m.foreignInput = true;
          }),
          ...(kind === "step" ? {} : { reload: { own: "the step" } }),
        }, { say: false });
      }
    }
  })();
  return { done: done.then(() => undefined, () => undefined), problems };
}

async function openFirst(h: H): Promise<Runtime> {
  h.opened();
  await h.drain(() => m.workers.some((w) => w.running));
  return h.runtimes[0]!;
}

async function run(a: Kind, b: Kind | null, at: number | null, failAt: number | null = null): Promise<string[]> {
  const h = harness();
  const first = await openFirst(h);
  const base = h.hits();
  m.failHit = failAt === null ? null : base + failAt;
  let second: ReturnType<typeof begin> | null = null;
  let secondDone = false;
  if (b && at !== null) h.at(base + at, () => {
    second = begin(h, b, first, a === "switch" && b === "switch" ? "travel" : "work");
    void second.done.then(() => { secondDone = true; });
  });
  const one = begin(h, a, first, "work");
  let done = false;
  void Promise.all([one.done, (async () => {
    for (let i = 0; b && !second && i < 400; i++) await tick();
    await (second as ReturnType<typeof begin> | null)?.done;
  })()]).then(() => { done = true; });
  let rested = await h.drain(() => done);
  m.failHit = null;
  const problems = [...h.violations];
  // A reload that waits behind someone's input: the input goes (sent, saved or discarded), and it runs — as often as
  // one waits again (a second begun in its waits may put off its own) — and a second begun late comes to its end.
  for (let round = 0; round < 6 && (m.deferred || (second && !secondDone)); round++) {
    const deferred = m.deferred;
    m.foreignInput = false;
    m.deferred = null;
    let ran = !deferred;
    if (deferred) void deferred().then(() => { ran = true; }, () => { ran = true; });
    rested = (await h.drain(() => ran && (!second || secondDone))) && rested;
  }
  // A path that ends through many turns of the loop (a runtime ending tick by tick) may outlast one rest: a second
  // one — never ending at all is what sentence 6 is about, not taking a while.
  if (!rested && done) rested = await h.drain(() => done && (!second || secondDone));
  problems.push(...h.violations.slice(problems.length));
  problems.push(...one.problems, ...((second as ReturnType<typeof begin> | null)?.problems ?? []));
  if (b && !second) problems.push("the second never began");
  if (!done || !rested) {
    const holds = ["notes", "work", "travel", "local"].filter((v) => vaultSyncHeld(v));
    problems.push(`the participants never came to an end (first ${done ? "ended" : "runs"}, second ${second ? (secondDone ? "ended" : "runs") : "none"}; still waiting: ${h.stillHeld().join(", ") || "nothing"}; state ${h.api.screenState()}; held: ${holds.join(", ") || "none"}; deferred: ${m.deferred ? "yes" : "no"})`);
  }
  if (h.api.screenState() === "leaving") problems.push("the runtime on screen stays leaving");
  const screen = h.book.onScreen();
  for (const r of h.runtimes) {
    if (r === screen && r.disposed !== 0) problems.push(`the runtime on screen #${r.n} was closed`);
    if (r !== screen && r.disposed !== 1) problems.push(`runtime #${r.n} of ${r.vaultId}, not on screen, closed ${r.disposed}×`);
  }
  for (const vault of ["notes", "work", "travel", "local"]) if (vaultSyncHeld(vault)) problems.push(`the sync of ${vault} is still held at the end`);
  const runningWorkers = m.workers.filter((w) => w.running);
  // A failed start leaves nothing on screen — the boot's own surface says so — and no sync; everything else ends open.
  if (!screen) {
    if (failAt === null || h.api.screenState() !== "none") problems.push("nothing on screen at the end");
    if (runningWorkers.length > 0) problems.push(`with nothing on screen ${runningWorkers.length} worker(s) run`);
    return problems;
  }
  if (screen.vaultId !== m.active) problems.push(`on screen ${screen.vaultId}, active ${m.active}`);
  if (runningWorkers.length !== 1 || runningWorkers[0]!.runtime !== screen) {
    problems.push(`at the end ${runningWorkers.length} worker(s) run, for #${runningWorkers.map((w) => (w.runtime as Runtime | null)?.n).join(",")}; on screen #${screen?.n}`);
  }
  return problems;
}

// The sync loads its classes on demand (`syncModules`, performance plan L5): loaded once before the model runs, so a
// run's rest is never a module still loading on a busy machine — the first start found no worker in time otherwise.
beforeAll(async () => {
  await import("./syncModules");
  await import("@plainva/core/workspace");
});

/** Between runs: nothing held any more, and what the last run left of the sync drained. */
async function settleSync(): Promise<void> {
  m.wait = async () => {};
  await detachSync().drain();
  // A run that ended with a hold standing has said so (sentence 7); the next one begins without it.
  resetSyncHoldsForTests();
}

afterEach(async () => {
  m.saver = null;
  m.failHit = null;
  m.deferred = null;
  m.deadlineGivesUp = false;
  m.retiredLate = false;
  m.foreignInput = false;
  m.failActive = false;
  m.failOpen = null;
  m.wait = async () => {};
  await detachSync().drain();
  resetSyncHoldsForTests();
});

/** How many waits `a` has on its own, from the vault open. */
async function waitsOf(a: Kind): Promise<number> {
  const alone = harness();
  await openFirst(alone);
  const base = alone.hits();
  const solo = begin(alone, a, alone.runtimes[0]!, "work");
  let soloDone = false;
  void solo.done.then(() => { soloDone = true; });
  await alone.drain(() => soloDone);
  if (m.deferred) {
    m.foreignInput = false;
    const deferred = m.deferred;
    m.deferred = null;
    let ran = false;
    void deferred().then(() => { ran = true; }, () => { ran = true; });
    await alone.drain(() => ran);
  }
  const waits = alone.hits() - base;
  await settleSync();
  return waits;
}

describe("the runtime on screen and its sync, every participant against every other", () => {
  for (const [gives, late] of [[false, false], [true, false], [false, true], [true, true]] as const) {
    for (const a of KINDS) {
      it(`hold the nine rules with ${a} first and every participant second, begun at every wait of it (the deadline ${gives ? "can run out" : "kept"}; a retired start ${late ? "late" : "in time"})`, async () => {
        expect.hasAssertions();
        const failures: string[] = [];
        m.deadlineGivesUp = gives;
        m.retiredLate = late;
        const waits = await waitsOf(a);
        expect(waits, "the first has waits of its own").toBeGreaterThan(0);
        for (const problem of await run(a, null, null)) failures.push(`${a} alone: ${problem}`);
        await settleSync();
        for (const b of KINDS) {
          for (let at = 1; at <= waits; at++) {
            for (const problem of await run(a, b, at)) failures.push(`${a} then ${b} at wait ${at}: ${problem}`);
            await settleSync();
          }
        }
        expect(failures.slice(0, 30)).toEqual([]);
      }, 600_000);
    }
  }
});

describe("every wait that can fail, failing — every transition has one way out of it (the table's cells)", () => {
  for (const gives of [false, true]) {
    for (const a of KINDS) {
      it(`hold the nine rules where a wait of ${a} fails, alone and with every participant begun at it (the deadline ${gives ? "can run out" : "kept"})`, async () => {
        expect.hasAssertions();
        const failures: string[] = [];
        m.deadlineGivesUp = gives;
        const waits = await waitsOf(a);
        for (let at = 1; at <= waits; at++) {
          for (const problem of await run(a, null, null, at)) failures.push(`${a} alone, wait ${at} failing: ${problem}`);
          await settleSync();
          for (const b of KINDS) {
            for (const problem of await run(a, b, at, at)) failures.push(`${a} then ${b} at wait ${at}, failing: ${problem}`);
            await settleSync();
          }
        }
        expect(failures.slice(0, 30)).toEqual([]);
      }, 600_000);
    }
  }
});

describe("the state of the runtime on screen", () => {
  it("is left the moment a switch has its turn: a step and the sync's restart pressed then take nothing of it", async () => {
    expect.hasAssertions();
    const h = harness();
    const first = await openFirst(h);
    const switching = h.api.switchVault("work");
    // At the switch's first wait it has left the runtime — long before it detaches its sync, let alone ends.
    await vi.waitFor(() => expect(h.api.runtimeOnScreen(), "THE DEFECT (T1): the switch's runtime counted as on screen until its end").toBeNull());
    const restart = restartSyncIfActive("notes");
    const step = withRuntimeStep({ vaultId: "notes", runtime: first as never }, { work: async (stop) => { await stop(); return "went on"; } }, { say: false })
      .then((v) => v, (e: Error) => e.name);
    let done = false;
    void Promise.all([switching, restart, step]).then(() => { done = true; });
    await h.drain(() => done);
    expect(await step).toBe("StepNotRunError");
    // THE DEFECT (S7): the restart built a worker on the runtime being closed, and the next vault's start found it.
    expect(m.workers.filter((w) => w.running).map((w) => (w.runtime as Runtime).vaultId)).toEqual(["work"]);
    expect(h.violations).toEqual([]);
  });

  it("goes back to open where a switch fails and the runtime stays — and its sync runs again", async () => {
    expect.hasAssertions();
    const h = harness();
    const first = await openFirst(h);
    m.failActive = true;
    const failing = h.api.switchVault("work").then(() => "switched", (e: Error) => e.message);
    let done = false;
    void failing.then(() => { done = true; });
    await h.drain(() => done && m.workers.some((w) => w.running));
    expect(await failing).toBe("registry unwritable");
    expect(h.api.runtimeOnScreen()).toBe(first);
    expect(m.workers.filter((w) => w.running).map((w) => w.runtime)).toEqual([first]);
  });

  it("knows no runtime on screen where the start after it failed: the one before is closed and gone", async () => {
    expect.hasAssertions();
    const h = harness();
    const first = await openFirst(h);
    // The reload's start of the vault does not open: what is on screen is nothing, not the runtime the reload closed.
    m.failOpen = (n) => n === 1;
    const reload = h.api.reloadActiveMobileVault();
    let done = false;
    void reload.then(() => { done = true; });
    await h.drain(() => done);
    expect(first.disposed).toBe(1);
    expect(h.api.runtimeOnScreen()).toBeNull();
  });
});

describe("the holds of a vault's sync, counted", () => {
  for (const order of ["the runtime step ends first", "the sign-in ends first"] as const) {
    for (const failing of ["none", "the runtime step", "the sign-in", "both"] as const) {
      it(`start nothing while either holds, and the sync once after the last (${order}; failing: ${failing})`, async () => {
        expect.hasAssertions();
        const h = harness();
        const first = await openFirst(h);
        let endStep!: () => void;
        let endSignIn!: () => void;
        const stepEnds = new Promise<void>((r) => (endStep = r));
        const signInEnds = new Promise<void>((r) => (endSignIn = r));
        const step = withRuntimeStep({ vaultId: "notes", runtime: first as never }, {
          work: async (stop) => { await stop(); await stepEnds; if (failing === "the runtime step" || failing === "both") throw new Error("step failed"); },
        }, { say: false }).catch(() => undefined);
        const signIn = withVaultSyncStopped("notes", async () => { await signInEnds; if (failing === "the sign-in" || failing === "both") throw new Error("keychain locked"); }).catch(() => undefined);
        await h.drain(() => true);
        // A restart from elsewhere while both hold (a password's activate, a confirmed address): it does nothing.
        void restartSyncIfActive("notes");
        await h.drain(() => true);
        expect(m.workers.filter((w) => w.running), "THE DEFECT (S5/S5b): a start ran under a step's hold").toEqual([]);
        if (order === "the runtime step ends first") endStep(); else endSignIn();
        await (order === "the runtime step ends first" ? step : signIn);
        await h.drain(() => true);
        expect(m.workers.filter((w) => w.running), "one hold still stands").toEqual([]);
        if (order === "the runtime step ends first") endSignIn(); else endStep();
        await Promise.all([step, signIn]);
        await h.drain(() => m.workers.some((w) => w.running));
        const builtAfter = m.workers.length;
        expect(m.workers.filter((w) => w.running).map((w) => w.runtime), "the sync once, after the last release").toEqual([first]);
        await h.drain(() => true);
        expect(m.workers.length, "and only once").toBe(builtAfter);
      });
    }
  }
});

describe("a restart while a step holds the sync", () => {
  it("stops nothing — also where the step has not stopped the sync yet — and starts nothing", async () => {
    expect.hasAssertions();
    const h = harness();
    const first = await openFirst(h);
    const before = m.workers.find((w) => w.running);
    let ready!: () => void;
    const readyToStop = new Promise<void>((r) => (ready = r));
    const step = withRuntimeStep({ vaultId: "notes", runtime: first as never }, { work: async (stop) => { await readyToStop; await stop(); } }, { say: false }).catch(() => undefined);
    await h.drain(() => true);
    // A password's activate, a confirmed address: a restart while the step holds the sync, before its own stop.
    void restartSyncIfActive("notes");
    await h.drain(() => true);
    // THE DEFECT (R4): the restart stopped the worker the step was to stop itself, under the step's hold.
    expect(before?.running, "the worker runs on until the step stops it").toBe(true);
    expect(m.workers.length).toBe(1);
    ready();
    let done = false;
    void step.then(() => { done = true; });
    await h.drain(() => done && m.workers.some((w) => w.running));
    expect(done).toBe(true);
  });
});

describe("a step's failure while its runtime is left", () => {
  it("is that the step did not finish — never a raw error — also for a healthy switch while it works", async () => {
    expect.hasAssertions();
    const h = harness();
    const first = await openFirst(h);
    let work!: () => void;
    const working = new Promise<void>((r) => (work = r));
    const step = withRuntimeStep({ vaultId: "notes", runtime: first as never }, {
      work: async (stop) => { await stop(); await working; throw new Error("SQLITE: the database is closed"); },
    }, { say: false }).then(() => "done", (e: Error) => e.name);
    await h.drain(() => true);
    const switching = h.api.switchVault("work");
    let switched = false;
    void switching.then(() => { switched = true; });
    await h.drain(() => switched);
    work();
    // THE DEFECT: the raw error of the closed database reached the person (also on `main`).
    expect(await step).toBe("StepInterruptedError");
    await h.drain(() => true);
  });
});

describe("a reload put off behind someone's input after its drain", () => {
  it("tells a step pressed meanwhile that it did not run, and the vault stays open, its sync running again later with the reload", async () => {
    expect.hasAssertions();
    const h = harness();
    const first = await openFirst(h);
    const reloading = h.api.reloadActiveMobileVault();
    // The reload has its turn and leaves the runtime; input begins on another surface while it drains.
    await vi.waitFor(() => expect(h.api.runtimeOnScreen()).toBeNull());
    m.foreignInput = true;
    const step = withRuntimeStep({ vaultId: "notes", runtime: first as never }, { work: async (stop) => { await stop(); } }, { say: false })
      .then(() => "done", (e: Error) => e.name);
    let done = false;
    void Promise.all([reloading, step]).then(() => { done = true; });
    await h.drain(() => done);
    // The window the text says "was being reloaded" for: the step did not run, and the vault is open again.
    expect(await step).toBe("StepNotRunError");
    expect(await reloading, "the reload is put off").toBe(false);
    expect(h.api.runtimeOnScreen()).toBe(first);
    expect(first.disposed).toBe(0);
  });
});

const runningOn = () => m.workers.filter((w) => w.running);
async function until(h: H, p: Promise<unknown>): Promise<void> {
  let done = false;
  void p.then(() => { done = true; }, () => { done = true; });
  await h.drain(() => done);
}
/** The save of `vaultId` fails as a folder out of reach does, once it is asked for (the probe's `failSave`). */
function failingSaves(h: H): { fail: boolean } {
  const saves = { fail: false };
  m.saver = {
    flushAll: () => m.wait("saves").then(() => { if (saves.fail) throw Object.assign(new Error("save failed"), { name: "VaultUnreachableError" }); }),
    pendingPaths: () => [],
  };
  void h;
  return saves;
}

describe("review B2, round 7 — the ways out the model did not have", () => {
  it("P1: a reload whose save fails leaves the vault open with its sync running, as on main — and a step then runs", async () => {
    expect.hasAssertions();
    const h = harness();
    const first = await openFirst(h);
    const saves = failingSaves(h);
    saves.fail = true;
    const reload = h.api.reloadActiveMobileVault().then(() => "reloaded", (e: Error) => e.message);
    await until(h, reload);
    saves.fail = false;
    await h.drain(() => runningOn().length > 0);
    expect(await reload).toBe("save failed");
    // THE DEFECT (S1): the state stayed `leaving` for good, and the vault's sync never started again.
    expect(h.api.screenState()).toBe("open");
    expect(h.api.runtimeOnScreen()).toBe(first);
    expect(runningOn().map((w) => w.runtime)).toEqual([first]);
    // "Try again" on the same vault, and a step: both find the vault open.
    await until(h, h.api.switchVault("notes"));
    expect(h.api.runtimeOnScreen()).toBe(first);
    const step = withRuntimeStep({ vaultId: "notes", runtime: first as never }, { work: async (stop) => { await stop(); return "ran"; } }, { say: false })
      .then((v) => v, (e: Error) => e.name);
    await until(h, step);
    expect(await step).toBe("ran");
    await h.drain(() => runningOn().length > 0);
    expect(runningOn().map((w) => w.runtime)).toEqual([first]);
    expect(first.disposed).toBe(0);
    expect(h.violations).toEqual([]);
  });

  it("P1 (H2): a step whose work fails while that reload is leaving says its own failure, not that it was interrupted — nothing was closed", async () => {
    expect.hasAssertions();
    const h = harness();
    const first = await openFirst(h);
    const saves = failingSaves(h);
    let fail!: () => void;
    const failing = new Promise<void>((r) => (fail = r));
    const step = withRuntimeStep({ vaultId: "notes", runtime: first as never }, {
      work: async (stop) => { await stop(); await failing; throw new Error("the keystore refused"); },
    }, { say: false }).then(() => "done", (e: Error) => e.message);
    await h.drain(() => true);
    saves.fail = true;
    const reload = h.api.reloadActiveMobileVault().catch(() => false);
    await vi.waitFor(() => expect(h.api.screenState()).toBe("leaving"));
    // The work fails while the reload has left the runtime; the reload fails after it and gives the runtime back.
    fail();
    await until(h, Promise.all([reload, step]));
    expect(await step).toBe("the keystore refused");
    expect(h.api.runtimeOnScreen()).toBe(first);
  });

  it("P2: a step's reload put off behind someone's input — no worker on the runtime the step changed, the status says paused, and the reload starts it", async () => {
    expect.hasAssertions();
    const h = harness();
    const first = await openFirst(h);
    const step = withRuntimeStep({ vaultId: "notes", runtime: first as never }, {
      work: async (stop) => { await stop(); await m.wait("the lift's work"); m.foreignInput = true; },
      reload: { own: "security-area" },
    }, { say: false }).then(() => "done", (e: Error) => e.name);
    await until(h, step);
    await h.drain(() => true);
    expect(await step).toBe("done");
    expect(first.disposed, "the reload is put off: the old runtime stays").toBe(0);
    // THE DEFECT (S2): the step's release built a worker on the runtime the step changed under it.
    expect(runningOn().filter((w) => w.runtime === first)).toEqual([]);
    expect(vaultSyncHeld("notes"), "the waiting reload holds it").toBe(true);
    expect(getSyncStatus().status, "and says so (M1)").toBe("off");
    // The input goes; the reload runs, and the reloaded vault starts its sync.
    m.foreignInput = false;
    const deferred = m.deferred!;
    m.deferred = null;
    await until(h, deferred());
    await h.drain(() => runningOn().length > 0);
    expect(first.disposed).toBe(1);
    expect(vaultSyncHeld("notes")).toBe(false);
    expect(runningOn().map((w) => (w.runtime as Runtime).n)).toEqual([h.runtimes[h.runtimes.length - 1]!.n]);
    expect(h.violations).toEqual([]);
  });

  it("P2b: the same where the input begins during the reload's drain", async () => {
    expect.hasAssertions();
    const h = harness();
    const first = await openFirst(h);
    const step = withRuntimeStep({ vaultId: "notes", runtime: first as never }, {
      work: async (stop) => {
        await stop();
        // Input begins once the reload has left the runtime (its drain runs).
        void (async () => {
          for (let i = 0; i < 400 && h.api.screenState() !== "leaving"; i++) await tick();
          m.foreignInput = true;
        })();
      },
      reload: { own: "security-area" },
    }, { say: false }).then(() => "done", (e: Error) => e.name);
    await until(h, step);
    await h.drain(() => true);
    expect(first.disposed).toBe(0);
    expect(h.api.runtimeOnScreen()).toBe(first);
    expect(runningOn().filter((w) => w.runtime === first), "THE DEFECT (S2): the release starts the sync on the runtime the step changed").toEqual([]);
    expect(vaultSyncHeld("notes")).toBe(true);
    expect(getSyncStatus().status).toBe("off");
  });

  it("P3: a step whose work succeeds after a switch has ended reloads nothing — not the vault switched to", async () => {
    expect.hasAssertions();
    const h = harness();
    const first = await openFirst(h);
    let finish!: () => void;
    const finishing = new Promise<void>((r) => (finish = r));
    const step = withRuntimeStep({ vaultId: "notes", runtime: first as never }, {
      work: async (stop) => { await stop(); await finishing; return true; },
      reload: { own: "security-area" },
    }, { say: false }).then(() => "done", (e: Error) => e.name);
    await h.drain(() => true);
    await until(h, h.api.switchVault("work"));
    await h.drain(() => runningOn().some((w) => (w.runtime as Runtime).vaultId === "work"));
    const other = h.runtimes.find((r) => r.vaultId === "work")!;
    finish();
    await until(h, step);
    await h.drain(() => true);
    // THE DEFECT (S3): the step of `notes` closed and reopened `work`.
    expect(other.disposed).toBe(0);
    expect(h.runtimes.filter((r) => r.vaultId === "work")).toHaveLength(1);
    // Its work landed before `notes` closed — a write after the close fails — and `notes` opens in its new state the
    // next time: the step finished, and says so (`docs/engineering/Screen_Runtime_Transitions.md`, "A step on the runtime").
    expect(await step).toBe("done");
    expect(runningOn().map((w) => w.runtime)).toEqual([other]);
    expect(h.violations).toEqual([]);
  });

  it("P4 (M1): while a step holds the sync, after away and back, the status says the sync is paused", async () => {
    expect.hasAssertions();
    const h = harness();
    const first = await openFirst(h);
    let end!: () => void;
    const ends = new Promise<void>((r) => (end = r));
    const step = withRuntimeStep({ vaultId: "notes", runtime: first as never }, { work: async (stop) => { await stop(); await ends; } }, { say: false }).catch(() => undefined);
    await h.drain(() => true);
    expect(getSyncStatus().status, "held from the step's stop on").toBe("off");
    await until(h, h.api.switchVault("work"));
    await h.drain(() => runningOn().some((w) => (w.runtime as Runtime).vaultId === "work"));
    await until(h, h.api.switchVault("notes"));
    await h.drain(() => h.api.runtimeOnScreen()?.vaultId === "notes");
    await h.drain(() => true);
    expect(runningOn()).toEqual([]);
    // THE DEFECT (M1): the status said the other vault's last state ("idle").
    expect(getSyncStatus().status).toBe("off");
    end();
    await until(h, step);
    await h.drain(() => runningOn().length > 0);
    expect(runningOn().map((w) => (w.runtime as Runtime).vaultId)).toEqual(["notes"]);
  });

  it("P5b (S4): a save pending for another vault never holds a switch up; a failing save of the vault itself refuses the switch and leaves it open, its sync running", async () => {
    expect.hasAssertions();
    const { createSaveCoordinator } = await import("@plainva/ui");
    const h = harness();
    const first = await openFirst(h);
    // The phone's saver keys by the vault (`noteSaver`): a save of `travel` whose folder is out of reach stays pending.
    const fails = new Set(["travel"]);
    const saver = createSaveCoordinator<{ vaultId: string }>({
      contextKey: (v) => v.vaultId, debounceMs: 1, retryBaseMs: 1_000_000, maxRetryDelayMs: 1_000_000,
      write: async (v) => { if (fails.has(v.vaultId)) throw Object.assign(new Error("the folder is out of reach"), { name: "VaultUnreachableError" }); },
    });
    m.saver = saver as never;
    saver.schedule({ vaultId: "travel" }, "t.md", "pending elsewhere");
    await new Promise((r) => setTimeout(r, 20));
    expect(saver.pendingPaths()).toEqual(["t.md"]);
    const sw = h.api.switchVault("work").then(() => "switched", (e: Error) => e.message);
    await until(h, sw);
    expect(await sw, "THE DEFECT (S4): a pending save of another vault refused the switch").toBe("switched");
    expect(m.active).toBe("work");
    // The vault's own failing save: the switch does not happen, and the vault stays open with its sync (S1's cell).
    await h.drain(() => h.api.runtimeOnScreen()?.vaultId === "work");
    const work = h.api.runtimeOnScreen()!;
    fails.add("work");
    saver.schedule({ vaultId: "work" }, "w.md", "typed");
    const back = h.api.switchVault("notes").then(() => "switched", (e: Error) => e.message);
    await until(h, back);
    await h.drain(() => runningOn().length > 0);
    expect(await back).toBe("the folder is out of reach");
    expect(m.active).toBe("work");
    expect(h.api.runtimeOnScreen()).toBe(work);
    expect(runningOn().map((w) => w.runtime)).toEqual([work]);
    expect(first.disposed).toBe(1);
    expect(h.violations).toEqual([]);
  });

  it("M2: a delete removes nothing while a step on the vault still runs — and waits for it, its removal held", async () => {
    expect.hasAssertions();
    const h = harness();
    const first = await openFirst(h);
    let end!: () => void;
    const ends = new Promise<void>((r) => (end = r));
    const step = withRuntimeStep({ vaultId: "notes", runtime: first as never }, { work: (stop) => body("notes", async () => { await stop(); await ends; }) }, { say: false }).catch(() => undefined);
    await h.drain(() => true);
    let deleted = false;
    const deleting = h.api.deleteVault("notes").then(() => { deleted = true; });
    await h.drain(() => m.active === "local" && h.api.runtimeOnScreen()?.vaultId === "local");
    await h.drain(() => true);
    // THE DEFECT (M2): the container, the index and the keys went while the step's body could still reach them.
    expect(deleted, "the removal waits for the step").toBe(false);
    end();
    await until(h, Promise.all([step, deleting]));
    expect(deleted).toBe(true);
    expect(h.violations).toEqual([]);
  });

  it("H1: a runtime comes back on screen only from `leaving`, and only where it was open when the turn left it", () => {
    expect.hasAssertions();
    const frame = source.slice(source.indexOf("function screenTransition<T>"), source.indexOf("\n}\n", source.indexOf("function screenTransition<T>")));
    expect(frame).toContain("if (!current || current !== wasOpen || gone || settled?.calledOff) return leaveForGood();");
    const back = source.slice(source.indexOf("function backOnScreen("), source.indexOf("\n}\n", source.indexOf("function backOnScreen(")));
    expect(back).toContain('if (screen.state !== "leaving") return;');
  });
});

describe("review B2, round 7 — a save against a called-off runtime (P5)", () => {
  it("ends at once, and no later flushAll of the vault — or of another — is refused by it", async () => {
    expect.hasAssertions();
    const { createSaveCoordinator, isSaveFailureFinal } = await import("@plainva/ui");
    const { CalledOffError } = await import("@plainva/core");
    const saver = createSaveCoordinator<{ vaultId: string; calledOff: boolean }>({
      contextKey: (v) => v.vaultId,
      debounceMs: 1, retryBaseMs: 1, maxRetryDelayMs: 2,
      write: async (v) => { if (v.calledOff) throw new CalledOffError("write"); },
    });
    // A keystroke on the note of the runtime the close called off (the editor stays mounted until the switch event).
    saver.schedule({ vaultId: "notes", calledOff: true }, "a.md", "typed in the last moment");
    await new Promise((r) => setTimeout(r, 200));
    const results: string[] = [];
    for (let i = 0; i < 3; i++) results.push(await saver.flushAll({ vaultId: "notes", calledOff: false }).then(() => "ok", (e: Error) => e.name));
    saver.schedule({ vaultId: "work", calledOff: false }, "b.md", "fine");
    results.push(await saver.flushAll().then(() => "ok", (e: Error) => e.name));
    expect(isSaveFailureFinal(new CalledOffError("write")), "a write the fence refused for good is final").toBe(true);
    expect(isSaveFailureFinal("write: the vault's runtime was called off"), "also as a client window hears it").toBe(true);
    expect(results).toEqual(["ok", "ok", "ok", "ok"]);
    expect(saver.pendingPaths()).toEqual([]);
  });
});

describe("the guard of the queue and of its one frame", () => {
  // Inside `fn` (a body handed to it, or a function declaration of that name), or in a function every caller of
  // which is — except `getMobileVault`, the start (`opening`) and its answer (`open`, `none`).
  const within = (frames: readonly string[]) => {
    const inside = (node: ts.Node, seen = new Set<string>()): boolean => {
      for (let at: ts.Node | undefined = node.parent; at; at = at.parent) {
        if ((ts.isArrowFunction(at) || ts.isFunctionExpression(at)) && ts.isCallExpression(at.parent) && frames.includes(at.parent.expression.getText(file))) return true;
        if (ts.isFunctionDeclaration(at) && at.name) {
          const name = at.name.text;
          if (name === "getMobileVault" || frames.includes(name)) return true;
          if (seen.has(name)) return true;
          seen.add(name);
          const calls: ts.Node[] = [];
          const visit = (n: ts.Node) => {
            if (ts.isCallExpression(n) && n.expression.getText(file) === name) calls.push(n);
            ts.forEachChild(n, visit);
          };
          visit(file);
          return calls.length > 0 && calls.every((call) => inside(call, seen));
        }
      }
      return false;
    };
    return inside;
  };
  const places = (match: (n: ts.Node, text: string) => boolean, inside: (n: ts.Node) => boolean): string[] => {
    const found: string[] = [];
    const visit = (n: ts.Node) => {
      const text = n.getText(file);
      if (match(n, text) && !inside(n)) found.push(`${text.slice(0, 60)} at line ${file.getLineAndCharacterOfPosition(n.getStart(file)).line + 1}`);
      ts.forEachChild(n, visit);
    };
    visit(file);
    return found;
  };

  it("keeps every write of the screen's state, and every way into and out of `leaving`, inside the one frame (`screenTransition`)", () => {
    expect.hasAssertions();
    // By its form, not by the care of each transition (review B2, round 7): a transition reaches the state only
    // through its turn (`turn.leave`, `stay`, `leaveVault`, `clear`), and the frame ends every turn that threw.
    const assigns = (n: ts.Node) => ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken && ["bootPromise", "screen", "screenBoot"].includes(n.left.getText(file));
    const calls = (n: ts.Node) => ts.isCallExpression(n) && ["retireBoot", "leaveVault", "leaveScreen", "backOnScreen", "clearScreen", "bootAbort.abort", "bootAbort?.abort"].includes(n.expression.getText(file));
    expect(places((n) => assigns(n) || calls(n), within(["screenTransition"]))).toEqual([]);
    // The event that begins the next start: sent by a transition in its turn.
    expect(places((n, text) => ts.isNewExpression(n) && n.expression.getText(file) === "CustomEvent" && /"m-vault-switched"/.test(text), within(["screenTransition"]))).toEqual([]);
    // Every turn of the frame is a turn of the queue, and the frame's catch ends what the turn left.
    const frame = source.slice(source.indexOf("function screenTransition<T>"), source.indexOf("\n}\n", source.indexOf("function screenTransition<T>")));
    expect(frame).toMatch(/return inScreenTransitions\(async \(\) => \{/);
    expect(frame).toMatch(/catch \(error\) \{\n\s+if \(left && !over\) await turn\.stay\(\);\n\s+throw error;/);
    // The only other turns: an empty one to wait for those before it, and the removal of a deleted vault.
    const queued: string[] = [];
    const visit = (n: ts.Node) => {
      if (ts.isCallExpression(n) && n.expression.getText(file) === "inScreenTransitions") {
        let at: ts.Node | undefined = n.parent;
        while (at && !ts.isFunctionDeclaration(at)) at = at.parent;
        queued.push((at as ts.FunctionDeclaration | undefined)?.name?.text ?? "?");
      }
      ts.forEachChild(n, visit);
    };
    visit(file);
    expect(queued.sort()).toEqual(["deleteVault", "screenTransition", "transitionsSettled"]);
    // And no turn waits on the sync's start chain: its starts are begun, never awaited, inside a transition.
    expect(source).not.toMatch(/await startSyncIfConfigured\(/);
  });
});
