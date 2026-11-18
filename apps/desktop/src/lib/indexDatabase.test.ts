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
function folder(initial: Record<string, string>, failRenameOf: string | null = null) {
  const files = new Map(Object.entries(initial));
  const steps: string[] = [];
  const fs: IndexDatabaseFiles = {
    exists: async (path) => files.has(path),
    rename: async (from, to) => {
      steps.push(`rename ${from} -> ${to}`);
      if (from === failRenameOf) throw new Error("rename failed");
      if (files.has(to)) throw new Error(`would replace ${to}`);
      files.set(to, files.get(from)!);
      files.delete(from);
    },
    writeEmpty: async (path) => {
      steps.push(`empty ${path}`);
      files.set(path, "");
    },
    listStartingWith: async (prefix) => [...files.keys()].filter((path) => path.startsWith(prefix)),
    remove: async (path) => {
      steps.push(`remove ${path}`);
      files.delete(path);
    },
  };
  return { files, steps, fs };
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
    // The companions first, the database last, the empty one after it.
    expect(steps).toEqual([
      `rename x.db-wal -> x.db.broken-${STAMP}-wal`,
      `rename x.db-shm -> x.db.broken-${STAMP}-shm`,
      `rename x.db -> x.db.broken-${STAMP}`,
      "empty x.db",
    ]);
    expect(STAMP).not.toMatch(/[:]/);
  });

  it("never over an earlier set-aside, and only the newest one is kept", async () => {
    const earlier = `x.db.broken-${STAMP}`;
    const { files, fs } = folder({ "x.db": "damaged again", [earlier]: "damaged before", [`${earlier}-wal`]: "its log", "x.db.broken-2026-01-01T00-00-00-000Z": "older still" });
    const aside = await setAsideIndexDatabase(fs, "x.db", AT);
    expect(aside).toBe(`x.db.broken-${STAMP}-2`);
    expect(Object.fromEntries(files), "each is as large as the index and holds the notes' text").toEqual({ [aside]: "damaged again", "x.db": "" });
  });

  it("a second press while one runs is that one", async () => {
    const { steps, fs } = folder({ "x.db": "damaged" });
    const [a, b] = await Promise.all([setAsideIndexDatabase(fs, "x.db", AT), setAsideIndexDatabase(fs, "x.db", AT)]);
    expect(a).toBe(b);
    expect(steps.filter((step) => step.startsWith("rename"))).toHaveLength(1);
  });

  it("a stop before the database moved is finished before it opens, under the same name", async () => {
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

  it("nothing half done: the open goes on as it was", async () => {
    const { files, steps, fs } = folder({ "x.db": "fine", "x.db-wal": "live log", [`x.db.broken-${STAMP}`]: "set aside", [`x.db.broken-${STAMP}-wal`]: "its log" });
    expect(await finishSetAside(fs, "x.db")).toBeNull();
    expect(steps).toEqual([]);
    expect(files.get("x.db-wal")).toBe("live log");
  });

  it("a set-aside tells the open not to bring an older copy back in", () => {
    expect(hasSetAside(["other.db", `x.db.broken-${STAMP}`], "x.db")).toBe(true);
    expect(hasSetAside(["x.db", "x.db-wal", "xx.db.broken-1"], "x.db")).toBe(false);
  });
});
