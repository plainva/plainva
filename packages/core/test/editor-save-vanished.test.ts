import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LocalVaultAdapter } from "../src/vault/LocalVaultAdapter.js";
import { ConflictAwareVaultAdapter } from "../src/vault/ConflictAwareVaultAdapter.js";
import { SyncStateRepository } from "../src/vault/SyncStateRepository.js";
import { VaultFileNotFoundError, VaultUnreachableError } from "../src/vault/IVaultAdapter.js";
import { realSqlite } from "./helpers/realSqlite.js";
import type { IDatabaseAdapter } from "../src/db/IDatabaseAdapter.js";

/**
 * Issue #110 (E9): a note that is open while its file is moved or deleted
 * outside Plainva. The editor still holds the text it loaded (its base) and
 * saves on. That save used to write the file again at its OLD place — beside
 * the moved note a second copy, or a deletion quietly undone, both carried on
 * by sync. An editor save now refuses; the text stays with the editor.
 */
describe("an editor save never recreates a note that vanished under it", () => {
  let directory: string, db: IDatabaseAdapter, files: LocalVaultAdapter, adapter: ConflictAwareVaultAdapter;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "plainva-vanished-"));
    db = await realSqlite();
    files = new LocalVaultAdapter(directory);
    await files.initialize();
    adapter = new ConflictAwareVaultAdapter(files, new SyncStateRepository(db));
    await files.createDir("4 blog/taken");
    await files.writeTextFile("4 blog/link-50.md", "# Link 50\n");
  });
  afterEach(async () => { await db.close(); await rm(directory, { recursive: true, force: true }); });

  it("refuses when the file was moved away, and leaves both places as they are", async () => {
    await adapter.writeEditorText("4 blog/link-50.md", "# Link 50\n\ntyped\n", "# Link 50\n");
    await rename(join(directory, "4 blog/link-50.md"), join(directory, "4 blog/taken/link-50.md"));

    await expect(adapter.writeEditorText("4 blog/link-50.md", "# Link 50\n\ntyped more\n", "# Link 50\n\ntyped\n"))
      .rejects.toBeInstanceOf(VaultFileNotFoundError);
    expect(await files.exists("4 blog/link-50.md")).toBe(false);
    expect(await files.readTextFile("4 blog/taken/link-50.md")).toBe("# Link 50\n\ntyped\n");
  });

  it("refuses when the file was deleted", async () => {
    await files.deleteItem("4 blog/link-50.md");
    await expect(adapter.writeEditorText("4 blog/link-50.md", "unsaved\n", "# Link 50\n"))
      .rejects.toBeInstanceOf(VaultFileNotFoundError);
    expect(await files.exists("4 blog/link-50.md")).toBe(false);
  });

  it("tells a vault folder that cannot be reached from a vanished file, and writes nothing", async () => {
    // A network drive that dropped: the vault's whole folder is away.
    const away = `${directory}-away`;
    await rename(directory, away);
    try {
      const refusal = await adapter.writeEditorText("4 blog/link-50.md", "unsaved\n", "# Link 50\n").catch((error: unknown) => error);
      expect(refusal).toBeInstanceOf(VaultUnreachableError);
      expect(refusal).not.toBeInstanceOf(VaultFileNotFoundError);
      expect((refusal as { code?: string }).code).toBe("VAULT_UNREACHABLE");
      expect(await files.exists("")).toBe(false);
    } finally {
      await rename(away, directory);
    }
    // Back again: the save goes through over the file as it lies there.
    await adapter.writeEditorText("4 blog/link-50.md", "# Link 50\n\nback\n", "# Link 50\n");
    expect(await files.readTextFile("4 blog/link-50.md")).toBe("# Link 50\n\nback\n");
  });

  it("calls a note gone from a vault that is left empty a vanished note: the vault is there", async () => {
    // The vault's one note, deleted from outside while it is open.
    await files.deleteItem("4 blog", true);
    expect(await files.listDir("")).toEqual([]);
    await expect(adapter.writeEditorText("4 blog/link-50.md", "unsaved\n", "# Link 50\n")).rejects.toBeInstanceOf(VaultFileNotFoundError);
  });

  it("calls a vault folder that is no longer the place it was opened at out of reach — the mount point a drive left", async () => {
    await files.deleteItem("4 blog/link-50.md");
    adapter.setRootCheck(async () => false);
    await expect(adapter.writeEditorText("4 blog/link-50.md", "unsaved\n", "# Link 50\n")).rejects.toBeInstanceOf(VaultUnreachableError);
    expect(await files.exists("4 blog/link-50.md")).toBe(false);
    expect(await adapter.sameRootAsOpened()).toBe(false);
  });

  it("keeps a missing file a vanished note where the storage cannot tell the place", async () => {
    await files.deleteItem("4 blog/link-50.md");
    adapter.setRootCheck(async () => null);
    await expect(adapter.writeEditorText("4 blog/link-50.md", "unsaved\n", "# Link 50\n")).rejects.toBeInstanceOf(VaultFileNotFoundError);
  });

  it("asks for the vault folder only where a file is missing, never on a save that finds its file", async () => {
    const asked: string[] = [];
    const exists = files.exists.bind(files);
    files.exists = async (path: string) => { asked.push(path); return exists(path); };
    await adapter.writeEditorText("4 blog/link-50.md", "# Link 50\n\ntyped\n", "# Link 50\n");
    expect(asked).not.toContain("");
    await files.deleteItem("4 blog/link-50.md");
    await adapter.writeEditorText("4 blog/link-50.md", "more\n", "# Link 50\n\ntyped\n").catch(() => {});
    expect(asked.filter((path) => path === "")).toHaveLength(1);
  });

  it("keeps a missing file a vanished note where the adapter cannot answer for its folder", async () => {
    await files.deleteItem("4 blog/link-50.md");
    const exists = files.exists.bind(files);
    files.exists = async (path: string) => { if (path === "") throw new Error("cannot tell"); return exists(path); };
    await expect(adapter.writeEditorText("4 blog/link-50.md", "unsaved\n", "# Link 50\n")).rejects.toBeInstanceOf(VaultFileNotFoundError);
  });

  it("still creates a note that has no base yet, and writes an explicit restore", async () => {
    // No base: nothing was loaded, so nothing vanished — a new note.
    await adapter.writeEditorText("4 blog/new.md", "# New\n", null);
    expect(await files.readTextFile("4 blog/new.md")).toBe("# New\n");
    // "Save here again" goes through the plain write on purpose.
    await files.deleteItem("4 blog/link-50.md");
    await adapter.writeTextFile("4 blog/link-50.md", "restored\n");
    expect(await files.readTextFile("4 blog/link-50.md")).toBe("restored\n");
  });
});
