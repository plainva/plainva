import { describe, expect, it } from "vitest";
import { buildZipFileName, selectZipsToDelete, shouldRunZip, zipNamePattern } from "@plainva/ui";
import { classifyBackupListing } from "./services/backupListing";

/**
 * The archive rules, now shared with the desktop (S36).
 *
 * The desktop's own suite already pins these; this one exists because they are
 * about to be applied on a SECOND device against the SAME folder. A retention
 * rule that behaves differently per shell deletes different files on two
 * phones looking at one vault, and the mistake only surfaces when someone
 * needs the backup that is gone.
 */
describe("the shared archive rules", () => {
  it("names archives so they sort oldest first", () => {
    const a = buildZipFileName("Arbeit", new Date(2026, 0, 2, 3, 4, 5));
    const b = buildZipFileName("Arbeit", new Date(2026, 0, 2, 3, 4, 6));
    expect(a).toBe("Arbeit_2026-01-02_03-04-05.zip");
    // Lexicographic order IS chronological order — that is what lets the
    // pruning take a plain slice off the front.
    expect([b, a].sort()).toEqual([a, b]);
  });

  it("never deletes a file it did not write", () => {
    const names = [
      "Arbeit_2026-01-01_00-00-00.zip",
      "Arbeit_2026-01-02_00-00-00.zip",
      "Steuer 2025.zip",
      "notes.txt",
    ];
    expect(selectZipsToDelete(names, "Arbeit", 1)).toEqual(["Arbeit_2026-01-01_00-00-00.zip"]);
  });

  it("treats keep 0 as keep 1, so a setting cannot mean 'delete everything'", () => {
    const names = ["V_2026-01-01_00-00-00.zip", "V_2026-01-02_00-00-00.zip"];
    expect(selectZipsToDelete(names, "V", 0)).toEqual(["V_2026-01-01_00-00-00.zip"]);
  });

  it("escapes a vault name that looks like a pattern", () => {
    expect(zipNamePattern("A.B(1)").test("A.B(1)_2026-01-01_00-00-00.zip")).toBe(true);
    expect(zipNamePattern("A.B(1)").test("AxB(1)_2026-01-01_00-00-00.zip")).toBe(false);
  });

  it("is due a day later, never while one is running or switched off", () => {
    const day = 24 * 60 * 60 * 1000;
    const now = 10 * day;
    expect(shouldRunZip({ enabled: true, lastRun: now - day - 1, now, running: false })).toBe(true);
    expect(shouldRunZip({ enabled: true, lastRun: now - 1000, now, running: false })).toBe(false);
    expect(shouldRunZip({ enabled: true, lastRun: 0, now, running: true })).toBe(false);
    expect(shouldRunZip({ enabled: false, lastRun: 0, now, running: false })).toBe(false);
  });

  it("runs on a vault that has never been archived", () => {
    // lastRun 0 must read as "never", not as "just now at the epoch".
    expect(shouldRunZip({ enabled: true, lastRun: 0, now: Date.parse("2026-08-04"), running: false })).toBe(true);
  });
});

/**
 * C25 (finding 2026-08-25): after a reinstall on Android the archive folder is
 * there, but `readdir` returns an empty list — "0 backups" was a lie the vault
 * page told while the files kept growing.
 */
describe("what the vault page may claim about the archive folder", () => {
  const zips = ["V_2026-01-01_00-00-00.zip", "V_2026-01-02_00-00-00.zip"];

  it("counts what it can read, newest first", () => {
    const out = classifyBackupListing({ folderExists: true, names: [...zips, "notes.txt"], lastRun: 1, remembered: "none" });
    expect(out).toEqual({ archives: [zips[1], zips[0]], unreadable: false });
  });

  it("calls an existing folder that shows nothing to an installation that never wrote 'unreadable', not empty", () => {
    expect(classifyBackupListing({ folderExists: true, names: [], lastRun: 0, remembered: "none" }).unreadable).toBe(true);
  });

  it("does not mistake a missing folder or a folder this installation emptied for the reinstall case", () => {
    // No folder: a fresh vault that has simply never been archived.
    expect(classifyBackupListing({ folderExists: false, names: [], lastRun: 0, remembered: "none" }).unreadable).toBe(false);
    // Folder present but this installation has written before: emptied by
    // hand, the next scheduled run refills it.
    expect(classifyBackupListing({ folderExists: true, names: [], lastRun: 123, remembered: "none" }).unreadable).toBe(false);
  });

  it("keeps saying so after the first new archive, until the user dismisses it", () => {
    // The first archive written by the new installation would otherwise make
    // the count look right while the old files stay invisible and unpruned.
    expect(classifyBackupListing({ folderExists: true, names: [zips[0]], lastRun: 5, remembered: "detected" }).unreadable).toBe(true);
    expect(classifyBackupListing({ folderExists: true, names: [], lastRun: 0, remembered: "dismissed" }).unreadable).toBe(false);
  });
});
