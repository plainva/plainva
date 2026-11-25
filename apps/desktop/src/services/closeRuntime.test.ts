// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@plainva/ui/i18n";
import { closingAtSyncPlace, resetClosingSyncPlacesForTests, syncStateBindingFor, toast, toastStore, waitForClosingSyncPlace, waitForClosingVault } from "@plainva/ui";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createVaultCallOff, QueueingVaultAdapter, SyncQueue } from "@plainva/core";
import { LocalVaultAdapter } from "../../../../packages/core/src/vault/LocalVaultAdapter";
import { realSqlite } from "../../../../packages/core/test/helpers/realSqlite";
import { closeVaultRuntime, type CloseRuntimeDeps } from "./closeRuntime";
import { awaitVaultTeardown, resetVaultTeardownsForTests } from "./vaultTeardown";

/**
 * The desktop's close of a vault's runtime (`closeVaultRuntime`), the one way
 * of `teardownVault` and of a reload: in order, within one deadline for the
 * whole close, and the same vault opens again only once the runtime has ENDED
 * — never two runtimes at one vault.
 */

const VAULT = "/vaults/notes";
const messages = () => toastStore.get().map((t) => t.message);
const hanging = <T = void>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};

function deps(order: string[], over: Partial<CloseRuntimeDeps> = {}): CloseRuntimeDeps {
  return {
    flushDrafts: async () => { order.push("drafts"); },
    forgetDraftMemory: () => {},
    settlePendingWrites: async () => { order.push("saves"); },
    pendingWritePaths: () => ["Inbox/Plan.md"],
    vaultLabel: () => "Notes",
    ...over,
  };
}

beforeEach(async () => {
  await i18n.changeLanguage("en");
  resetVaultTeardownsForTests();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  toast.clearAll();
});

describe("closing a vault's runtime on the desktop", () => {
  it("goes in order — drafts, saves, the sync step, the index — and ends once nothing of it is open", async () => {
    const order: string[] = [];
    const fence = createVaultCallOff();
    const { closed, ended } = closeVaultRuntime({
      path: VAULT,
      worker: { stopAndDrain: async () => { order.push("sync"); } },
      settingsOnly: { stopAndDrain: async () => { order.push("settings"); } },
      indexer: { whenIdle: async () => { order.push("index"); } },
      indexQueue: { whenIdle: async () => { order.push("queue"); } },
      fence,
    }, deps(order));
    await closed;
    await ended;
    expect(order).toEqual(["drafts", "saves", "sync", "settings", "index", "queue"]);
    expect(fence.calledOff, "through: nothing of it writes any more").toBe(true);
    expect(messages()).toEqual([]);
  });

  it("gives up after 30 s in the sync step: called off at once, the person goes on, and the same vault waits until the step's call has ended", async () => {
    const fence = createVaultCallOff();
    const storage = fence.storage({ writeTextFile: () => new Promise<void>(() => undefined) } as never) as unknown as { writeTextFile(): Promise<void> };
    const request = hanging();
    const { closed } = closeVaultRuntime({
      path: VAULT,
      // The sync step hangs on a call that is still open in the fenced storage.
      worker: { stopAndDrain: () => { void storage.writeTextFile().catch(() => undefined); return request.promise; } },
      settingsOnly: null, indexer: null, indexQueue: null, fence,
    }, deps([]));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(messages()).toEqual([i18n.t("closing.syncWait", { vault: "Notes" })]);
    await vi.advanceTimersByTimeAsync(25_000);
    await closed;
    expect(messages()).toEqual([i18n.t("closing.syncGaveUp", { vault: "Notes" })]);
    expect(fence.calledOff, "called off at once").toBe(true);

    // The same vault opens again: it waits, and says so (text 7), while the old runtime has a call open.
    toast.clearAll();
    let opened = false;
    const opening = waitForClosingVault(awaitVaultTeardown(VAULT), "Notes").then(() => { opened = true; });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(opened).toBe(false);
    expect(messages()).toEqual([i18n.t("closing.stillClosing", { vault: "Notes" })]);
    expect(fence.open, "the step's call is still open").toBeGreaterThan(0);
    void opening;
    request.resolve();
    await vi.advanceTimersByTimeAsync(0);
    // The storage call never answers in this test: the open stays waiting, and the notice stands with it.
    expect(opened).toBe(false);
    expect(messages()).toEqual([i18n.t("closing.stillClosing", { vault: "Notes" })]);
  });

  it("text 7 stands exactly as long as the old runtime has a call open, and goes then", async () => {
    const fence = createVaultCallOff();
    const call = hanging();
    const storage = fence.storage({ writeTextFile: () => call.promise } as never) as unknown as { writeTextFile(): Promise<void> };
    const write = storage.writeTextFile();
    const { closed } = closeVaultRuntime({ path: VAULT, worker: null, settingsOnly: null, indexer: null, indexQueue: null, fence }, deps([]));
    await closed;
    let opened = false;
    const opening = waitForClosingVault(awaitVaultTeardown(VAULT), "Notes").then(() => { opened = true; });
    await vi.advanceTimersByTimeAsync(6_000);
    expect(messages()).toEqual([i18n.t("closing.stillClosing", { vault: "Notes" })]);
    expect(opened).toBe(false);
    call.resolve();
    await write;
    await opening;
    expect(opened).toBe(true);
    expect(messages(), "gone once nothing is open").toEqual([]);
  });

  it("gives up on a save after 30 s without calling off: the save finishes in the background (text 4), and the runtime goes after it", async () => {
    const fence = createVaultCallOff();
    const save = hanging();
    const { closed, ended } = closeVaultRuntime({ path: VAULT, worker: null, settingsOnly: null, indexer: null, indexQueue: null, fence }, deps([], { settlePendingWrites: () => save.promise }));
    await vi.advanceTimersByTimeAsync(30_000);
    await closed;
    expect(messages()).toEqual([i18n.t("closing.savingGaveUp", { name: "Plan" })]);
    expect(fence.calledOff, "a local write is never overtaken").toBe(false);

    // The note opens again only once its save has ended: the same vault waits for this runtime (text 7).
    toast.clearAll();
    let opened = false;
    const opening = waitForClosingVault(awaitVaultTeardown(VAULT), "Notes").then(() => { opened = true; });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(opened, "never over a save still running").toBe(false);
    expect(messages()).toEqual([i18n.t("closing.stillClosing", { vault: "Notes" })]);
    save.resolve();
    await ended;
    await opening;
    expect(opened).toBe(true);
    expect(fence.calledOff).toBe(true);
  });
});

/**
 * A healthy close loses nothing that is owed to the sync queue. A write whose
 * queue entry could not be made at once (the database busy with another
 * transaction) is owed: its entry is tried again a moment later. Writers the
 * close does not wait for — a journal line from the tray, a task tick, the
 * assistant's write — can leave one owed when the vault closes. The close
 * gives it its last attempt while the runtime may still write, and calls the
 * runtime off only after it (at the order of a close before the fence, the
 * entry was tried against the still open database a quarter second later).
 */
describe("closing a vault's runtime with an entry owed to the sync queue", () => {
  it("gives the owed entry its last attempt before the runtime is called off, so the healthy close keeps it", async () => {
    expect.hasAssertions();
    vi.useRealTimers();
    const root = await mkdtemp(join(tmpdir(), "pv-close-owed-"));
    const raw = await realSqlite();
    try {
      const fence = createVaultCallOff();
      let busy = 1;
      // The database refuses the first queue transaction: busy with another one, as an index pass may hold it.
      const refusingOnce = new Proxy(raw, {
        get(target, key, receiver) {
          const value = Reflect.get(target, key, receiver) as unknown;
          if (typeof value !== "function") return value;
          return (...args: unknown[]) => {
            if (key === "transaction" && busy > 0) { busy -= 1; return Promise.reject(new Error("database is busy")); }
            return (value as (...a: unknown[]) => unknown).apply(target, args);
          };
        },
      });
      const db = fence.database(refusingOnce);
      const storage = fence.storage(new LocalVaultAdapter(root));
      await storage.initialize();
      const owed = new QueueingVaultAdapter(storage, new SyncQueue(db));
      const write = owed.writeTextFile("Journal/2026-11-19.md", "- 05:59 captured from the tray\n").then(() => "saved", (e: Error) => e.name);
      // The entry is owed now; its next attempt is due a quarter second after the change.
      await new Promise((r) => setTimeout(r, 30));
      const { closed, ended } = closeVaultRuntime({ path: VAULT, worker: null, settingsOnly: null, indexer: null, indexQueue: null, fence, owed }, deps([]));
      await closed;
      await ended;
      // Past the entry's next attempt: what it found then is in the database.
      await new Promise((r) => setTimeout(r, 400));
      expect(await raw.query("SELECT operation, file_path FROM offline_queue"), "the entry is in the queue").toEqual([{ operation: "write", file_path: "Journal/2026-11-19.md" }]);
      expect(await Promise.race([write, new Promise((r) => setTimeout(() => r("still owed"), 1_000))]), "the write stands").toBe("saved");
      expect(fence.calledOff, "and only then called off").toBe(true);
    } finally {
      await raw.close().catch(() => undefined);
      await rm(root, { recursive: true, force: true });
    }
  });
});

/**
 * Never two runtimes at one place, and the sync folder at the provider is a
 * place: another vault bound to the same folder waits with its sync for this
 * runtime to end (text 8).
 */
describe("closing a vault's runtime that synced with a folder", () => {
  afterEach(() => resetClosingSyncPlacesForTests());

  it("parks its end under that folder until the runtime has ended", async () => {
    expect.hasAssertions();
    vi.useRealTimers();
    const folder = syncStateBindingFor({ provider: "webdav", webdav: { url: "https://dav.example.test/shared", user: "u" } });
    const fence = createVaultCallOff();
    const call = hanging();
    const storage = fence.storage({ writeTextFile: () => call.promise } as never) as unknown as { writeTextFile(): Promise<void> };
    const write = storage.writeTextFile();
    const { closed } = closeVaultRuntime({ path: VAULT, worker: null, settingsOnly: null, indexer: null, indexQueue: null, fence, syncPlace: folder }, deps([]));
    await closed;
    expect(closingAtSyncPlace(folder).map((c) => c.vault), "another vault's sync at the folder waits").toEqual(["Notes"]);
    let started = false;
    const starting = waitForClosingSyncPlace(folder).then(() => { started = true; });
    await new Promise((r) => setTimeout(r, 10));
    expect(started).toBe(false);
    call.resolve();
    await write;
    await starting;
    expect(started, "starts once the old runtime has ended").toBe(true);
  });
});
