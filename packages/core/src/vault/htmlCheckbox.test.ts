import { describe, it, expect } from "vitest";
import { readHtmlCheckbox, setHtmlCheckboxChecked } from "./taskMutation.js";
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

/**
 * One linear tokenizer reads the tag for the renderers and the writer (plan
 * Befunde 24.09., E6). The patterns it replaced backtracked exponentially on a
 * hostile tag — and such a tag arrives from outside, in an event description
 * or a guest comment. The grammar is the old one; these pin it.
 */
describe("readHtmlCheckbox", () => {
  it("reads the spellings people write", () => {
    expect(readHtmlCheckbox('<input type="checkbox">')).toEqual({ checked: false });
    expect(readHtmlCheckbox('<input type="checkbox" checked>')).toEqual({ checked: true });
    expect(readHtmlCheckbox("<input type='checkbox' checked='checked' />")).toEqual({ checked: true });
    expect(readHtmlCheckbox("<INPUT CHECKED TYPE=CHECKBOX />")).toEqual({ checked: true });
    expect(readHtmlCheckbox('  <input\ttype = "checkbox"\n checked >  ')).toEqual({ checked: true });
    expect(readHtmlCheckbox('<input type="checkbox" checked/>')).toEqual({ checked: true });
  });

  it("is one element with two attributes, nothing else", () => {
    expect(readHtmlCheckbox('<input type="text">')).toBeNull();
    expect(readHtmlCheckbox('<input type="checkbox" onclick="x()">')).toBeNull();
    expect(readHtmlCheckbox('<input type="checkbox" name="a" checked>')).toBeNull();
    expect(readHtmlCheckbox("<input checked>")).toBeNull();
    expect(readHtmlCheckbox('<inputx type="checkbox">')).toBeNull();
    expect(readHtmlCheckbox('<input type="checkbox"> trailing')).toBeNull();
    expect(readHtmlCheckbox('<input type="checkbox"')).toBeNull();
    expect(readHtmlCheckbox("<input type= >")).toBeNull();
  });

  it("keeps the old grammar where it reads oddly", () => {
    // A bare value runs up to whitespace or `>`, a slash included.
    expect(readHtmlCheckbox("<input type=checkbox/>")).toBeNull();
    expect(readHtmlCheckbox("<input type=checkbox />")).toEqual({ checked: false });
    // A quoted value may hold `>`; the last `type` wins.
    expect(readHtmlCheckbox('<input checked="a>b" type="text" type="checkbox">')).toEqual({ checked: true });
    // Text glued to a closing quote is stepped over, as the attribute pattern did.
    expect(readHtmlCheckbox('<input type="checkbox"x>')).toEqual({ checked: false });
  });
});

describe("setHtmlCheckboxChecked writes the same bytes as before", () => {
  const one = (tag: string, checked: boolean) => setHtmlCheckboxChecked(`| a | ${tag} |`, 0, checked).content.slice(6, -2);
  it("sets `checked` before the closing bracket, folding whitespace into one space", () => {
    expect(one('<input type="checkbox">', true)).toBe('<input type="checkbox" checked>');
    expect(one('<input type="checkbox" />', true)).toBe('<input type="checkbox" checked/>');
    expect(one('<input type="checkbox"   >', true)).toBe('<input type="checkbox" checked>');
    expect(one("<input type=checkbox />", true)).toBe("<input type=checkbox checked/>");
  });

  it("removes the first `checked` with its value", () => {
    expect(one('<input type="checkbox" checked>', false)).toBe('<input type="checkbox">');
    expect(one('<input checked type="checkbox">', false)).toBe('<input type="checkbox">');
    expect(one('<input type="checkbox" checked="checked" />', false)).toBe('<input type="checkbox" />');
    expect(one("<input type='checkbox' CHECKED = 'yes'>", false)).toBe("<input type='checkbox'>");
    expect(one("<input type=checkbox checked=1/>", false)).toBe("<input type=checkbox>");
  });

  it("counts only whole tags, the way the old pattern matched them", () => {
    const line = '<input title="<input type=checkbox>"> <input type="checkbox"> <input type=checkbox';
    const out = setHtmlCheckboxChecked(line, 0, true);
    expect(out.content).toBe('<input title="<input type=checkbox>"> <input type="checkbox" checked> <input type=checkbox');
    expect(setHtmlCheckboxChecked(line, 1, true).changed).toBe(false);
  });
});

describe("hostile tags take linear time (plan Befunde 24.09., E6)", () => {
  const within = (budgetMs: number, run: () => void) => {
    const start = performance.now();
    run();
    expect(performance.now() - start).toBeLessThan(budgetMs);
  };

  it("an attribute list that every value could read two ways", () => {
    // `""` is a quoted AND a bare value; the old pattern tried 2^n readings
    // before giving up at the `!`. Forty attributes were already hours.
    const hostile = `<input${' -=""'.repeat(20_000)} !>`;
    within(1_000, () => expect(readHtmlCheckbox(hostile)).toBeNull());
    within(1_000, () => expect(setHtmlCheckboxChecked(`| ${hostile} |`, 0, true).changed).toBe(false));
    for (const quoted of [`<input -='${"' -='".repeat(20_000)}`, `<input -="${'" -="'.repeat(20_000)}`]) {
      within(1_000, () => expect(readHtmlCheckbox(quoted)).toBeNull());
      within(1_000, () => expect(setHtmlCheckboxChecked(quoted, 0, true).changed).toBe(false));
    }
  });

  it("long whitespace runs inside and around a tag", () => {
    const spaces = " ".repeat(100_000);
    within(1_000, () => expect(readHtmlCheckbox(`<input${spaces}x`)).toBeNull());
    within(1_000, () => expect(setHtmlCheckboxChecked(`<input type=checkbox${spaces}>`, 0, true).content).toBe("<input type=checkbox checked>"));
    within(1_000, () => expect(setHtmlCheckboxChecked(`<input type=checkbox${spaces}checked>`, 0, false).content).toBe("<input type=checkbox>"));
    within(1_000, () => setHtmlCheckboxChecked(`<input${spaces}`.repeat(20), 0, true));
    within(1_000, () => setHtmlCheckboxChecked(`<input a=<input a=<input `.repeat(5_000), 0, true));
  });
});
