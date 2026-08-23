// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * What the second window's sync surface does (multi-window C3).
 *
 * The interesting assertion is not "the button works". It is that a client
 * window is not silently WITHOUT a sync worker: null there reads through the
 * whole shell as "this vault is local", and one of the things that falls out of
 * that reading is a deletion the owner then has to ask a stranger about.
 */

const sent: Array<{ event: string; args: unknown }> = [];
let failing = false;
vi.mock("./windowBus", () => ({
  getWindowBus: async () => ({
    request: async (event: string, args: unknown) => {
      if (failing) throw new Error("no owner");
      sent.push({ event, args });
    },
  }),
}));

import { createClientSyncWorker } from "./clientSyncWorker";

const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  sent.length = 0;
  failing = false;
});

describe("the sync worker a client window gets", () => {
  it("sends the two status-bar buttons to the owner", async () => {
    const w = createClientSyncWorker();
    w.triggerImmediate();
    w.retryFailed();
    await settle();

    expect(sent).toEqual([
      { event: "sync-control", args: { what: "now" } },
      { event: "sync-control", args: { what: "retry" } },
    ]);
  });

  it("reports a deletion as user-initiated, with the paths", async () => {
    const w = createClientSyncWorker();
    w.noteUserInitiatedDeletion(["a.md", "b/c.md"]);
    await settle();

    // The owner's mass-deletion guard is the reader. Drop this hop and deleting
    // a folder here stops the cycle and puts the question in the other window.
    expect(sent).toEqual([{ event: "sync-control", args: { what: "note-deletions", paths: ["a.md", "b/c.md"] } }]);
  });

  it("keeps the lifecycle to itself", async () => {
    // start/stop/stopAndDrain belong to the window that owns the vault (E7).
    // Forwarding them would let one window stop syncing for everybody.
    const w = createClientSyncWorker();
    w.start();
    w.stop();
    await w.stopAndDrain();
    await settle();

    expect(sent).toEqual([]);
  });

  it("answers the queue view with an empty queue instead of throwing", async () => {
    // The settings open in the central window, so nobody asks here today — an
    // exception would surface as a broken panel the day somebody does.
    await expect(createClientSyncWorker().listPendingOperations()).resolves.toEqual({ total: 0, items: [] });
  });

  it("has no fullResync of its own", () => {
    // "Reload vault" already travels to the owner through the reindex RPC,
    // which runs the owner's full resync. A second one here would run the
    // cloud step twice.
    expect(createClientSyncWorker().fullResync).toBeUndefined();
  });

  it("does not throw when the central window is gone", async () => {
    failing = true;
    const w = createClientSyncWorker();
    expect(() => w.triggerImmediate()).not.toThrow();
    await settle();
    expect(sent).toEqual([]);
  });
});
