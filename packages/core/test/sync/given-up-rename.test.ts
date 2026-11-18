import { describe, expect, it, vi } from "vitest";
import { device, world } from "../helpers/davDevice.js";

/**
 * A rename whose queue entry was given up (Fehlerliste 0.9.0 A16,
 * Sammelplan § 3.89 no. 5 to 7).
 *
 * The chain changes the disk first and queues the change second; an entry
 * that still fails 30 seconds after its change is given up, and the rename
 * fails (owedQueueEntries.ts). Both shells then ask whether the file landed at
 * its new name and, where it did, carry on as after a rename: the index
 * follows the move (`relocatePathInIndex`, which reports no deletion) and
 * reads the destination. What reaches the remote then is what this test
 * reads, on the server and on the second device.
 */

const START = "# Plan\n\none\ntwo\nthree\n";

describe("a rename whose queue entry was given up", () => {
  it("ends with the file under its new name only — on the server and on both devices", async () => {
    const { dav, remote } = world();
    const a = await device(dav, { queueing: { giveUpAfterMs: 0, retryAtMs: [] } }), b = await device(dav);
    await a.put("Old.md", START);
    await a.cycle();
    await b.cycle();

    // The database refuses the rename's entry: given up, the rename fails — and landed.
    vi.spyOn(a.queue, "queueRename").mockRejectedValueOnce(new Error("database is locked"));
    await expect(a.app.renameItem("Old.md", "New.md")).rejects.toThrow("database is locked");
    expect(await a.files()).toEqual(["New.md"]);
    // What either shell does with a rename that landed (desktop `applyIndexChanges`, phone `relocatePathInIndex`).
    await a.indexer.relocatePathInIndex("Old.md", "New.md");
    await a.indexer.indexPath("New.md");

    for (let i = 0; i < 3; i++) {
      await a.cycle();
      await b.cycle();
    }

    expect(remote("New.md")).toBe(START);
    expect(remote("Old.md")).toBeNull();
    expect(await a.files()).toEqual(["New.md"]);
    expect(await b.files()).toEqual(["New.md"]);
  });

  it("the same where the next index pass is the first to look (no shell carried on)", async () => {
    const { dav, remote } = world();
    const a = await device(dav, { queueing: { giveUpAfterMs: 0, retryAtMs: [] } }), b = await device(dav);
    await a.put("Old.md", START);
    await a.cycle();
    await b.cycle();
    vi.spyOn(a.queue, "queueRename").mockRejectedValueOnce(new Error("database is locked"));
    await expect(a.app.renameItem("Old.md", "New.md")).rejects.toThrow("database is locked");
    for (let i = 0; i < 3; i++) {
      await a.cycle();
      await b.cycle();
    }
    expect(remote("New.md")).toBe(START);
    expect(remote("Old.md")).toBeNull();
    expect(await a.files()).toEqual(["New.md"]);
    expect(await b.files()).toEqual(["New.md"]);
  });
});
