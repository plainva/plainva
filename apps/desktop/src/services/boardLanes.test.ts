import { describe, expect, it } from "vitest";
import { groupRowsByLane, laneValuesOf, laneWriteValue, UNGROUPED_KEY } from "@plainva/ui";

// Swimlanes (issue #83, P6): one shared grouping for both shells.
describe("boardLanes", () => {
  const rows = [
    { "file.path": "a.md", priority: "High" },
    { "file.path": "b.md", priority: "Low" },
    { "file.path": "c.md" },
    { "file.path": "d.md", priority: ["High", "Urgent"] },
    { "file.path": "e.md", owner: "[[People/Ann|Ann]]" },
  ];

  it("reads single, multi and note.-prefixed values, wiki links by their text", () => {
    expect(laneValuesOf(rows[0], "priority")).toEqual(["High"]);
    expect(laneValuesOf(rows[3], "priority")).toEqual(["High", "Urgent"]);
    expect(laneValuesOf(rows[2], "priority")).toEqual([]);
    expect(laneValuesOf({ "note.priority": "Low" }, "priority")).toEqual(["Low"]);
    expect(laneValuesOf(rows[4], "owner")).toEqual(["Ann"]);
  });

  it("orders lanes by option order, then others alphabetically, No value last", () => {
    const lanes = groupRowsByLane(rows, "priority", ["Low", "Medium", "High"]);
    expect(lanes.map((l) => l.key)).toEqual(["Low", "Medium", "High", "Urgent", UNGROUPED_KEY]);
    expect(lanes.find((l) => l.key === "High")!.rows.map((r) => r["file.path"])).toEqual(["a.md", "d.md"]);
    expect(lanes.find((l) => l.key === "Medium")!.rows).toEqual([]);
    expect(lanes.find((l) => l.key === UNGROUPED_KEY)!.rows.map((r) => r["file.path"])).toEqual(["c.md", "e.md"]);
  });

  it("omits the No value lane when every row has a lane", () => {
    const lanes = groupRowsByLane(rows.slice(0, 2), "priority");
    expect(lanes.map((l) => l.key)).toEqual(["High", "Low"]);
  });

  it("writes the lane's stored value — a relation lane keeps its link — and empty for No value", () => {
    const lanes = groupRowsByLane(rows, "owner");
    expect(lanes.map((l) => [l.key, l.value])).toEqual([["Ann", "[[People/Ann|Ann]]"], [UNGROUPED_KEY, ""]]);
    expect(laneWriteValue(lanes, "Ann")).toBe("[[People/Ann|Ann]]");
    expect(laneWriteValue(lanes, UNGROUPED_KEY)).toBe("");
    const optionLanes = groupRowsByLane(rows, "priority", ["Low", "High"]);
    expect(laneWriteValue(optionLanes, "High")).toBe("High");
    expect(laneWriteValue(optionLanes, "Medium")).toBe("Medium");
  });
});
