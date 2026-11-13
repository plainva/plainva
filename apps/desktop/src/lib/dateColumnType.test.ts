import { describe, expect, it } from "vitest";
import { requireWholeRows } from "@plainva/core";
import { convertDateColumns, convertDateValue, dateInputSwitch, dateSwitchLosesTime, fillMissingProperty, notesMissingProperty, type PropertyWriteAdapter } from "@plainva/ui";

/**
 * A date column switched between "Date only" and "Date & time", and a
 * property filled into the notes that lack it (Sammelplan § 3.71 no. 1 and
 * 2): one rule and one loop for both shells — the desktop's view settings,
 * its column editor and the phone's property sheet.
 *
 * The vault is a map of files; the loops and the writers run for real.
 */

function vault(files: Record<string, string>) {
  const store = new Map(Object.entries(files));
  const failing = new Set<string>();
  const adapter: PropertyWriteAdapter = {
    readTextFile: async (p) => {
      const text = store.get(p);
      if (text === undefined) throw new Error(`missing ${p}`);
      return text;
    },
    writeTextFile: async (p, text) => {
      if (failing.has(p)) throw new Error("disk full");
      store.set(p, text);
    },
  };
  return { store, failing, adapter };
}

describe("dateInputSwitch", () => {
  it("is a switch only between the two date types", () => {
    expect(dateInputSwitch("date", "datetime")).toBe("datetime");
    expect(dateInputSwitch("datetime", "date")).toBe("date");
    expect(dateInputSwitch("date", "date")).toBeNull();
    // A column that becomes a date for the first time rewrites nothing.
    expect(dateInputSwitch("text", "date")).toBeNull();
    expect(dateInputSwitch(undefined, "datetime")).toBeNull();
    // A date that becomes something else neither.
    expect(dateInputSwitch("date", "text")).toBeNull();
  });

  it("asks only where a time is dropped", () => {
    expect(dateSwitchLosesTime("date")).toBe(true);
    expect(dateSwitchLosesTime("datetime")).toBe(false);
  });
});

describe("convertDateValue", () => {
  it("gives a day 12:00 and keeps a moment", () => {
    expect(convertDateValue("2026-11-05", "datetime")).toBe("2026-11-05T12:00");
    expect(convertDateValue("2026-11-05T09:30", "datetime")).toBe("2026-11-05T09:30");
  });

  it("keeps a moment's day, also with a space between day and time", () => {
    expect(convertDateValue("2026-11-05T09:30", "date")).toBe("2026-11-05");
    expect(convertDateValue("2026-11-05 09:30", "date")).toBe("2026-11-05");
    expect(convertDateValue("2026-11-05", "date")).toBe("2026-11-05");
  });

  it("leaves what is no date as it is", () => {
    for (const value of ["", "soon", "11/05/2026", null, undefined, 3, ["2026-11-05"]]) {
      expect(convertDateValue(value, "datetime")).toEqual(value);
      expect(convertDateValue(value, "date")).toEqual(value);
    }
  });
});

describe("convertDateColumns", () => {
  it("rewrites the value where it stands, under the note's own casing, and leaves the rest of the note", async () => {
    const { store, adapter } = vault({
      "a.md": "---\r\nowner: Ann # lead\r\ndue: 2026-11-05\r\n---\r\n# A\r\n",
      "b.md": "---\nDue: 2026-11-06\ntags:\n  - x\n---\nBody\n",
      "c.md": "---\ndue: later\n---\nBody\n",
      "d.md": "# no block\n",
    });
    const result = await convertDateColumns(adapter, ["a.md", "b.md", "c.md", "d.md"], ["due"], "datetime");
    expect(result.written.sort()).toEqual(["a.md", "b.md"]);
    expect(result.failed).toEqual([]);
    expect(store.get("a.md")).toBe("---\r\nowner: Ann # lead\r\ndue: 2026-11-05T12:00\r\n---\r\n# A\r\n");
    expect(store.get("b.md")).toBe("---\nDue: 2026-11-06T12:00\ntags:\n  - x\n---\nBody\n");
    // Nothing to convert: not written, not even rewritten.
    expect(store.get("c.md")).toBe("---\ndue: later\n---\nBody\n");
    expect(store.get("d.md")).toBe("# no block\n");
  });

  it("drops the time of both fields of a timeline", async () => {
    const { store, adapter } = vault({ "a.md": "---\nstart: 2026-11-05T09:00\nend: 2026-11-06T17:30\n---\n" });
    await convertDateColumns(adapter, ["a.md"], ["start", "end"], "date");
    expect(store.get("a.md")).toBe("---\nstart: 2026-11-05\nend: 2026-11-06\n---\n");
  });

  it("goes on past a note it cannot write, and says which one", async () => {
    const { store, failing, adapter } = vault({ "a.md": "---\ndue: 2026-11-05\n---\n", "b.md": "---\ndue: 2026-11-06\n---\n" });
    failing.add("a.md");
    const result = await convertDateColumns(adapter, ["a.md", "b.md"], ["due"], "datetime");
    expect(result.failed.map((f) => f.path)).toEqual(["a.md"]);
    expect(result.written).toEqual(["b.md"]);
    expect(store.get("b.md")).toBe("---\ndue: 2026-11-06T12:00\n---\n");
  });
});

describe("fillMissingProperty", () => {
  it("names the shown rows that lack the property", () => {
    const rows = [
      { "file.path": "a.md", owner: "Ann" },
      { "file.path": "b.md" },
      { "file.path": "c.md", owner: "" },
      { "file.path": "", owner: undefined },
    ];
    expect(notesMissingProperty(rows, "owner")).toEqual(["b.md"]);
  });

  it("writes the property (empty) where it is missing, and leaves a note that carries it in any form", async () => {
    const { store, adapter } = vault({
      "a.md": "---\nstatus: open\n---\n# A\n\nBody stays.\n",
      "b.md": "# No block\n",
      // The index was behind: the note has the key already, empty or in another casing.
      "c.md": "---\nOwner:\n---\n",
      "d.md": "---\nowner: Ann\n---\n",
    });
    const result = await fillMissingProperty(adapter, ["a.md", "b.md", "c.md", "d.md"], "owner", requireWholeRows([]));
    expect(result.written.sort()).toEqual(["a.md", "b.md"]);
    expect(store.get("a.md")).toMatch(/^---\nstatus: open\nowner: ("")?\n---\n# A\n\nBody stays\.\n$/);
    expect(store.get("b.md")).toMatch(/^---\nowner: ("")?\n---\n# No block\n$/);
    expect(store.get("c.md")).toBe("---\nOwner:\n---\n");
    expect(store.get("d.md")).toBe("---\nowner: Ann\n---\n");
  });
});
