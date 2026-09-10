import { splitLinkAnchor } from './linkAnchor';

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
  const re = /\[\[([^\]]+?)\]\]|\[([^\]]*?)\]\(([^)\s]+)\)|https?:\/\/[^\s)\]]+/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) segments.push({ type: 'text', text: text.slice(last, m.index) });
    if (m[1] !== undefined) {
      const [rawTarget, alias] = m[1].split('|');
      const { target, anchor } = splitLinkAnchor(rawTarget);
      const seg: InlineSegment = { type: 'wiki', target, display: (alias ?? rawTarget).trim() || target };
      if (anchor) seg.anchor = anchor;
      segments.push(seg);
    } else if (m[3] !== undefined) {
      segments.push({ type: 'markdown', target: m[3], text: m[2] });
    } else {
      segments.push({ type: 'url', target: m[0] });
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) segments.push({ type: 'text', text: text.slice(last) });
  return segments;
}

/**
 * Finds the link at the specified offset in a line of text.
 * Used to resolve clicks inside the CodeMirror editor.
 */
export function findLinkAtOffset(text: string, offset: number): ParsedLink | null {
  // Check for WikiLinks: [[target|alias]] or [[target]]
  const wikiRegex = /\[\[(.*?)\]\]/g;
  let m;
  while ((m = wikiRegex.exec(text)) !== null) {
    if (offset >= m.index && offset <= m.index + m[0].length) {
      // The anchor (`#Heading`, `^block`) stays with the link (issue #92);
      // the shell resolves it after the note is open.
      const { target, anchor } = splitLinkAnchor(m[1].split('|')[0]);
      return anchor ? { type: 'wiki', target, anchor } : { type: 'wiki', target };
    }
  }

  // Check for Standard Links: [text](url). The link TEXT must not contain a
  // `]` — otherwise the match spans a preceding `[...]` (e.g. a footnote `[^1]`)
  // into the real link and a tap on the footnote/text opens the link (issue #11).
  const mdRegex = /\[([^\]\n]*?)\]\(([^)\n]*?)\)/g;
  while ((m = mdRegex.exec(text)) !== null) {
    if (offset >= m.index && offset <= m.index + m[0].length) {
      return { type: 'markdown', text: m[1], target: m[2] };
    }
  }

  // Check for raw URLs: https://...
  const urlRegex = /(https?:\/\/[^\s)]+)/g;
  while ((m = urlRegex.exec(text)) !== null) {
    if (offset >= m.index && offset <= m.index + m[0].length) {
      return { type: 'url', target: m[0] };
    }
  }

  return null;
}
