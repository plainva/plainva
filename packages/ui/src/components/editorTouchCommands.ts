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

type TextChange = { from: number; to?: number; insert: string };

/**
 * Returns the offset where inline content starts. Markdown block markers are
 * deliberately kept outside emphasis/code markers so a whole-line selection
 * turns `- [ ] task` into `- [ ] **task**`, not `**- [ ] task**`.
 */
function inlineContentOffset(text: string): number {
  const m = /^(\s*(?:>\s*)*)(?:(?:#{1,6}\s+)|(?:(?:[-+*]|\d+[.)])\s+(?:\[[ xX]\]\s+)?))?/.exec(text);
  return m?.[0].length ?? 0;
}

function markerMode(doc: string, from: number, to: number, marker: string): "outside" | "inside" | "none" {
  const selected = doc.slice(from, to);
  const before = doc.slice(Math.max(0, from - marker.length), from);
  const after = doc.slice(to, Math.min(doc.length, to + marker.length));
  // A single `*` must never peel one character off a surrounding `**` pair.
  const boldClash = marker === "*" && (before.endsWith("**") || after.startsWith("**") || selected.startsWith("**"));
  if (!boldClash && before === marker && after === marker) return "outside";
  if (!boldClash && selected.length >= marker.length * 2 && selected.startsWith(marker) && selected.endsWith(marker)) return "inside";
  return "none";
}

/** Wraps (or unwraps) each selected logical line with an inline marker. */
export function toggleInlineMark(view: EditorView, marker: string): void {
  const { state } = view;
  const range = state.selection.main;
  if (range.empty) {
    view.dispatch({
      changes: { from: range.from, insert: marker + marker },
      selection: EditorSelection.cursor(range.from + marker.length),
      userEvent: "input",
    });
    view.focus();
    return;
  }

  const doc = state.doc.toString();
  const endProbe = Math.max(range.from, range.to - 1);
  const firstLine = state.doc.lineAt(range.from).number;
  const lastLine = state.doc.lineAt(endProbe).number;
  const segments: Array<{ from: number; to: number; mode: "outside" | "inside" | "none" }> = [];
  for (let n = firstLine; n <= lastLine; n++) {
    const line = state.doc.line(n);
    let from = Math.max(range.from, line.from + inlineContentOffset(line.text));
    let to = Math.min(range.to, line.to);
    // Keep incidental whitespace outside the marker pair.
    while (from < to && /\s/.test(doc[from])) from++;
    while (to > from && /\s/.test(doc[to - 1])) to--;
    if (from >= to) continue;
    segments.push({ from, to, mode: markerMode(doc, from, to, marker) });
  }
  if (segments.length === 0) return;

  const remove = segments.every((segment) => segment.mode !== "none");
  const changes: TextChange[] = [];
  for (const segment of segments) {
    if (remove) {
      if (segment.mode === "outside") {
        changes.push(
          { from: segment.from - marker.length, to: segment.from, insert: "" },
          { from: segment.to, to: segment.to + marker.length, insert: "" },
        );
      } else if (segment.mode === "inside") {
        changes.push(
          { from: segment.from, to: segment.from + marker.length, insert: "" },
          { from: segment.to - marker.length, to: segment.to, insert: "" },
        );
      }
    } else if (segment.mode === "none") {
      changes.push({ from: segment.from, insert: marker }, { from: segment.to, insert: marker });
    }
  }
  if (changes.length > 0) {
    const changeSet = state.changes(changes);
    view.dispatch({
      changes: changeSet,
      selection: EditorSelection.range(
        changeSet.mapPos(range.anchor, range.anchor <= range.head ? 1 : -1),
        changeSet.mapPos(range.head, range.head >= range.anchor ? -1 : 1),
      ),
      userEvent: "input",
    });
  }
  view.focus();
}

function notifyBlockConflict(view: EditorView): void {
  window.dispatchEvent(new CustomEvent("plainva-editor-block-format-conflict", { detail: { view } }));
}

const isHeadingPrefix = (prefix: string) => /^#{1,6}\s$/.test(prefix);
const isTaskPrefix = (prefix: string) => /^[-+*]\s\[[ xX]\]\s$/.test(prefix);

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
  let blocked = false;
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
    if (next && ((isHeadingPrefix(current) && isTaskPrefix(next)) || (isTaskPrefix(current) && isHeadingPrefix(next)))) {
      blocked = true;
      continue;
    }
    if (current === next) continue;
    changes.push({
      from: line.from + indent.length,
      to: line.from + indent.length + current.length,
      insert: next,
    });
  }
  if (changes.length) view.dispatch({ changes, userEvent: "input" });
  if (blocked) notifyBlockConflict(view);
  view.focus();
}

/** Cycles the heading level of the current line: none -> # -> ## -> ### -> none. */
export function cycleHeading(view: EditorView): void {
  const { state } = view;
  const line = state.doc.lineAt(state.selection.main.head);
  if (/^\s*(?:>\s*)*(?:[-+*]|\d+[.)])\s+\[[ xX]\]\s/.test(line.text)) {
    notifyBlockConflict(view);
    view.focus();
    return;
  }
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
  let blocked = false;
  for (const n of selectedLines(view)) {
    const line = state.doc.line(n);
    if (next && /^\s*(?:>\s*)*(?:[-+*]|\d+[.)])\s+\[[ xX]\]\s/.test(line.text)) {
      blocked = true;
      continue;
    }
    const m = /^#{1,6}\s/.exec(line.text);
    const cur = m ? m[0] : "";
    if (cur === next) continue;
    changes.push({ from: line.from, to: line.from + cur.length, insert: next });
  }
  if (changes.length) view.dispatch({ changes, userEvent: "input" });
  if (blocked) notifyBlockConflict(view);
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
  if (/^#{1,6}\s/.test(rest)) {
    notifyBlockConflict(view);
    view.focus();
    return;
  }
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
