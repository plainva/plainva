import { describe, expect, it } from "vitest";
import { leaksOf } from "./helpers/leaks.ts";

/** The check the reach and withholding tests rely on (helpers/leaks.ts): it finds a withheld value anywhere, and only that. */
describe("leaksOf", () => {
  const withheld = { words: ["Salary"], numbers: [9000, 9003, 50000] };

  it("finds a withheld value in any field, at any depth, as text or as a number", () => {
    expect(leaksOf({ hours: 9003 }, withheld)).toEqual(["hours: 9003"]);
    expect(leaksOf({ revenue: "50000" }, withheld)).toEqual(["revenue: 50000"]);
    expect(leaksOf({ tasks: ["[[Task]]", "[[Private/Salary]]"] }, withheld)).toEqual(["tasks[1]: Salary"]);
    expect(leaksOf({ a: { b: [{ c: "owes me 9000." }] } }, withheld)).toEqual(["a.b[0].c: 9000"]);
    expect(leaksOf({ note: "hours: 9000\nrate" }, withheld)).toEqual(["note: 9000"]);
    expect(leaksOf({ "Salary": 1 }, withheld)).toEqual(["Salary (key): Salary"]);
    expect(leaksOf(new Map([["x", 50000]]), withheld)).toEqual(["x: 50000"]);
    expect(leaksOf({ cell: "9000 €" }, withheld)).toEqual(["cell: 9000"]);
  });

  it("does not take digits inside a timestamp, a size, a hash or an id for a withheld number", () => {
    const row = {
      "file.mtime": 1795690009735.9272,
      "file.ctime": 1795690050000,
      "file.size": 190003,
      "file.revision": "9000ab19003f50000c",
      "file.revision2": "1795690009000.5:44",
      id: "toolu_9000x",
      uuid: "a9000-b9003-50000c",
      segments: "1f3c-9000-4a2b-50000",
      ratio: 0.9000,
      text: "0.9000 and 19000 and 90000",
    };
    expect(leaksOf(row, withheld)).toEqual([]);
  });
});
