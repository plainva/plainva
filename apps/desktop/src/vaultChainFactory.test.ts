import { describe, expect, it } from "vitest";
import ts from "typescript";
import { MemoryWorkspaceStateStore, PLAIN_VAULT_CHAIN, SyncQueue, UNINDEXED_VAULT_CHAIN, VaultPermissionDeniedError, WORKSPACE_VAULT_CHAIN, buildVaultChain } from "@plainva/core";
import { MemoryVaultAdapter } from "../../../packages/core/test/helpers/memoryVault";
import { realSqlite } from "../../../packages/core/test/helpers/realSqlite";
import { desktopChainPorts } from "./services/vaultChainPorts";
import { shippedSources } from "./test-sourceTree";

/**
 * Both shells get the SAME chain (stability plan R2, finding S2).
 *
 * The order of a vault's links is behaviour — a version before every write,
 * the permission check before the queue, the conflict guard on top — and it
 * lives once, in `buildVaultChain` (packages/core; its tests show the order
 * call by call). What is held here is that no code has a second recipe, and
 * that the desktop's ports give a workspace vault its permission check (the
 * phone's twin is `services/mobileChainPorts.test.ts` there).
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

const LINKS = new Set(["BackupVaultAdapter", "QueueingVaultAdapter", "WorkspaceQueueingVaultAdapter", "PermissionedVaultAdapter", "ConflictAwareVaultAdapter", "ConflictFileStore", "SyncStateRepository"]);

/**
 * Where a link class may be named as a value. Its own module defines it; the
 * factory builds it; and — with its reason — the few others. Everything else,
 * in every package, fails: naming the class is what every way of building one
 * needs (`new`, a namespace, a generic, an alias, a destructured rename,
 * `Reflect.construct`), so the guard does not chase spellings of `new`. A
 * mention as a TYPE is free: a type builds nothing.
 */
const MAY_NAME: Record<string, string> = {
  "packages/core/src/vault/vaultChain.ts": "the factory",
  "packages/core/src/vault/BackupVaultAdapter.ts": "its own module",
  "packages/core/src/vault/QueueingVaultAdapter.ts": "its own module",
  "packages/core/src/vault/ConflictAwareVaultAdapter.ts": "its own module (a static limit read on its own class)",
  "packages/core/src/vault/ConflictFileStore.ts": "its own module",
  "packages/core/src/vault/SyncStateRepository.ts": "its own module; it keeps the conflict journal in a ConflictFileStore over the files it is handed — the factory hands it the versions layer",
  "packages/core/src/workspace/authorization.ts": "the module of PermissionedVaultAdapter",
  "packages/core/src/workspace/queueingVaultAdapter.ts": "the module of WorkspaceQueueingVaultAdapter",
  "packages/core/src/vault/VaultIndexer.ts":
    "the index's own view of the sync state over the same database (hashes, merge bases, the not-text mark): a SyncStateRepository without files — no conflict journal, no file written, no link of a chain",
};

/** Is this identifier part of a type (or a type-only import or export)? */
function inType(node: ts.Node): boolean {
  for (let at = node.parent; at; at = at.parent) {
    // `class X extends Link` names the class as a value: the subclass builds one.
    if (ts.isHeritageClause(at)) return at.token !== ts.SyntaxKind.ExtendsKeyword || !ts.isClassLike(at.parent);
    if (ts.isTypeNode(at) && !ts.isExpressionWithTypeArguments(at) || ts.isTypeAliasDeclaration(at) || ts.isInterfaceDeclaration(at)) return true;
    if (ts.isImportSpecifier(at) || ts.isExportSpecifier(at)) return at.isTypeOnly || at.parent.parent.isTypeOnly;
    if (ts.isImportClause(at)) return at.isTypeOnly;
  }
  return false;
}

/** Every place a link class is named as a value: an identifier, or a string that is its name (`core["…"]`). */
function namings(rel: string, text: string): string[] {
  const file = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, rel.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found: string[] = [];
  (function visit(node: ts.Node) {
    const named = (ts.isIdentifier(node) && LINKS.has(node.text) && !inType(node)) || ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && LINKS.has(node.text));
    if (named) found.push(`${rel}:${file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1} ${node.getText(file)}`);
    ts.forEachChild(node, visit);
  })(file);
  return found;
}

describe("the vault chain", () => {
  it("keeps the order both shells had before the factory", () => {
    expect(PLAIN_VAULT_CHAIN).toEqual(["storage", "versions", "sync-queue", "conflict-guard"]);
    expect(WORKSPACE_VAULT_CHAIN).toEqual(["storage", "versions", "permissions", "workspace-queue", "conflict-guard"]);
    expect(UNINDEXED_VAULT_CHAIN).toEqual(["storage", "versions", "conflict-guard"]);
  });

  it("names a link class nowhere but where the list says: no code builds a link itself, whatever the spelling", () => {
    const offenders = shippedSources(["apps/desktop/src", "apps/mobile/src", "packages/ui/src", "packages/core/src"])
      .filter(({ rel }) => !(rel in MAY_NAME))
      .flatMap(({ rel, text }) => namings(rel, text));
    expect(offenders, "build the chain with `buildVaultChain` (packages/core/src/vault/vaultChain.ts); name a link only as a type").toEqual([]);
  });

  it("the guard sees every way of building a link (review 2026-11-12)", () => {
    const shapes = {
      plain: "const g = new ConflictAwareVaultAdapter(inner, repo);",
      namespace: `import * as core from "@plainva/core"; const g = new core.ConflictAwareVaultAdapter(inner, repo);`,
      generic: "const g = new ConflictAwareVaultAdapter<VaultAdapter>(inner, repo);",
      newline: "const g = new\n  ConflictAwareVaultAdapter(inner, repo);",
      destructured: `const { ConflictAwareVaultAdapter: Guard } = await import("@plainva/core"); const g = new Guard(inner, repo);`,
      assigned: "const Guard = ConflictAwareVaultAdapter; const g = new Guard(inner, repo);",
      reflect: "const g = Reflect.construct(QueueingVaultAdapter, [inner, queue]);",
      subclass: "class Mine extends BackupVaultAdapter {}",
      indexed: `import * as core from "@plainva/core"; const g = new core["SyncStateRepository"](db);`,
    };
    for (const [shape, text] of Object.entries(shapes)) expect(namings("apps/x/shape.ts", text), shape).not.toEqual([]);
    // A type builds nothing.
    expect(namings("apps/x/types.ts", `import type { BackupVaultAdapter } from "@plainva/core"; let below: BackupVaultAdapter | null = null;`)).toEqual([]);
  });

  it("every entry of the list says why", () => {
    for (const [rel, why] of Object.entries(MAY_NAME)) expect(why.length, rel).toBeGreaterThan(8);
  });

  it("is built by each shell's vault opening, from its ports, over the storage it opened", () => {
    const sources = new Map(shippedSources(["apps/desktop/src", "apps/mobile/src"]).map(({ rel, text }) => [rel, text]));
    const desktop = sources.get("apps/desktop/src/contexts/VaultContext.tsx")!;
    const phone = sources.get("apps/mobile/src/services/vaultService.ts")!;
    expect(desktop.match(/buildVaultChain\(desktopChainPorts\(\{\s*vaultPath: path,\s*storage: tauriVaultAdapter,/g)).toHaveLength(1);
    // With the index database, and without it.
    expect(phone.match(/buildVaultChain\(mobileChainPorts\(\{\s*storage: adapter,/g)).toHaveLength(2);
    // A vault with a workspace state hands it to the ports, in both shells (the state is made for every vault whose
    // security status names a workspace, unlocked or not; locked, the check refuses everything — see below).
    expect(desktop).toMatch(/workspace: workspaceStateStore \? \{ state: workspaceStateStore, runtime: workspaceRuntime \} : null,/);
    expect(phone).toMatch(/workspace: workspaceState \? \{ state: workspaceState, runtime: workspaceRuntime \} : null,/);
    // The phone's app code reaches the writable lowest link only by its own name (see rawVaultAdapter.test.ts).
    expect(phone).toMatch(/belowChain: backup,/);
  });
});

describe("the desktop's chain ports (review 2026-11-12: by behaviour, not by text)", () => {
  async function opened(workspace: boolean) {
    const storage = new MemoryVaultAdapter(1_000);
    await storage.writeTextFile("Note.md", "shared\n");
    const db = await realSqlite();
    const state = new MemoryWorkspaceStateStore();
    // A workspace whose runtime is not there — locked: its check refuses every change.
    const chain = buildVaultChain(desktopChainPorts({
      vaultPath: "C:/vaults/a", storage, versions: {}, deviceId: "desktop-a", db, queue: new SyncQueue(db),
      workspace: workspace ? { state, runtime: null } : null,
      confirm: async () => false,
    }));
    return { storage, chain };
  }

  it("give a workspace vault its permission check: a change the check refuses writes nothing", async () => {
    const { storage, chain } = await opened(true);
    expect(chain.links).toEqual(WORKSPACE_VAULT_CHAIN);
    await expect(chain.files.writeTextFile("Note.md", "changed\n")).rejects.toBeInstanceOf(VaultPermissionDeniedError);
    expect(await storage.readTextFile("Note.md")).toBe("shared\n");
  });

  it("give a plain vault none", async () => {
    const { storage, chain } = await opened(false);
    expect(chain.links).toEqual(PLAIN_VAULT_CHAIN);
    await chain.files.writeTextFile("Note.md", "changed\n");
    expect(await storage.readTextFile("Note.md")).toBe("changed\n");
  });
});
