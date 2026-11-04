import { describe, expect, it } from "vitest";
import { addDays, tasksDueUrgency, tasksUrgency, TASKS_URGENCY_PRIORITY } from "../src/tasksQuery/index.js";

/** The urgency score against the table of the Tasks documentation (Advanced/Urgency, 8.6.0). */

const TODAY = "2026-10-29";

describe("urgency", () => {
  it("due: the documented score for each day", () => {
    // Days relative to today (negative: overdue) and the score the documentation lists.
    const table: Array<[number, number]> = [
      [-30, 12.0], [-8, 12.0], [-7, 12.0], [-6, 11.54286], [-5, 11.08571], [-4, 10.62857], [-3, 10.17143], [-2, 9.71429], [-1, 9.25714],
      [0, 8.8], [1, 8.34286], [2, 7.88571], [3, 7.42857], [4, 6.97143], [5, 6.51429], [6, 6.05714], [7, 5.6], [8, 5.14286], [9, 4.68571],
      [10, 4.22857], [11, 3.77143], [12, 3.31429], [13, 2.85714], [14, 2.4], [15, 2.4], [400, 2.4],
    ];
    for (const [offset, score] of table) expect(tasksDueUrgency(addDays(TODAY, offset), TODAY)).toBeCloseTo(score, 5);
    expect(tasksDueUrgency(null, TODAY)).toBe(0);
    expect(tasksDueUrgency(undefined, TODAY)).toBe(0);
  });

  it("priority, scheduled and start", () => {
    expect(TASKS_URGENCY_PRIORITY).toEqual({ highest: 9.0, high: 6.0, medium: 3.9, none: 1.95, low: 0.0, lowest: -1.8 });
    expect(tasksUrgency({}, TODAY)).toBeCloseTo(1.95, 10);
    expect(tasksUrgency({ priorityLevel: "lowest" }, TODAY)).toBeCloseTo(-1.8, 10);
    expect(tasksUrgency({ scheduled: TODAY }, TODAY)).toBeCloseTo(6.95, 10);
    expect(tasksUrgency({ scheduled: addDays(TODAY, -10) }, TODAY)).toBeCloseTo(6.95, 10);
    expect(tasksUrgency({ scheduled: addDays(TODAY, 1) }, TODAY)).toBeCloseTo(1.95, 10);
    expect(tasksUrgency({ start: TODAY }, TODAY)).toBeCloseTo(1.95, 10);
    expect(tasksUrgency({ start: addDays(TODAY, 1) }, TODAY)).toBeCloseTo(-1.05, 10);
  });

  it("the documented examples", () => {
    expect(tasksUrgency({ due: TODAY, priorityLevel: "medium" }, TODAY)).toBeCloseTo(12.7, 10);
    expect(tasksUrgency({ priorityLevel: "high", scheduled: addDays(TODAY, -1), start: addDays(TODAY, -1) }, TODAY)).toBeCloseTo(11.0, 10);
    expect(tasksUrgency({ priorityLevel: "high", scheduled: addDays(TODAY, 1), start: addDays(TODAY, 1) }, TODAY)).toBeCloseTo(3.0, 10);
  });
});
