/**
 * Pure snippet builder for the context-graph suggestion preview: a short window
 * of surrounding text around a matched occurrence, split into before/match/
 * after so the match can be emphasized without dangerouslySetInnerHTML.
 * Whitespace (incl. newlines) is collapsed to single spaces; truncated sides
 * carry an ellipsis.
 */

export interface OccurrenceSnippet {
  before: string;
  match: string;
  after: string;
}

export function buildOccurrenceSnippet(
  content: string,
  index: number,
  length: number,
  window = 30
): OccurrenceSnippet {
  const match = content.slice(index, index + length).replace(/\s+/g, " ").trim();
  const beforeCut = index - window > 0;
  const afterEnd = index + length + window < content.length;
  const before = content
    .slice(Math.max(0, index - window), index)
    .replace(/\s+/g, " ")
    .replace(/^ /, "");
  const after = content
    .slice(index + length, index + length + window)
    .replace(/\s+/g, " ")
    .replace(/ $/, "");
  return {
    before: (beforeCut ? "…" : "") + before,
    match,
    after: after + (afterEnd ? "…" : ""),
  };
}
