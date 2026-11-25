// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { closeWaitNoteName, closingAtSyncPlace, parkClosingSyncPlace, resetClosingSyncPlacesForTests, stepNotRun, syncStateBindingFor, type SyncStateBinding, waitForClosingVault, toast, toastStore, waitWithDeadline } from "@plainva/ui";
import { armLeaveGuard, armedLeaveGuards, disarmLeaveGuard, foreignInputArmed, resetLeaveGuard } from "./leaveGuard";
import { currentMobileDialog, dismissMobileDialog } from "./mobileDialogs";
import { resetScreenStepsForTest, takeScreen } from "./screenStep";
import type { MobileVault } from "./vaultService";
import { vaultEntryName } from "./vaultEntryName";
import i18n from "@plainva/ui/i18n";
import { retiredBoot } from "./bootRetirement";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createVaultCallOff, QueueingVaultAdapter, SyncQueue, VaultIndexer } from "@plainva/core";
import { LocalVaultAdapter } from "../../../../packages/core/src/vault/LocalVaultAdapter";
import { realSqlite } from "../../../../packages/core/test/helpers/realSqlite";

/**
 * The vault switch and the vault reload of the phone (finding 2026-10-22,
 * § 3.139 Nr. 2, 5 and 7), run as written: the functions are lifted out of
 * `vaultService.ts`; the sync, the registry and the settings are stand-ins.
 */

const source = readFileSync(resolve("src/services/vaultService.ts"), "utf8");
const file = ts.createSourceFile("vaultService.ts", source, ts.ScriptTarget.Latest, true);
const NAMES = ["inScreenTransitions", "switchVault", "switchTo", "settleBeforeClosing", "renewAfterSyncGaveUp", "leaveVault", "closingKeys", "closingAt", "resumeOnScreen", "retireBoot", "retiredStart", "runtimeOnScreen", "reloadActiveMobileVault", "offerReload"];
const parts: string[] = [];
ts.forEachChild(file, (node) => {
  if (ts.isFunctionDeclaration(node) && node.name && NAMES.includes(node.name.text)) parts.push(node.getText(file).replace(/^export /, ""));
});
// The helpers are named so that a run against an older vaultService.ts still loads (the red half of the evidence).
const found = parts.map((part) => /function (\w+)/.exec(part)?.[1]);
for (const name of ["switchVault", "retireBoot", "reloadActiveMobileVault"]) if (!found.includes(name)) throw new Error(`${name} missing`);
const compiled = ts.transpileModule(
  "let bootPromise = Promise.resolve(initial); let screenBoot = { of: bootPromise, vault: initial }; let bootSettled = true; let bootAbort = null; let bootEntry = null; let previousVaultId = null; let switching = null;\n" +
    "let screenTransitions = Promise.resolve(); const ABANDON_BOOT_AFTER_MS = 2000; const closingVaults = new Map(); const RELOAD_STEP = \"vault-reload\";\n" +
    parts.join("\n") +
    "\nreturn { switchVault, reloadActiveMobileVault, renewAfterSyncGaveUp, boot: () => bootPromise, setBoot: (p) => { bootPromise = p; bootSettled = true; void p.then((v) => { if (bootPromise === p) screenBoot = { of: p, vault: v }; }); } };",
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } },
).outputText;

const vault = (id: string) => ({ vaultId: id, callOff: vi.fn(), ended: vi.fn(async () => {}), flushOwed: vi.fn(async () => {}), dispose: vi.fn(async () => {}) }) as unknown as MobileVault & { dispose: ReturnType<typeof vi.fn>; callOff: ReturnType<typeof vi.fn> };

function harness(start: string, initial: MobileVault = vault(start)) {
  const openAnew = vi.fn(async (): Promise<MobileVault> => ({ ...vault(start), anew: true }) as unknown as MobileVault);
  let active = start;
  const events: Array<string | undefined> = [];
  const syncStarted: string[] = [];
  const order: string[] = [];
  const stopSyncAndDrain = vi.fn(async () => { order.push("stop"); });
  const deps = {
    // What `retireBoot` hands a running boot to (bootRetirement.ts), as in the module.
    retiredBoot,
    initial,
    noteSaver: { flushAll: vi.fn(async () => {}), pendingPaths: () => [] },
    // The close's deadline (`settleBeforeClosing`), as in the module; its notice and its draft flush are not what is asked here.
    waitWithDeadline, waitForClosingVault, parkClosingSyncPlace, vaultEntryName, closeWaitNoteName, flushDraftsBeforeClosing: async () => {}, getVaultEntry: async () => ({ name: "" }),
    reportingTo: () => () => {},
    stopSyncAndDrain,
    // The close takes the sync off at once and drains it after the saves (`detachSync`): here, the stand-in above.
    detachSync: vi.fn(() => { order.push("detach"); return { drain: () => stopSyncAndDrain(), place: null as SyncStateBinding | null, running: true }; }),
    setActiveVault: vi.fn(async (id: string) => { order.push(`active:${id}`); active = id; }),
    reloadMobileSettingsForActiveVault: vi.fn(async () => {}),
    // The vault opened anew after a step left it (`renewAfterSyncGaveUp`): its start is the one on screen once it answers.
    getMobileVault: (() => { const p = openAnew(); api.setBoot(p); return p; }),
    toast,
    getActiveVaultEntry: async () => ({ id: active, name: "" }),
    startSyncIfConfigured: vi.fn(async (v: MobileVault) => { syncStarted.push(v.vaultId); }),
    foreignInputArmed,
    armedLeaveGuards,
    takeScreen,
    i18n: { t: (key: string) => key },
    window: { dispatchEvent: (event: CustomEvent<{ id?: string }>) => { events.push(event.detail?.id); return true; } },
    CustomEvent,
    console: { error: () => {} },
  };
  let api: {
    switchVault(id: string): Promise<void>;
    reloadActiveMobileVault(own?: string | readonly string[]): Promise<boolean>;
    renewAfterSyncGaveUp(left: { drain: Promise<void>; place: null; runtime: MobileVault; vault: string; notRun: () => Error }): Promise<MobileVault>;
    boot(): Promise<MobileVault> | null;
    setBoot(p: Promise<MobileVault>): void;
  };
  api = new Function(...Object.keys(deps), compiled)(...Object.values(deps)) as {
    switchVault(id: string): Promise<void>;
    reloadActiveMobileVault(own?: string | readonly string[]): Promise<boolean>;
    renewAfterSyncGaveUp(left: { drain: Promise<void>; place: null; runtime: MobileVault; vault: string; notRun: () => Error }): Promise<MobileVault>;
    boot(): Promise<MobileVault> | null;
    setBoot(p: Promise<MobileVault>): void;
  };
  return { ...api, deps: { ...deps, getMobileVault: openAnew }, events, syncStarted, order, active: () => active };
}

beforeEach(() => {
  resetLeaveGuard();
});
afterEach(() => {
  resetScreenStepsForTest();
  toast.clearAll();
  resetLeaveGuard();
});

describe("a vault switch", () => {
  it("is one switch for two flows that end in the same vault", async () => {
    // A sign-in coming back to its vault and a connect run activating it.
    const h = harness("notes");
    const first = h.switchVault("work");
    const second = h.switchVault("work");
    await Promise.all([first, second]);
    // THE DEFECT: each switched for itself — the second dropped the stacks again
    // and nulled the boot the first had begun.
    expect(h.events, "the stacks are dropped once").toEqual(["work"]);
    expect(h.deps.setActiveVault).toHaveBeenCalledTimes(1);
  });

  it("does a switch to another vault after the one under way, not across it", async () => {
    const h = harness("notes");
    await Promise.all([h.switchVault("work"), h.switchVault("travel")]);
    expect(h.events).toEqual(["work", "travel"]);
    expect(h.active()).toBe("travel");
  });

  it("that fails leaves the vault on screen active and its sync running", async () => {
    const h = harness("notes");
    h.deps.reloadMobileSettingsForActiveVault.mockRejectedValueOnce(new Error("settings unreadable"));
    await expect(h.switchVault("work")).rejects.toThrow("settings unreadable");
    // The list named a vault that was never started, and the sync stayed stopped.
    expect(h.active(), "the vault list names the vault on screen again").toBe("notes");
    expect(h.syncStarted, "the stopped sync runs again").toEqual(["notes"]);
    expect(h.events, "nothing was switched").toEqual([]);
    expect(h.deps.initial.dispose).not.toHaveBeenCalled();
  });

  it("that fails while stopping the sync starts it again", async () => {
    const h = harness("notes");
    h.deps.stopSyncAndDrain.mockRejectedValueOnce(new Error("drain failed"));
    await expect(h.switchVault("work")).rejects.toThrow("drain failed");
    expect(h.active()).toBe("notes");
    expect(h.deps.setActiveVault).not.toHaveBeenCalled();
    expect(h.syncStarted).toEqual(["notes"]);
  });

  it("that succeeds does not start the old vault's sync", async () => {
    const h = harness("notes");
    await h.switchVault("work");
    expect(h.syncStarted).toEqual([]);
    expect(h.events).toEqual(["work"]);
  });
});

describe("after the runtime was called off, only forwards", () => {
  afterEach(() => { vi.useRealTimers(); });

  it("a switch that fails after its sync step was given up on never resumes the called-off vault: it opens anew", async () => {
    vi.useFakeTimers();
    const h = harness("notes");
    let finish!: () => void;
    h.deps.stopSyncAndDrain.mockImplementationOnce(() => new Promise<void>((r) => (finish = r)));
    h.deps.reloadMobileSettingsForActiveVault.mockRejectedValueOnce(new Error("settings unreadable"));
    const switching = h.switchVault("work").catch((e: Error) => e.message);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await switching).toBe("settings unreadable");
    expect(h.deps.initial.callOff, "given up in the sync step: called off at once").toHaveBeenCalled();
    // THE DEFECT: the called-off vault stayed on screen and its sync started again over a runtime that refuses every call.
    expect(h.syncStarted, "no sync starts on a called-off runtime").toEqual([]);
    expect(h.events, "the vault on screen opens anew").toEqual(["notes"]);
    expect(h.active()).toBe("notes");
    // Its database closes once the step it gave up on has ended — never under a call still running.
    expect(h.deps.initial.dispose).not.toHaveBeenCalled();
    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.deps.initial.dispose).toHaveBeenCalled();
  });

  it("a reload whose sync step was given up on goes on, though input was begun in the drain", async () => {
    vi.useFakeTimers();
    const h = harness("notes");
    const MESSAGE = { id: "mail-compose", message: "The draft will not be saved." };
    h.deps.stopSyncAndDrain.mockImplementationOnce(() => { armLeaveGuard(MESSAGE); return new Promise<void>(() => undefined); });
    const reloading = h.reloadActiveMobileVault();
    await vi.advanceTimersByTimeAsync(30_000);
    // Asked before anything calls off — after the call-off a vault that stays on screen would refuse every call.
    expect(await reloading).toBe(true);
    expect(h.deps.initial.callOff).toHaveBeenCalled();
    expect(h.deps.initial.dispose, "not under the step still running").not.toHaveBeenCalled();
    expect(h.events).toEqual(["notes"]);
  });
});

describe("the sync of the vault a switch leaves", () => {
  afterEach(() => { vi.useRealTimers(); });

  it("is taken off before the saves, so a save that hangs past the deadline holds no sync of the next vault", async () => {
    expect.hasAssertions();
    vi.useFakeTimers();
    const h = harness("notes");
    let saved!: () => void;
    h.deps.noteSaver.flushAll.mockImplementationOnce(() => new Promise<void>((r) => (saved = r)));
    const switching = h.switchVault("work");
    await vi.advanceTimersByTimeAsync(30_000);
    await switching;
    // THE DEFECT: the sync was stopped only after the saves; the hanging save kept the old worker the app's, so the
    // next vault's start found it and started nothing — and the old vault's late stop then hit the next vault's.
    expect(h.order.slice(0, 1), "taken off at once").toEqual(["detach"]);
    expect(h.order, "drained only after the saves").not.toContain("stop");
    expect(h.events).toEqual(["work"]);
    saved();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.order).toContain("stop");
  });
});

describe("what a switch says while it waits", () => {
  afterEach(() => { vi.useRealTimers(); });

  it("names the vault as the list does — the vault on this device has no name of its own", async () => {
    expect.hasAssertions();
    vi.useFakeTimers();
    const h = harness("local");
    let done!: () => void;
    h.deps.detachSync.mockImplementationOnce(() => ({ drain: () => new Promise<void>((r) => (done = r)), place: null, running: true }));
    const switching = h.switchVault("work");
    await vi.advanceTimersByTimeAsync(5_000);
    // THE DEFECT: the notice said “A sync step of “” is still running”.
    expect(toastStore.get().map((t) => t.message)).toContain(i18n.t("closing.syncWait", { vault: vaultEntryName("") }));
    done();
    await switching;
  });

  it("names a sync step only where a sync runs", async () => {
    expect.hasAssertions();
    vi.useFakeTimers();
    const h = harness("notes");
    let done!: () => void;
    // Nothing of the sync ran; what is left of the close takes a while (a stand-in that hangs).
    h.deps.detachSync.mockImplementationOnce(() => ({ drain: () => new Promise<void>((r) => (done = r)), place: null, running: false }));
    const switching = h.switchVault("work");
    await vi.advanceTimersByTimeAsync(5_000);
    expect(toastStore.get().map((t) => t.message).filter((m) => /sync/i.test(m)), "no sync step is named").toEqual([]);
    done();
    await switching;
  });
});

describe("a step that gave up waiting for the sync", () => {
  it("leaves the vault as a close does — saves first, owed entries, then the call-off — and goes on with it opened anew", async () => {
    expect.hasAssertions();
    const order: string[] = [];
    let saved!: () => void;
    const initial = {
      ...vault("notes"),
      flushOwed: vi.fn(async () => { order.push("owed"); }),
      callOff: vi.fn(() => { order.push("call-off"); }),
      dispose: vi.fn(async () => { order.push("dispose"); }),
    } as unknown as MobileVault & { dispose: ReturnType<typeof vi.fn> };
    const h = harness("notes", initial);
    h.deps.noteSaver.flushAll.mockImplementationOnce(() => new Promise<void>((r) => (saved = () => { order.push("saved"); r(); })));
    let cycleEnded!: () => void;
    const drain = new Promise<void>((r) => (cycleEnded = r));
    const fresh = await h.renewAfterSyncGaveUp({ drain, place: null, runtime: initial, vault: "Notes", notRun: () => new Error("not run") });
    expect(fresh as unknown as { anew?: boolean }, "the step goes on with the vault opened anew").toMatchObject({ vaultId: "notes", anew: true });
    expect(h.events, "the screens follow as on a reload").toEqual(["notes"]);
    expect(order, "never over a save still running").toEqual([]);
    saved();
    await vi.waitFor(() => expect(order).toEqual(["saved", "owed", "call-off"]));
    // Its database closes once the cycle it left has ended.
    expect(initial.dispose).not.toHaveBeenCalled();
    cycleEnded();
    await vi.waitFor(() => expect(order).toContain("dispose"));
  });
});

describe("a step that gave up waiting for the sync, while another vault was opened", () => {
  it("does not go on with the other vault's runtime: it says the step did not run", async () => {
    expect.hasAssertions();
    const h = harness("notes");
    // A switch during the step: the vault that opens now is another one.
    h.deps.getMobileVault.mockImplementationOnce(async () => ({ ...vault("work"), anew: true }));
    const outcome = await h.renewAfterSyncGaveUp({ drain: Promise.resolve(), place: null, runtime: h.deps.initial, vault: "Notes", notRun: () => stepNotRun("Notes") }).then((v) => (v as MobileVault).vaultId, (e: Error) => e.name);
    // THE DEFECT: the step went on with whatever vault opened — the wizard on the wrong vault.
    expect(outcome).toBe("StepNotRunError");
    expect(toastStore.get().map((t) => t.message)).toContain(i18n.t("closing.stepNotRun", { vault: "Notes" }));
  });

  it("switched to another vault while it waited: closes nothing — of that vault or of its own — and never goes on with it", async () => {
    expect.hasAssertions();
    const h = harness("notes");
    const own = h.deps.initial;
    // The step on "notes" waits for its hanging cycle, and the person switches to "work" meanwhile.
    await h.switchVault("work");
    const work = vault("work");
    h.setBoot(Promise.resolve(work));
    await new Promise((r) => setTimeout(r, 0));
    h.deps.getMobileVault.mockImplementation(async () => ({ ...vault("work"), anew: true }));
    const eventsBefore = [...h.events];
    const outcome = await h.renewAfterSyncGaveUp({ drain: Promise.resolve(), place: null, runtime: own, vault: "Notes", notRun: () => stepNotRun("Notes") }).then((v) => `returned ${(v as MobileVault).vaultId}`, (e: Error) => e.name);
    await new Promise((r) => setTimeout(r, 10));
    // THE DEFECT (probe m4): it left and reopened "work" — the vault on screen now — and handed it to the step.
    expect(outcome).toBe("StepNotRunError");
    expect(h.events, "no vault is left and opened anew for the step").toEqual(eventsBefore);
    expect(work.callOff, "nothing of the other vault is called off").not.toHaveBeenCalled();
    expect(work.dispose).not.toHaveBeenCalled();
    expect(h.deps.getMobileVault, "nothing opened anew").not.toHaveBeenCalled();
    expect(toastStore.get().map((t) => t.message)).toContain(i18n.t("closing.stepNotRun", { vault: "Notes" }));
  });

  it("away and back while it waited: the same vault, a new runtime of it — the step's own is not left again, the step does not go on", async () => {
    expect.hasAssertions();
    const h = harness("notes");
    const own = h.deps.initial;
    await h.switchVault("work");
    await h.switchVault("notes");
    const again = vault("notes");
    h.setBoot(Promise.resolve(again));
    await new Promise((r) => setTimeout(r, 0));
    const eventsBefore = [...h.events];
    const outcome = await h.renewAfterSyncGaveUp({ drain: Promise.resolve(), place: null, runtime: own, vault: "Notes", notRun: () => stepNotRun("Notes") }).then(() => "went on", (e: Error) => e.name);
    await new Promise((r) => setTimeout(r, 10));
    expect(outcome).toBe("StepNotRunError");
    expect(h.events).toEqual(eventsBefore);
    expect(again.callOff).not.toHaveBeenCalled();
    expect(again.dispose).not.toHaveBeenCalled();
  });
});

describe("the place of the runtime a switch leaves", () => {
  afterEach(() => resetClosingSyncPlacesForTests());

  it("is parked under the vault's sync folder too, until the runtime has ended", async () => {
    expect.hasAssertions();
    const folder = syncStateBindingFor({ provider: "webdav", webdav: { url: "https://dav.example.test/shared", user: "u" } });
    let end!: () => void;
    const initial = { ...vault("notes"), ended: vi.fn(() => new Promise<void>((r) => (end = r))) } as unknown as MobileVault;
    const h = harness("notes", initial);
    h.deps.detachSync.mockImplementationOnce(() => ({ drain: async () => {}, place: folder, running: true }));
    await h.switchVault("work");
    // Another entry on the same folder: its sync start waits for this runtime (`waitForClosingSyncPlace`).
    expect(closingAtSyncPlace(folder).map((c) => c.vault)).toHaveLength(1);
    end();
    await vi.waitFor(() => expect(closingAtSyncPlace(folder)).toHaveLength(0));
  });
});

describe("a vault reload", () => {
  const MESSAGE = { id: "mail-compose", message: "The draft will not be saved." };
  const offers = () => toastStore.get().filter((item) => item.action !== undefined);

  it("reloads at once when nothing is at stake", async () => {
    const h = harness("notes");
    expect(await h.reloadActiveMobileVault("security-area")).toBe(true);
    expect(h.events).toEqual(["notes"]);
  });

  it("is not held back by the input of the screen it began on", async () => {
    const h = harness("notes");
    armLeaveGuard({ id: "security-area", message: "The credentials will be lost." });
    expect(await h.reloadActiveMobileVault("security-area")).toBe(true);
    expect(h.events).toEqual(["notes"]);
  });

  it("waits behind a message begun while it ran, and goes once the message is gone", async () => {
    const h = harness("notes");
    armLeaveGuard(MESSAGE);
    // THE DEFECT: the reload dropped every stack, and the message with them.
    expect(await h.reloadActiveMobileVault("security-area")).toBe(false);
    expect(h.events, "no stack was dropped").toEqual([]);
    expect(h.deps.stopSyncAndDrain).not.toHaveBeenCalled();
    expect(offers().map((o) => o.message)).toEqual(["mobile.vaultReloadOffer"]);

    disarmLeaveGuard(MESSAGE.id);
    await vi.waitFor(() => expect(h.events).toEqual(["notes"]));
    expect(offers(), "the notice went with the reload").toEqual([]);
  });

  it("goes at the notice's button once the message is given up, though its guard stands until the screen goes", async () => {
    const h = harness("notes");
    armLeaveGuard(MESSAGE);
    expect(await h.reloadActiveMobileVault("security-area")).toBe(false);
    const notice = offers()[0];
    notice.action!.run();
    toast.dismiss(notice.id);
    await new Promise((r) => setTimeout(r, 0));
    const dialog = currentMobileDialog();
    expect(dialog?.kind).toBe("confirm");
    if (dialog?.kind !== "confirm") throw new Error("no question");
    dialog.resolve(true);
    dismissMobileDialog(dialog);
    // "Discard" keeps the guard armed (the composer is still mounted); the reload must not wait for it again.
    await vi.waitFor(() => expect(h.events).toEqual(["notes"]));
    expect(offers()).toEqual([]);
  });

  it("waits too when the message was begun while the sync drained", async () => {
    const h = harness("notes");
    h.deps.stopSyncAndDrain.mockImplementationOnce(async () => { armLeaveGuard(MESSAGE); });
    expect(await h.reloadActiveMobileVault()).toBe(false);
    expect(h.events).toEqual([]);
    expect(h.deps.initial.dispose, "the vault on screen keeps working").not.toHaveBeenCalled();
    disarmLeaveGuard(MESSAGE.id);
    await vi.waitFor(() => expect(h.events).toEqual(["notes"]));
  });

  it("that waited does not reload a vault switched away from meanwhile", async () => {
    const h = harness("notes");
    armLeaveGuard(MESSAGE);
    expect(await h.reloadActiveMobileVault()).toBe(false);
    await h.switchVault("work");
    h.events.length = 0;
    disarmLeaveGuard(MESSAGE.id);
    await new Promise((r) => setTimeout(r, 0));
    expect(h.events).toEqual([]);
  });
});

/**
 * A healthy switch or reload loses nothing that is owed to the sync queue
 * (the phone's twin of the desktop's close). A write whose queue entry could
 * not be made at once — the database busy with another transaction, which
 * the phone's adapter refuses rather than queues — is owed, and its entry is
 * tried again a moment later. Closing the vault gives it its last attempt
 * (`dispose`: the owed entries are flushed, then the database closes), and
 * only after that may the runtime be called off: called off first, the last
 * attempt meets a fenced database and the entry is gone.
 */
describe("a healthy switch with an entry owed to the sync queue", () => {
  async function owingVault(id: string) {
    const root = await mkdtemp(join(tmpdir(), "pv-switch-owed-"));
    const raw = await realSqlite();
    const fence = createVaultCallOff();
    let busy = 1;
    const refusingOnce = new Proxy(raw, {
      get(target, key, receiver) {
        const value = Reflect.get(target, key, receiver) as unknown;
        if (typeof value !== "function") return value;
        return (...args: unknown[]) => {
          if (key === "transaction") if (key === "transaction" && busy > 0) { busy -= 1; return Promise.reject(new Error("database is busy")); }
          return (value as (...a: unknown[]) => unknown).apply(target, args);
        };
      },
    });
    const db = fence.database(refusingOnce);
    const storage = fence.storage(new LocalVaultAdapter(root));
    await storage.initialize();
    const owed = new QueueingVaultAdapter(storage, new SyncQueue(db));
    // The index is under way, as so often on the phone (the warm pass after the first paint, a resume rescan):
    // closing aborts it, and dispose waits for it to end first.
    const indexAbort = new AbortController();
    const indexer = new VaultIndexer(storage, db, { scanSignal: indexAbort.signal });
    // As `MobileVault`: ended calls off and waits; dispose waits for the index, gives the owed entries their last attempt, then closes.
    const v = {
      vaultId: id,
      callOff: () => fence.callOff(),
      ended: () => { fence.callOff(); return fence.ended(); },
      dispose: async () => { indexAbort.abort(); await indexer.whenIdle(); await owed.flush(); },
    } as unknown as MobileVault;
    const rows = () => raw.query<{ operation: string; file_path: string }>("SELECT operation, file_path FROM offline_queue");
    const cleanup = async () => { await raw.close().catch(() => undefined); await rm(root, { recursive: true, force: true }); };
    const scan = () => void indexer.indexVaultFull().catch(() => undefined);
    return { v, owed, fence, rows, cleanup, scan };
  }

  for (const how of ["switch", "reload"] as const) {
    it(`keeps it on a ${how}: the last attempt comes before the runtime is called off`, async () => {
      expect.hasAssertions();
      const o = await owingVault("notes");
      try {
        const h = harness("notes", o.v);
        const write = o.owed.writeTextFile("Tasks.md", "- [x] ticked just before switching\n").then(() => "saved", (e: Error) => e.name);
        // The entry is owed now; its next attempt is due a quarter second after the change.
        await new Promise((r) => setTimeout(r, 30));
        o.scan();
        if (how === "switch") await h.switchVault("work");
        else expect(await h.reloadActiveMobileVault()).toBe(true);
        await new Promise((r) => setTimeout(r, 400));
        expect(await o.rows(), "the entry is in the queue").toEqual([{ operation: "write", file_path: "Tasks.md" }]);
        expect(await Promise.race([write, new Promise((r) => setTimeout(() => r("still owed"), 1_000))]), "the write stands").toBe("saved");
        expect(o.fence.calledOff, "the runtime is called off after it").toBe(true);
      } finally {
        await o.cleanup();
      }
    });
  }
});
