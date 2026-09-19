import { RangeSetBuilder, type EditorState, type Extension } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { findInlineTagsInLine } from "@plainva/core";
import { tagSegments } from "../base/propertyModel";
import { tagColorAttrs } from "../lib/tagColor";
import { isEditorInteractive } from "./editorInteractive";

/**
 * Tags as pills in the live editor (finding 2026-09-19).
 *
 * A tag was plain text in the note - the one place it is written. The pill is a
 * MARK, never a replacement: the text stays `#project/website`, the caret walks
 * through it and every edit is an ordinary edit. What gets marked is what the
 * index counts (the rule lives in core/tagRule.ts); what the line rule cannot
 * know - that the line sits in a code block, the frontmatter or the text of a
 * link - the syntax tree answers here.
 *
 * A click opens the notes with the tag, with the manners of a wiki link: the
 * mouse always, a tap only while the note is being READ (while editing, a tap
 * places the caret).
 */

export type OpenTagFn = (tag: string) => void;

/**
 * Where a pill must not sit: blocks whose lines carry no tags, and inline nodes.
 * The text of a link is the one place the index counts and the editor does not
 * mark - a pill inside a link would be a click target inside a click target.
 */
const SKIP = new Set([
  "FencedCode", "CodeBlock", "HTMLBlock", "CommentBlock", "ProcessingInstructionBlock",
  "InlineCode", "Link", "Image", "URL", "Autolink", "HTMLTag", "Comment",
]);

/** End offset of the leading YAML frontmatter, or 0 - lezer has no node for it. */
function frontmatterEnd(state: EditorState): number {
  if (state.doc.lines < 2 || state.doc.line(1).text !== "---") return 0;
  for (let i = 2; i <= state.doc.lines; i++) {
    if (state.doc.line(i).text === "---") return state.doc.line(i).to;
  }
  return 0;
}

function skipped(state: EditorState, pos: number): boolean {
  for (let node: { name: string; parent: unknown } | null = syntaxTree(state).resolveInner(pos, 1); node; node = node.parent as typeof node) {
    if (SKIP.has(node.name)) return true;
  }
  return false;
}

/** The tag ranges of the visible lines - exported for the decoration test. */
export function visibleTagRanges(state: EditorState, ranges: readonly { from: number; to: number }[], fmEnd: number): { from: number; to: number; name: string }[] {
  const out: { from: number; to: number; name: string }[] = [];
  let lastLine = -1;
  for (const { from, to } of ranges) {
    for (let pos = from; pos <= to; ) {
      const line = state.doc.lineAt(pos);
      pos = line.to + 1;
      if (line.number === lastLine) continue;
      lastLine = line.number;
      if (line.to <= fmEnd || !line.text.includes("#")) continue;
      for (const tag of findInlineTagsInLine(line.text)) {
        if (skipped(state, line.from + tag.from)) continue;
        out.push({ from: line.from + tag.from, to: line.from + tag.to, name: tag.name });
      }
    }
  }
  return out;
}

function tagFromEl(node: EventTarget | null): string | null {
  const el = node instanceof Node ? (node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as HTMLElement)) : null;
  return el?.closest<HTMLElement>(".pv-tag-pill")?.getAttribute("data-tag") ?? null;
}

// One physical tap can surface as touchend AND click (see WikiLinkPlugin): the
// click fallback only acts when the primary handlers never saw the tap.
const tapStart = new WeakMap<EditorView, { x: number; y: number; at: number }>();
const lastTouch = new WeakMap<EditorView, number>();
const lastPointer = new WeakMap<EditorView, number>();
const lastOpen = new WeakMap<EditorView, { at: number; tag: string }>();

function open(view: EditorView, tag: string, timeStamp: number, onOpenTag: OpenTagFn): boolean {
  const last = lastOpen.get(view);
  if (!(last && last.tag === tag && timeStamp - last.at < 900)) onOpenTag(tag);
  lastOpen.set(view, { at: timeStamp, tag });
  return true;
}

export function tagPillPlugin(onOpenTag: OpenTagFn): Extension {
  return [
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;
        fmEnd: number;

        constructor(view: EditorView) {
          this.fmEnd = frontmatterEnd(view.state);
          this.decorations = this.build(view);
        }

        update(update: ViewUpdate) {
          if (update.docChanged) this.fmEnd = frontmatterEnd(update.state);
          // The syntax tree arrives in steps on a long note: a line that was not
          // parsed yet may turn out to be code.
          if (update.docChanged || update.viewportChanged || syntaxTree(update.startState) !== syntaxTree(update.state)) {
            this.decorations = this.build(update.view);
          }
        }

        build(view: EditorView): DecorationSet {
          const builder = new RangeSetBuilder<Decoration>();
          for (const tag of visibleTagRanges(view.state, view.visibleRanges, this.fmEnd)) {
            builder.add(tag.from, tag.to, Decoration.mark({ class: "pv-tag-pill", attributes: { "data-tag": tag.name, ...tagColorAttrs(tag.name) } }));
            // `#project/` stands quieter than `website`; the mark nests inside the pill.
            const { parent } = tagSegments(tag.name);
            if (parent) builder.add(tag.from, tag.from + 1 + parent.length, Decoration.mark({ class: "pv-tag-parent" }));
          }
          return builder.finish();
        }
      },
      { decorations: (plugin) => plugin.decorations },
    ),
    EditorView.domEventHandlers({
      mousedown: (event, view) => {
        if (event.button !== 0) return false;
        lastPointer.set(view, event.timeStamp);
        // A tap while EDITING places the caret; the browser then synthesizes this
        // mousedown from it, and it must not open anything either.
        const touched = lastTouch.get(view);
        if (touched !== undefined && event.timeStamp - touched < 1000 && isEditorInteractive(view.state)) return false;
        const tag = tagFromEl(event.target);
        if (!tag) return false;
        event.preventDefault();
        return open(view, tag, event.timeStamp, onOpenTag);
      },
      touchstart: (event, view) => {
        const t = event.touches[0];
        if (t) tapStart.set(view, { x: t.clientX, y: t.clientY, at: event.timeStamp });
        lastTouch.set(view, event.timeStamp);
        return false;
      },
      touchend: (event, view) => {
        if (isEditorInteractive(view.state)) return false;
        const start = tapStart.get(view);
        tapStart.delete(view);
        const end = event.changedTouches[0];
        if (!start || !end) return false;
        if (Math.hypot(end.clientX - start.x, end.clientY - start.y) > 10 || event.timeStamp - start.at > 700) return false;
        const tag = tagFromEl(event.target);
        if (!tag) return false;
        lastPointer.set(view, event.timeStamp);
        event.preventDefault();
        return open(view, tag, event.timeStamp, onOpenTag);
      },
      click: (event, view) => {
        if (isEditorInteractive(view.state)) return false;
        const seen = lastPointer.get(view);
        if (seen !== undefined && event.timeStamp - seen < 1500) return false;
        const tag = tagFromEl(event.target);
        if (!tag) return false;
        event.preventDefault();
        return open(view, tag, event.timeStamp, onOpenTag);
      },
    }),
  ];
}
