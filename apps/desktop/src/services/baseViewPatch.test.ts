import { describe, expect, it } from "vitest";
import { applyBaseViewPatch, baseConfigChange, BaseFileNotConfigError, BaseViewGoneError, findBaseView, ParkedBaseChanges, parseBaseConfig, readBaseConfig, serializeBaseConfig } from "@plainva/ui";

/**
 * A view's change is applied to the configuration as the file holds it when
 * it is written (review of the pinboard fix, 15.11.): a patch that is a
 * function computes its lists from the stored ones, never from the copy a
 * screen read when it opened — on the view the screen shows, found by its
 * name, read the way a database opens.
 */
const board = (views: string[]) => ["views:", ...views.flatMap((name) => [
  "  - type: table", `    name: ${name}`, "    plainva:", "      render: pinboard", "      pinboardOrder:", '        - "Z/A.md"', '        - "Z/B.md"',
]), ""].join("\n");
const pin = (path: string) => (view: Record<string, any>) => ({ pinboardPinned: [path, ...((view.pinboardPinned as string[]) ?? [])] });

describe("a database's view, changed on the file as it is", () => {
  it("a function of the stored view sees the lists the file holds now", () => {
    const cleaned = board(["Board"]).replace('        - "Z/A.md"\n', "");
    const text = baseConfigChange((fresh) => applyBaseViewPatch(fresh, { index: 0, name: "Board" }, (view) => ({
      pinboardPinned: ["Z/New.md"], pinboardOrder: (view.pinboardOrder as string[]).filter((p) => p !== "Z/New.md"),
    })))(cleaned)!;
    expect(parseBaseConfig(text).views[0].pinboardOrder).toEqual(["Z/B.md"]);
    expect(parseBaseConfig(text).views[0].pinboardPinned).toEqual(["Z/New.md"]);
  });

  it("finds the view by its name: one inserted before it moves nothing", () => {
    const text = baseConfigChange((fresh) => applyBaseViewPatch(fresh, { index: 0, name: "Board" }, pin("Z/X.md")))(board(["Inserted", "Board"]))!;
    const views = parseBaseConfig(text).views;
    expect(views[0].pinboardPinned).toBeUndefined();
    expect(views[1].pinboardPinned).toEqual(["Z/X.md"]);
  });

  it("refuses where the view is gone — removed, renamed, or past the end — and writes nothing", () => {
    const removed = board(["Table"]);
    expect(() => baseConfigChange((fresh) => applyBaseViewPatch(fresh, { index: 0, name: "Board" }, pin("Z/X.md")))(removed)).toThrow(BaseViewGoneError);
    expect(() => applyBaseViewPatch(parseBaseConfig(board(["Board"])), { index: 5, name: "Gone" }, { boardColorMode: "column" })).toThrow(BaseViewGoneError);
    // Two of one name: only where the screen's place still holds one of them.
    expect(findBaseView([{ name: "A" }, { name: "A" }], { index: 1, name: "A" })).toBe(1);
    expect(findBaseView([{ name: "A" }, { name: "A" }], { index: 2, name: "A" })).toBe(-1);
  });

  it("refuses a file that holds no configuration: empty, only comments, a single value", () => {
    for (const text of ["", "# only a comment\n", "just text\n"]) {
      expect(() => baseConfigChange((fresh) => applyBaseViewPatch(fresh, { index: 0, name: null, fallbackType: "table" }, { pinboardPinned: ["Z/X.md"] }))(text)).toThrow(BaseFileNotConfigError);
    }
    // A database with filters and no views gets the view it is shown as.
    const text = baseConfigChange((fresh) => applyBaseViewPatch(fresh, { index: 0, name: null, fallbackType: "board" }, { boardColumnOrder: ["X"] }))("filters:\n  and:\n    - file.folder == \"Z\"\n")!;
    expect(parseBaseConfig(text).views).toEqual([expect.objectContaining({ type: "board", boardColumnOrder: ["X"] })]);
  });

  it("reads the file the way the database opens: a file-level filter stays in the view's filter field", () => {
    const text = ['filters:', '  and:', '    - note.status == "open"', 'views:', '  - type: table', '    name: Board', '    plainva:', '      render: pinboard', ''].join("\n");
    const opened = readBaseConfig(text);
    const after = readBaseConfig(baseConfigChange((fresh) => applyBaseViewPatch(fresh, { index: 0, name: "Board" }, pin("Z/X.md")))(text)!);
    expect(JSON.stringify(after.views[0].filters)).toBe(JSON.stringify(opened.views[0].filters));
    expect(JSON.stringify(after.views[0].filters)).toContain("note.status");
  });

  it("keeps changes that found their file gone as what they are, and applies them in order to the file found", () => {
    const parked = new ParkedBaseChanges();
    parked.park((fresh) => applyBaseViewPatch(fresh, { index: 0, name: "Board" }, pin("Z/1.md")));
    parked.park((fresh) => applyBaseViewPatch(fresh, { index: 0, name: "Board" }, pin("Z/2.md")));
    expect(parked.waiting).toBe(true);
    // The file as it was found: another device removed Z/A.md meanwhile.
    const found = board(["Board"]).replace('        - "Z/A.md"\n', "");
    const views = parseBaseConfig(baseConfigChange(parked.composed())(found)!).views;
    expect(views[0].pinboardPinned).toEqual(["Z/2.md", "Z/1.md"]);
    expect(views[0].pinboardOrder).toEqual(["Z/B.md"]);
    parked.clear();
    expect(parked.waiting).toBe(false);
  });

  it("takes a key out with undefined, writes nothing where the patch says nothing", () => {
    const next = applyBaseViewPatch(parseBaseConfig(board(["Board"])), { index: 0, name: "Board" }, { pinboardOrder: undefined });
    expect(next.views[0].pinboardOrder).toBeUndefined();
    expect(applyBaseViewPatch(parseBaseConfig(board(["Board"])), { index: 0, name: "Board" }, () => null)).toBeNull();
    expect(baseConfigChange(() => null)(board(["Board"]))).toBeNull();
    expect(serializeBaseConfig(next)).not.toContain("pinboardOrder");
  });
});
