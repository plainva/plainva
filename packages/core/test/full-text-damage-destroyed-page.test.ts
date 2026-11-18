import { afterEach, describe, expect, it, vi } from "vitest";
import type { SqlStatements } from "../src/db/IDatabaseAdapter.js";
import { initializeSchema } from "../src/db/Schema.js";
import { readFullTextDamage, watchFullTextDamage } from "../src/db/fullTextDamage.js";
import { destroyLeafPage, fileDatabase, removeSeededFiles, seededFile, type Mode } from "./helpers/fileSqlite.js";

/**
 * A damaged full-text index on a real SQLite FILE, with one page of the
 * table's own storage destroyed on the disk. The table's root pages are whole,
 * so the vault opens; a search fails, and the damage is noted. Making the
 * table anew at the next open must read that page too (`DROP TABLE`), and
 * fails ("database disk image is malformed"). That must never keep the vault
 * from opening: it opens as it would without the note — without search — in
 * every later open, and the note says the attempt failed.
 *
 * The phone's plugin on iOS passes on only the primary code and SQLite's
 * words (`prepareSQL step failed rc: 11 message: …`): the damage is still
 * noted, and a damaged page of the notes' own table is not taken for a
 * damaged full-text index.
 */

afterEach(() => {
  vi.restoreAllMocks();
  removeSeededFiles();
});

const kept = async (db: SqlStatements) =>
  JSON.stringify([
    await db.query(`SELECT * FROM sync_state ORDER BY path`),
    await db.query(`SELECT * FROM offline_queue ORDER BY id`),
    await db.query(`SELECT id, path, title, sha256, size_bytes FROM files ORDER BY path`),
  ]);
const search = (db: SqlStatements) => db.query(`SELECT path FROM fts_notes WHERE fts_notes MATCH ?`, ["body"]);

describe("a full-text index with a destroyed page of its own storage", () => {
  it.each<Mode>(["desktop", "ios", "ios-plain"])("is noted at a search; every later open opens the vault, and the note says the attempt failed (%s)", async (mode) => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const file = await seededFile();
    const before = await (async () => { const db = fileDatabase(file, mode); const k = await kept(db); await db.close(); return k; })();
    destroyLeafPage(file, "fts_notes_data");

    const first = fileDatabase(file, mode);
    await initializeSchema(first);
    const watched = watchFullTextDamage(first);
    await expect(search(watched)).rejects.toThrow();
    expect((await readFullTextDamage(first)).state, "noted").toBe("noted");
    await first.close();

    for (const round of [1, 2, 3]) {
      const db = fileDatabase(file, mode);
      await expect(initializeSchema(db), `open ${round + 1}`).resolves.toBeUndefined();
      const damage = await readFullTextDamage(db);
      expect(damage.state, `open ${round + 1}: the note keeps the failed attempt`).toBe("rebuild-failed");
      if (damage.state === "rebuild-failed") expect(damage.failures).toBe(round);
      expect(await kept(db), "the sync state, the queue and the rows stay").toBe(before);
      await db.close();
    }
  });

  it("a destroyed page of the notes' own table met by a search is not taken for a damaged full-text index (iOS words)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const file = await seededFile();
    destroyLeafPage(file, "files");
    const db = fileDatabase(file, "ios");
    const watched = watchFullTextDamage(db);
    const joined = watched.query(`SELECT f.path, f.sha256, f.title FROM fts_notes fn JOIN files f ON f.path = fn.path WHERE fts_notes MATCH ?`, ["body"]);
    await expect(joined).rejects.toThrow(/rc: 11/);
    expect((await readFullTextDamage(db)).state).toBe("none");
    await db.close();
  });
});
