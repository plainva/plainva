/**
 * Best-effort HTML -> Markdown for calendar event descriptions read from
 * providers that store rich HTML (Google, Outlook/Graph body, CalDAV X-ALT-DESC).
 *
 * Plainva's canonical description format is Markdown, so incoming HTML is
 * flattened to a readable Markdown source: block boundaries become newlines, a
 * handful of inline tags map to Markdown, everything else is stripped and HTML
 * entities are decoded. Deliberately regex-based (no DOM) so it runs inside the
 * core adapters and their node tests. Lossy by design — the user re-edits in a
 * Markdown editor, and an UNEDITED event keeps its original remote HTML because
 * the write path leaves an untouched description alone (touched-guard).
 */

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", middot: "·", hellip: "…", mdash: "—", ndash: "–",
};

export function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, h: string) => {
      try { return String.fromCodePoint(parseInt(h, 16)); } catch { return _m; }
    })
    .replace(/&#(\d+);/g, (_m, d: string) => {
      try { return String.fromCodePoint(Number(d)); } catch { return _m; }
    })
    .replace(/&([a-zA-Z]+);/g, (m, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? m);
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, "");
}

/** Whether a raw description string carries HTML markup or entities. */
export function looksLikeHtml(s: string): boolean {
  return /<\/?[a-z][^>]*>/i.test(s) || /&(?:[a-zA-Z]+|#\d+|#x[0-9a-fA-F]+);/.test(s);
}

export function htmlToMarkdown(html: string): string {
  let s = html;
  // Drop non-content elements with their content.
  s = s.replace(/<(script|style|head|title)\b[\s\S]*?<\/\1>/gi, "");
  s = s.replace(/<!--[\s\S]*?-->/g, "");
  // Links: <a href="X">text</a> -> [text](X) (bare url when the label equals it).
  s = s.replace(/<a\b[^>]*\bhref\s*=\s*["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, text: string) => {
    const label = decodeHtmlEntities(stripTags(text)).trim();
    const url = href.trim();
    if (!url) return label;
    return label && label !== url ? `[${label}](${url})` : url;
  });
  // Inline emphasis / code.
  s = s.replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_m, _t, inner: string) => `**${stripTags(inner).trim()}**`);
  s = s.replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_m, _t, inner: string) => `*${stripTags(inner).trim()}*`);
  s = s.replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (_m, inner: string) => `\`${stripTags(inner).trim()}\``);
  // List items become "- " lines.
  s = s.replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_m, inner: string) => `\n- ${stripTags(inner).trim()}`);
  // Block boundaries and hard breaks become newlines.
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/(p|div|h[1-6]|ul|ol|li|tr|table|blockquote)\s*>/gi, "\n");
  s = s.replace(/<(p|div|h[1-6]|ul|ol|blockquote)\b[^>]*>/gi, "\n");
  // Strip the remaining tags and decode entities (this maps &nbsp; to a space).
  s = decodeHtmlEntities(stripTags(s));
  // Tidy whitespace: kill trailing spaces, collapse runs of >2 blank lines.
  s = s.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

/**
 * A provider description normalized to Markdown: converted when it looks like
 * HTML, passed through when it is already plain text (a bare CalDAV DESCRIPTION
 * is valid Markdown). Empty/whitespace becomes undefined.
 */
export function normalizeDescription(raw: string | undefined | null): string | undefined {
  if (raw == null) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  return looksLikeHtml(trimmed) ? htmlToMarkdown(trimmed) || undefined : trimmed;
}
