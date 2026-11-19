/**
 * The placeholders of Plainva's templates: their grammar and their names, in
 * one place for the template engine that fills them
 * (`packages/ui/src/base/templateEngine.ts`) and for the index, which leaves a
 * template's title alone where the engine would fill it (Fehlerliste 0.9.0,
 * B26). The engine resolves exactly these names; a test holds it to them.
 */

/**
 * One placeholder. `raw` is the exact text matched, so replacement never has to
 * reconstruct it. A leading backslash marks an escape: `\{{date}}` writes the
 * token itself into the note, which is how the handbook can document tokens.
 */
export interface TemplateToken {
  raw: string;
  escaped: boolean;
  name: string;
  /** Signed day offset from `{{date+7}}` / `{{daily-1}}`; 0 when absent. */
  offset: number;
  /** Everything after the colon — a format string or a prompt label. */
  arg: string | null;
  index: number;
}

/** `\?{{ name [±N] [:arg] }}` — one grammar for every placeholder. */
const TOKEN_HEAD = /([a-zA-Z_][a-zA-Z_0-9]*)([+-]\d+)?/y;

/** Scan delimiters once; an unterminated argument never rescans every opener. */
export function scanTemplate(text: string): TemplateToken[] {
  const out: TemplateToken[] = [];
  let cursor = 0, close = -1;
  while (cursor < text.length) {
    const open = text.indexOf("{{", cursor);
    if (open < 0) break;
    if (close < open + 2) close = text.indexOf("}", open + 2);
    if (close < 0) break;
    if (text[close + 1] !== "}") { cursor = close + 1; continue; }
    TOKEN_HEAD.lastIndex = open + 2;
    const head = TOKEN_HEAD.exec(text);
    const end = TOKEN_HEAD.lastIndex;
    if (!head || (end !== close && (text[end] !== ":" || end > close))) { cursor = open + 2; continue; }
    const escaped = open > 0 && text[open - 1] === "\\";
    const index = escaped ? open - 1 : open;
    out.push({ raw: text.slice(index, close + 2), escaped, name: head[1], offset: Number(head[2] ?? 0), arg: end === close ? null : text.slice(end + 1, close), index });
    cursor = close + 2;
  }
  return out;
}

/** What the engine fills by itself: the note's own name, the dates, its place, what is selected or copied. */
export const TEMPLATE_FILLED_TOKENS: ReadonlySet<string> = new Set([
  "title", "date", "time", "yesterday", "tomorrow", "folder", "vault", "daily", "weekday", "selection", "clipboard",
]);

/** What a meeting note's template takes from its event; outside a meeting note they stay as written. */
export const TEMPLATE_EVENT_TOKENS: ReadonlySet<string> = new Set(["start", "end", "location", "attendees", "organizer", "link", "description"]);

/** The questions a template asks: `{{prompt:Label}}`, `{{select:Label|A,B}}`, `{{date_prompt:Label}}`. */
export const TEMPLATE_QUESTION_TOKENS: ReadonlySet<string> = new Set(["prompt", "select", "date_prompt"]);

/** Placed last, once everything else is filled: where the caret goes. */
export const TEMPLATE_CARET_TOKEN = "cursor";

/** Whether `name` is a placeholder the template engine fills in. */
export function isTemplateTokenName(name: string): boolean {
  return TEMPLATE_FILLED_TOKENS.has(name) || TEMPLATE_EVENT_TOKENS.has(name) || TEMPLATE_QUESTION_TOKENS.has(name) || name === TEMPLATE_CARET_TOKEN;
}

/**
 * Whether `text` holds a placeholder the template engine fills in when a note
 * is made from a template (`{{title}}`, `Daily {{date:YYYY-MM-DD}}`) — not one
 * written behind a backslash, and not `{{each}}` or `{{ variable }}`, which
 * the engine leaves as they are.
 */
export function holdsTemplateToken(text: string): boolean {
  if (!text.includes("{{")) return false;
  return scanTemplate(text).some((token) => !token.escaped && isTemplateTokenName(token.name));
}
