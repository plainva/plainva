import { describe, expect, it } from "vitest";
import { choicesWith, splitTextFileExtensions, vaultExportFileName, versionIntervalLabel, VERSION_INTERVAL_CHOICES, VERSION_MAX_AGE_CHOICES, ZIP_KEEP_CHOICES } from "@plainva/ui";

/**
 * What both shells' settings rows hand to each other (Sammelplan § 3.169 Nr. 3):
 * the choices of the backup pickers, the split of "More text files" and the
 * name of a vault export.
 */
describe("backup choices, one list for both shells", () => {
  it("offers the phone's minute and the desktop's 30 seconds and 180 days alike", () => {
    expect(VERSION_INTERVAL_CHOICES).toEqual([0, 30, 60, 120, 300, 600]);
    expect(VERSION_MAX_AGE_CHOICES).toContain(180);
    expect(VERSION_MAX_AGE_CHOICES[VERSION_MAX_AGE_CHOICES.length - 1]).toBe(0);
  });

  it("keeps a value another device set among the choices, in order", () => {
    // The desktop's free field allows 12 archives; the phone's picker shows it.
    expect(choicesWith(ZIP_KEEP_CHOICES, 12)).toEqual([3, 7, 12, 14, 30]);
    expect(choicesWith(ZIP_KEEP_CHOICES, 7)).toEqual([3, 7, 14, 30]);
    // 0 is "every change" for the interval, first; "no limit" for the age, last.
    expect(choicesWith(VERSION_INTERVAL_CHOICES, 45)).toEqual([0, 30, 45, 60, 120, 300, 600]);
    expect(choicesWith(VERSION_MAX_AGE_CHOICES, 60, "last")).toEqual([30, 60, 90, 180, 365, 0]);
  });

  it("names an interval as both shells did: every change, seconds, minutes", () => {
    expect(versionIntervalLabel(0, "every change")).toBe("every change");
    expect(versionIntervalLabel(30, "x")).toBe("30 s");
    expect(versionIntervalLabel(90, "x")).toBe("90 s");
    expect(versionIntervalLabel(120, "x")).toBe("2 min");
  });
});

describe("More text files", () => {
  it("splits where people separate entries; the open rule cleans each one", () => {
    expect(splitTextFileExtensions(".log, ini;  fountain\nadoc")).toEqual([".log", "ini", "fountain", "adoc"]);
    expect(splitTextFileExtensions("  ")).toEqual([]);
  });
});

describe("vault export name", () => {
  it("is the phone's name: the label made file-safe, a date, .zip", () => {
    const when = new Date(Date.UTC(2026, 9, 30, 12));
    expect(vaultExportFileName("Work notes", when)).toBe("Work_notes-2026-10-30.zip");
    expect(vaultExportFileName("§§", when)).toBe("_-2026-10-30.zip");
    expect(vaultExportFileName("", when)).toBe("vault-2026-10-30.zip");
  });
});
