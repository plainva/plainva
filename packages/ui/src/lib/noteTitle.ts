/**
 * Display-name helpers shared by the file tree, the tab strips and the
 * bookmarks list so their notion of "the name to show for a path" never
 * diverges (this replaces three inline copies of the same regex).
 *
 * A note (`.md`) or database (`.base`) file drops its extension in the UI;
 * attachments (any other extension) keep theirs, matching the file tree.
 */

/** Strip the `.md` / `.base` display extension from a bare file name. Other
 *  extensions are left intact so attachments keep them. */
export function stripNoteExtension(name: string): string {
  return name.replace(/\.(md|base)$/i, "");
}

/** Display name for a note/base path: the basename without its `.md` / `.base`
 *  extension. Attachments keep their extension. */
export function noteDisplayName(path: string): string {
  return stripNoteExtension(path.split(/[/\\]/).pop() ?? path);
}
