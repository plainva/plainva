// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { closeWaitNoteName, parkClosingSyncPlace, waitForClosingVault, toast, waitWithDeadline } from "@plainva/ui";
import { vaultEntryName } from "./vaultEntryName";
import { retiredBoot } from "./bootRetirement";

/**
 * The transitions that leave or replace the runtime on screen — a switch, a
 * step's renew after its sync gave up, a reload, an index rebuild — run one
 * after the other (`inScreenTransitions`, review B2 round 5). Each checks at
 * its turn the start it was called for, and does nothing where that is no
 * longer on screen.
 *
 * Proven the one way that covers the class, not one race after the other:
 * for every pair of transitions, in both orders, the second starts at every
 * wait of the first. The functions are lifted out of `vaultService.ts` as
 * written; the boot is the module's own wait for a vault still closing
 * (`closingAt`), then a stand-in runtime. Every wait of a stand-in can be
 * held. After both are through, always the same four things hold:
 *
 * 1. never two open runtimes at one vault;
 * 2. every runtime that opened and is not on screen was closed exactly once;
 * 3. a step goes on only with the instance on screen;
 * 4. the runtime on screen belongs to the active vault entry.
 */

const source = readFileSync(resolve("src/services/vaultService.ts"), "utf8");
const file = ts.createSourceFile("vaultService.ts", source, ts.ScriptTarget.Latest, true);
const NAMES = ["getMobileVault", "runtimeOnScreen", "retireBoot", "retiredStart", "inScreenTransitions", "switchVault", "switchTo", "closingKeys", "closingAt",
  "settleBeforeClosing", "leaveVault", "renewAfterSyncGaveUp", "resumeOnScreen", "reloadActiveMobileVault", "offerReload", "rebuildOpenMobileIndexDatabase", "rebuildOpenIndexDatabaseOf"];
const parts: string[] = [];
ts.forEachChild(file, (node) => {
  if (ts.isFunctionDeclaration(node) && node.name && NAMES.includes(node.name.text)) parts.push(node.getText(file).replace(/^export /, ""));
});
const compiled = ts.transpileModule(
  "let bootPromise = null; let bootSettled = false; let bootAbort = null; let bootEntry = null; let screenBoot = null; let previousVaultId = null; let switching = null;\n" +
    "let screenTransitions = Promise.resolve(); const ABANDON_BOOT_AFTER_MS = 20; const closingVaults = new Map(); const RELOAD_STEP = 'vault-reload';\n" +
    // The module's boot, cut to what this is about: the wait for a runtime of the vault still closing (text 7), then the runtime.
    "async function boot(entry, signal) { await waitForClosingVault(closingAt(entry.id, entry.external), '', { signal }); if (signal?.aborted) throw retiredStart(); return openRuntime(entry, signal); }\n" +
    parts.join("\n") +
    "\nreturn { getMobileVault, switchVault, renewAfterSyncGaveUp, reloadActiveMobileVault, rebuildOpenMobileIndexDatabase, runtimeOnScreen: typeof runtimeOnScreen === 'function' ? runtimeOnScreen : () => null };",
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } },
).outputText;

type Runtime = { vaultId: string; n: number; disposed: number; db: object; isEncryptedWorkspace: false; external: null;
  dispose(): Promise<void>; callOff(): void; ended(): Promise<void>; flushOwed(): Promise<void> };
type Api = {
  getMobileVault(): Promise<Runtime>;
  switchVault(id: string): Promise<void>;
  renewAfterSyncGaveUp(left: { drain: Promise<void>; place: null; runtime: Runtime; vault: string; notRun: () => Error }): Promise<Runtime>;
  reloadActiveMobileVault(): Promise<boolean>;
  rebuildOpenMobileIndexDatabase(): Promise<boolean>;
  runtimeOnScreen(): Runtime | null;
};

const tick = () => new Promise((r) => setTimeout(r, 0));

/** The module with every wait of its stand-ins held until the driver lets it go. */
function harness(opts: { failBoot?: (id: string, n: number) => boolean; startSync?: (v: Runtime) => Promise<void>; failSetActive?: boolean } = {}) {
  let active = "notes";
  let n = 0;
  const runtimes: Runtime[] = [];
  const violations: string[] = [];
  const held: Array<() => void> = [];
  let hits = 0;
  let onHit: ((count: number) => void) | null = null;
  /** One wait of a stand-in: held until released, counted. */
  const wait = () => new Promise<void>((go) => {
    hits += 1;
    held.push(go);
    onHit?.(hits);
  });
  const notRun = () => Object.assign(new Error("not run"), { name: "StepNotRunError" });
  let api: Api;
  const deps = {
    retiredBoot,
    waitWithDeadline, waitForClosingVault, parkClosingSyncPlace, vaultEntryName, closeWaitNoteName, toast,
    noteSaver: { flushAll: () => wait(), pendingPaths: () => [] },
    flushDraftsBeforeClosing: () => wait(),
    getVaultEntry: async () => { await wait(); return { name: "" }; },
    reportingTo: () => () => {},
    detachSync: () => ({ drain: () => wait(), place: null, running: true }),
    setActiveVault: async (id: string) => { await wait(); if (opts.failSetActive) throw new Error("registry unwritable"); active = id; },
    reloadMobileSettingsForActiveVault: () => wait(),
    getActiveVaultEntry: async () => { await wait(); return { id: active, name: "" }; },
    startSyncIfConfigured: (v: Runtime) => opts.startSync?.(v) ?? Promise.resolve(),
    foreignInputArmed: () => false,
    armedLeaveGuards: () => [],
    takeScreen: () => {},
    setAsideMobileIndexDatabase: async () => { await wait(); return true; },
    LOCAL_VAULT_ID: "local",
    i18n: { t: (k: string) => k },
    openRuntime: async (entry: { id: string }) => {
      await wait();
      const v: Runtime = {
        vaultId: entry.id, n: n++, disposed: 0, db: {}, isEncryptedWorkspace: false, external: null,
        dispose: async () => { v.disposed += 1; },
        callOff: () => {},
        // A runtime ends once it is closed (`MobileVault.ended`): the next start of the vault waits for that.
        ended: async () => { while (v.disposed === 0) await tick(); },
        flushOwed: async () => {},
      };
      if (opts.failBoot?.(entry.id, v.n)) throw new Error("the vault did not open");
      const open = runtimes.filter((r) => r.vaultId === entry.id && r.disposed === 0);
      if (open.length > 0) violations.push(`two runtimes at ${entry.id}: #${open.map((r) => r.n).join(",")} and #${v.n}`);
      runtimes.push(v);
      return v;
    },
    // The screens (`useVaultBoot`): every switch event opens the vault on screen at once.
    window: { dispatchEvent: () => { void api.getMobileVault().catch(() => {}); return true; } },
    CustomEvent: class { constructor(public type: string, public init?: unknown) {} },
    console: { error: () => {}, warn: () => {} },
  };
  api = new Function(...Object.keys(deps), compiled)(...Object.values(deps)) as Api;
  return {
    api, runtimes, violations, notRun,
    active: () => active,
    hits: () => hits,
    /** Calls `then` at the `count`-th wait, before that wait is let go. */
    at: (count: number, then: () => void) => {
      onHit = (now) => { if (now === count) { onHit = null; then(); } };
    },
    /** Lets every held wait go, one at a time, until `until` holds and nothing is held for a while; false where it never came. */
    drain: async (until: () => boolean): Promise<boolean> => {
      for (let quiet = 0; quiet < 200;) {
        const next = held.shift();
        if (next) { quiet = 0; next(); await tick(); continue; }
        await new Promise((r) => setTimeout(r, 2));
        quiet += 1;
        if (until() && quiet > 15) return true;
      }
      return false;
    },
  };
}

type Kind = "switch" | "renew" | "reload" | "rebuild";
const KINDS: Kind[] = ["switch", "renew", "reload", "rebuild"];

/** Begins a transition of `kind`; a step's renew is for the runtime it has — the one on screen, or the one it began on. */
function begin(h: ReturnType<typeof harness>, kind: Kind, first: Runtime, to: string): { done: Promise<unknown>; wentOnWith: () => Runtime | null; okAtEnd: () => boolean } {
  let wentOn: Runtime | null = null;
  let onScreenThen = true;
  const done = (() => {
    switch (kind) {
      case "switch": return h.api.switchVault(to);
      case "reload": return h.api.reloadActiveMobileVault();
      case "rebuild": return h.api.rebuildOpenMobileIndexDatabase();
      case "renew": {
        const runtime = h.api.runtimeOnScreen() ?? first;
        return h.api.renewAfterSyncGaveUp({ drain: Promise.resolve(), place: null, runtime, vault: "", notRun: h.notRun }).then((fresh) => {
          wentOn = fresh;
          // Read at the very moment the step would go on with it.
          onScreenThen = h.api.runtimeOnScreen() === fresh;
        });
      }
    }
  })();
  const settled = done.then(() => undefined, () => undefined);
  return { done: settled, wentOnWith: () => wentOn, okAtEnd: () => onScreenThen };
}

async function opened(h: ReturnType<typeof harness>): Promise<Runtime> {
  const first = h.api.getMobileVault();
  await h.drain(() => h.api.runtimeOnScreen() !== null);
  return first;
}

async function run(a: Kind, b: Kind, at: number | null): Promise<string[]> {
  const h = harness();
  const first = await opened(h);
  const base = h.hits();
  let second: ReturnType<typeof begin> | null = null;
  const startB = () => { second = begin(h, b, first, a === "switch" && b === "switch" ? "travel" : "work"); };
  if (at !== null) h.at(base + at, startB);
  const one = begin(h, a, first, "work");
  let done = false;
  void Promise.all([one.done, (async () => {
    for (let i = 0; at !== null && !second && i < 1000; i++) await tick();
    await (second as ReturnType<typeof begin> | null)?.done;
  })()]).then(() => { done = true; });
  const rested = await h.drain(() => done && h.api.runtimeOnScreen() !== null);
  const problems = [...h.violations];
  if (!second) problems.push("the second transition never began");
  if (!done) problems.push("the transitions never ended (they wait on each other)");
  if (!rested && done) problems.push("nothing is on screen at the end");
  const screen = h.api.runtimeOnScreen();
  for (const r of h.runtimes) {
    if (r === screen && r.disposed !== 0) problems.push(`the runtime on screen #${r.n} was closed`);
    if (r !== screen && r.disposed !== 1) problems.push(`runtime #${r.n} of ${r.vaultId}, not on screen, closed ${r.disposed}×`);
  }
  for (const t of [one, second as ReturnType<typeof begin> | null]) {
    if (t?.wentOnWith() && !t.okAtEnd()) problems.push(`a step went on with #${t.wentOnWith()!.n}, which was not on screen`);
  }
  if (!screen) problems.push("no runtime on screen");
  else if (screen.vaultId !== h.active()) problems.push(`on screen ${screen.vaultId}, active ${h.active()}`);
  return problems;
}

describe("the transitions of the runtime on screen (one queue)", () => {
  it("hold the four rules for every pair, in both orders, the second begun at every wait of the first", async () => {
    expect.hasAssertions();
    const failures: string[] = [];
    for (const a of KINDS) {
      // How many waits the first has on its own (its boot after it included).
      const alone = harness();
      await opened(alone);
      const base = alone.hits();
      const solo = begin(alone, a, alone.runtimes[0]!, "work");
      let soloDone = false;
      void solo.done.then(() => { soloDone = true; });
      await alone.drain(() => soloDone && alone.api.runtimeOnScreen() !== null);
      const waits = alone.hits() - base;
      for (const b of KINDS) {
        for (let at = 1; at <= waits; at++) {
          for (const problem of await run(a, b, at)) failures.push(`${a} then ${b} at wait ${at}: ${problem}`);
        }
      }
    }
    expect(failures).toEqual([]);
  }, 120_000);

  it("a step's renew whose runtime a switch left before its turn opens nothing and says the step did not run", async () => {
    expect.hasAssertions();
    const h = harness();
    const first = await opened(h);
    const switching = h.api.switchVault("work");
    const renew = h.api.renewAfterSyncGaveUp({ drain: Promise.resolve(), place: null, runtime: first, vault: "", notRun: h.notRun }).then(() => "went on", (e: Error) => e.name);
    let done = false;
    void Promise.all([switching, renew]).then(() => { done = true; });
    await h.drain(() => done && h.api.runtimeOnScreen() !== null);
    expect(await renew).toBe("StepNotRunError");
    expect(h.runtimes.map((r) => r.vaultId), "the renew opened nothing: notes, then work").toEqual(["notes", "work"]);
  });

  it("a reload for a start that a switch replaced before its turn reloads nothing", async () => {
    expect.hasAssertions();
    const h = harness();
    await opened(h);
    const switching = h.api.switchVault("work");
    const reload = h.api.reloadActiveMobileVault();
    let done = false;
    void Promise.all([switching, reload]).then(() => { done = true; });
    await h.drain(() => done && h.api.runtimeOnScreen() !== null);
    expect(await reload).toBe(false);
    expect(h.runtimes.map((r) => r.vaultId)).toEqual(["notes", "work"]);
  });

  it("knows no runtime on screen where the start after it failed: the one before is closed and gone", async () => {
    expect.hasAssertions();
    // The reload's start of the vault does not open: what is on screen is nothing, not the runtime the reload closed.
    const h = harness({ failBoot: (_id, n) => n === 1 });
    const first = await opened(h);
    const reload = h.api.reloadActiveMobileVault();
    let done = false;
    void reload.then(() => { done = true; });
    await h.drain(() => done);
    expect(first.disposed).toBe(1);
    expect(h.api.runtimeOnScreen()).toBeNull();
  });

  it("never waits on the sync's start chain inside a transition: a failed switch that starts the sync again lets the renew behind it run", async () => {
    expect.hasAssertions();
    // The start chain holds a step (as `changeRemoteFolder` does) whose renew waits in the queue behind the switch:
    // the switch's resume of the sync waits on that chain. Waited for, the two would wait on each other for good.
    let renewDone!: () => void;
    const chainFree = new Promise<void>((r) => (renewDone = r));
    const h = harness({ failSetActive: true, startSync: () => chainFree });
    const first = await opened(h);
    const switching = h.api.switchVault("work").then(() => "switched", (e: Error) => e.message);
    const renew = h.api.renewAfterSyncGaveUp({ drain: Promise.resolve(), place: null, runtime: first, vault: "", notRun: h.notRun })
      .then(() => "went on", (e: Error) => e.name).finally(() => renewDone());
    let done = false;
    void Promise.all([switching, renew]).then(() => { done = true; });
    await h.drain(() => done);
    expect(await switching).toBe("registry unwritable");
    expect(["went on", "StepNotRunError"]).toContain(await renew);
  });

  it("keeps `bootPromise = null` and `retireBoot(` inside the queue: every place that writes them runs as a transition's turn", () => {
    expect.hasAssertions();
    // Each occurrence lies in a body handed to `inScreenTransitions`, or in a function every caller of which does.
    const named = new Map<string, ts.FunctionDeclaration>();
    ts.forEachChild(file, (node) => { if (ts.isFunctionDeclaration(node) && node.name) named.set(node.name.text, node); });
    const inQueue = (node: ts.Node, seen = new Set<string>()): boolean => {
      for (let at: ts.Node | undefined = node.parent; at; at = at.parent) {
        if ((ts.isArrowFunction(at) || ts.isFunctionExpression(at)) && ts.isCallExpression(at.parent) && at.parent.expression.getText(file) === "inScreenTransitions") return true;
        if (ts.isFunctionDeclaration(at) && at.name) {
          const name = at.name.text;
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
      const write = ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken && n.left.getText(file) === "bootPromise" && n.right.getText(file) === "null";
      const retire = ts.isCallExpression(n) && n.expression.getText(file) === "retireBoot";
      if ((write || retire) && !inQueue(n)) places.push(`${text} at line ${file.getLineAndCharacterOfPosition(n.getStart(file)).line + 1}`);
      ts.forEachChild(n, visit);
    };
    visit(file);
    expect(places).toEqual([]);
    // And no turn waits on the sync's start chain: its starts are begun, never awaited, inside a transition.
    expect(source).not.toMatch(/await startSyncIfConfigured\(/);
  });
});
