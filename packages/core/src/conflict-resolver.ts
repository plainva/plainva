import { diffIndices, merge } from "node-diff3";

export type MergeResult = {
  mergedText: string;
  hasConflicts: boolean;
};

/**
 * Performs a 3-way text merge using diff3.
 * 
 * @param base The original common ancestor text
 * @param yours The local text changes
 * @param theirs The remote text changes
 * @returns An object containing the merged text (with conflict markers if any) and a boolean indicating if conflicts exist.
 */
export function mergeText(base: string, yours: string, theirs: string): MergeResult {
  // Split strings into arrays of lines.
  const splitLines = (str: string) => str.split(/\r?\n/);
  
  const baseLines = splitLines(base);
  const yoursLines = splitLines(yours);
  const theirsLines = splitLines(theirs);

  const result = merge(yoursLines, baseLines, theirsLines);
  
  return {
    mergedText: result.result.join("\n"),
    hasConflicts: result.conflict
  };
}

/** A read-back contains the intended change, possibly with additional edits. */
export function containsTextChanges(base: string, intended: string, actual: string): boolean {
  if (actual === intended) return true;
  const result = mergeText(base, intended, actual);
  return !result.hasConflicts && result.mergedText === actual;
}

/** Editor input can continue on the same line as a confirmed external write.
 * Keep whole words atomic: two competing edits to one word still conflict.
 * Bound the fallback after trimming the shared prefix/suffix; large divergent
 * documents retain the ordinary conflict-copy path instead of costly diffing. */
export function mergeEditorText(base: string, yours: string, theirs: string): MergeResult {
  const lines = mergeText(base, yours, theirs);
  if (!lines.hasConflicts) return lines;
  const tokenize = (text: string) => text.match(/\s+|\S+/gu) ?? [];
  const a = tokenize(yours), o = tokenize(base), b = tokenize(theirs);
  let start = 0;
  while (start < a.length && start < o.length && start < b.length && a[start] === o[start] && o[start] === b[start]) start++;
  let end = 0;
  while (end < a.length - start && end < o.length - start && end < b.length - start
    && a[a.length - end - 1] === o[o.length - end - 1] && o[o.length - end - 1] === b[b.length - end - 1]) end++;
  if (a.length + o.length + b.length - 3 * (start + end) > 4096) return lines;
  const middle = (tokens: string[]) => tokens.slice(start, tokens.length - end);
  const ancestor = middle(o);
  const changes = (tokens: string[]) => diffIndices(ancestor, middle(tokens)).map((change) => ({
    from: change.buffer1[0], to: change.buffer1[0] + change.buffer1[1], insert: change.buffer2Content,
  }));
  const left = changes(a), right = changes(b);
  const edits = [...left];
  for (const r of right) {
    let duplicate = false;
    for (const l of left) {
      if (l.from === r.from && l.to === r.to && l.insert.join("") === r.insert.join("")) { duplicate = true; break; }
      // Insertions at opposite edges of a replaced word are independent;
      // insertions inside it, overlapping replacements and competing inserts
      // at the same boundary require the ordinary conflict-copy path.
      const overlap = l.from === l.to && r.from === r.to ? l.from === r.from
        : l.from === l.to ? r.from < l.from && l.from < r.to
        : r.from === r.to ? l.from < r.from && r.from < l.to
        : l.from < r.to && r.from < l.to;
      if (overlap) return lines;
    }
    if (!duplicate) edits.push(r);
  }
  for (const edit of edits.sort((l, r) => r.from - l.from || r.to - l.to)) ancestor.splice(edit.from, edit.to - edit.from, ...edit.insert);
  return { mergedText: [...o.slice(0, start), ...ancestor, ...(end ? o.slice(o.length - end) : [])].join(""), hasConflicts: false };
}
