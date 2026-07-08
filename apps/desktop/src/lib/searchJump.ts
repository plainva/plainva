/**
 * Jump-to-match helpers for the sidebar search (plan Suche P5): clicking a
 * search result opens the note and reveals the first occurrence of the term.
 * Matching is case-insensitive but literal — FTS diacritic folding is wider,
 * so a fold-only match (e.g. "muller" -> "Müller") simply does not jump.
 */

/** One parked jump at a time: the editor pane may not even be MOUNTED yet
 *  when a result is clicked (lazy component, first file open), so the click
 *  stores the request here and pokes mounted editors via the
 *  `plainva-search-jump` event; whichever consumer sees the file first takes
 *  the jump (one-shot). */
let pendingSearchJump: { path: string; term: string } | null = null;

export function setPendingSearchJump(jump: { path: string; term: string }): void {
  pendingSearchJump = jump;
}

/** Hands the parked jump to the caller iff it targets `path`; clears it. */
export function consumePendingSearchJump(path: string | null): { path: string; term: string } | null {
  if (!path || !pendingSearchJump || pendingSearchJump.path !== path) return null;
  const jump = pendingSearchJump;
  pendingSearchJump = null;
  return jump;
}

/** First case-insensitive occurrence of `term` in `text` (editor modes). */
export function findFirstMatch(text: string, term: string): { from: number; to: number } | null {
  if (!term) return null;
  const idx = text.toLowerCase().indexOf(term.toLowerCase());
  return idx < 0 ? null : { from: idx, to: idx + term.length };
}

/** Walks the rendered read-view DOM for the first text node containing `term`
 *  and returns a Range over the match (single text node — a term split across
 *  inline formatting is treated as not found). */
export function findTextRange(root: Node, term: string): Range | null {
  if (!term) return null;
  const needle = term.toLowerCase();
  const doc = root.ownerDocument;
  if (!doc) return null;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const text = node.textContent ?? "";
    const idx = text.toLowerCase().indexOf(needle);
    if (idx >= 0) {
      const range = doc.createRange();
      range.setStart(node, idx);
      range.setEnd(node, idx + term.length);
      return range;
    }
  }
  return null;
}

/** Applies the native selection to the range and scrolls it into view — the
 *  selection itself is the (theme-correct) highlight in the read view. */
export function selectAndRevealRange(range: Range): void {
  const win = range.startContainer.ownerDocument?.defaultView;
  const sel = win?.getSelection?.();
  if (sel) {
    sel.removeAllRanges();
    sel.addRange(range);
  }
  try {
    range.startContainer.parentElement?.scrollIntoView({ block: "center" });
  } catch {
    // jsdom has no scrollIntoView — selection alone is fine there.
  }
}
