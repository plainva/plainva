import { describe, expect, it } from "vitest";
import { newItemPrefill } from "./baseOps";

describe("newItemPrefill (E3 filter prefill)", () => {
  it("prefills the simple == rules of the active view under ALL logic", () => {
    const config = {
      views: [
        { type: "table", name: "A" },
        {
          type: "table",
          name: "B",
          filters: { and: ['status == "Offen"', 'note.prio == "1"', 'kunde != "ACME"'] },
        },
      ],
    };
    expect(newItemPrefill(config, 1)).toEqual({ status: "Offen", prio: "1" });
  });

  it("stays empty under ANY logic and without views", () => {
    const config = { views: [{ type: "table", name: "A", filters: { or: ['status == "Offen"'] } }] };
    expect(newItemPrefill(config, 0)).toEqual({});
    expect(newItemPrefill({}, 0)).toEqual({});
  });
});
