import { describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { documentHeaderExtension } from "@plainva/ui";

/**
 * The live header reads the note's properties block as the one definition does
 * (finding 2026-10-09).
 *
 * It scanned the lines for itself, wanted a line that is exactly `---` and gave
 * up after 300 lines. So a note whose fences carry a blank and one with a long
 * block had their icon, stripe and lifecycle badge in the read view and none in
 * the live editor.
 *
 * State level: what the widget was built from. That it renders is the session
 * test's business (`editorSession.test.ts`, the lifecycle badge).
 */

const TEXTS = { addIcon: "a", addColor: "b", changeIcon: "c", changeColor: "d" };
const CALLBACKS = { onPickIcon: () => {}, onPickColor: () => {} };
const MARK = String.fromCharCode(0xfeff);

interface HeaderWidget {
  meta: { icon?: string; iconColor?: string; headerColor?: string };
  badge: "draft" | "deprecated" | null;
}

const stateOf = (doc: string) => EditorState.create({ doc, extensions: [documentHeaderExtension(true, TEXTS, CALLBACKS)] });

/** The widget the header field holds for a state. */
function headerOf(state: EditorState): HeaderWidget {
  for (const source of state.facet(EditorView.decorations)) {
    if (typeof source === "function") continue;
    for (const cursor = source.iter(); cursor.value; cursor.next()) {
      const widget = (cursor.value.spec as { widget?: Partial<HeaderWidget> }).widget;
      if (widget && "badge" in widget && "meta" in widget) return widget as HeaderWidget;
    }
  }
  throw new Error("the state carries no header widget");
}

describe("the live header and the properties block", () => {
  const YAML = 'status: draft\nplainva:\n  icon: "lucide:book"\n  header_color: "#0d6f6f"';

  it.each([
    ["exact fences", `---\n${YAML}\n---\n# Title\n`],
    ["blanks behind either fence", `--- \n${YAML}\n---\t\n# Title\n`],
    ["a byte order mark in front of the opening fence", `${MARK}---\n${YAML}\n---\n# Title\n`],
    ["fences that are the whole note", `---\n${YAML}\n---`],
  ])("reads badge, icon and stripe from a block with %s", (_name, doc) => {
    const header = headerOf(stateOf(doc));
    expect(header.badge).toBe("draft");
    expect(header.meta).toEqual({ icon: "lucide:book", headerColor: "#0d6f6f" });
  });

  it("reads a block of more than 300 lines", () => {
    const many = Array.from({ length: 400 }, (_value, index) => `key${index}: ${index}`).join("\n");
    const header = headerOf(stateOf(`---\n${many}\n${YAML}\n---\n# Title\n`));
    expect(header.badge).toBe("draft");
    expect(header.meta.icon).toBe("lucide:book");
  });

  it("shows nothing for an empty block, for no block and for a first line that only looks like a fence", () => {
    for (const doc of [
      "---\n---\n# Title\n",
      "# Title\n",
      `---\n${YAML}\n# Title\n`, // never closed
      `----\n${YAML}\n----\n# Title\n`,
      `--- x\n${YAML}\n---\n# Title\n`,
      `---\n---\n${YAML}\n---\n`, // the empty block ends on line 2; the rest is text
    ]) {
      const header = headerOf(stateOf(doc));
      expect(header.badge, JSON.stringify(doc)).toBeNull();
      expect(header.meta, JSON.stringify(doc)).toEqual({});
    }
  });

  it("follows the block as it changes", () => {
    let state = stateOf(`---\n${YAML}\n---\n# Title\n`);
    const at = state.doc.toString().indexOf("draft");
    state = state.update({ changes: { from: at, to: at + "draft".length, insert: "deprecated" } }).state;
    expect(headerOf(state).badge).toBe("deprecated");

    // Text behind the closing dashes: the line is no fence any more, and there is no block.
    const closeTo = state.doc.toString().indexOf("\n# Title");
    state = state.update({ changes: { from: closeTo, insert: "x" } }).state;
    expect(headerOf(state).badge).toBeNull();
    // Taken back, the block is one again.
    state = state.update({ changes: { from: closeTo, to: closeTo + 1 } }).state;
    expect(headerOf(state).badge).toBe("deprecated");

    // A block that arrives in a note without one.
    let plain = stateOf("# Title\n");
    plain = plain.update({ changes: { from: 0, insert: "--- \nstatus: draft\n--- \n" } }).state;
    expect(headerOf(plain).badge).toBe("draft");
  });

  it("does not read the block again for an edit behind it — and does for one that touches it", () => {
    const start = stateOf(`---\n${YAML}\n---\n# Title\n`);
    const before = headerOf(start);
    const textStart = start.doc.toString().indexOf("# Title");
    /** Applies a change and says how often the YAML was sliced out of the new document. */
    const apply = (state: EditorState, changes: { from: number; to?: number; insert?: string }) => {
      const transaction = state.update({ changes });
      const slices = vi.spyOn(transaction.newDoc, "sliceString");
      const next = transaction.state;
      const count = slices.mock.calls.length;
      slices.mockRestore();
      return { next, count };
    };

    // Typing at the end of the note, and at the very start of its text.
    const atEnd = apply(start, { from: start.doc.length, insert: "x" });
    expect(atEnd.count).toBe(0);
    expect(headerOf(atEnd.next)).toBe(before);
    const atTextStart = apply(atEnd.next, { from: textStart, insert: "x" });
    expect(atTextStart.count).toBe(0);
    expect(headerOf(atTextStart.next)).toBe(before);

    // An edit inside the block is read, and one on its closing line as well.
    const inside = apply(atTextStart.next, { from: 4, insert: "a: 1\n" });
    expect(inside.count).toBe(1);
    const onClosingLine = apply(inside.next, { from: textStart + 5 - 1, insert: " " });
    expect(onClosingLine.count).toBe(1);
    // A blank behind the closing fence leaves the block a block, with the same content.
    expect(headerOf(onClosingLine.next).badge).toBe("draft");
  });
});
