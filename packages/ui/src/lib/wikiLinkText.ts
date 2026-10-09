import { likeContainsAnySpelling, wikiTargetForPath } from "@plainva/core";

/**
 * The text Plainva writes for a link to a note someone picked from a list.
 *
 * A pick used to write the note's TITLE — `[[Angebotsbrief]]` for the note
 * `Projekte/Brief.md` — in the `[[` completion, the `@` mention and the
 * relation pickers, while the graph's "link this mention", the task and the
 * reverse columns wrote the file's name. A title is the weakest name a note
 * has: the link rule tries it last (`LinkResolver.ts`, step 5), so a link by
 * title silently leads to another note as soon as one is CALLED that, two
 * notes of one title got the same text, and Obsidian follows no title at all
 * (finding 2026-10-08).
 *
 * So every pick writes what the other writers write: the file's name where it
 * is the only one of that name, otherwise the path (`wikiTargetForPath`) — a
 * target that leads back to the picked note from every note of the vault. A
 * title that reads differently is kept as the link's text: `[[Brief|Angebotsbrief]]`.
 */

/** The slice of the query service this needs; both shells' service satisfies it. */
export interface LinkTextSource {
  db: { query: (sql: string, params?: any[]) => Promise<any[]> };
}

/**
 * The files whose name could be taken for the name of one of `paths` — all
 * `wikiTargetForPath` has to see to tell whether a bare name is still the
 * only one. One query for a whole list of picks instead of every path of the
 * vault per keystroke.
 */
export async function pathsSharingNames(source: LinkTextSource, paths: readonly string[]): Promise<string[]> {
  const names = [...new Set(paths.map((path) => path.split(/[/\\]/).pop() ?? "").filter(Boolean))];
  if (names.length === 0) return [];
  const rows = await source.db.query(
    `SELECT path FROM files WHERE ${names.map(() => "path LIKE ? ESCAPE '\\'").join(" OR ")}`,
    names.map(likeContainsAnySpelling),
  );
  return (rows ?? []).map((row: { path?: unknown }) => String(row.path ?? "")).filter(Boolean);
}

/**
 * `[[target]]`, or `[[target|title]]` where the note's title reads otherwise.
 * `sharing` is `pathsSharingNames` for this path (or every note path of the
 * vault, where a caller holds that anyway).
 */
export function wikiLinkTextFor(path: string, title: string | null | undefined, sharing: readonly string[]): string {
  const target = wikiTargetForPath(path, [...sharing]);
  const shown = (title ?? "").trim();
  // A text that would end the link or read as its alias mark cannot be one.
  return shown === "" || shown === target || /[[\]|\r\n]/.test(shown) ? `[[${target}]]` : `[[${target}|${shown}]]`;
}
