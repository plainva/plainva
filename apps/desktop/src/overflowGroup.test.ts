import { describe, expect, it } from "vitest";
import { splitOverflow } from "@plainva/ui";

/**
 * E4: what does not fit goes into a menu — and the two rules that make the
 * fold predictable are exactly what a later "simplification" would drop.
 */
const active = (n: string) => (x: string) => x === n;

describe("splitOverflow", () => {
  it("leaves a row that fits alone", () => {
    expect(splitOverflow(["a", "b", "c"], 3, active("a"))).toEqual({ visible: ["a", "b", "c"], overflow: [] });
  });

  it("keeps the active entry visible even when it sits at the end", () => {
    // The finding itself: with four views the switcher clipped, and the one
    // you are looking at was the one that disappeared.
    // Three slots hold two entries and the menu, so `d` displaces nothing —
    // it keeps its place in the order and `b`/`c` move into the menu.
    const { visible, overflow } = splitOverflow(["a", "b", "c", "d"], 3, active("d"));
    expect(visible).toEqual(["a", "d"]);
    expect(overflow).toEqual(["b", "c"]);
  });

  it("never reorders — a selected entry does not jump to the front", () => {
    const { visible } = splitOverflow(["a", "b", "c", "d", "e"], 3, active("e"));
    expect(visible).toEqual(["a", "e"]);
  });

  it("reserves a slot for the menu itself", () => {
    // Filling the limit with entries and then adding the menu would cause the
    // very overflow this exists to prevent.
    const { visible } = splitOverflow(["a", "b", "c", "d"], 3, active("a"));
    expect(visible).toHaveLength(2);
  });

  it("still shows the active entry when there is room for nothing else", () => {
    const { visible, overflow } = splitOverflow(["a", "b", "c"], 1, active("b"));
    expect(visible).toEqual(["b"]);
    expect(overflow).toEqual(["a", "c"]);
  });
});
