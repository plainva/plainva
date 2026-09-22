import { describe, expect, it } from "vitest";
import {
  baseDateProperty,
  baseSelectorAcceptsInput,
  columnsForBaseSelector,
  dailyDayResolver,
  FILE_DAY,
  isReadOnlyDateColumn,
} from "@plainva/ui";

/**
 * `file.day` — the day a daily note's FILE NAME stands for (plan
 * Journal-Erweiterungen, X8/E7).
 *
 * A calendar can only place a row it has a date for, and a daily note's date is
 * its name. Writing it into the frontmatter as well would be the same fact
 * twice, and the second copy would be the one that goes stale. These pin the
 * three doors that used to be shut — the naming rule, the picker, the lock —
 * and the one rule both shells now share for "which column places a row".
 */

describe("the day a file name stands for", () => {
  it("reads the vault's own format, in its own folder", () => {
    const iso = dailyDayResolver({ folder: "Tagebuch", format: "YYYY-MM-DD" })!;
    expect(iso("Tagebuch/2026-09-22.md")).toBe("2026-09-22");
    // Not a daily note: a note that merely lives in the folder says nothing.
    expect(iso("Tagebuch/Einkaufen.md")).toBeNull();
    // Outside the folder the same name is not a daily note either.
    expect(iso("Projekte/2026-09-22.md")).toBeNull();

    const dotted = dailyDayResolver({ folder: "", format: "YY.MM.DD" })!;
    expect(dotted("26.09.22.md")).toBe("2026-09-22");
    // A note that merely RESEMBLES the format is refused by the round trip.
    expect(dotted("2026-09.md")).toBeNull();
  });

  it("is absent entirely when the vault has no usable naming", () => {
    expect(dailyDayResolver(null)).toBeNull();
    expect(dailyDayResolver({ folder: "Tagebuch", format: "  " })).toBeNull();
  });
});

describe("which column places a row", () => {
  it("prefers the field the view names, then the first real date column", () => {
    const columns = { note: { input: "text" }, due: { input: "date" }, seen: { input: "datetime" } };
    expect(baseDateProperty({ dateField: "seen" }, columns)).toBe("seen");
    expect(baseDateProperty({}, columns)).toBe("due");
    expect(baseDateProperty({}, { note: { input: "text" } })).toBeNull();
    expect(baseDateProperty(undefined, undefined)).toBeNull();
    // The named field wins even when it is the virtual one.
    expect(baseDateProperty({ dateField: FILE_DAY }, columns)).toBe(FILE_DAY);
  });

  it("offers the virtual field in the date picker although it has no type", () => {
    // It is no property of the note, so the type table alone would refuse it.
    expect(baseSelectorAcceptsInput("dateField", undefined)).toBe(false);
    expect(baseSelectorAcceptsInput("dateField", undefined, false, FILE_DAY)).toBe(true);
    const offered = columnsForBaseSelector("dateField", ["title", "due", FILE_DAY], (c) => (c === "due" ? "date" : undefined));
    expect(offered).toEqual(["due", FILE_DAY]);
    // And nowhere else: grouping a board by a date would make one column per day.
    expect(baseSelectorAcceptsInput("boardGroup", undefined, false, FILE_DAY)).toBe(false);
  });

  it("is read-only, because moving a card would have to rename the note", () => {
    expect(isReadOnlyDateColumn(FILE_DAY)).toBe(true);
    expect(isReadOnlyDateColumn("due")).toBe(false);
    expect(isReadOnlyDateColumn(null)).toBe(false);
  });
});
