import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { initializeSchema, readFullTextDamage, watchFullTextDamage } from "@plainva/core";
import { fullTextDamageNotice, setAsideIndexDatabase, type IndexDatabaseFiles } from "@plainva/ui";
import { destroyLeafPage, fileDatabase, removeSeededFiles, seededFile } from "../../../../packages/core/test/helpers/fileSqlite";

/**
 * The search's "Rebuild index" from start to end, over a real SQLite file: a
 * page of the full-text index's own storage destroyed on the disk, the damage
 * noted at a search, the next open's attempt to make the full-text index
 * anew failing — the vault opens without search, and the search offers
 * "Rebuild index" in an ordinary vault only. The button takes the start's
 * way (`setAsideIndexDatabase`, then the open): afterwards the search finds
 * again and no note is left. And it is the start's way in the code too: the
 * open vault is closed the ordinary way first, then the start's rebuild runs.
 */

afterEach(() => {
  vi.restoreAllMocks();
  removeSeededFiles();
});

/** The desktop's file system as the set-aside reaches it, over the real disk. */
const diskFiles: IndexDatabaseFiles = {
  exists: async (path) => existsSync(path),
  rename: async (from, to) => renameSync(from, to),
  writeEmpty: async (path) => { if (!existsSync(path)) writeFileSync(path, new Uint8Array(), { flag: "wx" }); },
  listStartingWith: async (prefix) => readdirSync(dirname(prefix)).filter((name) => name.startsWith(basename(prefix))).map((name) => join(dirname(prefix), name)),
  remove: async (path) => rmSync(path, { force: true }),
  readText: async (path) => (existsSync(path) ? readFileSync(path, "utf8") : null),
  writeText: async (path, text, options) => {
    if (options?.exclusive && existsSync(path)) return false;
    writeFileSync(path, text, options?.exclusive ? { flag: "wx" } : undefined);
    return true;
  },
  modifiedAt: async (path) => (existsSync(path) ? statSync(path).mtimeMs : null),
};

describe("the search's \"Rebuild index\", start to end", () => {
  it("offered only where the open could not make the full-text index anew; afterwards the search finds again and no note is left", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const file = await seededFile();
    destroyLeafPage(file, "fts_notes_data");

    // An open, a search that meets the damage: noted, and the search says the next open makes it anew.
    const first = fileDatabase(file, "desktop");
    await initializeSchema(first);
    await expect(watchFullTextDamage(first).query(`SELECT path FROM fts_notes WHERE fts_notes MATCH ?`, ["body"])).rejects.toThrow();
    expect(fullTextDamageNotice(await readFullTextDamage(first), false)).toEqual({ textKey: "errors.fullTextDamaged", offerRebuild: false });
    await first.close();

    // The next open: its attempt fails, the vault opens without search, and now only "Rebuild index" helps.
    const second = fileDatabase(file, "desktop");
    await initializeSchema(second);
    const damage = await readFullTextDamage(second);
    expect(fullTextDamageNotice(damage, false)).toEqual({ textKey: "errors.fullTextRebuildFailed", offerRebuild: true });
    expect(fullTextDamageNotice(damage, true)).toEqual({ textKey: "errors.fullTextRebuildFailedWorkspace", offerRebuild: false });
    expect(fullTextDamageNotice(damage, "unknown").offerRebuild).toBe(false);
    // The ordinary close: nothing holds the file any more.
    await second.close();

    // The button: the start's set-aside, then the open.
    const copy = await setAsideIndexDatabase(diskFiles, file);
    expect(existsSync(copy), "the damaged file is kept beside the new one").toBe(true);
    const rebuilt = fileDatabase(file, "desktop");
    await initializeSchema(rebuilt);
    expect((await readFullTextDamage(rebuilt)).state, "no note is left").toBe("none");
    await rebuilt.execute(`INSERT INTO fts_notes (content, title, path) VALUES ('body text', 'N0', 'N0.md')`);
    expect(await watchFullTextDamage(rebuilt).query(`SELECT path FROM fts_notes WHERE fts_notes MATCH ?`, ["body"]), "the search finds again").toEqual([{ path: "N0.md" }]);
    await rebuilt.close();
  });

  it("is the start's way in the vault context: closed the ordinary way first, then the start's rebuild", () => {
    const source = readFileSync(join(__dirname, "..", "contexts", "VaultContext.tsx"), "utf8");
    const body = (name: string) => {
      const start = source.indexOf(`const ${name} = async`);
      expect(start, name).toBeGreaterThan(-1);
      return source.slice(start, source.indexOf("\n  };", start));
    };
    const fromStart = body("rebuildIndexDatabase");
    const fromSearch = body("rebuildDamagedIndexDatabase");
    // One rebuild for both: the same set-aside, the same open (with the accounts' restore in it).
    expect(fromStart).toContain("rebuildIndexDatabaseAt(");
    expect(fromSearch).toContain("rebuildIndexDatabaseAt(");
    expect(body("rebuildIndexDatabaseAt")).toMatch(/awaitVaultTeardown\([\s\S]*setAsideDesktopIndexDatabase\([\s\S]*loadVault\(/);
    // The ordinary close's safeguards before anything touches the file, and never in an encrypted workspace.
    expect(fromSearch).toMatch(/indexDatabaseRebuildOffered\([\s\S]*askHeldWork\(\)[\s\S]*teardownVault\(\)[\s\S]*rebuildIndexDatabaseAt\(/);
    expect(fromSearch).not.toContain("setAsideDesktopIndexDatabase(");
  });
});
