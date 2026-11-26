// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { closeWaitNoteName, parkClosingSyncPlace, toast, waitForClosingVault, type CloudAccountRecord } from "@plainva/ui";
import { vaultEntryName } from "./vaultEntryName";
import { retiredBoot } from "./bootRetirement";

/**
 * The transitions of the phone's runtime on screen and the sync that runs on
 * it, together (review B2, rounds 5 and 6). The transitions are lifted out of
 * `vaultService.ts` as written; the sync is the real `syncService` with fake
 * workers. Every wait of the stand-ins can be held: the registry, the drafts,
 * the saves, a worker's drain, the close's deadline, the 2 s a retired start
 * is given, the boot at four points, and the screens' start of the sync after
 * a boot.
 *
 * For every pair of participants — a switch, a step on the runtime (its sync
 * stopped within the deadline, or the deadline given up and the vault opened
 * anew), a reload, an index rebuild, a restart of the sync, a step on the
 * vault's sign-ins — in both orders, with the deadline kept and with it able
 * to run out, the second begins at every wait of the first.
 *
 * The measure is the model's own book, never `runtimeOnScreen()`: which start
 * was retired (its signal), which runtime a close began to leave (its settle,
 * its `leaveVault`), which was closed (`dispose`). Against it always the same:
 *
 * 1. never two open runtimes at one vault;
 * 2. every runtime that opened and is not on screen at the end was closed
 *    exactly once, and the one on screen not at all;
 * 3. a step goes on only with a runtime the book has open on screen;
 * 4. the runtime on screen belongs to the active vault entry;
 * 5. no worker is built for a runtime the book has retired, left or closed,
 *    and at the end exactly one runs, for the runtime on screen;
 * 6. everything comes to an end.
 */

type Runtime = {
  vaultId: string; n: number; disposed: number; retired: boolean; leaving: boolean; external: null; db: object; isEncryptedWorkspace: false;
  dispose(): Promise<void>; callOff(): void; ended(): Promise<void>; flushOwed(): Promise<void>; enableSyncEnqueue(): void;
  [key: string]: unknown;
};
type Api = {
  getMobileVault(): Promise<Runtime>;
  switchVault(id: string): Promise<void>;
  renewAfterSyncGaveUp(left: unknown): Promise<Runtime>;
  reloadActiveMobileVault(): Promise<boolean>;
  rebuildOpenMobileIndexDatabase(): Promise<boolean>;
  runtimeOnScreen(): Runtime | null;
};

const m = vi.hoisted(() => ({
  api: null as null | {
    getMobileVault(): Promise<unknown>; switchVault(id: string): Promise<void>; renewAfterSyncGaveUp(left: unknown): Promise<unknown>; runtimeOnScreen(): unknown;
  },
  /** One wait of a stand-in: held until the driver lets it go. */
  wait: (async () => {}) as (label: string) => Promise<void>,
  /** Whether the close's deadline can run out in this run (`waitWithDeadline`). */
  deadlineGivesUp: false,
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
}));
vi.mock("./flowVault", () => ({ enterMadeVault: async () => undefined }));
vi.mock("./mobileSettingsSync", () => ({ mobileSyncDeviceId: async () => "phone", prepareMobileSettingsSync: async (_v: unknown, _p: unknown, raw: unknown) => ({ target: raw, runner: { run: async () => undefined } }) }));
vi.mock("./mobileWorkspaceSecurity", () => ({ loadMobilePublicationRuntime: async () => null, getMobileWorkspaceStatus: async () => null }));
vi.mock("../adapters/webdavHttp", () => ({ webdavFetch: vi.fn(), allowHttpOrigin: vi.fn() }));
vi.mock("../adapters/syncUpload", () => ({ createContentRefResolver: () => ({}), mobileSyncUploader: {} }));

import { detachSync, restartSyncIfActive, startSyncAfterBoot, startSyncIfConfigured, withRuntimeStep, withVaultSyncStopped } from "./syncService";
import { waitWithDeadline } from "@plainva/ui";

const source = readFileSync(resolve("src/services/vaultService.ts"), "utf8");
const file = ts.createSourceFile("vaultService.ts", source, ts.ScriptTarget.Latest, true);
const NAMES = ["getMobileVault", "runtimeOnScreen", "leaveScreen", "clearScreen", "retireBoot", "retiredStart", "inScreenTransitions", "switchVault", "switchTo", "closingKeys", "closingAt",
  "settleBeforeClosing", "leaveVault", "renewAfterSyncGaveUp", "resumeOnScreen", "reloadActiveMobileVault", "offerReload", "rebuildOpenMobileIndexDatabase", "rebuildOpenIndexDatabaseOf"];
const parts: string[] = [];
ts.forEachChild(file, (node) => {
  if (ts.isFunctionDeclaration(node) && node.name && NAMES.includes(node.name.text)) parts.push(node.getText(file).replace(/^export /, ""));
});
const compiled = ts.transpileModule(
  "let bootPromise = null; let bootSettled = false; let bootAbort = null; let bootEntry = null; let screen = { state: 'none', of: null, runtime: null }; let screenBoot = null;\n" +
    "let previousVaultId = null; let switching = null; let screenTransitions = Promise.resolve(); const ABANDON_BOOT_AFTER_MS = 2000; const closingVaults = new Map(); const RELOAD_STEP = 'vault-reload';\n" +
    // The module's boot, cut to its waits: before and in the wait for a runtime of the vault still closing (text 7),
    // after the check that the start was not retired, and before it answers.
    "async function boot(entry, signal) { await wait('boot: before the close'); await waitForClosingVault(wait('boot: in the close').then(() => closingAt(entry.id, entry.external)), '', { signal }); if (signal?.aborted) throw retiredStart(); await wait('boot: opening'); return openRuntime(entry, signal); }\n" +
    parts.join("\n") +
    // The book: a close that begins (its settle, its leave) marks the runtime it leaves.
    "\nconst settleAsWritten = settleBeforeClosing; settleBeforeClosing = (current) => { book.leaving(current); return settleAsWritten(current); };" +
    "\nconst leaveAsWritten = leaveVault; leaveVault = (current, settled) => { book.leaving(current); return leaveAsWritten(current, settled); };" +
    "\nreturn { getMobileVault, switchVault, renewAfterSyncGaveUp, reloadActiveMobileVault, rebuildOpenMobileIndexDatabase, runtimeOnScreen };",
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } },
).outputText;

// One turn of the event loop, the quick way (`setImmediate`): the model waits hundreds of them per run.
const tick = () => new Promise<void>((r) => (typeof setImmediate === "function" ? setImmediate(r) : setTimeout(r, 0)));

function harness() {
  m.active = "notes";
  m.workers.length = 0;
  let n = 0;
  const runtimes: Runtime[] = [];
  const violations: string[] = [];
  const held: Array<{ label: string; go: () => void }> = [];
  let hits = 0;
  let onHit: ((count: number) => void) | null = null;
  m.wait = (label) => new Promise<void>((go) => {
    hits += 1;
    held.push({ label, go });
    onHit?.(hits);
  });
  const book = {
    leaving: (r: Runtime | null) => { if (r) r.leaving = true; },
    /** Open on screen by the book: the latest runtime that opened, while nothing retired, left or closed it. */
    onScreen: (): Runtime | null => {
      const last = runtimes[runtimes.length - 1];
      return last && !last.retired && !last.leaving && last.disposed === 0 ? last : null;
    },
  };
  // eslint-disable-next-line prefer-const
  let api: Api;
  const opened = () => {
    void api.getMobileVault().then(async (v) => {
      await m.wait("the screens' start after the boot");
      await startSyncAfterBoot(v as never);
    }, () => {});
  };
  const deps = {
    // The 2 s a retired start is given end at a held wait: the start answers before it, or is closed late.
    retiredBoot: (pending: Promise<Runtime>, settled: boolean, callOff: () => void, _ms: number, leaving: (left: Promise<Runtime>) => void) => {
      if (settled) return retiredBoot(pending, settled, callOff, 0, leaving);
      callOff();
      return m.wait("2 s for a retired start").then(() => retiredBoot(pending, settled, () => {}, 0, leaving));
    },
    waitWithDeadline, waitForClosingVault, parkClosingSyncPlace, vaultEntryName, closeWaitNoteName, toast, book,
    wait: (label: string) => m.wait(label),
    noteSaver: { flushAll: () => m.wait("saves"), pendingPaths: () => [] },
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
    foreignInputArmed: () => m.foreignInput,
    armedLeaveGuards: () => [],
    takeScreen: () => {},
    setAsideMobileIndexDatabase: async () => { await m.wait("set aside"); return true; },
    LOCAL_VAULT_ID: "local",
    i18n: { t: (k: string) => k },
    openRuntime: async (entry: { id: string }, signal?: AbortSignal) => {
      const v = {
        vaultId: entry.id, n: n++, disposed: 0, retired: !!signal?.aborted, leaving: false, external: null, db: {}, isEncryptedWorkspace: false,
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
    }
  };
  return {
    api, runtimes, violations, book, opened,
    hits: () => hits,
    at: (count: number, then: () => void) => { onHit = (now) => { if (now === count) { onHit = null; then(); } }; },
    /** Lets every held wait go, one at a time, until `until` holds and nothing is held for a while; false where it never came. */
    drain: async (until: () => boolean): Promise<boolean> => {
      for (let quiet = 0; quiet < 40;) {
        watchBuilt();
        // Where the deadline can run out, it does: its wait goes first, before the work it races (the drain).
        const first = m.deadlineGivesUp ? held.findIndex((w) => w.label === "deadline") : -1;
        const next = first >= 0 ? held.splice(first, 1)[0] : held.shift();
        if (next) { quiet = 0; next.go(); await tick(); continue; }
        await tick();
        quiet += 1;
        if (until() && quiet > 4) { watchBuilt(); return true; }
      }
      watchBuilt();
      return false;
    },
  };
}
type H = ReturnType<typeof harness>;

type Kind = "switch" | "step" | "reload" | "rebuild" | "restart" | "sign-in";
const KINDS: Kind[] = ["switch", "step", "reload", "rebuild", "restart", "sign-in"];

/** Begins a participant; a step is for the runtime it has — the one on screen then, or the one it began on. */
function begin(h: H, kind: Kind, first: Runtime, to: string): { done: Promise<unknown>; problems: string[] } {
  const problems: string[] = [];
  const done = (() => {
    switch (kind) {
      case "switch": return h.api.switchVault(to);
      case "reload": return h.api.reloadActiveMobileVault();
      case "rebuild": return h.api.rebuildOpenMobileIndexDatabase();
      case "restart": return restartSyncIfActive(m.active);
      case "sign-in": return withVaultSyncStopped(m.active, () => m.wait("the sign-in's write"));
      case "step": {
        const runtime = h.api.runtimeOnScreen() ?? first;
        return withRuntimeStep({ vaultId: runtime.vaultId, runtime: runtime as never }, {
          work: async (stop) => {
            const on = (await stop()) as unknown as Runtime;
            // Read at the very moment the step goes on with it.
            if (h.book.onScreen() !== on) problems.push(`a step went on with #${on.n}, which the book had not open on screen`);
            await m.wait("the step's work");
          },
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

async function run(a: Kind, b: Kind | null, at: number | null): Promise<string[]> {
  const h = harness();
  const first = await openFirst(h);
  const base = h.hits();
  let second: ReturnType<typeof begin> | null = null;
  if (b && at !== null) h.at(base + at, () => { second = begin(h, b, first, a === "switch" && b === "switch" ? "travel" : "work"); });
  const one = begin(h, a, first, "work");
  let done = false;
  void Promise.all([one.done, (async () => {
    for (let i = 0; b && !second && i < 400; i++) await tick();
    await (second as ReturnType<typeof begin> | null)?.done;
  })()]).then(() => { done = true; });
  const rested = await h.drain(() => done);
  const problems = [...h.violations, ...one.problems, ...((second as ReturnType<typeof begin> | null)?.problems ?? [])];
  if (b && !second) problems.push("the second never began");
  if (!done || !rested) problems.push("the participants never came to an end");
  const screen = h.book.onScreen();
  for (const r of h.runtimes) {
    if (r === screen && r.disposed !== 0) problems.push(`the runtime on screen #${r.n} was closed`);
    if (r !== screen && r.disposed !== 1) problems.push(`runtime #${r.n} of ${r.vaultId}, not on screen, closed ${r.disposed}×`);
  }
  if (!screen) problems.push("nothing on screen at the end");
  else if (screen.vaultId !== m.active) problems.push(`on screen ${screen.vaultId}, active ${m.active}`);
  const runningWorkers = m.workers.filter((w) => w.running);
  if (runningWorkers.length !== 1 || runningWorkers[0]!.runtime !== screen) {
    problems.push(`at the end ${runningWorkers.length} worker(s) run, for #${runningWorkers.map((w) => (w.runtime as Runtime | null)?.n).join(",")}; on screen #${screen?.n}`);
  }
  return problems;
}

/** Between runs: nothing held any more, and what the last run left of the sync drained. */
async function settleSync(): Promise<void> {
  m.wait = async () => {};
  await detachSync().drain();
}

afterEach(async () => {
  m.deadlineGivesUp = false;
  m.foreignInput = false;
  m.failActive = false;
  m.failOpen = null;
  m.wait = async () => {};
  await detachSync().drain();
});

describe("the runtime on screen and its sync, every participant against every other", () => {
  for (const gives of [false, true]) {
    for (const a of KINDS) {
      it(`hold the six rules with ${a} first and every participant second, begun at every wait of it (the deadline ${gives ? "can run out" : "kept"})`, async () => {
        expect.hasAssertions();
        const failures: string[] = [];
        m.deadlineGivesUp = gives;
        // How many waits the first has on its own.
        const alone = harness();
        await openFirst(alone);
        const base = alone.hits();
        const solo = begin(alone, a, alone.runtimes[0]!, "work");
        let soloDone = false;
        void solo.done.then(() => { soloDone = true; });
        await alone.drain(() => soloDone);
        const waits = alone.hits() - base;
        expect(waits, "the first has waits of its own").toBeGreaterThan(0);
        await settleSync();
        for (const problem of await run(a, null, null)) failures.push(`${a} alone: ${problem}`);
        await settleSync();
        for (const b of KINDS) {
          for (let at = 1; at <= waits; at++) {
            for (const problem of await run(a, b, at)) failures.push(`${a} then ${b} at wait ${at}: ${problem}`);
            await settleSync();
          }
        }
        expect(failures.slice(0, 30)).toEqual([]);
      }, 300_000);
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

describe("the guard of the queue", () => {
  it("keeps every write of the screen's state inside a transition's turn", () => {
    expect.hasAssertions();
    // Each write lies in a body handed to `inScreenTransitions`, or in a function every caller of which does — except
    // the start (`opening`) and its answer (`open`, `none`) in `getMobileVault`.
    const inQueue = (node: ts.Node, seen = new Set<string>()): boolean => {
      for (let at: ts.Node | undefined = node.parent; at; at = at.parent) {
        if ((ts.isArrowFunction(at) || ts.isFunctionExpression(at)) && ts.isCallExpression(at.parent) && at.parent.expression.getText(file) === "inScreenTransitions") return true;
        if (ts.isFunctionDeclaration(at) && at.name) {
          const name = at.name.text;
          if (name === "getMobileVault") return true;
          if (seen.has(name)) return true;
          seen.add(name);
          const calls: ts.Node[] = [];
          const visit = (n: ts.Node) => {
            if (ts.isCallExpression(n) && n.expression.getText(file) === name) calls.push(n);
            ts.forEachChild(n, visit);
          };
          visit(file);
          return calls.length > 0 && calls.every((call) => inQueue(call, seen));
        }
      }
      return false;
    };
    const places: string[] = [];
    const visit = (n: ts.Node) => {
      const text = n.getText(file);
      const assigns = ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken && ["bootPromise", "screen", "screenBoot"].includes(n.left.getText(file));
      const calls = ts.isCallExpression(n) && ["retireBoot", "leaveVault", "leaveScreen", "clearScreen", "bootAbort.abort", "bootAbort?.abort"].includes(n.expression.getText(file));
      const event = ts.isNewExpression(n) && n.expression.getText(file) === "CustomEvent" && /"m-vault-switched"/.test(text);
      if ((assigns || calls || event) && !inQueue(n)) places.push(`${text.slice(0, 60)} at line ${file.getLineAndCharacterOfPosition(n.getStart(file)).line + 1}`);
      ts.forEachChild(n, visit);
    };
    visit(file);
    expect(places).toEqual([]);
    // And no turn waits on the sync's start chain: its starts are begun, never awaited, inside a transition.
    expect(source).not.toMatch(/await startSyncIfConfigured\(/);
  });
});
