import { describe, it, expect } from "vitest";
import {
  parseDependencies, serializeDependencies, gapDays,
  findDependencyCycle, findScheduleConflicts, EVALUATED_RELTYPE,
  type DependencyNode,
} from "@plainva/ui";

/**
 * Dependencies write into people's notes and can be built into a loop in two
 * clicks — every assertion here has a red counter-proof in the loop's § 5.
 */
describe("parseDependencies", () => {
  it("reads the RFC 9253 shape", () => {
    expect(parseDependencies([{ uid: "[[A]]", reltype: "FINISHTOSTART", gap: "P1D" }]))
      .toEqual([{ uid: "[[A]]", reltype: "FINISHTOSTART", gap: "P1D" }]);
  });

  it("accepts a bare string as finish-to-start — that is what people type by hand", () => {
    expect(parseDependencies("[[A]]")).toEqual([{ uid: "[[A]]", reltype: EVALUATED_RELTYPE }]);
    expect(parseDependencies(["[[A]]", "  "])).toEqual([{ uid: "[[A]]", reltype: EVALUATED_RELTYPE }]);
  });

  it("keeps the other relationship types instead of flattening them", () => {
    // Plainva evaluates only finish-to-start, but a file written elsewhere
    // must survive a round trip unchanged.
    const deps = parseDependencies([{ uid: "[[A]]", reltype: "startToStart" }]);
    expect(deps[0].reltype).toBe("STARTTOSTART");
    expect(serializeDependencies(deps)).toEqual([{ uid: "[[A]]", reltype: "STARTTOSTART" }]);
  });

  it("drops what it cannot read rather than throwing", () => {
    expect(parseDependencies([{ reltype: "FINISHTOSTART" }, null, 42, { uid: "" }])).toEqual([]);
    expect(parseDependencies(undefined)).toEqual([]);
    // An unparsable gap is dropped; the dependency itself survives.
    expect(parseDependencies([{ uid: "[[A]]", gap: "morgen" }])).toEqual([{ uid: "[[A]]", reltype: EVALUATED_RELTYPE }]);
  });

  it("writes no empty gap", () => {
    expect(serializeDependencies([{ uid: "[[A]]", reltype: "FINISHTOSTART" }]))
      .toEqual([{ uid: "[[A]]", reltype: "FINISHTOSTART" }]);
  });
});

describe("gapDays", () => {
  it("reads the day-scale parts of an ISO duration", () => {
    expect(gapDays("P1D")).toBe(1);
    expect(gapDays("P2W")).toBe(14);
    expect(gapDays("-P3D")).toBe(-3);
    expect(gapDays(undefined)).toBe(0);
    expect(gapDays("nonsense")).toBe(0);
  });
});

const nodes = (m: Record<string, string[]>): DependencyNode[] =>
  Object.entries(m).map(([key, preds]) => ({
    key,
    blockedBy: preds.map((k) => ({ key: k, reltype: EVALUATED_RELTYPE })),
  }));

describe("findDependencyCycle", () => {
  it("names the concrete path instead of only saying no", () => {
    // B depends on A. Making A depend on B closes the loop.
    const path = findDependencyCycle(nodes({ A: [], B: ["A"] }), "A", "B");
    expect(path).toEqual(["A", "B", "A"]);
  });

  it("finds a loop several steps long", () => {
    expect(findDependencyCycle(nodes({ A: [], B: ["A"], C: ["B"] }), "A", "C")).toEqual(["A", "C", "B", "A"]);
  });

  it("refuses an entry depending on itself", () => {
    expect(findDependencyCycle(nodes({ A: [] }), "A", "A")).toEqual(["A", "A"]);
  });

  it("allows an edge that closes nothing", () => {
    expect(findDependencyCycle(nodes({ A: [], B: [], C: ["B"] }), "B", "A")).toBeNull();
  });

  it("terminates on a graph that is already cyclic", () => {
    // A file edited by hand can already contain a loop. The guard must answer,
    // not hang.
    expect(findDependencyCycle(nodes({ A: ["B"], B: ["A"] }), "A", "B")).not.toBeNull();
  });
});

describe("findScheduleConflicts", () => {
  const dates = new Map([
    ["A", { start: "2026-08-01", end: "2026-08-05" }],
    ["B", { start: "2026-08-03" }],
    ["C", { start: "2026-08-10" }],
  ]);

  it("reports a successor that begins before its predecessor is finished", () => {
    const found = findScheduleConflicts(nodes({ A: [], B: ["A"] }), dates);
    expect(found).toEqual([{ key: "B", predecessor: "A", overlapDays: 3 }]);
  });

  it("says nothing when the order holds", () => {
    expect(findScheduleConflicts(nodes({ A: [], C: ["A"] }), dates)).toEqual([]);
  });

  it("counts the gap as part of the requirement", () => {
    const withGap: DependencyNode[] = [
      { key: "C", blockedBy: [{ key: "A", reltype: EVALUATED_RELTYPE, gap: "P7D" }] },
    ];
    // A ends 08-05, +1 day +7 days gap = 08-13; C starts 08-10, so three days early.
    expect(findScheduleConflicts(withGap, dates)).toEqual([{ key: "C", predecessor: "A", overlapDays: 3 }]);
  });

  it("ignores the relationship types it does not evaluate", () => {
    const other: DependencyNode[] = [{ key: "B", blockedBy: [{ key: "A", reltype: "STARTTOSTART" }] }];
    expect(findScheduleConflicts(other, dates)).toEqual([]);
  });

  it("says nothing when a date is missing — an unknown is not a conflict", () => {
    expect(findScheduleConflicts(nodes({ B: ["Z"] }), dates)).toEqual([]);
    expect(findScheduleConflicts(nodes({ Z: ["A"] }), dates)).toEqual([]);
  });
});
