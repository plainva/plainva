// Pure "turn into" transforms for the block menu (#7). Each works on the raw
// text of a block (its lines) and returns the rewritten text. A block's existing
// leading marker is stripped first, then the new one applied — so conversions
// compose (e.g. heading -> bullet -> quote) without piling up markers.

export type BlockTarget = "paragraph" | "h1" | "h2" | "h3" | "bullet" | "numbered" | "task" | "quote" | "code";

/** Remove one leading block marker (heading / quote / list / task) from a line. */
export function stripMarker(line: string): string {
  return line
    .replace(/^(\s*)#{1,6}[ \t]+/, "$1")
    .replace(/^(\s*)>[ \t]?/, "$1")
    .replace(/^(\s*)([-*+]|\d+[.)])[ \t]+(\[[ xX]\][ \t]+)?/, "$1");
}

export function turnInto(text: string, target: BlockTarget): string {
  const lines = text.split("\n");
  switch (target) {
    case "paragraph":
      return lines.map(stripMarker).join("\n");
    case "h1":
    case "h2":
    case "h3": {
      const n = target === "h1" ? 1 : target === "h2" ? 2 : 3;
      // Headings are single-line: the first line becomes the heading; any extra
      // lines fall back to plain paragraph text.
      return lines.map((l, i) => (i === 0 ? `${"#".repeat(n)} ${stripMarker(l).trimStart()}` : stripMarker(l))).join("\n");
    }
    case "bullet":
      return lines.map((l) => `- ${stripMarker(l)}`).join("\n");
    case "numbered":
      return lines.map((l, i) => `${i + 1}. ${stripMarker(l)}`).join("\n");
    case "task":
      return lines.map((l) => `- [ ] ${stripMarker(l)}`).join("\n");
    case "quote":
      return lines.map((l) => `> ${stripMarker(l)}`).join("\n");
    case "code":
      return "```\n" + lines.map(stripMarker).join("\n") + "\n```";
  }
}

/**
 * Invisible list separator (E2, 2026-07-05): a blank line alone does NOT keep
 * two same-style lists apart — CommonMark parses them as ONE loose list (also
 * in Obsidian/GitHub, even with two blank lines). The standard workaround is a
 * comment line between them; Plainva's read view hides comments anyway.
 */
export const LIST_SEPARATOR = "<!-- -->";

/**
 * The list-marker "style" of a line: its bullet char (-, *, +) or the ordered
 * delimiter (. or )), null for non-list lines. CommonMark merges adjacent
 * lists only when this style matches — a marker/delimiter change already
 * starts a new list, so only same-style neighbours need the separator.
 */
export function listMarkerStyle(lineText: string): string | null {
  const m = /^\s*(?:([-*+])|\d{1,9}([.)]))[ \t]/.exec(lineText);
  if (!m) return null;
  return m[1] ?? m[2];
}

export interface MoveBlockGuards {
  /** Insert LIST_SEPARATOR between the block above the drop position and the moved block. */
  guardAbove?: boolean;
  /** Insert LIST_SEPARATOR between the moved block and the block below the drop position. */
  guardBelow?: boolean;
}

/**
 * Move a block (lines [srcFirst..srcLast], 1-based) so it sits directly above
 * the block starting at line `targetFirst`. Pure: takes and returns the whole
 * document text (the caller replaces the doc in one transaction — offset-safe).
 * The block's trailing blank line travels with it and a blank separator is kept,
 * so blocks don't merge. `targetFirst` past the end appends the block.
 * `guards` additionally place the invisible LIST_SEPARATOR at a boundary where
 * the caller detected a same-style list (blank lines alone would merge there).
 */
export function moveBlockAbove(docText: string, srcFirst: number, srcLast: number, targetFirst: number, guards: MoveBlockGuards = {}): string {
  const lines = docText.split("\n");
  const sf = srcFirst - 1;
  const sl = srcLast - 1;
  if (sf < 0 || sl >= lines.length || sf > sl) return docText;
  // The moved unit includes one trailing blank line if present.
  let unitEnd = sl;
  if (unitEnd + 1 < lines.length && lines[unitEnd + 1].trim() === "") unitEnd++;
  const seg = lines.slice(sf, unitEnd + 1);
  const removed = seg.length;
  const rest = [...lines.slice(0, sf), ...lines.slice(unitEnd + 1)];
  let idx = targetFirst - 1;
  if (sf < idx) idx -= removed; // src removed before the target -> shift the index up
  idx = Math.max(0, Math.min(idx, rest.length));
  let segOut = seg[seg.length - 1].trim() === "" ? seg : [...seg, ""];
  const sepAt = (i: number) => i >= 0 && i < rest.length && rest[i].trim() === LIST_SEPARATOR;
  // Separator below the moved block (skip if one already sits there, possibly behind a blank).
  const sepBelowExists = sepAt(idx) || (idx < rest.length && rest[idx].trim() === "" && sepAt(idx + 1));
  if (guards.guardBelow && idx < rest.length && !sepBelowExists) {
    segOut = [...segOut, LIST_SEPARATOR, ""];
  }
  const prevLine = idx > 0 ? rest[idx - 1] : null;
  const sepAboveExists = sepAt(idx - 1) || (prevLine !== null && prevLine.trim() === "" && sepAt(idx - 2));
  if (guards.guardAbove && prevLine !== null && !sepAboveExists) {
    // Separator above the moved block, flanked by blank lines.
    segOut = prevLine.trim() === "" ? [LIST_SEPARATOR, "", ...segOut] : ["", LIST_SEPARATOR, "", ...segOut];
  } else if (prevLine !== null && prevLine.trim() !== "" && segOut[0].trim() !== "") {
    // Keep a blank separator above the moved block too (e.g. when appending).
    segOut = ["", ...segOut];
  }
  const out = [...rest.slice(0, idx), ...segOut, ...rest.slice(idx)];
  return out.join("\n");
}
