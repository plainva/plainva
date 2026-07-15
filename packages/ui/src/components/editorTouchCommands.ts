import { startCompletion } from "@codemirror/autocomplete";
import { undo, redo } from "@codemirror/commands";
import { openSearchPanel } from "@codemirror/search";
import { EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

/**
 * Small selection-based editing commands for the mobile keyboard toolbar
 * (M4). They operate on any EditorView, so the desktop could reuse them;
 * they live here because the CodeMirror dependencies do.
 */

export { undo, redo };

/** Wraps (or unwraps) the selection with an inline marker like ** or ~~. */
export function toggleInlineMark(view: EditorView, marker: string): void {
  const { state } = view;
  const changes = state.changeByRange((range) => {
    const before = state.sliceDoc(Math.max(0, range.from - marker.length), range.from);
    const after = state.sliceDoc(range.to, Math.min(state.doc.length, range.to + marker.length));
    if (before === marker && after === marker) {
      return {
        changes: [
          { from: range.from - marker.length, to: range.from, insert: "" },
          { from: range.to, to: range.to + marker.length, insert: "" },
        ],
        range: EditorSelection.range(range.from - marker.length, range.to - marker.length),
      };
    }
    return {
      changes: [
        { from: range.from, insert: marker },
        { from: range.to, insert: marker },
      ],
      range: EditorSelection.range(range.from + marker.length, range.to + marker.length),
    };
  });
  view.dispatch(changes, { userEvent: "input" });
  view.focus();
}

const LINE_PREFIX = /^(\s*)((?:[-*+]\s\[[ xX]\]\s)|(?:[-*+]\s)|(?:>\s)|(?:#{1,6}\s))?/;

/** Sets/removes a block prefix ("- ", "- [ ] ", "> ") on the selected lines. */
export function toggleLinePrefix(view: EditorView, prefix: string): void {
  const { state } = view;
  const lines = new Set<number>();
  for (const r of state.selection.ranges) {
    for (let pos = r.from; pos <= r.to; ) {
      const line = state.doc.lineAt(pos);
      lines.add(line.number);
      if (line.to >= r.to) break;
      pos = line.to + 1;
    }
  }
  const changes: { from: number; to: number; insert: string }[] = [];
  const sorted = [...lines].sort((a, b) => a - b);
  const allSet = sorted.every((n) => {
    const line = state.doc.line(n);
    const m = LINE_PREFIX.exec(line.text);
    return (m?.[2] ?? "") === prefix;
  });
  for (const n of sorted) {
    const line = state.doc.line(n);
    const m = LINE_PREFIX.exec(line.text)!;
    const indent = m[1] ?? "";
    const current = m[2] ?? "";
    const next = allSet ? "" : prefix;
    if (current === next) continue;
    changes.push({
      from: line.from + indent.length,
      to: line.from + indent.length + current.length,
      insert: next,
    });
  }
  if (changes.length) view.dispatch({ changes, userEvent: "input" });
  view.focus();
}

/** Cycles the heading level of the current line: none -> # -> ## -> ### -> none. */
export function cycleHeading(view: EditorView): void {
  const { state } = view;
  const line = state.doc.lineAt(state.selection.main.head);
  const m = /^(#{1,6})\s/.exec(line.text);
  const level = m ? m[1].length : 0;
  const next = level >= 3 ? 0 : level + 1;
  const insert = next === 0 ? "" : "#".repeat(next) + " ";
  view.dispatch({
    changes: { from: line.from, to: line.from + (m ? m[0].length : 0), insert },
    userEvent: "input",
  });
  view.focus();
}

/**
 * Toolbar entry to the slash menu (R3.4 — typing "/" is clumsy on touch
 * keyboards): inserts a "/" at the caret and opens the completion popup the
 * SlashCommandPlugin serves. Typed insertion alone would not trigger it —
 * completion only auto-opens on real input events.
 */
export function openSlashMenu(view: EditorView): void {
  const pos = view.state.selection.main.head;
  view.dispatch({
    changes: { from: pos, insert: "/" },
    selection: EditorSelection.cursor(pos + 1),
    userEvent: "input",
  });
  view.focus();
  setTimeout(() => startCompletion(view), 0);
}

/** Wraps the selection in a wiki link ([[selection]]) or inserts [[]]. */
export function insertWikiLink(view: EditorView): void {
  const { state } = view;
  const range = state.selection.main;
  const text = state.sliceDoc(range.from, range.to);
  view.dispatch({
    changes: { from: range.from, to: range.to, insert: `[[${text}]]` },
    selection: EditorSelection.cursor(range.from + 2 + text.length),
    userEvent: "input",
  });
  view.focus();
}

/** Opens CodeMirror's find/replace panel (C4: the note context sheet's
 * "search in note" row — the shell has no keyboard shortcut on touch). */
export function openFindPanel(view: EditorView): void {
  openSearchPanel(view);
}

/** The lines spanned by the current selection ranges (1-based, sorted). */
function selectedLines(view: EditorView): number[] {
  const { state } = view;
  const lines = new Set<number>();
  for (const r of state.selection.ranges) {
    for (let pos = r.from; pos <= r.to; ) {
      const line = state.doc.lineAt(pos);
      lines.add(line.number);
      if (line.to >= r.to) break;
      pos = line.to + 1;
    }
  }
  return [...lines].sort((a, b) => a - b);
}

/**
 * Sets (or removes, for level 0) an ATX heading prefix on the selected lines.
 * Keyboard shortcuts bind Mod+Shift+1/2/3 to levels 1–3 and Mod+Shift+0 to 0.
 */
export function setHeadingLevel(view: EditorView, level: number): void {
  const { state } = view;
  const next = level <= 0 ? "" : "#".repeat(Math.min(6, level)) + " ";
  const changes: { from: number; to: number; insert: string }[] = [];
  for (const n of selectedLines(view)) {
    const line = state.doc.line(n);
    const m = /^#{1,6}\s/.exec(line.text);
    const cur = m ? m[0] : "";
    if (cur === next) continue;
    changes.push({ from: line.from, to: line.from + cur.length, insert: next });
  }
  if (changes.length) view.dispatch({ changes, userEvent: "input" });
  view.focus();
}

/**
 * Wraps the selection in a Markdown link `[text]()` with the caret placed
 * inside the parentheses (Mod+K, matching Obsidian/Notion/VS Code). An empty
 * selection inserts `[]()` ready to type the label.
 */
export function insertMarkdownLink(view: EditorView): void {
  const { state } = view;
  const r = state.selection.main;
  const text = state.sliceDoc(r.from, r.to);
  view.dispatch({
    changes: { from: r.from, to: r.to, insert: `[${text}]()` },
    // caret between "(" and ")": from + "[" + text + "]" + "("
    selection: EditorSelection.cursor(r.from + text.length + 3),
    userEvent: "input",
  });
  view.focus();
}

/**
 * Toggles the task checkbox on the current line (Mod+Enter): `[ ]`↔`[x]` on a
 * task line, adds `[ ] ` to a bare list item, or turns plain text into a task.
 */
export function toggleTaskLine(view: EditorView): void {
  const { state } = view;
  const line = state.doc.lineAt(state.selection.main.head);
  const indent = (/^\s*/.exec(line.text)![0]) || "";
  const rest = line.text.slice(indent.length);
  const markAt = line.from + indent.length + 2; // after "- "
  let change: { from: number; to: number; insert: string };
  if (/^[-*+] \[ \] /.test(rest)) {
    change = { from: markAt, to: markAt + 3, insert: "[x]" };
  } else if (/^[-*+] \[[xX]\] /.test(rest)) {
    change = { from: markAt, to: markAt + 3, insert: "[ ]" };
  } else if (/^[-*+] /.test(rest)) {
    change = { from: markAt, to: markAt, insert: "[ ] " };
  } else {
    change = { from: line.from + indent.length, to: line.from + indent.length, insert: "- [ ] " };
  }
  view.dispatch({ changes: change, userEvent: "input" });
  view.focus();
}
