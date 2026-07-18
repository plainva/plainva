/**
 * Pure Markdown text operations for the compose editor's formatting toolbar and
 * slash menu. These run against the compose <textarea>'s value + selection only
 * — deliberately NOT the shared CodeMirror editor session: that session's slash
 * pickers (table/date/block…) fire GLOBAL window events that the note editor
 * also listens to (some unguarded), so a second mounted session would cross-talk
 * with the open note. A self-contained textarea keeps compose isolated.
 *
 * Every operation returns the new value plus the caret/selection to restore, so
 * the component can keep the textarea and React state in sync.
 */

export interface TextEdit {
  value: string;
  selStart: number;
  selEnd: number;
}

/** Wrap (or unwrap, when already wrapped) the selection with a marker like `**`. */
export function toggleWrap(value: string, start: number, end: number, marker: string): TextEdit {
  const sel = value.slice(start, end);
  const m = marker.length;
  // Already wrapped just inside the selection → unwrap.
  if (sel.startsWith(marker) && sel.endsWith(marker) && sel.length >= m * 2) {
    const inner = sel.slice(m, sel.length - m);
    return { value: value.slice(0, start) + inner + value.slice(end), selStart: start, selEnd: start + inner.length };
  }
  // Marker sits immediately OUTSIDE the selection → unwrap it.
  if (value.slice(start - m, start) === marker && value.slice(end, end + m) === marker) {
    return { value: value.slice(0, start - m) + sel + value.slice(end + m), selStart: start - m, selEnd: end - m };
  }
  const placeholder = sel.length === 0;
  const inner = placeholder ? "" : sel;
  const next = value.slice(0, start) + marker + inner + marker + value.slice(end);
  const caret = start + m;
  return { value: next, selStart: caret, selEnd: caret + inner.length };
}

/** Toggle a line prefix (`# `, `- `, `> `, `- [ ] `) on every line the selection touches. */
export function toggleLinePrefix(value: string, start: number, end: number, prefix: string): TextEdit {
  const lineStart = value.lastIndexOf("\n", start - 1) + 1;
  let lineEnd = value.indexOf("\n", end);
  if (lineEnd === -1) lineEnd = value.length;
  const block = value.slice(lineStart, lineEnd);
  const lines = block.split("\n");
  // Heading prefixes are exclusive: strip any existing heading first.
  const isHeading = /^#{1,6} $/.test(prefix);
  const allHave = lines.every((l) => l.startsWith(prefix));
  const next = lines
    .map((l) => {
      if (allHave) return l.slice(prefix.length);
      let base = l;
      if (isHeading) base = base.replace(/^#{1,6} /, "");
      return prefix + base;
    })
    .join("\n");
  const delta = next.length - block.length;
  const newValue = value.slice(0, lineStart) + next + value.slice(lineEnd);
  return { value: newValue, selStart: lineStart, selEnd: lineEnd + delta };
}

/** Insert a block snippet on its own line(s) at the caret (blank-line padded). */
export function insertBlock(value: string, start: number, end: number, snippet: string): TextEdit {
  const before = value.slice(0, start);
  const after = value.slice(end);
  const needLeadingNl = before.length > 0 && !before.endsWith("\n") ? "\n" : "";
  const needTrailingNl = after.length > 0 && !after.startsWith("\n") ? "\n" : "";
  const ins = needLeadingNl + snippet + needTrailingNl;
  const next = before + ins + after;
  const caret = start + needLeadingNl.length + snippet.length;
  return { value: next, selStart: caret, selEnd: caret };
}

/** Insert an inline link `[text](url)` (or a placeholder) at the selection. */
export function insertLink(value: string, start: number, end: number): TextEdit {
  const sel = value.slice(start, end) || "";
  const text = sel || "Text";
  const snippet = `[${text}](url)`;
  const next = value.slice(0, start) + snippet + value.slice(end);
  // Select the "url" placeholder so the user types the target next.
  const urlStart = start + text.length + 3; // "[" + text + "](" = text.length + 3
  return { value: next, selStart: urlStart, selEnd: urlStart + 3 };
}

export type ComposeCommandId =
  | "h1" | "h2" | "h3"
  | "bold" | "italic" | "strike" | "code"
  | "bullet" | "numbered" | "task" | "quote"
  | "codeblock" | "divider" | "link";

export interface ComposeCommand {
  id: ComposeCommandId;
  /** i18n key for the menu label. */
  labelKey: string;
  defaultLabel: string;
  /** Slash-menu search aliases (lower-case, space-separated is fine). */
  keywords: string;
}

/** The commands offered in the toolbar and the `/` menu (email-appropriate only —
 * no wiki links, embeds, templates, images or header icon/color). */
export const COMPOSE_COMMANDS: ComposeCommand[] = [
  { id: "h1", labelKey: "compose.cmdH1", defaultLabel: "Überschrift 1", keywords: "h1 heading überschrift title" },
  { id: "h2", labelKey: "compose.cmdH2", defaultLabel: "Überschrift 2", keywords: "h2 heading überschrift" },
  { id: "h3", labelKey: "compose.cmdH3", defaultLabel: "Überschrift 3", keywords: "h3 heading überschrift" },
  { id: "bold", labelKey: "compose.cmdBold", defaultLabel: "Fett", keywords: "bold fett strong b" },
  { id: "italic", labelKey: "compose.cmdItalic", defaultLabel: "Kursiv", keywords: "italic kursiv emphasis i" },
  { id: "strike", labelKey: "compose.cmdStrike", defaultLabel: "Durchgestrichen", keywords: "strike durchgestrichen s" },
  { id: "code", labelKey: "compose.cmdCode", defaultLabel: "Code", keywords: "code inline monospace" },
  { id: "bullet", labelKey: "compose.cmdBullet", defaultLabel: "Aufzählung", keywords: "bullet list aufzählung ul" },
  { id: "numbered", labelKey: "compose.cmdNumbered", defaultLabel: "Nummerierte Liste", keywords: "numbered ordered list liste ol" },
  { id: "task", labelKey: "compose.cmdTask", defaultLabel: "Aufgabe", keywords: "task todo checkbox aufgabe" },
  { id: "quote", labelKey: "compose.cmdQuote", defaultLabel: "Zitat", keywords: "quote zitat blockquote" },
  { id: "codeblock", labelKey: "compose.cmdCodeBlock", defaultLabel: "Codeblock", keywords: "codeblock fence pre" },
  { id: "divider", labelKey: "compose.cmdDivider", defaultLabel: "Trennlinie", keywords: "divider hr rule trennlinie" },
  { id: "link", labelKey: "compose.cmdLink", defaultLabel: "Link", keywords: "link url hyperlink" },
];

/** Apply a compose command to the text + selection. Pure. */
export function applyComposeCommand(id: ComposeCommandId, value: string, start: number, end: number): TextEdit {
  switch (id) {
    case "h1": return toggleLinePrefix(value, start, end, "# ");
    case "h2": return toggleLinePrefix(value, start, end, "## ");
    case "h3": return toggleLinePrefix(value, start, end, "### ");
    case "bold": return toggleWrap(value, start, end, "**");
    case "italic": return toggleWrap(value, start, end, "*");
    case "strike": return toggleWrap(value, start, end, "~~");
    case "code": return toggleWrap(value, start, end, "`");
    case "bullet": return toggleLinePrefix(value, start, end, "- ");
    case "numbered": return toggleLinePrefix(value, start, end, "1. ");
    case "task": return toggleLinePrefix(value, start, end, "- [ ] ");
    case "quote": return toggleLinePrefix(value, start, end, "> ");
    case "codeblock": return insertBlock(value, start, end, "```\n" + value.slice(start, end) + "\n```");
    case "divider": return insertBlock(value, start, end, "---");
    case "link": return insertLink(value, start, end);
  }
}

/** Detect an active slash trigger: a `/` at line start (or after whitespace)
 * immediately before the caret, with an optional query typed after it. Returns
 * the slash position and the lower-case query, or null. */
export function detectSlash(value: string, caret: number): { from: number; query: string } | null {
  // Walk back from the caret over the query (letters only) to the `/`.
  let i = caret;
  while (i > 0 && /[A-Za-zÀ-ÿ0-9]/.test(value[i - 1])) i--;
  if (i === 0 || value[i - 1] !== "/") return null;
  const slashPos = i - 1;
  const before = slashPos === 0 ? "" : value[slashPos - 1];
  if (before !== "" && before !== "\n" && before !== " ") return null;
  return { from: slashPos, query: value.slice(i, caret).toLowerCase() };
}

/** Filter the command list by a slash query. */
export function filterCommands(query: string): ComposeCommand[] {
  const q = query.trim().toLowerCase();
  if (!q) return COMPOSE_COMMANDS;
  return COMPOSE_COMMANDS.filter((c) => c.keywords.includes(q) || c.id.includes(q));
}
