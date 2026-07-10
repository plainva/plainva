/**
 * Word counting for the status bar and the selection stats (maintainer report
 * 2026-07-07): the previous `/\S+/g` counted every non-whitespace token, so
 * bare Markdown syntax (`#`, `---`, `|`, `- [ ]`, `**`, code-fence markers,
 * ordered-list markers) and emojis inflated the word count.
 *
 * A word is now a whitespace-separated token that contains at least one
 * Unicode letter or digit, minus two Markdown structure shapes that would
 * slip through that rule: task checkboxes (`[x]`) and ordered-list markers
 * (`1.` / `1)`, only at the start of a line — `2024.` inside prose keeps
 * counting). Tokens that mix markers with text (`**bold**`, `[[Wiki Link]]`,
 * `word👍`) and URLs still count as one word each; space-less CJK text stays
 * token-based (unchanged behaviour). Character counts are not affected.
 */

const HAS_WORD_CHAR = /[\p{L}\p{N}]/u;
const TASK_BOX = /^\[[xX ]?\]$/;
const ORDERED_LIST_MARKER = /^\d{1,9}[.)]$/;

export function countWords(text: string): number {
  if (!text) return 0;
  let count = 0;
  for (const line of text.split("\n")) {
    const tokens = line.match(/\S+/g);
    if (!tokens) continue;
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      if (!HAS_WORD_CHAR.test(token)) continue;
      if (TASK_BOX.test(token)) continue;
      if (i === 0 && ORDERED_LIST_MARKER.test(token)) continue;
      count++;
    }
  }
  return count;
}
