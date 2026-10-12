import { editorTextOf } from "@plainva/core";
import type { HastNode } from "./readerAnchors";
import { lineDirections, mayContainRtl, textDirectionOf, type TextDirection } from "./textDirection";

/** Blocks that take the direction of their source line. */
const LINE_BLOCKS = new Set(["h1", "h2", "h3", "h4", "h5", "h6", "p", "li", "ul", "ol", "blockquote", "table"]);

/**
 * Right-to-left text in the reading view (issue 111, plan Teil R, R3).
 *
 * Sets `dir` on every block of the rendered note from the SAME rule the
 * editor uses (lib/textDirection.ts), read from the original source - so a
 * paragraph never runs one way in the editor and the other way here. Needs the
 * source addresses `rehypeReaderSource` writes (`dataSourceLine`, `-From`,
 * `-To`) and therefore runs after it.
 *
 * A table cell is a block of its own: its first strong character decides, and
 * a cell without one runs with its table. Code keeps the reader's
 * left-to-right. A note without any right-to-left character gets no attribute
 * at all, so its markup is exactly what it was.
 */
export function rehypeReaderDirection(original: string) {
  // The rule reads LINES, and it reads them as the editor holds them. For the
  // note an editor shows that is `original` itself; an embedded note comes
  // from its file, with `\r` at its line ends and, where the file has one, a
  // byte order mark in front of its first line — a task there kept its box in
  // what was read, and the `x` in it decided for a line written in Arabic
  // (finding 2026-10-09). The line numbers are the same in both texts.
  const dirs: readonly TextDirection[] | null = mayContainRtl(original) ? lineDirections(editorTextOf(original)) : null;
  return () => (root: HastNode) => {
    if (!dirs) return;
    const walk = (node: HastNode, table: TextDirection | null) => {
      if (node.type === "element") {
        const tag = node.tagName ?? "";
        if (tag === "pre" || tag === "code") return;
        const props = node.properties ??= {};
        const line = props.dataSourceLine;
        if ((tag === "th" || tag === "td") && table) {
          const from = props.dataSourceFrom, to = props.dataSourceTo;
          if (typeof from === "number" && typeof to === "number") props.dir = textDirectionOf(original.slice(from, to).replace(/^\s*\|/, ""), table);
        } else if (LINE_BLOCKS.has(tag) && typeof line === "number" && line >= 1) {
          const dir = dirs[line - 1] ?? "ltr";
          props.dir = dir;
          if (tag === "table") table = dir;
        }
      }
      for (const child of node.children ?? []) walk(child, table);
    };
    walk(root, null);
  };
}
