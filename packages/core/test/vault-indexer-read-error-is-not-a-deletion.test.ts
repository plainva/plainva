import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { realSqlite } from "./helpers/realSqlite.js";
import { MemoryVaultAdapter } from "./helpers/memoryVault.js";
import type { IDatabaseAdapter } from "../src/db/IDatabaseAdapter.js";
import { VaultFileNotFoundError, VaultPermissionDeniedError } from "../src/vault/IVaultAdapter.js";
import { VaultIndexer } from "../src/vault/VaultIndexer.js";

/**
 * A file the index could not look at is not a file that is gone (finding
 * 2026-10-13).
 *
 * The pass over a single path took EVERY failure of `getFileInfo` for "not
 * there": the row left the index and the host was told the file had been
 * deleted, which queues its deletion on the remote — and on every other
 * device. A file that was locked for a moment, a share that had dropped, a
 * provider that did not answer: deleted everywhere. The second look, taken
 * right before the row goes, read a failure as "not back" in the same way.
 *
 * And where the vault's own folder is gone — a network drive, a picked folder
 * whose provider is away — every path in it honestly answers "not found". That
 * is no deletion either: nothing in a vault that is not there can be judged.
 */

let vault: MemoryVaultAdapter;
let db: IDatabaseAdapter;
let indexer: VaultIndexer;
let gone: string[];

beforeEach(async () => {
  vault = new MemoryVaultAdapter();
  db = await realSqlite();
  gone = [];
  indexer = new VaultIndexer(vault, db, { onLocalFileDeleted: (p) => gone.push(p) });
  await vault.writeTextFile("note.md", "# Note\n");
  await vault.writeTextFile("Folder/inner.md", "# Inner\n");
  await indexer.indexVaultFull();
});

afterEach(async () => {
  await db.close();
});

const rows = async () => (await db.query<{ path: string }>("SELECT path FROM files ORDER BY path")).map((r) => r.path);
const both = ["Folder/inner.md", "note.md"];

/** Every look at a file's metadata fails the way `failure` says, until the returned function is called. */
function metadataFails(failure: (path: string) => Error): () => void {
  const real = vault.getFileInfo.bind(vault);
  vault.getFileInfo = async (p) => { throw failure(p); };
  return () => { vault.getFileInfo = real; };
}

/** The vault's own folder is away: every path answers "not found", the folder itself does not answer as present. */
function vaultFolderIsAway(rootAnswer: () => Promise<boolean>): void {
  vault.getFileInfo = async (p) => { throw new VaultFileNotFoundError(p); };
  vault.exists = async (p) => (p === "" ? rootAnswer() : false);
  vault.listDir = async (p) => { throw new VaultFileNotFoundError(p ?? ""); };
}

describe("a file the index could not look at", () => {
  it.each([
    ["a permission error", (p: string) => new VaultPermissionDeniedError(p)],
    ["an error without a kind", () => new Error("The device is not ready")],
    ["a plugin error with a code of its own", () => Object.assign(new Error("read unavailable"), { code: "EIO" })],
  ])("stays in the index and is not reported gone (%s)", async (_name, failure) => {
    metadataFails(failure);
    // The pass fails with the adapter's own error: the shells try such a
    // path again, and then leave it to the full scan.
    const thrown = failure("note.md");
    await expect(indexer.inspectPath("note.md")).rejects.toThrow(thrown.message);
    await expect(indexer.indexPath("note.md")).rejects.toThrow(thrown.message);
    expect(gone).toEqual([]);
    expect(await rows()).toEqual(both);
  });

  it("stays in the index where the existence check cannot be asked either", async () => {
    metadataFails(() => new Error("The device is not ready"));
    vault.exists = async () => { throw new Error("The device is not ready"); };
    await expect(indexer.inspectPath("note.md")).rejects.toThrow("The device is not ready");
    expect(gone).toEqual([]);
    expect(await rows()).toEqual(both);
  });

  it("is judged again by the next pass, and found gone when it is", async () => {
    const heal = metadataFails(() => new Error("The device is not ready"));
    await expect(indexer.inspectPath("note.md")).rejects.toThrow("The device is not ready");
    heal();
    expect(await indexer.inspectPath("note.md")).toBe("unchanged");
    expect(gone).toEqual([]);

    await vault.deleteItem("note.md");
    expect(await indexer.inspectPath("note.md")).toBe("removed");
    expect(gone).toEqual(["note.md"]);
    expect(await rows()).toEqual(["Folder/inner.md"]);
  });

  it("is not removed when the second look, right before the row goes, fails", async () => {
    // Missing at the first look, unreadable at the second: nothing is proven.
    const real = vault.getFileInfo.bind(vault);
    let looks = 0;
    vault.getFileInfo = async (p) => {
      if (p !== "note.md") return real(p);
      if (++looks === 1) throw new VaultFileNotFoundError(p);
      throw new Error("The device is not ready");
    };
    vault.exists = async (p) => { if (p === "") return true; throw new Error("The device is not ready"); };
    await expect(indexer.inspectPath("note.md")).rejects.toThrow("The device is not ready");
    expect(gone).toEqual([]);
    expect(await rows()).toEqual(both);
    // The failed pass left no transaction open behind it: the next one opens its own.
    vault.getFileInfo = real;
    vault.exists = async (p) => p === "";
    await vault.deleteItem("note.md");
    expect(await indexer.inspectPath("note.md")).toBe("removed");
    expect(gone).toEqual(["note.md"]);
  });
});

describe("a file that is gone", () => {
  it("leaves the index and is reported, once", async () => {
    await vault.deleteItem("note.md");
    expect(await indexer.inspectPath("note.md")).toBe("removed");
    expect(await indexer.inspectPath("note.md")).toBe("unchanged");
    expect(gone).toEqual(["note.md"]);
    expect(await rows()).toEqual(["Folder/inner.md"]);
  });

  it("is found gone where the adapter's metadata call fails without a kind and only its existence check knows", async () => {
    // The desktop adapter asks "is it there" and then reads the metadata: a
    // file removed between the two fails the second call with the platform's
    // own message. The deletion must not stay in the index for good.
    await vault.deleteItem("note.md");
    metadataFails(() => new Error("failed to get metadata: os error 2"));
    expect(await indexer.inspectPath("note.md")).toBe("removed");
    expect(gone).toEqual(["note.md"]);
    expect(await rows()).toEqual(["Folder/inner.md"]);
  });
});

describe("a vault whose own folder is away", () => {
  it.each([
    ["answers as absent", async () => false],
    ["cannot be asked", async (): Promise<boolean> => { throw new Error("The network path was not found"); }],
  ])("loses no row and reports nothing through a single path (the folder %s)", async (_name, rootAnswer) => {
    vaultFolderIsAway(rootAnswer);
    expect(await indexer.inspectPath("note.md")).toBe("unchanged");
    expect(await indexer.indexPath("Folder/inner.md")).toBe("unchanged");
    expect(gone).toEqual([]);
    expect(await rows()).toEqual(both);
  });

  it.each([
    ["answers as absent", async () => false],
    ["cannot be asked", async (): Promise<boolean> => { throw new Error("The network path was not found"); }],
  ])("loses no row and reports nothing when a folder in it is re-read (the folder %s)", async (_name, rootAnswer) => {
    vaultFolderIsAway(rootAnswer);
    const report = await indexer.reconcileFolder("Folder");
    expect(report.removed).toEqual([]);
    expect(gone).toEqual([]);
    expect(await rows()).toEqual(both);
  });

  it.each([
    // Away until the second look at the file is through: only the question BEFORE that look can know.
    ["comes back right after the look", false, true],
    // There until the second look begins: only the question AFTER it can know.
    ["drops right before the look", true, false],
  ])("loses no row when the folder %s", async (_name, thereBefore, thereAfter) => {
    // A share that reconnects, or drops, while one path is judged. The path
    // answers "not found" all along; the folder's state turns inside the
    // second look, the one taken in the transaction.
    let there = thereBefore;
    let looks = 0;
    vault.getFileInfo = async (p) => {
      if (++looks === 2) there = thereAfter;
      throw new VaultFileNotFoundError(p);
    };
    vault.exists = async (p) => (p === "" ? there : false);
    expect(await indexer.inspectPath("note.md")).toBe("unchanged");
    expect(looks).toBe(thereBefore ? 2 : 1);
    expect(gone).toEqual([]);
    expect(await rows()).toEqual(both);
  });

  it("still empties a folder that is gone from a vault that is there", async () => {
    await vault.deleteItem("Folder", true);
    const list = vault.listDir.bind(vault);
    vault.listDir = async (p, ...rest) => {
      if (p === "Folder") throw new VaultFileNotFoundError(p);
      return list(p, ...rest);
    };
    const report = await indexer.reconcileFolder("Folder");
    expect(report.removed).toEqual(["Folder/inner.md"]);
    expect(gone).toEqual(["Folder/inner.md"]);
    expect(await rows()).toEqual(["note.md"]);
  });
});
