import { describe, it, expect } from "vitest";
import {
  normalizeRollup,
  serializeRollup,
  aggregateRollup,
  matchesRollupWhere,
  rollupNeedsProperty,
  rollupNeedsWhere,
  rollupIsNumeric,
  ROLLUP_FNS,
  type RollupSpec,
} from "./rollup.js";

describe("normalizeRollup", () => {
  it("reads a full spec", () => {
    expect(
      normalizeRollup({ through: "aufgaben", of: "status", fn: "countWhere", where: { op: "!=", value: "Erledigt" } })
    ).toEqual({ through: "aufgaben", of: "status", fn: "countWhere", where: { op: "!=", value: "Erledigt" } });
  });

  it("counts without a property", () => {
    expect(normalizeRollup({ through: "aufgaben", fn: "count" })).toEqual({ through: "aufgaben", fn: "count" });
  });

  // Red counter-proof 1: an unknown function is DROPPED, never thrown on — a
  // `.base` from a newer Plainva must still open.
  it("drops an unknown function instead of throwing", () => {
    expect(() => normalizeRollup({ through: "aufgaben", of: "x", fn: "wurzel" })).not.toThrow();
    expect(normalizeRollup({ through: "aufgaben", of: "x", fn: "wurzel" })).toBeNull();
  });

  // Red counter-proof 2: a condition without an operand is malformed.
  it("drops a countWhere without a condition, and a condition without a value", () => {
    expect(normalizeRollup({ through: "a", of: "status", fn: "countWhere" })).toBeNull();
    expect(normalizeRollup({ through: "a", of: "status", fn: "countWhere", where: { op: "!=" } })).toBeNull();
    expect(normalizeRollup({ through: "a", of: "status", fn: "countWhere", where: { op: "~", value: "x" } })).toBeNull();
  });

  it("drops a spec that misses its through or its of", () => {
    expect(normalizeRollup({ of: "status", fn: "count" })).toBeNull();
    expect(normalizeRollup({ through: "a", fn: "sum" })).toBeNull();
    expect(normalizeRollup(null)).toBeNull();
    expect(normalizeRollup("aufgaben")).toBeNull();
    expect(normalizeRollup([{ through: "a", fn: "count" }])).toBeNull();
  });

  it("keeps an empty operand — that is the is-empty operator, not a missing value", () => {
    const spec = normalizeRollup({ through: "a", of: "notiz", fn: "countWhere", where: { op: "==", value: "" } });
    expect(spec?.where).toEqual({ op: "==", value: "" });
  });

  it("round-trips losslessly", () => {
    const spec: RollupSpec = { through: "aufgaben", of: "aufwand", fn: "sum" };
    expect(normalizeRollup(serializeRollup(spec))).toEqual(spec);
    const withWhere: RollupSpec = { through: "t", of: "s", fn: "percentWhere", where: { op: "==", value: "Erledigt" } };
    expect(normalizeRollup(serializeRollup(withWhere))).toEqual(withWhere);
  });

  it("writes no empty keys", () => {
    expect(serializeRollup({ through: "a", fn: "count" })).toEqual({ through: "a", fn: "count" });
  });
});

describe("function traits", () => {
  it("only count works without a property", () => {
    for (const fn of ROLLUP_FNS) expect(rollupNeedsProperty(fn)).toBe(fn !== "count");
  });
  it("only the where-functions need a condition", () => {
    for (const fn of ROLLUP_FNS) {
      expect(rollupNeedsWhere(fn)).toBe(fn === "countWhere" || fn === "percentWhere");
    }
  });
  it("earliest and latest are the only non-numeric results", () => {
    for (const fn of ROLLUP_FNS) {
      expect(rollupIsNumeric(fn)).toBe(fn !== "earliest" && fn !== "latest");
    }
  });
});

describe("matchesRollupWhere", () => {
  it("compares scalars and lists the way base filters do", () => {
    expect(matchesRollupWhere("Erledigt", { op: "==", value: "Erledigt" })).toBe(true);
    expect(matchesRollupWhere("Offen", { op: "!=", value: "Erledigt" })).toBe(true);
    expect(matchesRollupWhere(["a", "b"], { op: "==", value: "b" })).toBe(true);
    expect(matchesRollupWhere(["a", "b"], { op: "!=", value: "b" })).toBe(false);
  });

  it("treats a missing value as not-equal, matching the filter semantics", () => {
    expect(matchesRollupWhere(undefined, { op: "!=", value: "Erledigt" })).toBe(true);
    expect(matchesRollupWhere(undefined, { op: "==", value: "Erledigt" })).toBe(false);
  });

  it("uses an empty operand as the is-empty operator", () => {
    expect(matchesRollupWhere(undefined, { op: "==", value: "" })).toBe(true);
    expect(matchesRollupWhere([], { op: "==", value: "" })).toBe(true);
    expect(matchesRollupWhere("x", { op: "!=", value: "" })).toBe(true);
  });

  it("contains and notContains", () => {
    expect(matchesRollupWhere("Roadmap Q3", { op: "contains", value: "Q3" })).toBe(true);
    expect(matchesRollupWhere("Roadmap Q3", { op: "notContains", value: "Q4" })).toBe(true);
    expect(matchesRollupWhere(undefined, { op: "notContains", value: "Q4" })).toBe(true);
  });

  it("compares numbers numerically, not as strings", () => {
    expect(matchesRollupWhere(9, { op: "<", value: "10" })).toBe(true);
    expect(matchesRollupWhere("9", { op: "<", value: "10" })).toBe(true);
    expect(matchesRollupWhere("2026-08-11", { op: ">=", value: "2026-08-01" })).toBe(true);
  });
});

describe("aggregateRollup", () => {
  const through = "aufgaben";

  it("counts the linked notes, not their values", () => {
    expect(aggregateRollup({ through, fn: "count" }, [1, undefined, ["a", "b"]])).toBe(3);
    expect(aggregateRollup({ through, fn: "count" }, [])).toBe(0);
  });

  it("countWhere and percentWhere", () => {
    const values = ["Offen", "Erledigt", "In Arbeit", "Erledigt"];
    const open: RollupSpec = { through, of: "status", fn: "countWhere", where: { op: "!=", value: "Erledigt" } };
    expect(aggregateRollup(open, values)).toBe(2);
    const done: RollupSpec = { through, of: "status", fn: "percentWhere", where: { op: "==", value: "Erledigt" } };
    expect(aggregateRollup(done, values)).toBe(50);
  });

  it("reports 0 percent for an empty relation rather than dividing by zero", () => {
    const spec: RollupSpec = { through, of: "s", fn: "percentWhere", where: { op: "==", value: "x" } };
    expect(aggregateRollup(spec, [])).toBe(0);
  });

  it("sums, averages and takes the median", () => {
    const values = [120, "240", 60, undefined];
    expect(aggregateRollup({ through, of: "a", fn: "sum" }, values)).toBe(420);
    expect(aggregateRollup({ through, of: "a", fn: "average" }, values)).toBe(140);
    expect(aggregateRollup({ through, of: "a", fn: "median" }, values)).toBe(120);
    expect(aggregateRollup({ through, of: "a", fn: "median" }, [1, 2, 3, 4])).toBe(2.5);
    expect(aggregateRollup({ through, of: "a", fn: "min" }, values)).toBe(60);
    expect(aggregateRollup({ through, of: "a", fn: "max" }, values)).toBe(240);
  });

  // A sum of nothing is not zero — a zero would read as "measured, and it is
  // none", which is a different statement from "nothing to measure".
  it("returns nothing when there is nothing numeric to measure", () => {
    expect(aggregateRollup({ through, of: "a", fn: "sum" }, [])).toBeNull();
    expect(aggregateRollup({ through, of: "a", fn: "sum" }, ["Offen", undefined])).toBeNull();
    expect(aggregateRollup({ through, of: "a", fn: "average" }, [null])).toBeNull();
  });

  it("reads a decimal comma", () => {
    expect(aggregateRollup({ through, of: "a", fn: "sum" }, ["1,5", "2,5"])).toBe(4);
  });

  it("counts checkboxes in both the boolean and the string spelling", () => {
    const values = [true, "true", false, "no", undefined];
    expect(aggregateRollup({ through, of: "erledigt", fn: "checked" }, values)).toBe(2);
    expect(aggregateRollup({ through, of: "erledigt", fn: "unchecked" }, values)).toBe(3);
  });

  it("counts notes with and without a value", () => {
    const values = ["x", "", undefined, [], ["a"]];
    expect(aggregateRollup({ through, of: "a", fn: "filled" }, values)).toBe(2);
    expect(aggregateRollup({ through, of: "a", fn: "empty" }, values)).toBe(3);
  });

  it("counts distinct values across lists", () => {
    expect(aggregateRollup({ through, of: "tags", fn: "unique" }, [["a", "b"], ["b"], undefined, "c"])).toBe(3);
  });

  it("finds the earliest and the latest date", () => {
    const values = ["2026-08-11", "2026-07-01", undefined, "kein Datum"];
    expect(aggregateRollup({ through, of: "faellig", fn: "earliest" }, values)).toBe("2026-07-01");
    expect(aggregateRollup({ through, of: "faellig", fn: "latest" }, values)).toBe("2026-08-11");
    expect(aggregateRollup({ through, of: "faellig", fn: "latest" }, ["morgen"])).toBeNull();
  });

  it("flattens list values before measuring them", () => {
    expect(aggregateRollup({ through, of: "a", fn: "sum" }, [[1, 2], 3])).toBe(6);
  });
});
