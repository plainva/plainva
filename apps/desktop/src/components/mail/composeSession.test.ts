// @vitest-environment jsdom
import { afterEach, describe, it, expect } from "vitest";
import { undoDepth } from "@codemirror/commands";
import { createComposeSession, type ComposeSession } from "@plainva/ui/mail";
import { resetSpellcheckForTests, setSpellcheckOn } from "@plainva/ui";

afterEach(() => resetSpellcheckForTests());

/**
 * The compose editor's engine, shared by the desktop dialog and the phone
 * (G3b). It runs a REAL EditorView in jsdom, so what is pinned here is the
 * behaviour both shells inherit — a divergence between them would now have to
 * be a divergence in their chrome, not in how a message is written.
 */

function mount(doc = "", touch = false): { session: ComposeSession; seen: () => string } {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  let last = doc;
  const session = createComposeSession({
    parent,
    doc,
    touch,
    onChange: (v) => {
      last = v;
    },
  });
  return { session, seen: () => last };
}

describe("compose session", () => {
  it("applies a toolbar command to the selection and reports the new text", () => {
    const { session, seen } = mount("hello world");
    session.view.dispatch({ selection: { anchor: 0, head: 5 } });
    session.run("bold");
    expect(session.view.state.doc.toString()).toBe("**hello** world");
    expect(seen()).toBe("**hello** world");
    session.destroy();
  });

  it("keeps the selection on the wrapped text so a second command nests correctly", () => {
    const { session } = mount("hello");
    session.view.dispatch({ selection: { anchor: 0, head: 5 } });
    session.run("bold");
    session.run("italic");
    expect(session.view.state.doc.toString()).toBe("***hello***");
    session.destroy();
  });

  it("swallows the typed trigger when a command comes from the slash menu", () => {
    // What the user typed: "Note: /quo" with the caret at the end.
    const { session, seen } = mount("Note: /quo");
    session.view.dispatch({ selection: { anchor: 10 } });
    session.runSlash("quote", 6);
    expect(session.view.state.doc.toString()).toBe("> Note: ");
    expect(seen()).toBe("> Note: ");
    session.destroy();
  });

  it("reports an active slash trigger and clears it once the caret leaves", () => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const hits: (null | { from: number; query: string })[] = [];
    const session = createComposeSession({
      parent,
      doc: "",
      onChange: () => {},
      onSlashChange: (hit) => hits.push(hit),
    });
    const latest = () => hits[hits.length - 1];
    session.view.dispatch({ changes: { from: 0, insert: "/bo" }, selection: { anchor: 3 } });
    expect(latest()).toEqual({ from: 0, query: "bo" });
    session.view.dispatch({ changes: { from: 3, insert: " " }, selection: { anchor: 4 } });
    expect(latest()).toBeNull();
    session.destroy();
  });

  it("adopts an external draft but ignores what the caller already emitted", () => {
    const { session } = mount("");
    // A reply prefill arriving from the parent.
    session.applyExternalText("> quoted original");
    expect(session.view.state.doc.toString()).toBe("> quoted original");
    // Typing: the session emitted this, so re-supplying it must not dispatch.
    session.view.dispatch({ changes: { from: 17, insert: "!" } });
    const before = session.view.state.doc.toString();
    session.applyExternalText(before);
    expect(session.view.state.doc.toString()).toBe(before);
    session.destroy();
  });

  it("turns the virtual keyboard smart only in the touch profile", () => {
    const plain = mount("", false);
    expect(plain.session.view.contentDOM.getAttribute("autocapitalize")).toBe("off");
    plain.session.destroy();

    const phone = mount("", true);
    expect(phone.session.view.contentDOM.getAttribute("autocapitalize")).toBe("sentences");
    expect(phone.session.view.contentDOM.getAttribute("autocorrect")).toBe("on");
    // Spell checking is not part of the touch profile: it is the device switch
    // (plan Befunde 2026-10-06, E3), off by default on both profiles.
    expect(phone.session.view.contentDOM.getAttribute("spellcheck")).toBe("false");
    phone.session.destroy();
  });

  it("follows the spell-checking switch in an open draft and keeps caret and undo history", () => {
    const { session } = mount("Hallo");
    const view = session.view;
    expect(view.contentDOM.getAttribute("spellcheck")).toBe("false");
    view.dispatch({ changes: { from: 5, insert: " Welt" }, selection: { anchor: 2 }, userEvent: "input.type" });
    const depth = undoDepth(view.state);
    expect(depth).toBeGreaterThan(0);

    setSpellcheckOn(true);
    expect(session.view).toBe(view);
    expect(view.contentDOM.getAttribute("spellcheck")).toBe("true");
    expect(view.state.doc.toString()).toBe("Hallo Welt");
    expect(view.state.selection.main.head).toBe(2);
    expect(undoDepth(view.state)).toBe(depth);
    // The keyboard profile is untouched by the switch.
    expect(view.contentDOM.getAttribute("autocapitalize")).toBe("off");

    setSpellcheckOn(false);
    expect(view.contentDOM.getAttribute("spellcheck")).toBe("false");
    session.destroy();
    // A closed draft no longer listens.
    expect(() => setSpellcheckOn(true)).not.toThrow();
  });

  it("a draft opened while the switch is on starts checked", () => {
    setSpellcheckOn(true);
    const { session } = mount("", true);
    expect(session.view.contentDOM.getAttribute("spellcheck")).toBe("true");
    expect(session.view.contentDOM.getAttribute("autocorrect")).toBe("on");
    session.destroy();
  });
});
