/**
 * What the search field is currently being used for (S16).
 *
 * One field, three jobs — the desktop needs three separate doors for this
 * (search sidebar, quick switcher, command palette) because it has the room.
 * A phone does not, so the field itself says which job it is doing: a leading
 * `>` means commands, anything else means find, and nothing typed yet means
 * "here is what you might want".
 *
 * The prefix is the palette convention (VS Code, Obsidian, GitHub) rather than
 * an invention, so it is a thing people already know rather than a thing they
 * have to discover.
 */

export const COMMAND_PREFIX = ">";

export type SearchMode = "idle" | "commands" | "find";

export interface ParsedQuery {
  mode: SearchMode;
  /** What to search or filter with — the prefix removed. */
  term: string;
}

export function parseQuery(raw: string): ParsedQuery {
  const q = raw.trimStart();
  if (q.startsWith(COMMAND_PREFIX)) {
    return { mode: "commands", term: q.slice(COMMAND_PREFIX.length).trim() };
  }
  const term = raw.trim();
  return term === "" ? { mode: "idle", term: "" } : { mode: "find", term };
}

/**
 * The search operators, as offered chips. They exist in the FTS parser already
 * (`ftsQuery.ts`); what was missing is any way to find out they exist — the
 * field never mentioned them.
 */
export const OPERATOR_CHIPS = [
  { insert: "tag:", labelKey: "search.opTag" },
  { insert: "path:", labelKey: "search.opPath" },
  { insert: '""', labelKey: "search.opPhrase", caretBack: 1 },
  { insert: "-", labelKey: "search.opExclude" },
] as const;

/** Appends an operator to the query, keeping exactly one space before it. */
export function appendOperator(query: string, insert: string): string {
  const base = query.trimEnd();
  return base === "" ? insert : `${base} ${insert}`;
}
