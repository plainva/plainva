/**
 * Tells whether a wiki-link target resolves to an existing vault file
 * (maintainer 2026-07-18, "Obsidian-style unresolved links"). The editor and
 * the read view use it to render links to not-yet-created notes in a muted
 * "unresolved" style — clicking such a link then creates the note.
 *
 * The membership set mirrors the index resolution exactly
 * (VaultQueryService.resolveNotePath: `title = t OR path = t OR path = t.md`,
 * case-insensitive): build a lowercased set of every file's title and path,
 * then test the target both as-is and with a `.md` suffix. Pure + synchronous
 * so the CodeMirror decoration plugin can call it per link without I/O.
 */

/** Build the lowercased title/path membership set from the vault's files. */
export function buildWikiTargetSet(files: { title: string; path: string }[]): Set<string> {
  const set = new Set<string>();
  for (const f of files) {
    if (f.title) set.add(f.title.toLowerCase());
    if (f.path) set.add(f.path.toLowerCase());
  }
  return set;
}

/**
 * True when `target` resolves to a file in `set`. An empty target, or a null
 * set (index not loaded yet), counts as resolved so links never flash as
 * "unresolved" before the index is ready. The header (`#…`) and alias (`|…`)
 * are ignored, matching how links resolve.
 */
export function isWikiTargetResolved(target: string, set: Set<string> | null | undefined): boolean {
  if (!set) return true;
  const t = target.split("#")[0].split("|")[0].trim().toLowerCase();
  if (!t) return true;
  return set.has(t) || set.has(`${t}.md`);
}

/**
 * Target path + H1 title for the note a click on an UNRESOLVED wiki link
 * creates (maintainer 2026-07-18, Obsidian parity). Header (`#…`) and alias
 * (`|…`) are stripped. A target that already carries a folder (`Folder/Note`)
 * creates exactly there; a bare target lands in the host note's folder
 * (Obsidian's "same folder" default), or the vault root when the host is at the
 * root. Empty title means the caller should skip creation. Shared by desktop
 * and mobile.
 */
export function wikiTargetToPath(target: string, hostPath?: string): { path: string; title: string } {
  const clean = target.split("#")[0].split("|")[0].trim();
  const base = clean.replace(/\.md$/i, "");
  const title = (base.split("/").pop() || base).trim();
  let path: string;
  if (base.includes("/")) {
    path = `${base}.md`;
  } else if (hostPath && hostPath.includes("/")) {
    path = `${hostPath.slice(0, hostPath.lastIndexOf("/"))}/${base}.md`;
  } else {
    path = `${base}.md`;
  }
  return { path, title };
}
