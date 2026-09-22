import { describe, it, expect } from "vitest";
import { setHtmlCheckboxChecked } from "./taskMutation.js";
import { setChecklistTaskDone } from "./taskMutation.js";

/**
 * A checklist inside a table cell (finding 2026-09-22).
 *
 * GFM knows task boxes only in list items, so the HTML tag is what people
 * write there — and what Obsidian renders. These boxes keep an ordinal space
 * of their own: they carry no due date, no recurrence and no completion
 * stamp, so counting them together with the GFM ones would make every later
 * task line address the wrong row.
 */
describe("setHtmlCheckboxChecked", () => {
  const TABLE = [
    "| Step | done |",
    "| --- | --- |",
    '| Fuse checked | <input type="checkbox" checked> |',
    '| Router swapped | <input type="checkbox"> |',
    "",
  ].join("\n");

  it("ticks the box it is asked for and leaves the rest of the tag alone", () => {
    const out = setHtmlCheckboxChecked(TABLE, 1, true);
    expect(out.changed).toBe(true);
    expect(out.content).toContain('| Router swapped | <input type="checkbox" checked> |');
    // The first row is untouched, attributes and all.
    expect(out.content).toContain('| Fuse checked | <input type="checkbox" checked> |');
  });

  it("clears a ticked box and writes nothing when it is already in that state", () => {
    const cleared = setHtmlCheckboxChecked(TABLE, 0, false);
    expect(cleared.changed).toBe(true);
    expect(cleared.content).toContain('| Fuse checked | <input type="checkbox"> |');
    expect(setHtmlCheckboxChecked(TABLE, 0, true).changed).toBe(false);
    expect(setHtmlCheckboxChecked(TABLE, 9, true).changed).toBe(false);
  });

  it("skips fenced code, the way the GFM scan does", () => {
    const note = ['```html', '<input type="checkbox">', "```", '<input type="checkbox">', ""].join("\n");
    const out = setHtmlCheckboxChecked(note, 0, true);
    expect(out.content.split("\n")[1]).toBe('<input type="checkbox">');
    expect(out.content.split("\n")[3]).toBe('<input type="checkbox" checked>');
  });

  it("keeps its ordinals apart from the GFM ones", () => {
    const note = [
      "- [ ] a real task",
      '| x | <input type="checkbox"> |',
      "- [ ] another real task",
      "",
    ].join("\n");
    // Index 0 in each space addresses a different line: the HTML writer never
    // touches a task line, and the task writer never touches the table.
    expect(setHtmlCheckboxChecked(note, 0, true).content.split("\n")[1]).toBe('| x | <input type="checkbox" checked> |');
    expect(setChecklistTaskDone(note, 0, true).content.split("\n")[0]).toBe("- [x] a real task");
    expect(setChecklistTaskDone(note, 1, true).content.split("\n")[2]).toBe("- [x] another real task");
  });
});
