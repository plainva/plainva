export type ParsedLink =
  | { type: 'wiki', target: string }
  | { type: 'markdown', target: string, text: string }
  | { type: 'url', target: string };

export type InlineSegment =
  | { type: 'text', text: string }
  | { type: 'wiki', target: string, display: string }
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
      const target = rawTarget.split('#')[0].trim();
      segments.push({ type: 'wiki', target, display: (alias ?? rawTarget).trim() || target });
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
      let linkTarget = m[1].split('|')[0];
      linkTarget = linkTarget.split('#')[0]; // ignore header/anchor for now
      return { type: 'wiki', target: linkTarget };
    }
  }

  // Check for Standard Links: [text](url)
  const mdRegex = /\[(.*?)\]\((.*?)\)/g;
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
