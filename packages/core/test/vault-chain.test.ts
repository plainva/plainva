import { describe, expect, it } from "vitest";
import {
  BackupVaultAdapter,
  ConflictAwareVaultAdapter,
  MemoryWorkspaceStateStore,
  PermissionedVaultAdapter,
  PLAIN_VAULT_CHAIN,
  QueueingVaultAdapter,
  SyncQueue,
  UNINDEXED_VAULT_CHAIN,
  VaultPermissionDeniedError,
  WORKSPACE_VAULT_CHAIN,
  WorkspaceQueueingVaultAdapter,
  buildVaultChain,
  type IVaultAdapter,
  type VaultChain,
  type VaultStorageReader,
  type VaultVersionsControl,
  type WorkspaceMutationAuthorizer,
} from "../src/index.js";
import { MemoryVaultAdapter } from "./helpers/memoryVault.js";
import { realSqlite } from "./helpers/realSqlite.js";

/**
 * The one factory of a vault's write chain (stability plan R2). The order of
 * the links is behaviour: these tests hold it twice — as the list of links the
 * factory reports, and as what a write actually does, call by call, at the
 * storage below.
 */

/** The storage, with every call that changes something recorded in order. */
class RecordingStorage extends MemoryVaultAdapter {
  readonly log: string[] = [];
  override async writeTextFile(path: string, content: string) { this.log.push(`write ${path}`); return super.writeTextFile(path, content); }
  override async writeBinaryFile(path: string, content: Uint8Array) { this.log.push(`write ${path}`); return super.writeBinaryFile(path, content); }
  override async deleteItem(path: string, recursive?: boolean) { this.log.push(`delete ${path}`); return super.deleteItem(path, recursive); }
  override async renameItem(from: string, to: string) { this.log.push(`rename ${from} ${to}`); return super.renameItem(from, to); }
  /** What was written to the user's files, without the app's own (versions, conflict journal). */
  userWrites() { return this.log.filter((line) => !line.includes(".plainva/")); }
}

/** Walks a chain from the top down to the storage by the links' own fields, naming each. */
function linksOf(chain: VaultChain, storage: IVaultAdapter): string[] {
  const names: string[] = [];
  let link: unknown = chain.files;
  while (link) {
    if (link === storage) { names.push("storage"); break; }
    if (link instanceof ConflictAwareVaultAdapter) names.push("conflict-guard");
    else if (link instanceof QueueingVaultAdapter) names.push("sync-queue");
    else if (link instanceof WorkspaceQueueingVaultAdapter) names.push("workspace-queue");
    else if (link instanceof PermissionedVaultAdapter) names.push("permissions");
    else if (link instanceof BackupVaultAdapter) names.push("versions");
    else throw new Error("a link the chain does not know");
    const own = link as unknown as { inner?: unknown; raw?: unknown };
    link = own.inner ?? own.raw;
  }
  return names.reverse();
}

async function plainChain(storage = new RecordingStorage(1_000)) {
  const db = await realSqlite();
  const queue = new SyncQueue(db);
  const chain = buildVaultChain({ storage, deviceId: "device-a", index: { db, queue }, kind: "external-folder" });
  const queued = async () => (await db.query<{ operation: string; file_path: string }>("SELECT operation, file_path FROM offline_queue ORDER BY id")).map((row) => `${row.operation} ${row.file_path}`);
  return { storage, db, queue, chain, queued };
}

function workspaceChain(storage: RecordingStorage, authorize: WorkspaceMutationAuthorizer) {
  return realSqlite().then((db) => {
    const state = new MemoryWorkspaceStateStore();
    const chain = buildVaultChain({ storage, deviceId: "device-a", index: { db, queue: new SyncQueue(db) }, workspace: { state, authorize }, kind: "external-folder" });
    return { chain, state };
  });
}

describe("buildVaultChain", () => {
  it("builds the plain vault's chain in its one order, bottom first", async () => {
    const { storage, chain } = await plainChain();
    expect(chain.links).toEqual(["storage", "versions", "sync-queue", "conflict-guard"]);
    expect(PLAIN_VAULT_CHAIN).toEqual(chain.links);
    // What the factory says is what it built, link for link.
    expect(linksOf(chain, storage)).toEqual(chain.links);
    expect(chain.belowChain).toBeInstanceOf(BackupVaultAdapter);
    expect(chain.syncRepo).not.toBeNull();
  });

  it("puts the workspace's permission check between the versions and its own queue", async () => {
    const storage = new RecordingStorage(1_000);
    const { chain } = await workspaceChain(storage, async () => true);
    expect(chain.links).toEqual(["storage", "versions", "permissions", "workspace-queue", "conflict-guard"]);
    expect(WORKSPACE_VAULT_CHAIN).toEqual(chain.links);
    expect(linksOf(chain, storage)).toEqual(chain.links);
  });

  it("without an index database: versions and the conflict guard, nothing queued", () => {
    const storage = new RecordingStorage(1_000);
    const chain = buildVaultChain({ storage, deviceId: "device-a", index: null, kind: "container" });
    expect(chain.links).toEqual(["storage", "versions", "conflict-guard"]);
    expect(UNINDEXED_VAULT_CHAIN).toEqual(chain.links);
    expect(linksOf(chain, storage)).toEqual(chain.links);
    expect(chain.queueing).toBeNull();
    expect(chain.syncRepo).toBeNull();
  });

  it("takes the version of a file BEFORE it writes over it, and queues the change once it is on disk", async () => {
    const { storage, chain, queued } = await plainChain();
    await storage.writeTextFile("Note.md", "one\n");
    storage.log.length = 0;
    await chain.files.writeTextFile("Note.md", "two\n");
    const versionAt = storage.log.findIndex((line) => line.startsWith("write .plainva/backups/"));
    const noteAt = storage.log.indexOf("write Note.md");
    expect(versionAt).toBeGreaterThanOrEqual(0);
    expect(noteAt).toBeGreaterThan(versionAt);
    expect(await storage.readTextFile("Note.md")).toBe("two\n");
    expect(await queued()).toEqual(["write Note.md"]);
  });

  it("keeps the change of a file that changed outside the app since the editor read it (the guard on top)", async () => {
    const { storage, chain } = await plainChain();
    await chain.files.writeTextFile("Note.md", "a\nb\nc\n");
    // Another program changes the last line; the editor still holds what it read, and changes the first.
    await storage.writeTextFile("Note.md", "a\nb\nC\n");
    const result = await chain.files.writeEditorText!("Note.md", "A\nb\nc\n", "a\nb\nc\n");
    expect(editorTextOfStored(result.stored)).toBe("A\nb\nC\n");
    expect(await storage.readTextFile("Note.md")).toBe("A\nb\nC\n");
  });

  it("an open conflict keeps the user's text in a working copy, through the whole chain", async () => {
    const { storage, chain } = await plainChain();
    await chain.files.writeTextFile("Note.md", "line\n");
    await storage.writeTextFile("Note.md", "theirs\n");
    const result = await chain.files.writeEditorText!("Note.md", "mine\n", "line\n");
    // The file keeps what the other side wrote; the user's text lies beside it.
    expect(await storage.readTextFile("Note.md")).toBe("theirs\n");
    expect(result.session).not.toBeNull();
    expect(await storage.readTextFile(result.session!.workingCopyPath)).toBe("mine\n");
    // The next save of the editor goes on into the working copy, never over the other side's text.
    await chain.files.writeEditorText!("Note.md", "mine, more\n", "mine\n");
    expect(await storage.readTextFile("Note.md")).toBe("theirs\n");
  });

  it("a change the workspace refuses takes no version, writes nothing and queues nothing", async () => {
    const storage = new RecordingStorage(1_000);
    await storage.writeTextFile("Note.md", "one\n");
    storage.log.length = 0;
    const { chain, state } = await workspaceChain(storage, async () => ({ allowed: false, reason: "not-granted" }) as never);
    await expect(chain.files.writeTextFile("Note.md", "two\n")).rejects.toBeInstanceOf(VaultPermissionDeniedError);
    expect(storage.log).toEqual([]);
    expect(await storage.readTextFile("Note.md")).toBe("one\n");
    expect(await state.listQueue()).toEqual([]);
  });

  it("a change the workspace allows is versioned, written and queued in the workspace's queue, not the plain one", async () => {
    const storage = new RecordingStorage(1_000);
    await storage.writeTextFile("Note.md", "one\n");
    storage.log.length = 0;
    const { chain, state } = await workspaceChain(storage, async () => true);
    await chain.files.writeTextFile("Note.md", "two\n");
    expect(storage.userWrites()).toEqual(["write Note.md"]);
    expect(await state.listQueuedPaths()).toEqual(["Note.md"]);
    expect(storage.log.findIndex((line) => line.startsWith("write .plainva/backups/"))).toBeLessThan(storage.log.indexOf("write Note.md"));
  });

  it("a write to a file that is not there yet creates it, versioned as nothing and queued", async () => {
    const { storage, chain, queued } = await plainChain();
    await chain.files.writeTextFile("New.md", "fresh\n");
    expect(storage.userWrites()).toEqual(["write New.md"]);
    expect(await queued()).toEqual(["write New.md"]);
  });

  it("a deletion goes only with a net: the version is written before the file goes", async () => {
    const { storage, chain, queued } = await plainChain();
    await storage.writeTextFile("Gone.md", "keep me\n");
    storage.log.length = 0;
    await chain.files.deleteItem("Gone.md", false, { confirmed: true });
    const versionAt = storage.log.findIndex((line) => line.startsWith("write .plainva/backups/"));
    expect(versionAt).toBeGreaterThanOrEqual(0);
    expect(storage.log.indexOf("delete Gone.md")).toBeGreaterThan(versionAt);
    expect(await queued()).toEqual(["delete Gone.md"]);
  });

  it("without the index database the conflict journal lies in files, and a write still takes its version first", async () => {
    const storage = new RecordingStorage(1_000);
    const chain = buildVaultChain({ storage, deviceId: "device-a", index: null, kind: "container" });
    await chain.files.writeTextFile("Note.md", "line\n");
    await storage.writeTextFile("Note.md", "theirs\n");
    storage.log.length = 0;
    const result = await chain.files.writeEditorText!("Note.md", "mine\n", "line\n");
    expect(result.session).not.toBeNull();
    expect(storage.log.some((line) => line.startsWith("write .plainva/conflicts/"))).toBe(true);
  });

  it("hands out what lies below the top by type: a reader cannot write, the versions control only versions", async () => {
    const { chain } = await plainChain();
    const reader: VaultStorageReader = chain.belowChain;
    const versions: VaultVersionsControl = chain.belowChain;
    // @ts-expect-error — a reader has no way to write past the chain
    expect(reader.writeTextFile).toBeDefined();
    // @ts-expect-error — nor does the versions control
    expect(versions.deleteItem).toBeDefined();
    expect(typeof versions.forceBackup).toBe("function");
  });
});

/** The editor's text of what the chain stored (no BOM, `\n`). */
function editorTextOfStored(stored: string): string {
  return stored.replace(/\r\n/g, "\n");
}
