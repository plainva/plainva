import { describe, expect, it, vi } from "vitest";
import { VaultIndexer } from "../src/vault/VaultIndexer.js";
import { BackupVaultAdapter } from "../src/vault/BackupVaultAdapter.js";
import type { IVaultAdapter } from "../src/vault/IVaultAdapter.js";
import { MockDatabaseAdapter } from "./mocks/MockDatabaseAdapter.js";

describe("index lifetime", () => {
  it("retains indexed notes under a subtree that could not be inspected", async () => {
    const db = new MockDatabaseAdapter();
    vi.spyOn(db, "query").mockResolvedValue([{ path: "offline/kept.md", mtime_local: 42 }]);
    const execute = vi.spyOn(db, "execute");
    const deleted = vi.fn();
    const vault = { listDirReport: async () => ({ files: [], skipped: [{ path: "offline", reason: "unreadable" }] }) } as unknown as IVaultAdapter;
    const result = await new VaultIndexer(vault, db, { onLocalFileDeleted: deleted }).indexVaultFull();
    expect(result.removed).toBe(0);
    // Nothing but the index's marks of a scan that went through (third review of 11.11.).
    expect(execute.mock.calls.filter(([sql]) => !/\bmeta\b/.test(String(sql)))).toEqual([]);
    expect(deleted).not.toHaveBeenCalled();
  });
  it("cancels through the adapter wrapper before deleting or indexing any rows", async () => {
    const controller = new AbortController();
    const db = new MockDatabaseAdapter();
    const execute = vi.spyOn(db, "execute");
    const listDirReport = vi.fn(async (_path, _recursive, options) => {
      expect(options.signal).toBe(controller.signal);
      controller.abort();
      return { files: [], skipped: [] };
    });
    const raw = { listDirReport } as unknown as IVaultAdapter;
    const indexer = new VaultIndexer(new BackupVaultAdapter(raw), db, { scanSignal: controller.signal });
    await expect(indexer.indexVaultFull()).rejects.toMatchObject({ name: "AbortError" });
    await indexer.whenIdle();
    // Nothing but the mark that the index, empty, is owed a scan (third review of 11.11.).
    expect(execute.mock.calls.filter(([sql]) => !/\bmeta\b/.test(String(sql)))).toEqual([]);
    await expect(indexer.indexVaultFull()).rejects.toMatchObject({ name: "AbortError" });
    expect(listDirReport).toHaveBeenCalledTimes(1);
  });

  it("coalesces overlapping reconciles into one follow-up and waits for both", async () => {
    // A caller arriving during a scan gets the scan after it (3.118), and
    // every further caller shares that one: two scans, not three.
    let finish!: () => void;
    const gate = new Promise<void>(resolve => { finish = resolve; });
    const listDir = vi.fn(async () => { await gate; return []; });
    const indexer = new VaultIndexer({ listDir } as unknown as IVaultAdapter, new MockDatabaseAdapter());
    const first = indexer.indexVaultFull();
    const second = indexer.indexVaultFull();
    expect(second).not.toBe(first);
    expect(indexer.indexVaultFull()).toBe(second);
    let idle = false;
    const waiting = indexer.whenIdle().then(() => { idle = true; });
    await Promise.resolve();
    expect(idle).toBe(false);
    finish();
    await Promise.all([first, second, waiting]);
    expect(listDir).toHaveBeenCalledTimes(2);
  });
});
