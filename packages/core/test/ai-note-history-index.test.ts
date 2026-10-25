import { describe, expect, it } from "vitest";
import { VaultIndexer } from "../src/vault/VaultIndexer.js";
import { VaultQueryService } from "../src/vault/VaultQueryService.js";
import { MemoryVaultAdapter } from "./helpers/memoryVault.js";
import { realSqlite } from "./helpers/realSqlite.js";

/**
 * Where the history of a note begins (AI harness P9-1), against the real
 * SQLite of the index: the moment the index first saw a note — which no
 * later save moves, not even one that replaces the file —, the same note
 * under either normalization of its name, and nothing for a note the index
 * does not know or that was deleted. And the notes changed after an instant,
 * which a look back lists, with that moment beside each.
 */

/** A morning in October 2026, in milliseconds: the clock of the vault in memory starts here. */
const START = new Date(2026, 9, 6, 9, 0).getTime();

async function indexed(files: Record<string, string>) {
  const db = await realSqlite();
  const vault = new MemoryVaultAdapter(START);
  for (const [path, text] of Object.entries(files)) await vault.writeTextFile(path, text);
  const indexer = new VaultIndexer(vault, db);
  await indexer.indexVaultFull();
  return { db, vault, indexer, query: new VaultQueryService(db) };
}

describe("when the index first saw a note", () => {
  it("answers with that moment, keeps it through a save that replaces the file, and knows no other note", async () => {
    const { vault, indexer, query } = await indexed({ "Projects/Plan.md": "# Plan\n", "Projects/Überblick.md": "# Überblick\n" });
    const plan = await query.getNoteCreated("Projects/Plan.md");
    expect(plan).not.toBeNull();
    expect(plan!).toBeGreaterThan(START);
    expect(plan!).toBeLessThan(START + 60_000);

    // A save that writes a new file in place of the old one: the file system has a new moment of birth, the index keeps its own.
    await vault.deleteItem("Projects/Plan.md");
    await vault.writeTextFile("Projects/Plan.md", "# Plan\n\nKick-off on Monday.\n");
    expect((await vault.getFileInfo("Projects/Plan.md")).ctime).toBeGreaterThan(plan!);
    await indexer.indexVaultFull();
    expect(await query.getNoteCreated("Projects/Plan.md")).toBe(plan);

    // The same note, its name in the other normalization.
    const overview = await query.getNoteCreated("Projects/Überblick.md".normalize("NFC"));
    expect(overview).not.toBeNull();
    expect(await query.getNoteCreated("Projects/Überblick.md".normalize("NFD"))).toBe(overview);

    expect(await query.getNoteCreated("Projects/Nothing.md")).toBeNull();
    await vault.deleteItem("Projects/Überblick.md");
    await indexer.indexVaultFull();
    expect(await query.getNoteCreated("Projects/Überblick.md")).toBeNull();
  });

  it("lists the notes changed after an instant with the moment each was first seen, newest first, of a folder or of all", async () => {
    const { vault, indexer, query } = await indexed({ "Projects/Plan.md": "# Plan\n", "Journal/Day.md": "# Day\n", "Projects/Old.md": "# Old\n" });
    const seen = await query.getNoteCreated("Projects/Plan.md");
    const before = (await vault.getFileInfo("Projects/Old.md")).mtime;
    await vault.writeTextFile("Projects/Plan.md", "# Plan\n\nBudget agreed.\n");
    await vault.writeTextFile("Journal/Day.md", "# Day\n\nCalled the studio.\n");
    await indexer.indexVaultFull();
    const all = await query.getNotesChangedIn("", before, 10);
    expect(all.map((row) => row.path)).toEqual(["Journal/Day.md", "Projects/Plan.md"]);
    expect(all.find((row) => row.path === "Projects/Plan.md")!.created).toBe(seen);
    expect((await query.getNotesChangedIn("Projects", before, 10)).map((row) => row.path)).toEqual(["Projects/Plan.md"]);
  });
});
