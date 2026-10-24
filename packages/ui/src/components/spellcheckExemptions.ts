import { syntaxTree } from "@codemirror/language";
import type { Extension, Range } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { frontmatterLines } from "./editorFrontmatter";

/**
 * What a spell checker must leave alone inside a note (plan Befunde
 * 2026-10-06, S1).
 *
 * The note editor kept spell checking off on 2026-07-16 for one reason: the
 * whole note is one editable element, so switching the checker on puts red
 * lines under everything that is not language - code, URLs, HTML, the
 * frontmatter. The checker honours `spellcheck="false"` on an element INSIDE a
 * checked one, so those ranges are marked here and the objection goes away
 * without giving up the feature.
 *
 * Whole lines get the attribute where the block is not prose (fenced and
 * indented code, HTML blocks, the frontmatter); spans get it where a line is
 * prose around something that is not (inline code, a URL, an HTML tag).
 * Only what is on screen is marked. The extension is part of the session's
 * spell-checking compartment and exists only while the switch is on, so with
 * the switch off the editor carries none of it.
 *
 * Whether a given WebView respects the nested attribute is the platform's
 * business and no suite can see it: what is asserted is the attribute.
 */

const OFF = { spellcheck: "false" };
const lineOff = Decoration.line({ attributes: OFF });
const markOff = Decoration.mark({ attributes: OFF });

/** Blocks that hold no prose: every line of them is exempt. */
const BLOCKS = new Set(["FencedCode", "CodeBlock", "HTMLBlock", "CommentBlock", "ProcessingInstructionBlock"]);
/** Inline ranges that hold no prose. */
const SPANS = new Set(["InlineCode", "URL", "Autolink", "HTMLTag", "Comment", "ProcessingInstruction"]);

function build(view: EditorView): DecorationSet {
  const { state } = view;
  const ranges: Range<Decoration>[] = [];
  const offLines = new Set<number>();
  const lineOffAt = (from: number, to: number) => {
    const last = state.doc.lineAt(Math.min(to, state.doc.length)).number;
    for (let n = state.doc.lineAt(from).number; n <= last; n += 1) {
      if (offLines.has(n)) continue;
      offLines.add(n);
      ranges.push(lineOff.range(state.doc.line(n).from));
    }
  };

  // The frontmatter ends with its closing line; lezer has no node for it.
  const fmEnd = frontmatterLines(state.doc)?.closeTo ?? 0;
  for (const visible of view.visibleRanges) {
    if (fmEnd > 0 && visible.from < fmEnd) lineOffAt(visible.from, Math.min(visible.to, fmEnd));
    syntaxTree(state).iterate({
      from: visible.from,
      to: visible.to,
      enter: (node) => {
        if (BLOCKS.has(node.name)) {
          lineOffAt(Math.max(node.from, visible.from), Math.min(node.to, visible.to));
          return false;
        }
        if (SPANS.has(node.name)) {
          if (node.to > node.from) ranges.push(markOff.range(node.from, node.to));
          return false;
        }
        return undefined;
      },
    });
  }
  return Decoration.set(ranges, true);
}

export function spellcheckExemptions(): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = build(view);
      }
      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged || syntaxTree(update.startState) !== syntaxTree(update.state)) {
          this.decorations = build(update.view);
        }
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );
}
