import { beforeEach, describe, expect, it } from "vitest";
import { editorCommandTarget } from "./editorCommandTarget";

/**
 * A broadcast editor command (slash menu, template insert) reaches ONE editor
 * (plan Befunde 2026-09-24, E14): the pinboard's entry window puts a second
 * editor over the first, and both used to answer.
 */
describe("editorCommandTarget", () => {
  beforeEach(() => editorCommandTarget.reset());

  it("before any editor had the focus, the active pane answers — as before", () => {
    const pane = editorCommandTarget.newId();
    const other = editorCommandTarget.newId();
    editorCommandTarget.mount(pane);
    editorCommandTarget.mount(other);
    expect(editorCommandTarget.is(pane, true)).toBe(true);
    expect(editorCommandTarget.is(other, false)).toBe(false);
  });

  it("the editor that took the focus answers, and only it — even when it is not the active pane", () => {
    const pane = editorCommandTarget.newId();
    const entry = editorCommandTarget.newId();
    editorCommandTarget.mount(pane);
    editorCommandTarget.mount(entry);
    editorCommandTarget.focus(pane);
    editorCommandTarget.focus(entry);
    expect(editorCommandTarget.is(entry, false)).toBe(true);
    expect(editorCommandTarget.is(pane, true)).toBe(false);
  });

  it("an editor that goes away hands the commands back to the active pane", () => {
    const pane = editorCommandTarget.newId();
    const entry = editorCommandTarget.newId();
    editorCommandTarget.mount(pane);
    const unmount = editorCommandTarget.mount(entry);
    editorCommandTarget.focus(entry);
    unmount();
    expect(editorCommandTarget.is(pane, true)).toBe(true);
  });

  it("a focus reported by an editor that is not mounted claims nothing", () => {
    const pane = editorCommandTarget.newId();
    editorCommandTarget.mount(pane);
    editorCommandTarget.focus("editor-gone");
    expect(editorCommandTarget.is(pane, true)).toBe(true);
  });
});
