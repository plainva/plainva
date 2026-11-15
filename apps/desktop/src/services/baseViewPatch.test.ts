import { describe, expect, it } from "vitest";
import { applyBaseViewPatch, baseConfigChange, parseBaseConfig, serializeBaseConfig } from "@plainva/ui";

/**
 * A view's change is applied to the configuration as the file holds it when
 * it is written (review of the pinboard fix, 15.11.): a patch that is a
 * function computes its lists from the stored ones, never from the copy a
 * screen read when it opened.
 */
const FILE = ["views:", "  - type: table", "    name: Board", "    plainva:", "      render: pinboard", "      pinboardOrder:", '        - "Z/A.md"', '        - "Z/B.md"', ""].join("\n");

describe("a database's view, changed on the file as it is", () => {
  it("a function of the stored view sees the lists the file holds now", () => {
    const cleaned = FILE.replace('        - "Z/A.md"\n', "");
    let written: any = null;
    const text = baseConfigChange(
      (fresh) => applyBaseViewPatch(fresh, 0, (view) => ({ pinboardPinned: ["Z/New.md"], pinboardOrder: (view.pinboardOrder as string[]).filter((p) => p !== "Z/New.md") })),
      (next) => { written = next; },
    )(cleaned)!;
    expect(parseBaseConfig(text).views[0].pinboardOrder).toEqual(["Z/B.md"]);
    expect(written.views[0].pinboardPinned).toEqual(["Z/New.md"]);
  });

  it("takes a key out with undefined, writes nothing where the patch says nothing", () => {
    const next = applyBaseViewPatch(parseBaseConfig(FILE), 0, { pinboardOrder: undefined });
    expect(next.views[0].pinboardOrder).toBeUndefined();
    expect(applyBaseViewPatch(parseBaseConfig(FILE), 0, () => null)).toBeNull();
    expect(baseConfigChange(() => null, () => {})(FILE)).toBeNull();
    expect(serializeBaseConfig(next)).not.toContain("pinboardOrder");
  });

  it("gives a file without views the view it is asked for, where the caller names its type", () => {
    expect(applyBaseViewPatch({}, 0, { boardColumnOrder: ["X"] })).toBeNull();
    expect(applyBaseViewPatch({}, 0, { boardColumnOrder: ["X"] }, "board").views).toEqual([{ type: "board", boardColumnOrder: ["X"] }]);
  });
});
