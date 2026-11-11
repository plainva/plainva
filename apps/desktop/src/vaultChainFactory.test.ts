import { describe, expect, it } from "vitest";
import { PLAIN_VAULT_CHAIN, UNINDEXED_VAULT_CHAIN, WORKSPACE_VAULT_CHAIN } from "@plainva/core";
import { shippedSources } from "./test-sourceTree";

/**
 * Both shells get the SAME chain (stability plan R2, finding S2).
 *
 * The order of a vault's links is behaviour — a version before every write,
 * the permission check before the queue, the conflict guard on top — and it
 * lives once, in `buildVaultChain` (packages/core, its tests show the order
 * call by call). What is held here is that no shell has a second recipe: no
 * app code puts a link of the chain together itself, and each shell's vault
 * opening builds its chain with the factory, over the storage it opened.
 *
 * Today's order, before the factory, as read from the code of App 927dff411:
 * the desktop's `VaultContext` and the phone's `boot` both built
 *   storage → BackupVaultAdapter → [PermissionedVaultAdapter] →
 *   QueueingVaultAdapter | WorkspaceQueueingVaultAdapter → ConflictAwareVaultAdapter,
 * and the phone without its index database
 *   storage → BackupVaultAdapter → ConflictAwareVaultAdapter (conflict state in files).
 * The pinned lists below are those orders. The two shells differed in one
 * argument: the phone's sync state kept its conflict journal on the raw
 * storage, the desktop's on the versions layer — the same files, since the
 * versions layer passes the app's own `.plainva` files straight through; the
 * factory takes the desktop's.
 */

const LINKS = /\bnew (BackupVaultAdapter|QueueingVaultAdapter|WorkspaceQueueingVaultAdapter|PermissionedVaultAdapter|ConflictAwareVaultAdapter|ConflictFileStore|SyncStateRepository)\s*\(/;

describe("the vault chain", () => {
  it("keeps the order both shells had before the factory", () => {
    expect(PLAIN_VAULT_CHAIN).toEqual(["storage", "versions", "sync-queue", "conflict-guard"]);
    expect(WORKSPACE_VAULT_CHAIN).toEqual(["storage", "versions", "permissions", "workspace-queue", "conflict-guard"]);
    expect(UNINDEXED_VAULT_CHAIN).toEqual(["storage", "versions", "conflict-guard"]);
  });

  it("is put together by no shell itself: every link comes from the factory", () => {
    const offenders = shippedSources(["apps/desktop/src", "apps/mobile/src", "packages/ui/src"])
      .filter(({ text }) => LINKS.test(text))
      .map(({ rel, text }) => `${rel}: ${text.match(LINKS)![0]}`);
    expect(offenders, "build the chain with `buildVaultChain` (packages/core/src/vault/vaultChain.ts)").toEqual([]);
  });

  it("is built by each shell's vault opening, over the storage it opened", () => {
    const sources = new Map(shippedSources(["apps/desktop/src", "apps/mobile/src"]).map(({ rel, text }) => [rel, text]));
    const desktop = sources.get("apps/desktop/src/contexts/VaultContext.tsx")!;
    const phone = sources.get("apps/mobile/src/services/vaultService.ts")!;
    expect(desktop.match(/buildVaultChain\(\{\s*storage: tauriVaultAdapter,/g)).toHaveLength(1);
    // With the index database, and without it.
    expect(phone.match(/buildVaultChain\(\{\s*storage: adapter,/g)).toHaveLength(2);
    // The phone's app code reaches the writable lowest link only by its own name (see rawVaultAdapter.test.ts).
    expect(phone).toMatch(/belowChain: backup,/);
  });
});
