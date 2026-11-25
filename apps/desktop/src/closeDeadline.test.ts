// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import i18n from "@plainva/ui/i18n";
import { parkClosingSyncPlace, resetClosingSyncPlacesForTests, stepFailureSaid, stepNotRun, syncStateBindingFor, toast, toastStore, waitForClosingSyncPlace, waitForClosingVault, waitWithDeadline } from "@plainva/ui";

/**
 * Closing, switching or reloading a vault waits within a deadline, in both
 * shells (`waitWithDeadline`): a notice after 5 s naming what it waits for,
 * going on after 30 s and saying so — and then the vault's runtime is called
 * off (`createVaultCallOff`) before the next one starts.
 */

// The desktop package's folder is where its tests run.
const ROOT = resolve(process.cwd(), "..", "..");
const messages = () => toastStore.get().map((t) => t.message);

beforeEach(async () => {
  await i18n.changeLanguage("en");
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  toast.clearAll();
});

describe("the deadline of a close", () => {
  it("says nothing where the work ends in time", async () => {
    let done!: () => void;
    const waited = waitWithDeadline(new Promise<void>((r) => (done = r)), () => ({ kind: "sync", vault: "Notes" }));
    await vi.advanceTimersByTimeAsync(4_000);
    done();
    expect(await waited).toBe("done");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(messages()).toEqual([]);
  });

  it("names what it waits for after 5 s, takes that notice down when the work ends, and passes a failure on", async () => {
    let fail!: (e: Error) => void;
    const waited = waitWithDeadline(new Promise<void>((_, reject) => (fail = reject)), () => ({ kind: "sync", vault: "Notes" }));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(messages()).toEqual([i18n.t("closing.syncWait", { vault: "Notes" })]);
    fail(new Error("disk"));
    await expect(waited).rejects.toThrow("disk");
    expect(messages()).toEqual([]);
  });

  it("goes on after 30 s and says what now happens; several notes are counted", async () => {
    const waited = waitWithDeadline(new Promise<void>(() => undefined), () => ({ kind: "saving", names: ["A", "B", "C"] }));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(messages()).toEqual([i18n.t("closing.savingWaitMany", { count: 3 })]);
    await vi.advanceTimersByTimeAsync(25_000);
    expect(await waited).toBe("gave-up");
    expect(messages()).toEqual([i18n.t("closing.savingGaveUpMany", { count: 3 })]);
  });

  it("says a step's failure once: its own notice, or that it did not finish where its runtime was called off", async () => {
    expect.hasAssertions();
    vi.useRealTimers();
    const notRun = stepNotRun("Notes");
    expect(messages()).toEqual([i18n.t("closing.stepNotRun", { vault: "Notes" })]);
    // The caller (the overlay, a settings page) sees a step's own notice and says nothing more.
    expect(stepFailureSaid(notRun, "Notes")).toBe(true);
    expect(messages()).toHaveLength(1);
    toast.clearAll();
    expect(stepFailureSaid(Object.assign(new Error("vault storage.writeTextFile: the vault's runtime was called off"), { name: "CalledOffError" }), "Notes")).toBe(true);
    expect(messages()).toEqual([i18n.t("closing.stepInterrupted", { vault: "Notes" })]);
    toast.clearAll();
    expect(stepFailureSaid(new Error("wrong recovery code"), "Notes"), "any other failure is the caller's to say").toBe(false);
    expect(messages()).toEqual([]);
  });

  it("marks the provider gone only when it is taken down, not on a teardown inside it (the index rebuilt, then the vault loaded again)", () => {
    const desktop = readFileSync(join(ROOT, "apps/desktop/src/contexts/VaultContext.tsx"), "utf8");
    const teardown = desktop.slice(desktop.indexOf("const teardownVault = async"), desktop.indexOf("const teardownVaultRef"));
    // THE DEFECT: `teardownVault` set the mark, and "Rebuild index" calls it before it loads the vault again in the
    // same provider — every step after said "did not run" with the vault open.
    expect(teardown).not.toContain("providerGoneRef");
    expect(desktop).toMatch(/useEffect\(\(\) => \{\s*providerGoneRef\.current = false;\s*return \(\) => \{\s*providerGoneRef\.current = true;\s*\};\s*\}, \[\]\);/);
  });

  it("takes the notice of an open that waits for the same vault's close down when that open is called off", async () => {
    expect.hasAssertions();
    const abort = new AbortController();
    let done = false;
    const waiting = waitForClosingVault(new Promise<void>(() => undefined), "Notes", { signal: abort.signal }).then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(messages()).toEqual([i18n.t("closing.stillClosing", { vault: "Notes" })]);
    // THE DEFECT: the notice of an open whose provider went stood until the old close ended — for good where a save hung.
    abort.abort();
    await waiting;
    expect(done).toBe(true);
    expect(messages()).toEqual([]);
  });

  it("holds a sync start at a folder where another vault still closes, says so after 5 s (text 8), and takes the notice down once it has ended", async () => {
    expect.hasAssertions();
    const folder = syncStateBindingFor({ provider: "s3", s3: { endpoint: "https://s3.example.test", bucket: "notes" } });
    let end!: () => void;
    parkClosingSyncPlace(folder, "Work", new Promise<void>((r) => (end = r)));
    let started = false;
    const starting = waitForClosingSyncPlace(folder).then(() => { started = true; });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(messages()).toEqual([i18n.t("closing.stillClosingSameFolder", { vault: "Work" })]);
    expect(started).toBe(false);
    end();
    await starting;
    expect(messages()).toEqual([]);
    resetClosingSyncPlacesForTests();
  });

  it("is how both shells close: one deadline for the whole close, and the same vault opens again only once its runtime has ended", () => {
    const desktop = readFileSync(join(ROOT, "apps/desktop/src/contexts/VaultContext.tsx"), "utf8");
    const close = readFileSync(join(ROOT, "apps/desktop/src/services/closeRuntime.ts"), "utf8");
    // In order: drafts, saves, then the sync step, the settings-only sync and the index — one deadline over all of it.
    expect(close).toMatch(/deps\.flushDrafts\(path\)[\s\S]*deps\.settlePendingWrites\(path\)[\s\S]*worker\?\.stopAndDrain\(\)[\s\S]*settingsOnly\?\.stopAndDrain\(\)[\s\S]*indexer\?\.whenIdle[\s\S]*indexQueue\?\.whenIdle\(\)/);
    // Called off only after what is owed to the sync queue has had its last attempt — in a healthy close as after a give-up.
    expect(close).toMatch(/const callOffAfterOwed = \(\) => flushOwed\(\)\.then\(\(\) => fence\?\.callOff\(\)\)/);
    expect(close).toMatch(/waitWithDeadline\(drain, saving\)\) === "gave-up" && step\.kind !== "saving"\) void callOffAfterOwed\(\)/);
    expect(close).toMatch(/await callOffAfterOwed\(\);\s*await fence\?\.ended\(\);[\s\S]*noteVaultTeardown\(path, ended\)/);
    // The close and a reload of the same vault go that one way; the open waits for the end (text 7).
    const teardown = desktop.slice(desktop.indexOf("const teardownVault = async"), desktop.indexOf("const teardownVaultRef"));
    expect(teardown).toContain("closeVaultRuntime({ path, worker, settingsOnly,");
    expect(desktop).toMatch(/live && \(live\.worker \|\| callOffRef\.current\)[\s\S]*closeVaultRuntime\([\s\S]*waitForClosingVault\(awaitVaultTeardown\(path\)/);
    // A reload calls the previous load off first, as a close does: its index stops scanning, and the close does not wait it out.
    expect(desktop).toMatch(/const previousLoad = loadAbortRef\.current;[\s\S]*live && \(live\.worker \|\| callOffRef\.current\)[\s\S]*previousLoad\?\.abort\(\);\s*await closeVaultRuntime\(/);
    // Every runtime is fenced from its start, and a called-off load calls its runtime off.
    expect(desktop).toMatch(/const callOff = createVaultCallOff\(\);[\s\S]*loadStarts\.fence\(callOff\);[\s\S]*callOff\.storage\(new TauriVaultAdapter\(path\)\)[\s\S]*callOff\.database\(openedDatabase\)/);

    // A step that stops the sync to work on the vault does so within the deadline (`stopSyncForStep`), and never by
    // waiting for the worker without end; the vault it leaves opens anew with its sync held until the step reloads it.
    expect(desktop, "no step waits for the worker without end").not.toMatch(/state\.syncWorker\?\.stopAndDrain\(\)/);
    // Each step goes through `workspaceSteps.ts` (the stopped sync, the new runtime's handles, the hold ending on every
    // way out — its own tests), and takes nothing of the runtime from the closure it began in.
    for (const [flow, through] of [["const activateWorkspace", "withSyncStopped(stepPorts("], ["const lockWorkspace", "lockWorkspaceStep(stepPorts("], ["const resumeWorkspaceSetup", "withSyncStopped(stepPorts("], ["const restoreWorkspaceRecovery", "withSyncStopped(stepPorts("], ["const decommissionWorkspace", "leaveWorkspace(stepPorts("], ["const liftWorkspaceEncryption", "leaveWorkspace(stepPorts("]] as const) {
      const at = desktop.indexOf(flow);
      expect(at, flow).toBeGreaterThan(-1);
      const body = desktop.slice(at, desktop.indexOf("\n  };\n", at));
      expect(body, flow).toContain(through);
      const step = body.slice(body.indexOf(through));
      expect(step, `${flow}: no handle from the closure`).not.toMatch(/state\.(belowChainAdapter|dbAdapter|syncWorker)|syncTargetRef\.current|\bloadVault\(/);
    }
    expect(desktop.match(/startSyncOf\(\(\) => (settingsOnly|worker|fileWorker)\.start\(\)\)/g), "every sync start of a load waits for its folder and asks the hold").toHaveLength(3);
    expect(desktop).toMatch(/const syncGate = createSyncGate\(\{ path, place: binding, signal: currentAbortSignal \}\);[\s\S]*?const startSyncOf = \(begin: \(\) => void\) => \(\) => syncGate\.start\(begin\);/);
    // What reaches the folder before a worker does goes through the gate as well (its behaviour: `syncGate.test.ts`).
    expect(desktop).toMatch(/void syncGate\.stoppable\(\(signal\) => startEncryptedWorkspace\(signal\)\)/);
    // A step stops a reconcile that runs already, as it stops a worker (`runningVaultSyncStep`).
    expect(desktop).toMatch(/runtimeRef\.current\.worker : null\) \?\? runningVaultSyncStep\(path\)/);
    expect(desktop).toMatch(/heldStart = \(\) => void syncGate\.once\(/);
    // The vault opens meanwhile: nothing of the load waits for the folder.
    expect(desktop).not.toMatch(/await [^;\n]*waitForClosingSyncPlace\(/);
    // The ports of every step: the sync taken for the step's length, and its runtime only from what the last load
    // left — no fallback to the closure (`createStepPorts`; the steps' behaviour: `workspaceSteps.test.ts`).
    const ports = desktop.slice(desktop.indexOf("const stepPorts = (path: string)"), desktop.indexOf("const reopenAfterStep"));
    expect(ports).toContain("take: () => takeVaultSync(path)");
    expect(ports, "no handle of the step from the closure").not.toMatch(/state\.(belowChainAdapter|dbAdapter|syncWorker)/);

    const phone = readFileSync(join(ROOT, "apps/mobile/src/services/vaultService.ts"), "utf8");
    const settle = phone.slice(phone.indexOf("async function settleBeforeClosing"), phone.indexOf("function leaveVault"));
    // The sync is taken off the vault first, before anything awaits, and drained after the saves.
    expect(settle).toMatch(/^async function settleBeforeClosing[^\n]*\n(?:\s*\/\/[^\n]*\n)*\s*const detached = detachSync\(\);/);
    expect(settle).toMatch(/flushDraftsBeforeClosing\(current\)[\s\S]*noteSaver\.flushAll\(\)[\s\S]*detached\.drain\(\)[\s\S]*waitWithDeadline\(drain, now\)[\s\S]*step\.kind !== "saving"[\s\S]*left\.flushOwed\(\)[\s\S]*left\.callOff\(\)/);
    // The vault closes after the drain (never under a save still running), and is called off only after it closed.
    const leave = phone.slice(phone.indexOf("async function leaveVault"), phone.indexOf("\n}\n", phone.indexOf("async function leaveVault")));
    expect(leave).toMatch(/settled\.drain[\s\S]*\.then\(\(\) => current\.dispose\(\)\)[\s\S]*await disposed;\s*await current\.ended\(\);/);
    for (const name of ["async function switchTo", "export async function reloadActiveMobileVault"]) {
      const body = phone.slice(phone.indexOf(name), phone.indexOf("\n}\n", phone.indexOf(name)));
      expect(body, name).toContain("await settleBeforeClosing(current)");
      expect(body, name).toContain("await leaveVault(current, settled");
    }
    // The boot of a vault waits for the end of its previous runtime (text 7), before its own fence.
    expect(phone).toMatch(/waitForClosingVault\(closingAt\(entry\.id, entry\.external\)[\s\S]*const callOff = createVaultCallOff\(\);[\s\S]*callOff\.storage\(opened\)[\s\S]*callOff\.database\(/);
    // Deleting a vault: one deadline over its saves and a start still opening (text 6).
    expect(phone).toMatch(/await noteSaver\.flushAll\(\);[\s\S]*waiting\.on = "opening";[\s\S]*waitWithDeadline\(waited, [\s\S]*\{ kind: "opening", vault: name \}/);
  });
});
