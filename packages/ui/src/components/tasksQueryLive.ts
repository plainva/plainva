import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import { StateField, type EditorState, type Extension, type Range } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { activeLineSet } from "./LivePreviewPlugin";
import { fenceOpenerFor, findFencedBlocks } from "./fencedBlocks";

/**
 * The ```tasks block of the Obsidian Tasks plugin in the live editor of both
 * shells (plan Tasks-Abfragen, T4): outside the caret the block's lines give
 * way to the query's result; with the caret in it, the query stands as text,
 * like every other widget. The source mode always shows the text.
 *
 * The CodeMirror side lives here, the content comes from the shell
 * (`TasksQueryHost`): the desktop mounts a React root with its vault context,
 * the phone one with its vault and sheets — both draw the shared
 * `TasksQueryBlock`. The block stays a block in a quote or callout: it takes
 * the line class of the card it replaces, so the card goes on around it.
 *
 * In a read-only editor (the phone's reading mode) the caret shows nothing,
 * so the block is drawn wherever the selection stands.
 */

/** What the shell gets to fill one block. */
export interface TasksQueryWidgetContext {
  /** The query, as the Tasks plugin reads it (quote markers and fence indentation cut). */
  source: string;
  view: EditorView;
  /**
   * Puts the caret into the query: on line `line` of the block (1-based, the
   * line after the opening fence is 1), or at the end of the first line.
   */
  editQuery(line: number | null): void;
  /** Where `editQuery` would put the caret — for a shell that first has to switch to writing. */
  positionOf(line: number | null): number;
  /**
   * Changes the note this editor holds through an editor transaction — a tick
   * on a task of the same note must not write past the editor's own text.
   * `change` gets the text as it stands; null changes nothing. Answers whether
   * a change was made.
   */
  changeNote(change: (text: string) => string | null): boolean;
}

export interface TasksQueryHost {
  /** Mounts the block into `container`; the answer unmounts it. */
  render(container: HTMLElement, context: TasksQueryWidgetContext): () => void;
}

/** One minimal change from `before` to `after`: the common start and end stay untouched. */
export function minimalTextChange(before: string, after: string): { from: number; to: number; insert: string } | null {
  if (before === after) return null;
  let start = 0;
  const max = Math.min(before.length, after.length);
  while (start < max && before.charCodeAt(start) === after.charCodeAt(start)) start++;
  let endBefore = before.length;
  let endAfter = after.length;
  while (endBefore > start && endAfter > start && before.charCodeAt(endBefore - 1) === after.charCodeAt(endAfter - 1)) {
    endBefore--;
    endAfter--;
  }
  return { from: start, to: endBefore, insert: after.slice(start, endAfter) };
}

/** Applies `change` to the editor's text as one transaction; see `TasksQueryWidgetContext.changeNote`. */
export function changeEditorNote(view: EditorView, change: (text: string) => string | null): boolean {
  const before = view.state.doc.toString();
  const after = change(before);
  if (after === null) return false;
  const diff = minimalTextChange(before, after);
  if (!diff) return false;
  view.dispatch({ changes: diff, userEvent: "input.task" });
  return true;
}

type HeightObserverHost = HTMLElement & { __pvHeightObs?: ResizeObserver; __pvUnmount?: () => void };

class TasksQueryWidget extends WidgetType {
  constructor(
    readonly source: string,
    readonly quoteClass: string,
    readonly host: () => TasksQueryHost | null | undefined,
  ) {
    super();
  }

  eq(other: TasksQueryWidget) {
    return this.source === other.source && this.quoteClass === other.quoteClass;
  }

  toDOM(view: EditorView) {
    const el = document.createElement("div") as HeightObserverHost;
    el.className = this.quoteClass ? `pv-tasksquery-live ${this.quoteClass}` : "pv-tasksquery-live";
    el.dataset.testid = "tasks-query-live";
    // The result changes height when it loads and when a group folds;
    // CodeMirror's height map has to follow, or clicks below drift.
    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(() => view.requestMeasure());
      ro.observe(el);
      el.__pvHeightObs = ro;
    }
    const host = this.host();
    if (host) {
      // Where the block stands NOW: the widget may have moved since it was drawn.
      const positionOf = (line: number | null): number => {
        const doc = view.state.doc;
        const first = doc.lineAt(Math.min(view.posAtDOM(el), doc.length)).number;
        return doc.line(Math.min(doc.lines, first + Math.max(1, line ?? 1))).to;
      };
      el.__pvUnmount = host.render(el, {
        source: this.source,
        view,
        positionOf,
        editQuery: (line) => {
          view.dispatch({ selection: { anchor: positionOf(line) }, scrollIntoView: true });
          view.focus();
        },
        changeNote: (change) => changeEditorNote(view, change),
      });
    }
    return el;
  }

  // The block's own buttons and rows take their clicks; CodeMirror stays out.
  ignoreEvent() {
    return true;
  }

  destroy(dom: HTMLElement) {
    const host = dom as HeightObserverHost;
    host.__pvHeightObs?.disconnect();
    host.__pvHeightObs = undefined;
    const unmount = host.__pvUnmount;
    host.__pvUnmount = undefined;
    unmount?.();
  }
}

const TASKS_OPEN = fenceOpenerFor("tasks");

function buildTasksQueryDecorations(state: EditorState, host: () => TasksQueryHost | null | undefined): DecorationSet {
  if (!host()) return Decoration.none;
  const decos: Range<Decoration>[] = [];
  try {
    const editable = state.facet(EditorView.editable);
    const activeLines = editable ? activeLineSet(state) : new Set<number>();
    for (const block of findFencedBlocks(state, TASKS_OPEN)) {
      let active = false;
      for (let i = block.firstLine; i <= block.lastLine; i++) if (activeLines.has(i)) active = true;
      if (active) continue;
      decos.push(Decoration.replace({ widget: new TasksQueryWidget(block.code, block.quoteClass, host), block: true }).range(block.from, block.to));
    }
  } catch (e) {
    console.error("[tasksQueryLive] build error", e);
    return Decoration.none;
  }
  return Decoration.set(decos, true);
}

/**
 * The block field. A block widget changes line heights, so it has to come from
 * a StateField (known before the viewport is measured), like the Mermaid
 * diagrams and tables. `host` is read when a block is built; without one the
 * blocks stay text.
 */
export function tasksQueryBlockField(host: () => TasksQueryHost | null | undefined): Extension {
  return StateField.define<DecorationSet>({
    create: (state) => buildTasksQueryDecorations(state, host),
    update: (value, tr) => {
      const editableChanged = tr.startState.facet(EditorView.editable) !== tr.state.facet(EditorView.editable);
      if (tr.docChanged || tr.selection || editableChanged || syntaxTree(tr.startState) !== syntaxTree(tr.state)) {
        return buildTasksQueryDecorations(tr.state, host);
      }
      return value.map(tr.changes);
    },
    provide: (f) => EditorView.decorations.from(f),
  });
}
