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

  it("is put together by no code but the factory: every link comes from it", () => {
    const LINK_NAMES = "BackupVaultAdapter|QueueingVaultAdapter|WorkspaceQueueingVaultAdapter|PermissionedVaultAdapter|ConflictAwareVaultAdapter|ConflictFileStore|SyncStateRepository";
    // Built directly, under another name, or through a subclass of its own.
    const ALIASED = new RegExp(String.raw`\b(${LINK_NAMES})\s+as\s+\w+`);
    const EXTENDED = new RegExp(String.raw`\bextends\s+(${LINK_NAMES})\b`);
    // The links' own modules define them; the factory builds them; nothing else in any package — but the
    // indexer, whose `SyncStateRepository` over the same database is the index's view of the sync state
    // (hashes, merge bases, the not-text mark): no conflict journal, no file written, no link of a chain.
    const OWN = /^packages\/core\/src\/(vault\/(vaultChain|BackupVaultAdapter|QueueingVaultAdapter|ConflictAwareVaultAdapter|ConflictFileStore|SyncStateRepository|VaultIndexer)|workspace\/(authorization|queueingVaultAdapter))\.ts$/;
    const offenders = shippedSources(["apps/desktop/src", "apps/mobile/src", "packages/ui/src", "packages/core/src"])
      .filter(({ rel }) => !OWN.test(rel))
      .flatMap(({ rel, text }) => [LINKS, ALIASED, EXTENDED].filter((rule) => rule.test(text)).map((rule) => `${rel}: ${text.match(rule)![0]}`));
    expect(offenders, "build the chain with `buildVaultChain` (packages/core/src/vault/vaultChain.ts)").toEqual([]);
  });

  it("is given the workspace's permission check by each shell for a workspace vault", () => {
    const sources = new Map(shippedSources(["apps/desktop/src", "apps/mobile/src"]).map(({ rel, text }) => [rel, text]));
    // The workspace port is set whenever the vault has a workspace state — a vault built with `workspace: null`
    // would get the plain queue and no permission check.
    expect(sources.get("apps/desktop/src/contexts/VaultContext.tsx")).toMatch(/workspace: workspaceStateStore\s*\?\s*\{\s*state: workspaceStateStore,\s*authorize: workspaceWriteAuthorizer\(workspaceRuntime, workspaceStateStore,/);
    expect(sources.get("apps/mobile/src/services/vaultService.ts")).toMatch(/workspace: workspaceState \? \{ state: workspaceState, authorize: workspaceWriteAuthorizer\(workspaceRuntime, workspaceState,/);
    expect(sources.get("apps/desktop/src/contexts/VaultContext.tsx")).toMatch(/const workspaceStateStore = workspaceSecurityStatus \? new SqlWorkspaceStateStore\(dbAdapter\) : null;/);
    expect(sources.get("apps/mobile/src/services/vaultService.ts")).toMatch(/workspaceState = workspaceStatus \? new SqlWorkspaceStateStore\(db\) : null;/);
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
