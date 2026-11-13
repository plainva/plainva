import { describe, expect, it } from "vitest";
import { MemoryWorkspaceStateStore, PLAIN_VAULT_CHAIN, StructureNeedsIndexError, SyncQueue, UNINDEXED_LOCAL_VAULT_CHAIN, UNINDEXED_VAULT_CHAIN, VaultPermissionDeniedError, WORKSPACE_VAULT_CHAIN, buildVaultChain } from "@plainva/core";
import { MemoryVaultAdapter } from "../../../../packages/core/test/helpers/memoryVault";
import { realSqlite } from "../../../../packages/core/test/helpers/realSqlite";
import { mobileChainPorts } from "./mobileChainPorts";

/**
 * The phone's chain ports, by behaviour (stability plan R2, review of
 * 2026-11-12): what `boot` hands `buildVaultChain` gives a workspace vault its
 * permission check, a plain vault none, and a vault without its database the
 * chain without a queue. The desktop's twin is `vaultChainFactory.test.ts` there.
 */
async function opened(variant: "workspace" | "plain" | "no database" | "no database, remote") {
  const storage = new MemoryVaultAdapter(1_000);
  await storage.writeTextFile("Note.md", "shared\n");
  const db = await realSqlite();
  const chain = buildVaultChain(mobileChainPorts({
    storage, versions: {}, deviceId: "phone-a",
    index: variant.startsWith("no database") ? null : { db, queue: new SyncQueue(db) },
    // A workspace whose runtime is not there — locked: its check refuses every change.
    workspace: variant === "workspace" ? { state: new MemoryWorkspaceStateStore(), runtime: null } : null,
    kind: "container",
    remote: variant === "no database, remote",
    confirm: async () => false,
  }));
  return { storage, chain };
}

describe("the phone's chain ports", () => {
  it("give a workspace vault its permission check: a change the check refuses writes nothing", async () => {
    const { storage, chain } = await opened("workspace");
    expect(chain.links).toEqual(WORKSPACE_VAULT_CHAIN);
    await expect(chain.files.writeTextFile("Note.md", "changed\n")).rejects.toBeInstanceOf(VaultPermissionDeniedError);
    expect(await storage.readTextFile("Note.md")).toBe("shared\n");
  });

  it("give a plain vault none", async () => {
    const { storage, chain } = await opened("plain");
    expect(chain.links).toEqual(PLAIN_VAULT_CHAIN);
    await chain.files.writeTextFile("Note.md", "changed\n");
    expect(await storage.readTextFile("Note.md")).toBe("changed\n");
  });

  it("give a vault without its database the chain without a queue; one with a remote refuses what only the queue could carry", async () => {
    expect((await opened("no database")).chain.links).toEqual(UNINDEXED_LOCAL_VAULT_CHAIN);
    const { storage, chain } = await opened("no database, remote");
    expect(chain.links).toEqual(UNINDEXED_VAULT_CHAIN);
    await expect(chain.files.deleteItem("Note.md", false)).rejects.toBeInstanceOf(StructureNeedsIndexError);
    expect(await storage.readTextFile("Note.md")).toBe("shared\n");
  });
});
