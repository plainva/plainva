// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@plainva/ui/i18n";
import { parkClosingSyncPlace, resetClosingSyncPlacesForTests, syncStateBindingFor, toast, toastStore } from "@plainva/ui";
import { createSyncGate, resetVaultSyncTakenForTests, takeVaultSync } from "./syncGate";

/**
 * The desktop's gate to a vault's sync folder (`syncGate.ts`): what a load of
 * the vault starts there — the worker, the settings-only sync, the reconcile
 * of an encrypted workspace, the look at a held folder — waits until no
 * other vault closes at the same folder, and stops while a step holds the
 * vault's sync.
 */

const VAULT = "/vaults/notes";
const folder = syncStateBindingFor({ provider: "webdav", webdav: { url: "https://dav.example.test/shared", user: "u" } });
const messages = () => toastStore.get().map((t) => t.message);
const hanging = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
};
const tick = () => new Promise((r) => setTimeout(r, 0));

/** A worker whose `start` does nothing where it runs, as the sync workers' does. */
function worker() {
  const w = { running: false, starts: 0, start: () => { if (w.running) return; w.running = true; w.starts += 1; }, stop: () => { w.running = false; } };
  return w;
}

beforeEach(async () => {
  await i18n.changeLanguage("en");
});
afterEach(() => {
  vi.useRealTimers();
  resetClosingSyncPlacesForTests();
  resetVaultSyncTakenForTests();
  toast.clearAll();
});

describe("the gate to a vault's sync folder", () => {
  it("touches the folder only once the other vault at it has closed: the worker, the reconcile, the look at a held folder", async () => {
    expect.hasAssertions();
    const other = hanging();
    parkClosingSyncPlace(folder, "Work", other.promise);
    const gate = createSyncGate({ path: VAULT, place: folder, signal: new AbortController().signal });
    const w = worker();
    const touched: string[] = [];
    gate.start(() => { touched.push("worker"); w.start(); });
    const reconcile = gate.once(async () => { touched.push("reconcile"); return "worker of the workspace"; });
    void gate.once(async () => { touched.push("held folder"); });
    expect(gate.freeNow()).toBe(false);
    await tick();
    // THE DEFECT: the reconcile of the encrypted workspace and the look at a held folder reached the folder at once.
    expect(touched).toEqual([]);
    other.resolve();
    expect(await reconcile).toBe("worker of the workspace");
    await tick();
    expect(touched.sort()).toEqual(["held folder", "reconcile", "worker"]);
    expect(w.running).toBe(true);
  });

  it("starts nothing for a load that was called off, and the notice of text 8 goes with it", async () => {
    expect.hasAssertions();
    vi.useFakeTimers();
    parkClosingSyncPlace(folder, "Work", new Promise<void>(() => undefined));
    const load = new AbortController();
    const gate = createSyncGate({ path: VAULT, place: folder, signal: load.signal });
    const touched: string[] = [];
    gate.start(() => touched.push("worker"));
    const once = gate.once(async () => { touched.push("reconcile"); });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(messages()).toEqual([i18n.t("closing.stillClosingSameFolder", { vault: "Work" })]);
    // THE DEFECT: the notice stood after the vault that waited was closed.
    load.abort();
    await once;
    await vi.advanceTimersByTimeAsync(0);
    expect(messages()).toEqual([]);
    expect(touched).toEqual([]);
  });

  it("holds every start while a step has the sync — also one that still waited for the folder — and starts it when the step gives it back", async () => {
    expect.hasAssertions();
    const other = hanging();
    parkClosingSyncPlace(folder, "Work", other.promise);
    const gate = createSyncGate({ path: VAULT, place: folder, signal: new AbortController().signal });
    const w = worker();
    gate.start(() => w.start());
    // A step (lifting the encryption, say) takes the sync while the start still waits for the folder.
    const giveBack = takeVaultSync(VAULT);
    other.resolve();
    await tick();
    await tick();
    // THE DEFECT: the folder came free and the worker started in the middle of the step.
    expect(w.running, "not in the middle of the step").toBe(false);
    giveBack();
    expect(w.running, "the step through, the sync runs").toBe(true);
  });

  it("starts the worker again that a step stopped in time and then failed ('same')", async () => {
    expect.hasAssertions();
    const gate = createSyncGate({ path: VAULT, place: folder, signal: new AbortController().signal });
    const w = worker();
    gate.start(() => w.start());
    expect(w.running).toBe(true);
    const giveBack = takeVaultSync(VAULT);
    w.stop(); // the step stops the sync in time
    // The step fails (a wrong recovery code): it gives the sync back on its way out.
    giveBack();
    // THE DEFECT: nothing started it again, and the vault stayed without its sync.
    expect(w.running).toBe(true);
    expect(w.starts).toBe(2);
  });

  it("holds the reconcile of the runtime a step opened anew until the step is through", async () => {
    expect.hasAssertions();
    const giveBack = takeVaultSync(VAULT);
    // The step left the vault ("renewed"): the vault opens anew, and its load would reconcile the workspace.
    const reopened = createSyncGate({ path: VAULT, place: folder, signal: new AbortController().signal });
    const order: string[] = [];
    const reconcile = reopened.once(async () => { order.push("reconcile"); });
    await tick();
    order.push("teardown of the workspace");
    // THE DEFECT: the reconcile ran beside the teardown and wrote rows after the state was cleared.
    expect(order).toEqual(["teardown of the workspace"]);
    giveBack();
    await reconcile;
    expect(order).toEqual(["teardown of the workspace", "reconcile"]);
  });
});
