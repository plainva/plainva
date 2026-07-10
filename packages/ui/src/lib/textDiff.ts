/**
 * Smallest single-range change that turns `oldText` into `newText`
 * (common prefix/suffix trim), or null when both are identical.
 *
 * Used when adopting externally produced file content (sync cycle, local
 * watcher — which also sees our own saves): replacing the whole CodeMirror
 * document forces every decoration plugin to rebuild and visibly shifts the
 * view, while a minimal range change keeps caret, scroll and unrelated
 * decorations untouched (Jitter-Fix P5, 2026-07-05).
 */
export function minimalDocChange(
  oldText: string,
  newText: string
): { from: number; to: number; insert: string } | null {
  if (oldText === newText) return null;
  let start = 0;
  const max = Math.min(oldText.length, newText.length);
  while (start < max && oldText.charCodeAt(start) === newText.charCodeAt(start)) start++;
  let endOld = oldText.length;
  let endNew = newText.length;
  while (endOld > start && endNew > start && oldText.charCodeAt(endOld - 1) === newText.charCodeAt(endNew - 1)) {
    endOld--;
    endNew--;
  }
  return { from: start, to: endOld, insert: newText.slice(start, endNew) };
}
