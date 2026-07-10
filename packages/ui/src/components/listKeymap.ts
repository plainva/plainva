import { EditorView, type KeyBinding } from "@codemirror/view";
import { completionStatus } from "@codemirror/autocomplete";

// Markdown list auto-continuation (#10): Enter continues the current list item,
// Tab / Shift-Tab indent it. All decision logic is pure and unit-tested below;
// the keymap is a thin wrapper that dispatches the computed edit.

export interface ListInfo {
  indent: string;
  /** The marker without trailing space: "-", "*", "+", or "1." / "1)". */
  marker: string;
  ordered: boolean;
  /** Parsed number for ordered lists. */
  num?: number;
  /** True for a task item ("- [ ] ..."). */
  task: boolean;
  /** Whether the task checkbox is checked. */
  checked: boolean;
  /** The text after the marker (and checkbox). */
  content: string;
}

/** Parse a single line into list metadata, or null if it is not a list item. */
export function parseListLine(text: string): ListInfo | null {
  const um = text.match(/^(\s*)([-*+])\s+(\[([ xX])\]\s+)?(.*)$/);
  if (um) {
    return { indent: um[1], marker: um[2], ordered: false, task: !!um[3], checked: /[xX]/.test(um[4] || ""), content: um[5] };
  }
  const om = text.match(/^(\s*)(\d+)([.)])\s+(.*)$/);
  if (om) {
    return { indent: om[1], marker: om[2] + om[3], ordered: true, num: parseInt(om[2], 10), task: false, checked: false, content: om[4] };
  }
  return null;
}

export interface ContinueResult {
  /** Empty item -> exit the list (clear the marker on the current line). */
  exit: boolean;
  /** Text to insert at the cursor to start the next item (when not exiting). */
  insert: string;
}

/** Decide what Enter should do on a list line. */
export function continueList(info: ListInfo): ContinueResult {
  if (info.content.trim() === "") return { exit: true, insert: "" };
  if (info.ordered) {
    const sep = info.marker.slice(-1); // "." or ")"
    return { exit: false, insert: `\n${info.indent}${(info.num ?? 1) + 1}${sep} ` };
  }
  const checkbox = info.task ? "[ ] " : "";
  return { exit: false, insert: `\n${info.indent}${info.marker} ${checkbox}` };
}

function handleEnter(view: EditorView): boolean {
  // Let the autocomplete popup own Enter when it is open.
  if (completionStatus(view.state) === "active") return false;
  const sel = view.state.selection.main;
  if (!sel.empty) return false;
  const line = view.state.doc.lineAt(sel.head);
  const info = parseListLine(line.text);
  if (!info) return false;
  // Only continue when the caret is at/after the marker's content (not when
  // editing inside the indent before the marker).
  if (sel.head < line.from + info.indent.length) return false;
  const res = continueList(info);
  if (res.exit) {
    view.dispatch({ changes: { from: line.from, to: line.to, insert: "" }, selection: { anchor: line.from }, userEvent: "input" });
    return true;
  }
  view.dispatch({
    changes: { from: sel.head, insert: res.insert },
    selection: { anchor: sel.head + res.insert.length },
    userEvent: "input",
  });
  return true;
}

function handleTab(view: EditorView): boolean {
  if (completionStatus(view.state) === "active") return false;
  const sel = view.state.selection.main;
  if (!sel.empty) return false;
  const line = view.state.doc.lineAt(sel.head);
  if (!parseListLine(line.text)) return false; // only inside list items
  view.dispatch({
    changes: { from: line.from, insert: "  " },
    selection: { anchor: sel.head + 2 },
    userEvent: "input.indent",
  });
  return true;
}

function handleShiftTab(view: EditorView): boolean {
  const sel = view.state.selection.main;
  if (!sel.empty) return false;
  const line = view.state.doc.lineAt(sel.head);
  if (!parseListLine(line.text)) return false;
  const lead = line.text.match(/^\s+/)?.[0] ?? "";
  if (!lead) return false;
  const remove = Math.min(2, lead.length);
  view.dispatch({
    changes: { from: line.from, to: line.from + remove, insert: "" },
    selection: { anchor: Math.max(line.from, sel.head - remove) },
    userEvent: "input.dedent",
  });
  return true;
}

export const listKeymap: readonly KeyBinding[] = [
  { key: "Enter", run: handleEnter },
  { key: "Tab", run: handleTab },
  { key: "Shift-Tab", run: handleShiftTab },
];
