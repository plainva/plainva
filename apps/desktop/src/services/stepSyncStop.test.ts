// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@plainva/ui/i18n";
import { toast, toastStore, waitForClosingVault } from "@plainva/ui";
import { createVaultCallOff, isCalledOffError } from "@plainva/core";
import { closeVaultRuntime } from "./closeRuntime";
import { stopSyncForStep } from "./stepSyncStop";
import { awaitVaultTeardown, resetVaultTeardownsForTests } from "./vaultTeardown";
import { adoptLeftNoteSave, hasLeftNoteSave, leftNoteSaveEpoch, resetLeftNoteSavesForTests } from "./leftNoteSaves";
import { settlePendingWrites } from "./pendingWrites";

/**
 * A step that stops the sync to work on the vault — the security wizard,
 * locking, restoring or lifting a workspace — waited for the cycle for as long
 * as it ran. Now within the close's deadline; after it the vault is left and
 * opened anew, and the step goes on with the new runtime.
 *
 * The reopen here is what `loadVault` does with the vault on screen: it closes
 * the old runtime the way every close does (`closeVaultRuntime`: drafts, the
 * saves, the index, the owed queue entries, then the call-off) and waits until
 * that runtime and the cycle the step left have ended (text 7).
 */

const VAULT = "/vaults/notes";
const messages = () => toastStore.get().map((t) => t.message);
const hanging = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
};

beforeEach(async () => {
  await i18n.changeLanguage("en");
  resetVaultTeardownsForTests();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  toast.clearAll();
});

describe("a step that stops the sync on the desktop", () => {
  it("goes on with the runtime on screen where the cycle ends in time", async () => {
    expect.hasAssertions();
    const order: string[] = [];
    const worker = { stop: vi.fn(), stopAndDrain: async () => { order.push("drained"); } };
    const outcome = await stopSyncForStep({ path: VAULT, vault: "Notes", worker, fence: createVaultCallOff(), forgetWorker: () => order.push("forget"), reopen: async () => { order.push("reopen"); } });
    expect(outcome).toBe("same");
    expect(worker.stop).toHaveBeenCalled();
    expect(order).toEqual(["drained"]);
  });

  it("does nothing without a sync", async () => {
    expect.hasAssertions();
    expect(await stopSyncForStep({ path: VAULT, vault: "Notes", worker: null, fence: null, forgetWorker: () => {}, reopen: async () => {} })).toBe("same");
  });

  it("after 30 s leaves the vault in the close's order: a save that is still on its way lands, and the vault opens anew once the cycle it left has ended", async () => {
    expect.hasAssertions();
    const order: string[] = [];
    const fence = createVaultCallOff();
    const files = new Map<string, string>();
    const storage = fence.storage({ writeTextFile: async (p: string, v: string) => { files.set(p, v); } } as never) as unknown as { writeTextFile(p: string, v: string): Promise<void> };
    const cycle = hanging();
    const worker = { stop: vi.fn(), stopAndDrain: () => cycle.promise };
    let reopened = false;
    let save = "none";
    const stopping = stopSyncForStep({
      path: VAULT,
      vault: "Notes",
      worker,
      fence,
      forgetWorker: () => order.push("forget"),
      // As `loadVault` with the vault on screen: the editor's save fires as the vault reloads (its debounce, the
      // unmount flush), the old runtime closes in the close's order, and the open waits for its end.
      reopen: async () => {
        const typed = storage.writeTextFile("Note.md", "typed").then(() => { save = "written"; }, (e: unknown) => { save = isCalledOffError(e) ? "refused" : String(e); });
        const { closed } = closeVaultRuntime({ path: VAULT, worker: null, settingsOnly: null, indexer: null, indexQueue: null, fence, owed: { flush: async () => { order.push(fence.calledOff ? "owed after the call-off" : "owed"); } } }, {
          flushDrafts: async () => { order.push("drafts"); },
          forgetDraftMemory: () => {},
          settlePendingWrites: async () => { await typed; order.push("saves"); },
          pendingWritePaths: () => [],
          vaultLabel: () => "Notes",
        });
        await closed;
        await waitForClosingVault(awaitVaultTeardown(VAULT), "Notes");
        reopened = true;
      },
    });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(messages()).toEqual([i18n.t("closing.syncWait", { vault: "Notes" })]);
    await vi.advanceTimersByTimeAsync(25_000);
    expect(messages()).toContain(i18n.t("closing.syncGaveUp", { vault: "Notes" }));
    // THE DEFECT: the step called the runtime off before the saves had their chance — the save that fired then was refused.
    expect(save, "the save lands").toBe("written");
    expect(files.get("Note.md")).toBe("typed");
    expect(order).toEqual(["forget", "drafts", "saves", "owed"]);
    expect(fence.calledOff, "called off after the saves").toBe(true);
    // Never two runtimes at one vault: the new one opens once the cycle the step left has ended.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(reopened).toBe(false);
    expect(messages()).toContain(i18n.t("closing.stillClosing", { vault: "Notes" }));
    cycle.resolve();
    expect(await stopping).toBe("renewed");
    expect(reopened).toBe(true);
  });
});

/**
 * The saves of notes an editor left (`leftNoteSaves.ts`) are tried again by
 * themselves — through the runtime their editor wrote with. A reload of the
 * same vault closes that runtime through `closeVaultRuntime`, whose
 * `settlePendingWrites` ends the vault's left saves and starts a new epoch:
 * nothing is tried again through the old runtime afterwards, after a plain
 * reload as after a step that had to leave the vault ("renewed").
 */
describe("the left saves of notes over a reload of the same vault", () => {
  afterEach(() => resetLeftNoteSavesForTests());

  /** A left save of the old runtime, its first try failed: tried again by itself from then on. */
  function leftSave() {
    const tries = { count: 0 };
    const epoch = leftNoteSaveEpoch(VAULT);
    const save = { vaultPath: VAULT, path: "Inbox/Plan.md", epoch, retry: async () => { tries.count += 1; throw new Error("disk"); }, stillDue: () => true };
    adoptLeftNoteSave(save, new Error("disk"));
    expect(hasLeftNoteSave(VAULT, "Inbox/Plan.md")).toBe(true);
    return { tries, save };
  }

  /** The reload as `loadVault` has it for the vault on screen: the old runtime closes through `closeVaultRuntime`. */
  const reload = async () => {
    const fence = createVaultCallOff();
    const { closed } = closeVaultRuntime({ path: VAULT, worker: null, settingsOnly: null, indexer: null, indexQueue: null, fence }, {
      flushDrafts: async () => {},
      forgetDraftMemory: () => {},
      settlePendingWrites,
      pendingWritePaths: () => [],
      vaultLabel: () => "Notes",
    });
    await closed;
  };

  it("after a plain reload: the old runtime's left save is not tried again, and a late hand-over of its editor is refused", async () => {
    expect.hasAssertions();
    const { tries, save } = leftSave();
    await reload();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(tries.count, "no try through the old runtime").toBe(0);
    expect(hasLeftNoteSave(VAULT, "Inbox/Plan.md")).toBe(false);
    adoptLeftNoteSave(save, new Error("disk"));
    expect(hasLeftNoteSave(VAULT, "Inbox/Plan.md"), "the old epoch is refused").toBe(false);
  });

  it("after a step that had to leave the vault ('renewed'): the same", async () => {
    expect.hasAssertions();
    const { tries, save } = leftSave();
    const cycle = hanging();
    // While the step waits for the cycle the old runtime is still the vault's: a try there is right. From the reload on, none.
    let atReload = -1;
    const stopping = stopSyncForStep({
      path: VAULT, vault: "Notes", worker: { stop: () => {}, stopAndDrain: () => cycle.promise }, fence: createVaultCallOff(),
      forgetWorker: () => {},
      reopen: async () => { atReload = tries.count; await reload(); },
    });
    await vi.advanceTimersByTimeAsync(30_000);
    cycle.resolve();
    expect(await stopping).toBe("renewed");
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(atReload, "reloaded").toBeGreaterThanOrEqual(0);
    expect(tries.count - atReload, "no try through the old runtime after the reload").toBe(0);
    adoptLeftNoteSave(save, new Error("disk"));
    expect(hasLeftNoteSave(VAULT, "Inbox/Plan.md")).toBe(false);
  });
});
