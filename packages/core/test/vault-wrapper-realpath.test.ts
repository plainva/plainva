import { describe, expect, it } from "vitest";
import { BackupVaultAdapter } from "../src/vault/BackupVaultAdapter.js";
import { ConflictAwareVaultAdapter } from "../src/vault/ConflictAwareVaultAdapter.js";
import { QueueingVaultAdapter } from "../src/vault/QueueingVaultAdapter.js";
import type { IVaultAdapter } from "../src/vault/IVaultAdapter.js";
import type { SyncQueue } from "../src/sync/SyncQueue.js";

// The desktop shell only holds the wrapped chain; the stored spelling of a path
// (path identity, ADR 0016) must reach it through every wrapper.
describe("wrapped vault adapters pass the stored spelling through", () => {
  const stored = "Neutralität/Plan.pdf";
  const inner = { realPath: async () => stored } as unknown as IVaultAdapter;
  it.each([
    ["Queueing", () => new QueueingVaultAdapter(inner, {} as SyncQueue)],
    ["Backup", () => new BackupVaultAdapter(inner)],
    ["ConflictAware", () => new ConflictAwareVaultAdapter(inner, {} as never)],
  ])("%s", async (_name, make) => {
    expect(await make().realPath!("Neutralität/Plan.pdf")).toBe(stored);
  });
  it("falls back to the path when the inner adapter has no spellings", async () => {
    expect(await new QueueingVaultAdapter({} as IVaultAdapter, {} as SyncQueue).realPath!("a/b.md")).toBe("a/b.md");
  });
});
