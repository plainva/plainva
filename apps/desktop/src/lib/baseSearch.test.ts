import { describe, expect, it } from "vitest";
import { baseSearchMetadata, baseSearchRevision, filterRowsBySearch, pinboardTextMatches, plainCellText, searchableCellText } from "@plainva/ui";

/**
 * The search of a database, for every view (finding 2026-09-19). The field and
 * the hook are the pinboard's and have their own tests; this pins what the
 * other seven views were missing - what a row is searched BY, when a result
 * goes stale, and the filter.
 */
const rows = [
  { "file.path": "Jobs/Offer Vogt.md", "file.name": "Offer Vogt", "file.tags": ["client"], status: "Open", owner: "[[Anna]]", "file.mtime": 1, "file.size": 10 },
  { "file.path": "Jobs/Mail migration.md", "file.name": "Mail migration", status: "In progress", hours: 12, "file.mtime": 2, "file.size": 20 },
];

describe("what a row is searched by", () => {
  it("the name, the tags and every VISIBLE column as the view displays it", () => {
    const meta = baseSearchMetadata(rows, ["status", "owner"], (row, col) => (col === "owner" ? String(row[col] ?? "").replace(/[[\]]/g, "") : String(row[col] ?? "")));
    expect(meta.get("Jobs/Offer Vogt.md")).toEqual(["Offer Vogt", "client", "Open", "Anna"]);
    // A hidden column is not searched: nobody can see why such a row would match.
    expect(meta.get("Jobs/Mail migration.md")).toEqual(["Mail migration", "In progress", ""]);
    expect(pinboardTextMatches(meta.get("Jobs/Offer Vogt.md")!, "vogt")).toBe(true);
    expect(pinboardTextMatches(meta.get("Jobs/Mail migration.md")!, "12")).toBe(false);
  });

  it("takes a view's extra texts - the pinboard's labels - without the views knowing of each other", () => {
    const meta = baseSearchMetadata(rows.slice(0, 1), [], () => "", () => ["urgent"]);
    expect(meta.get("Jobs/Offer Vogt.md")).toEqual(["Offer Vogt", "urgent", "client"]);
  });

  it("reads a cell as plain text where no formatter is at hand", () => {
    expect(plainCellText(null)).toBe("");
    expect(plainCellText(12)).toBe("12");
    expect(plainCellText(["[[Anna]]", "[[Ben]]"])).toBe("[[Anna]] [[Ben]]");
    expect(plainCellText({ a: 1 })).toBe('{"a":1}');
  });

  it("searches a typed cell by its plain value - an element has no text to stringify", () => {
    // A select renders as a chip ELEMENT; String(element) is "[object Object]".
    expect(searchableCellText("paused", { $$typeof: Symbol.for("react.element") })).toBe("paused");
    // A formatted date is text: both the shown form and the stored one match.
    expect(searchableCellText("2026-09-19", "19.09.2026")).toBe("19.09.2026 2026-09-19");
    expect(searchableCellText(null, undefined)).toBe("");
  });
});

describe("when a result goes stale, and the filter", () => {
  it("the revision changes with a row's note, and only then", () => {
    const before = baseSearchRevision(rows);
    expect(baseSearchRevision(rows.map((row) => ({ ...row })))).toBe(before);
    expect(baseSearchRevision([{ ...rows[0], "file.mtime": 99 }, rows[1]])).not.toBe(before);
  });

  it("no query leaves every row and the array itself; a query leaves the matches in their order", () => {
    expect(filterRowsBySearch(rows, null)).toBe(rows);
    expect(filterRowsBySearch(rows, new Set(["Jobs/Mail migration.md"]))).toEqual([rows[1]]);
    expect(filterRowsBySearch(rows, new Set())).toEqual([]);
  });
});
