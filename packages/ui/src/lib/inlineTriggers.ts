/**
 * `[[` and `#` in a plain text field (plan Befunde 2026-10-06, W5).
 *
 * The note editor has always completed a link after `[[` and a tag after `#`.
 * The capture fields of the journal and the tasks view are ordinary inputs —
 * CodeMirror's completion cannot reach them — so they offered nothing, and an
 * entry that should link a note had to be typed blind. This is the part of the
 * editor's completion that is not CodeMirror: where a trigger stands, what the
 * vault offers for it, and what a pick writes. The editor's sources
 * (`editorTriggers.ts`) read the SAME searches, so a note found after `[[` in
 * the editor is found in a capture field under the same name, in the same
 * order.
 */

/** The slice of the query service a search needs; both shells' service satisfies it. */
export interface TriggerQuerySource {
  db: { query: (sql: string, params?: unknown[]) => Promise<any[]> };
  getAllTags: () => Promise<{ tag: string; count: number }[]>;
}

export interface InlineTrigger {
  kind: "link" | "tag";
  /** Offset of the `[[` or the `#` — replaced when something is picked. */
  from: number;
  /** The caret the trigger was read at. */
  to: number;
  /** What was typed after the trigger. */
  term: string;
}

export interface InlineSuggestion {
  kind: "note" | "attachment" | "tag";
  /** What the list shows. */
  label: string;
  /** What a pick writes in place of the trigger and its term. */
  insert: string;
  /** A second, quiet word: the path of a file, how often a tag occurs. */
  detail?: string;
  /** For a tag: how many notes carry it. */
  count?: number;
}

/** How far back a trigger is looked for, in characters — the editor's window. */
const WINDOW = 250;
/** Past this, what follows `[[` is prose, not the name of a note. */
const MAX_TERM = 80;

const TAG_CHAR = /[\p{L}\p{N}/_-]/u;
const TAG_LEAD = /[\s([{]/;

/**
 * The trigger the caret stands in, or null.
 *
 * A link is opened by the first `[[` after the last `]` of the line; a `!`
 * in front makes it an embed, which a capture field does not complete. Inside
 * an open link a `#` addresses a heading and is nobody's tag. A tag needs at
 * least one character after its `#` and a boundary in front of it, so a
 * heading marker, an anchor in a URL and `C#` never trigger.
 */
export function inlineTriggerAt(text: string, caret: number): InlineTrigger | null {
  if (caret < 0 || caret > text.length) return null;
  const lineStart = text.lastIndexOf("\n", caret - 1) + 1;
  const start = Math.max(lineStart, caret - WINDOW);
  const before = text.slice(start, caret);

  const bound = before.lastIndexOf("]");
  const open = before.indexOf("[[", bound + 1);
  if (open >= 0) {
    const from = start + open;
    if (from > 0 && text[from - 1] === "!") return null;
    const term = before.slice(open + 2);
    if (term.length > MAX_TERM || term.includes("#") || term.includes("|")) return null;
    return { kind: "link", from, to: caret, term: term.trim() };
  }

  let at = caret;
  while (at > start && TAG_CHAR.test(text[at - 1])) at -= 1;
  if (at === caret || at === 0 || text[at - 1] !== "#") return null;
  const hash = at - 1;
  if (hash > 0 && !TAG_LEAD.test(text[hash - 1])) return null;
  return { kind: "tag", from: hash, to: caret, term: text.slice(at, caret) };
}

/**
 * Notes first, then attachments — the ORDER BY carries the ranking. `.base`
 * files stay out: they are opened, not linked to as text. A note is linked by
 * its title, an attachment by its path (it has no title, and the bare stem
 * would not resolve).
 */
export async function searchLinkTargets(source: TriggerQuerySource, term: string, limit = 12): Promise<InlineSuggestion[]> {
  const like = `%${term}%`;
  const rows = await source.db.query(
    `SELECT path, title, (CASE WHEN path LIKE '%.md' THEN 0 ELSE 1 END) AS is_attachment FROM files
         WHERE (title LIKE ? OR path LIKE ?) AND path NOT LIKE '%.base'
         ORDER BY is_attachment, (CASE WHEN title LIKE ? THEN 1 ELSE 2 END), mtime_local DESC
         LIMIT ${Math.max(1, Math.floor(limit))}`,
    [like, like, `${term}%`],
  );
  return (rows ?? []).map((row: { path: string; title?: string | null; is_attachment?: number }): InlineSuggestion => {
    if (row.is_attachment) {
      const name = row.path.split(/[/\\]/).pop() || row.path;
      return { kind: "attachment", label: name, insert: `[[${row.path}]]`, detail: row.path };
    }
    const title = row.title || row.path.split(/[/\\]/).pop()?.replace(/\.md$/i, "") || row.path;
    return { kind: "note", label: title, insert: `[[${title}]]`, detail: row.path };
  });
}

/** The vault's tags that begin with `term`, in the order the index lists them. */
export async function searchTags(source: TriggerQuerySource, term: string, limit = 20): Promise<InlineSuggestion[]> {
  const lower = term.toLowerCase();
  const all = await source.getAllTags();
  return all
    .filter((entry) => entry.tag.replace(/^#/, "").toLowerCase().startsWith(lower))
    .slice(0, limit)
    .map((entry): InlineSuggestion => {
      const bare = entry.tag.replace(/^#/, "");
      return { kind: "tag", label: `#${bare}`, insert: `#${bare}`, count: entry.count };
    });
}

/**
 * What the vault offers for a trigger.
 *
 * A tag that is written out in full is complete, and nothing is offered for
 * it — even when a longer one begins the same way. A capture field saves on
 * Enter: `Milk #home` + Enter must save, not stop to ask whether `#homework`
 * was meant. One more letter brings the longer tag back.
 */
export async function suggestForTrigger(source: TriggerQuerySource, trigger: InlineTrigger): Promise<InlineSuggestion[]> {
  if (trigger.kind === "link") return searchLinkTargets(source, trigger.term);
  const tags = await searchTags(source, trigger.term);
  const typed = `#${trigger.term}`.toLowerCase();
  return tags.some((tag) => tag.insert.toLowerCase() === typed) ? [] : tags;
}

/**
 * Writes a pick into the text and says where the caret goes.
 *
 * A `]]` that already stands behind the caret is consumed — otherwise a link
 * typed into `[[]]` would end in four brackets. A space follows the insertion
 * so typing can go on, unless one is there already.
 */
export function applyInlineTrigger(text: string, trigger: InlineTrigger, insert: string): { text: string; caret: number } {
  let end = trigger.to;
  if (trigger.kind === "link") {
    if (text.startsWith("]]", end)) end += 2;
    else if (text.startsWith("]", end)) end += 1;
  }
  const tail = text.slice(end);
  const gap = tail.length === 0 || !/^\s/.test(tail) ? " " : "";
  const head = text.slice(0, trigger.from) + insert + gap;
  return { text: head + tail, caret: head.length + (gap ? 0 : tail.startsWith(" ") ? 1 : 0) };
}
