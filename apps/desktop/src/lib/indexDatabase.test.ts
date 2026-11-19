import { describe, expect, it } from "vitest";
import {
  finishSetAside,
  hasSetAside,
  indexDatabaseFailureKind,
  indexDatabaseFailureMessage,
  indexDatabaseRebuildOffered,
  indexDatabaseWorkspace,
  setAsideIndexDatabase,
  setAsideStamp,
  type IndexDatabaseFiles,
} from "@plainva/ui";

/**
 * A vault's index database that does not open (both shells' start,
 * packages/ui/src/lib/indexDatabase.ts): why, in the driver's words, and
 * setting a damaged one aside without ever losing or reopening it.
 */

describe("why an index database did not open", () => {
  it.each([
    "error returned from database: (code: 11) database disk image is malformed",
    "error returned from database: (code: 26) file is not a database",
    "error returned from database: (code: 267) database disk image is malformed",
    "error returned from database: (code: 779) database disk image is malformed",
    "Open: open plainva-index failed: database disk image is malformed",
    "Error: SQLITE_NOTADB: file is not a database",
    "malformed database schema (files) - near \"x\": syntax error",
    // The phone's plugin on iOS: the primary code only.
    "Error: prepareSQL step failed rc: 11 message: unknown error",
    // FTS5's own words for its storage, under any code.
    "error returned from database: (code: 1) invalid fts5 file format (found 99, expected 4 or 5) - run 'rebuild'",
    "error returned from database: (code: 1) vtable constructor failed: fts_notes",
    "Error: prepareSQL step failed rc: 11 message: fts5: missing row -80 from content table 'main'.'fts_notes_content'",
  ])("a damaged file: %s", (text) => {
    expect(indexDatabaseFailureKind(new Error(text))).toBe("damaged");
  });

  it.each([
    ["error returned from database: (code: 5) database is locked", "locked"],
    ["SQLITE_BUSY: database is locked", "locked"],
    ["error returned from database: (code: 13) database or disk is full", "full"],
    ["No space left on device (os error 28)", "full"],
    ["error returned from database: (code: 8) attempt to write a readonly database", "readOnly"],
    ["error returned from database: (code: 14) unable to open database file", "readOnly"],
    ["error returned from database: (code: 10) disk I/O error", "unavailable"],
    ["Connection to plainva-index not available", "unavailable"],
  ] as const)("not damaged — and nothing to rebuild: %s", (text, kind) => {
    expect(indexDatabaseFailureKind(new Error(text))).toBe(kind);
    expect(indexDatabaseRebuildOffered(kind, false)).toBe(false);
  });

  it("offers to rebuild a damaged database, never in an encrypted workspace", () => {
    expect(indexDatabaseRebuildOffered("damaged", false)).toBe(true);
    expect(indexDatabaseRebuildOffered("damaged", true)).toBe(false);
  });

  it("offers nothing where it could not be told whether the vault is an encrypted workspace", async () => {
    const workspace = await indexDatabaseWorkspace(async () => { throw new Error("settings store unavailable"); });
    expect(workspace).toBe("unknown");
    expect(indexDatabaseRebuildOffered("damaged", workspace)).toBe(false);
    const said = indexDatabaseFailureMessage("damaged", new Error("database disk image is malformed"), workspace);
    expect(said, "said as a database that did not open, not as one to rebuild").toContain("database disk image is malformed");
    expect(said).not.toBe(indexDatabaseFailureMessage("damaged", new Error("database disk image is malformed"), false));
    expect(await indexDatabaseWorkspace(async () => null)).toBe(false);
    expect(await indexDatabaseWorkspace(async () => ({ workspaceId: "w" }))).toBe(true);
  });

  it("reads the cause an error carries, and a plain message object", () => {
    expect(indexDatabaseFailureKind(Object.assign(new Error("open failed"), { cause: new Error("file is not a database") }))).toBe("damaged");
    expect(indexDatabaseFailureKind({ message: "database disk image is malformed" })).toBe("damaged");
  });
});

/** A folder of files in memory, noting every step. */
function folder(initial: Record<string, string>, failRenameOf: string | null = null, failRemoveOf: string | null = null, at: Record<string, number> = {}) {
  const files = new Map(Object.entries(initial));
  const steps: string[] = [];
  /** When each file was last written: the initial ones at time 0 or as given, every write later than the one before. */
  const times = new Map(Object.keys(initial).map((path) => [path, at[path] ?? 0]));
  let clock = 100;
  const fs: IndexDatabaseFiles = {
    exists: async (path) => files.has(path),
    rename: async (from, to) => {
      steps.push(`rename ${from} -> ${to}`);
      if (from === failRenameOf) throw new Error("rename failed");
      if (files.has(to)) throw new Error(`would replace ${to}`);
      files.set(to, files.get(from)!);
      times.set(to, times.get(from) ?? 0);
      files.delete(from);
    },
    writeEmpty: async (path) => {
      steps.push(`empty ${path}`);
      files.set(path, "");
      times.set(path, ++clock);
    },
    listStartingWith: async (prefix) => [...files.keys()].filter((path) => path.startsWith(prefix)),
    remove: async (path) => {
      steps.push(`remove ${path}`);
      if (path === failRemoveOf) throw new Error("EBUSY: resource busy or locked");
      files.delete(path);
    },
    readText: async (path) => files.get(path) ?? null,
    writeText: async (path, text, options) => {
      if (options?.exclusive && files.has(path)) return false;
      steps.push(`note ${path}`);
      files.set(path, text);
      times.set(path, ++clock);
      return true;
    },
    modifiedAt: async (path) => (files.has(path) ? times.get(path) ?? null : null),
  };
  return { files, steps, fs, times };
}

const AT = new Date("2026-11-17T09:30:00.123Z");
const STAMP = setAsideStamp(AT);

describe("setting a damaged index database aside", () => {
  it("keeps every byte under a name of its own, the companions with it, and leaves an empty database", async () => {
    const { files, steps, fs } = folder({ "x.db": "damaged", "x.db-wal": "log", "x.db-shm": "index" });
    const aside = await setAsideIndexDatabase(fs, "x.db", AT);
    expect(aside).toBe(`x.db.broken-${STAMP}`);
    expect(Object.fromEntries(files)).toEqual({
      [`x.db.broken-${STAMP}`]: "damaged",
      [`x.db.broken-${STAMP}-wal`]: "log",
      [`x.db.broken-${STAMP}-shm`]: "index",
      "x.db": "",
    });
    // The note first, the companions, the database last, the empty one after it, the note gone.
    expect(steps).toEqual([
      "note x.db.setting-aside",
      `rename x.db-wal -> x.db.broken-${STAMP}-wal`,
      `rename x.db-shm -> x.db.broken-${STAMP}-shm`,
      `rename x.db -> x.db.broken-${STAMP}`,
      "empty x.db",
      "remove x.db.setting-aside",
    ]);
    expect(STAMP).not.toMatch(/[:]/);
  });

  it("never over an earlier set-aside, and the two newest are kept: two rebuilds in a row keep the copy with the data", async () => {
    const earlier = `x.db.broken-${STAMP}`;
    const older = "x.db.broken-2026-01-01T00-00-00-000Z";
    const { files, steps, fs } = folder({ "x.db": "damaged again", [earlier]: "damaged before", [`${earlier}-wal`]: "its log", [older]: "older still", [`${older}-shm`]: "older index" });
    const aside = await setAsideIndexDatabase(fs, "x.db", AT);
    expect(aside).toBe(`x.db.broken-${STAMP}-2`);
    expect(Object.fromEntries(files)).toEqual({ [aside]: "damaged again", [earlier]: "damaged before", [`${earlier}-wal`]: "its log", "x.db": "" });
    // The oldest goes companions first, its main file last.
    expect(steps.filter((step) => step.startsWith("remove x.db.broken"))).toEqual([`remove ${older}-shm`, `remove ${older}`]);
  });

  it("a second press while one runs is that one", async () => {
    const { steps, fs } = folder({ "x.db": "damaged" });
    const [a, b] = await Promise.all([setAsideIndexDatabase(fs, "x.db", AT), setAsideIndexDatabase(fs, "x.db", AT)]);
    expect(a).toBe(b);
    expect(steps.filter((step) => step.startsWith("rename"))).toHaveLength(1);
  });

  it("a stop before the database moved is finished before it opens, under the same name, by its note", async () => {
    const { files, fs } = folder({ "x.db": "damaged", "x.db-wal": "log" }, "x.db");
    await expect(setAsideIndexDatabase(fs, "x.db", AT)).rejects.toThrow("rename failed");
    expect(files.has("x.db-wal"), "its log is set aside, never replayed into a new one").toBe(false);
    expect(files.get(`x.db.broken-${STAMP}-wal`)).toBe("log");
    // The next open: the database never opens without its log.
    const healed = folder(Object.fromEntries(files));
    const aside = await finishSetAside(healed.fs, "x.db");
    expect(aside).toBe(`x.db.broken-${STAMP}`);
    expect(Object.fromEntries(healed.files)).toEqual({ [`x.db.broken-${STAMP}`]: "damaged", [`x.db.broken-${STAMP}-wal`]: "log", "x.db": "" });
  });

  it("a stop after the database moved, before the note went: the next open moves nothing of the new database", async () => {
    const { files, fs } = folder({ "x.db": "damaged" }, null, "x.db.setting-aside");
    await expect(setAsideIndexDatabase(fs, "x.db", AT)).rejects.toThrow("EBUSY");
    // The new database is in use by now, with a log of its own.
    files.set("x.db", "rebuilt, in use");
    files.set("x.db-wal", "its own log");
    const again = folder(Object.fromEntries(files));
    await finishSetAside(again.fs, "x.db");
    expect(again.files.get("x.db")).toBe("rebuilt, in use");
    expect(again.files.get("x.db-wal")).toBe("its own log");
    expect(again.files.has("x.db.setting-aside")).toBe(false);
  });

  it.each(["-wal", "-shm", "-journal"])("a companion of an earlier copy beside a healthy database (%s), its main file gone: nothing happens at the open", async (companion) => {
    const { files, steps, fs } = folder({ "x.db": "healthy, in use", "x.db-wal": "live log", [`x.db.broken-${STAMP}${companion}`]: "orphan" });
    expect(await finishSetAside(fs, "x.db")).toBeNull();
    expect(steps).toEqual([]);
    expect(files.get("x.db")).toBe("healthy, in use");
    expect(files.get("x.db-wal")).toBe("live log");
  });

  it.each([
    ["the oldest copy's companion", "x.db.broken-2026-01-01T00-00-00-000Z-wal"],
    ["the oldest copy's main file", "x.db.broken-2026-01-01T00-00-00-000Z"],
  ])("removing old copies fails at %s: the rebuild stands, and the next open sets nothing aside", async (_label, failing) => {
    const older = "x.db.broken-2026-01-01T00-00-00-000Z";
    const { files, fs } = folder({ "x.db": "damaged", [older]: "oldest", [`${older}-wal`]: "oldest log", "x.db.broken-2026-02-01T00-00-00-000Z": "older" }, null, failing);
    await expect(setAsideIndexDatabase(fs, "x.db", AT)).resolves.toBe(`x.db.broken-${STAMP}`);
    expect(files.get("x.db")).toBe("");
    files.set("x.db", "rebuilt, in use");
    const next = folder(Object.fromEntries(files));
    expect(await finishSetAside(next.fs, "x.db")).toBeNull();
    expect(next.files.get("x.db")).toBe("rebuilt, in use");
  });

  it("the copy just made stays whatever its stamp says: a clock set back does not make it the oldest", async () => {
    const later1 = "x.db.broken-2027-01-01T00-00-00-000Z";
    const later2 = "x.db.broken-2027-02-01T00-00-00-000Z";
    const { files, fs } = folder({ "x.db": "damaged, with the data", [later1]: "older copy", [later2]: "newer copy" });
    const aside = await setAsideIndexDatabase(fs, "x.db", AT);
    expect(files.get(aside), "the copy with the data").toBe("damaged, with the data");
    expect(files.has(later2), "and the newest other one").toBe(true);
    expect(files.has(later1)).toBe(false);
  });

  it("a companion whose main file is gone is no copy: it takes no place, and it goes", async () => {
    const whole = "x.db.broken-2026-10-01T00-00-00-000Z";
    const orphan = "x.db.broken-2026-10-02T00-00-00-000Z-wal";
    const { files, fs } = folder({ "x.db": "damaged again", [whole]: "the older whole copy", [orphan]: "orphan log" });
    const aside = await setAsideIndexDatabase(fs, "x.db", AT);
    expect(Object.fromEntries(files)).toEqual({ [aside]: "damaged again", [whole]: "the older whole copy", "x.db": "" });
  });

  it("a note whose copy is gone, beside a database written after it: the note goes, nothing moves", async () => {
    const { files, steps, fs } = folder(
      { "x.db": "new, in use", "x.db-wal": "its log", "x.db.setting-aside": JSON.stringify({ stamp: STAMP }) },
      null, null, { "x.db.setting-aside": 1, "x.db": 50, "x.db-wal": 50 },
    );
    expect(await finishSetAside(fs, "x.db")).toBeNull();
    expect(steps.filter((step) => step.startsWith("rename") || step.startsWith("empty"))).toEqual([]);
    expect(files.get("x.db")).toBe("new, in use");
    expect(files.has("x.db.setting-aside")).toBe(false);
  });

  it("a note written, the run stopped before its first move: the damaged database, older than the note, is set aside at the open", async () => {
    const { files, fs } = folder(
      { "x.db": "damaged", "x.db.setting-aside": JSON.stringify({ stamp: STAMP }) },
      null, null, { "x.db": 1, "x.db.setting-aside": 50 },
    );
    expect(await finishSetAside(fs, "x.db")).toBe(`x.db.broken-${STAMP}`);
    expect(files.get(`x.db.broken-${STAMP}`)).toBe("damaged");
    expect(files.get("x.db")).toBe("");
  });

  it("a second window that finds the first one's note finishes that run instead of beginning its own", async () => {
    const OTHER = "2026-11-17T08-00-00-000Z";
    const { files, fs } = folder({ "x.db": "damaged", "x.db-wal": "log", "x.db.setting-aside": JSON.stringify({ stamp: OTHER }) }, null, null, { "x.db": 1, "x.db-wal": 1, "x.db.setting-aside": 50 });
    // The first window wrote its note between this one's look and its own write.
    let looked = false;
    const racing = { ...fs, readText: async (path: string) => (looked ? fs.readText(path) : ((looked = true), null)) };
    const aside = await setAsideIndexDatabase(racing, "x.db", AT);
    expect(aside).toBe(`x.db.broken-${OTHER}`);
    expect(Object.fromEntries(files)).toEqual({ [`x.db.broken-${OTHER}`]: "damaged", [`x.db.broken-${OTHER}-wal`]: "log", "x.db": "" });
  });

  it("a set-aside tells the open not to bring an older copy back in", () => {
    expect(hasSetAside(["other.db", `x.db.broken-${STAMP}`], "x.db")).toBe(true);
    expect(hasSetAside(["x.db", "x.db-wal", "xx.db.broken-1"], "x.db")).toBe(false);
  });
});
