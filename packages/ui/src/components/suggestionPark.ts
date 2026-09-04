import { presentableDiff } from "@codemirror/merge";
import type { ParkedSuggestion } from "@plainva/core";

/**
 * A parked copy, brought up to the note as it stands now (C34).
 *
 * If the note has not changed since the copy was typed, the copy is the copy.
 * If it has, every changed block of the old copy is re-found in the new text
 * by the base text it replaced — the same rule as the send path uses to
 * anchor a proposal: the quote first. A block whose quote is gone (the
 * passage was rewritten or deleted) cannot be placed and is handed back as
 * an orphan, so the caller can append it to the round's note instead of
 * dropping it silently. A pure insertion has no quote; it is placed after
 * the text that preceded it in the base, and orphaned when that is gone too.
 */
export interface ReconciledSuggestion {
  copy: string;
  /** What could not be placed - the replacement text, or the deleted quote for a pure deletion. */
  orphaned: string[];
  /** True when the note had changed and the copy was rebuilt. */
  rebased: boolean;
}

const CONTEXT = 24;

export function reconcileParkedSuggestion(record: Pick<ParkedSuggestion, "base" | "copy">, currentText: string): ReconciledSuggestion {
  if (record.base === currentText) return { copy: record.copy, orphaned: [], rebased: false };
  const blocks = presentableDiff(record.base, record.copy).map((change) => ({
    quote: record.base.slice(change.fromA, change.toA),
    replacement: record.copy.slice(change.fromB, change.toB),
    before: record.base.slice(Math.max(0, change.fromA - CONTEXT), change.fromA),
  }));
  const orphaned: string[] = [];
  const placed: Array<{ from: number; to: number; replacement: string }> = [];
  let cursor = 0;
  for (const block of blocks) {
    if (block.quote) {
      const at = currentText.indexOf(block.quote, cursor);
      if (at < 0) { orphaned.push(block.replacement || block.quote); continue; }
      placed.push({ from: at, to: at + block.quote.length, replacement: block.replacement });
      cursor = at + block.quote.length;
      continue;
    }
    // Insertion: right after the base's preceding text, if that still exists.
    if (!block.before) { placed.push({ from: 0, to: 0, replacement: block.replacement }); continue; }
    const anchor = currentText.indexOf(block.before, cursor);
    if (anchor < 0) { orphaned.push(block.replacement); continue; }
    const at = anchor + block.before.length;
    placed.push({ from: at, to: at, replacement: block.replacement });
    cursor = at;
  }
  let copy = currentText;
  for (const edit of [...placed].sort((a, b) => b.from - a.from)) {
    copy = copy.slice(0, edit.from) + edit.replacement + copy.slice(edit.to);
  }
  return { copy, orphaned, rebased: true };
}

/** How many change blocks a parked copy holds against its base. */
export function parkedSuggestionBlocks(record: Pick<ParkedSuggestion, "base" | "copy">): number {
  return presentableDiff(record.base, record.copy).length;
}
