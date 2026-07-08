import { describe, it, expect } from "vitest";
import {
  BACKUPS_ROOT,
  backupDirFor,
  isBatchBackupFolderName,
  isPlainvaInternalPath,
  makeBackupPath,
  parseBackupFileName,
  parseBackupPath,
  parseBatchFolderStamp,
} from "../src/vault/backupNaming.js";

describe("backupNaming", () => {
  it("parses a simple backup file name", () => {
    expect(parseBackupFileName("note.md.1736100000000.bak")).toEqual({
      originalName: "note.md",
      timestamp: 1736100000000,
    });
  });

  it("is safe for original names containing dots", () => {
    expect(parseBackupFileName("Meine Notiz v2.1.md.1736100000000.bak")).toEqual({
      originalName: "Meine Notiz v2.1.md",
      timestamp: 1736100000000,
    });
    expect(parseBackupFileName("tasks.base.1736100000000.bak")).toEqual({
      originalName: "tasks.base",
      timestamp: 1736100000000,
    });
  });

  it("distinguishes A.md from A.md.foo backups", () => {
    const a = parseBackupFileName("A.md.1736100000000.bak");
    const afoo = parseBackupFileName("A.md.foo.1736100000000.bak");
    expect(a?.originalName).toBe("A.md");
    expect(afoo?.originalName).toBe("A.md.foo");
  });

  it("rejects names that do not match the grammar", () => {
    expect(parseBackupFileName("foo.bak")).toBeNull();
    expect(parseBackupFileName("foo.md.bak")).toBeNull();
    expect(parseBackupFileName("foo.md.12345.bak")).toBeNull(); // too few digits
    expect(parseBackupFileName("foo.md.notanumber.bak")).toBeNull();
    expect(parseBackupFileName("foo.md.1736100000000.txt")).toBeNull();
  });

  it("round-trips through makeBackupPath and parseBackupPath", () => {
    const p = makeBackupPath("a/b/Note v1.2.md", 1736100000000);
    expect(p).toBe(`${BACKUPS_ROOT}/a/b/Note v1.2.md.1736100000000.bak`);
    expect(parseBackupPath(p)).toEqual({ originalPath: "a/b/Note v1.2.md", timestamp: 1736100000000 });
  });

  it("parses root-level backup paths", () => {
    expect(parseBackupPath(`${BACKUPS_ROOT}/root.md.1736100000000.bak`)).toEqual({
      originalPath: "root.md",
      timestamp: 1736100000000,
    });
  });

  it("returns null for paths outside the backups root or unparseable names", () => {
    expect(parseBackupPath("notes/a.md.1736100000000.bak")).toBeNull();
    expect(parseBackupPath(`${BACKUPS_ROOT}/index-md-stamp/readme.md`)).toBeNull();
  });

  it("computes the backup dir for nested and root files", () => {
    expect(backupDirFor("a/b/c.md")).toBe(`${BACKUPS_ROOT}/a/b`);
    expect(backupDirFor("c.md")).toBe(BACKUPS_ROOT);
    expect(backupDirFor("a\\b\\c.md")).toBe(`${BACKUPS_ROOT}/a/b`);
  });

  it("recognizes batch backup folders and recovers their stamp", () => {
    const d = new Date("2026-07-05T14:30:45.123Z");
    const stamp = d.toISOString().replace(/[:.]/g, "-");
    expect(isBatchBackupFolderName(`index-md-${stamp}`)).toBe(true);
    expect(isBatchBackupFolderName(`okf-conversion-${stamp}`)).toBe(true);
    expect(isBatchBackupFolderName("some-folder")).toBe(false);
    expect(parseBatchFolderStamp(`index-md-${stamp}`)).toBe(d.getTime());
    expect(parseBatchFolderStamp(`okf-conversion-${stamp}`)).toBe(d.getTime());
    expect(parseBatchFolderStamp("index-md-garbage")).toBeNull();
    expect(parseBatchFolderStamp("unrelated")).toBeNull();
  });

  it("identifies .plainva-internal paths", () => {
    expect(isPlainvaInternalPath(".plainva")).toBe(true);
    expect(isPlainvaInternalPath(".plainva/bookmarks.json")).toBe(true);
    expect(isPlainvaInternalPath(".plainva\\backups\\a.md.1.bak")).toBe(true);
    expect(isPlainvaInternalPath("notes/a.md")).toBe(false);
    expect(isPlainvaInternalPath(".plainvax/a.md")).toBe(false);
  });
});
