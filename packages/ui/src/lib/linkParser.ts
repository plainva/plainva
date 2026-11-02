import { delimitedText, markdownLinks } from "@plainva/core";
import { readWikiLinkInner } from './linkAnchor';

export type ParsedLink =
  | { type: 'wiki', target: string, anchor?: string }
  | { type: 'markdown', target: string, text: string }
  | { type: 'url', target: string };

export type InlineSegment =
  | { type: 'text', text: string }
  | { type: 'wiki', target: string, display: string, anchor?: string }
  | { type: 'markdown', target: string, text: string }
  | { type: 'url', target: string };

/**
 * Split free text into plain-text and link segments — [[wiki|alias]] links,
 * [label](url) markdown links and bare URLs, in source order. Used by the
 * `.base` cell renderer so links inside a property value render like they do in
 * a markdown note (plan W4/P11).
 */
export function segmentInlineText(text: string): InlineSegment[] {
  const segments: InlineSegment[] = [];
  const matches: Array<{ index: number; end: number; segment: InlineSegment }> = [];
  for (const part of delimitedText(text, "[[", "]]")) {
    if (!part.inner || part.inner.includes("]")) continue;
    const { target, anchor, head, alias } = readWikiLinkInner(part.inner);
    matches.push({ index: part.index, end: part.end, segment: { type: "wiki", target, display: (alias ?? head).trim() || target, ...(anchor ? { anchor } : {}) } });
  }
  for (const part of markdownLinks(text)) {
    if (!part.destination || /\s/.test(part.destination)) continue;
    matches.push({ index: part.index, end: part.end, segment: { type: "markdown", target: part.destination, text: part.label } });
  }
  for (const m of text.matchAll(/https?:\/\/[^\s)\]]+/g)) matches.push({ index: m.index, end: m.index + m[0].length, segment: { type: "url", target: m[0] } });
  matches.sort((a, b) => a.index - b.index);
  let last = 0;
  for (const part of matches) {
    if (part.index < last) continue;
    if (part.index > last) segments.push({ type: "text", text: text.slice(last, part.index) });
    segments.push(part.segment); last = part.end;
  }
  if (last < text.length) segments.push({ type: 'text', text: text.slice(last) });
  return segments;
}

/**
 * Finds the link at the specified offset in a line of text.
 * Used to resolve clicks inside the CodeMirror editor.
 */
export function findLinkAtOffset(text: string, offset: number): ParsedLink | null {
  for (const part of delimitedText(text, "[[", "]]")) {
    if (/[\r\n\u2028\u2029]/.test(part.inner)) continue;
    if (offset >= part.index && offset <= part.end) {
      const { target, anchor } = readWikiLinkInner(part.inner);
      return anchor ? { type: "wiki", target, anchor } : { type: "wiki", target };
    }
  }
  for (const part of markdownLinks(text)) {
    if (part.label.includes("\n") || part.destination.includes("\n")) continue;
    if (offset >= part.index && offset <= part.end) return { type: "markdown", text: part.label, target: part.destination };
  }
  let m;
  // Check for raw URLs: https://...
  const urlRegex = /(https?:\/\/[^\s)]+)/g;
  while ((m = urlRegex.exec(text)) !== null) {
    if (offset >= m.index && offset <= m.index + m[0].length) {
      return { type: 'url', target: m[0] };
    }
  }

  return null;
}
