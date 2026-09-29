import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LocalVaultAdapter } from "../src/vault/LocalVaultAdapter.js";
import { ConflictAwareVaultAdapter } from "../src/vault/ConflictAwareVaultAdapter.js";
import { SyncStateRepository } from "../src/vault/SyncStateRepository.js";
import { VaultFileNotFoundError } from "../src/vault/IVaultAdapter.js";
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
