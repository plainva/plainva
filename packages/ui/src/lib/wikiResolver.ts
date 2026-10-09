import { buildLinkTargetIndex, explicitLinkPath, linkTargetName, resolveLinkTargetIndexed, type LinkTargetIndex } from "@plainva/core";

/**
 * Tells whether a wiki-link target resolves to an existing vault file
 * (maintainer 2026-07-18, "Obsidian-style unresolved links"). The editor and
 * the read view use it to render links to not-yet-created notes in a muted
 * "unresolved" style — clicking such a link then creates the note.
 *
 * The answer is the link rule's (`resolveLinkTargetIndexed` in the core): the
 * very lookup a click asks through `VaultQueryService.resolveNotePath`. Until
 * 2026-10-08 this file kept a lowercased set of every title and path instead —
 * the desktop's old click rule, copied —, so a note with a title of its own
 * was drawn as missing under its file's name, on the phone too, where a tap
 * opened it. Pure + synchronous so the CodeMirror decoration plugin can call
 * it per link without I/O.
 */

/**
 * The lookup over every indexed file, as the shells push it into the editor.
 * Opaque: ask it through `isWikiTargetResolved`.
 */
export type WikiTargetSet = LinkTargetIndex;

/** Build the lookup from the vault's files — every file of the index with the title it holds. */
export function buildWikiTargetSet(files: readonly { title?: string | null; path: string }[]): WikiTargetSet {
  return buildLinkTargetIndex(files);
}

/**
 * True when `target`, written in the note at `hostPath`, resolves to a file in
 * `set`. An empty target, or a null set (index not loaded yet), counts as
 * resolved so links never flash as "unresolved" before the index is ready. The
 * header (`#…`) and alias (`|…`) are ignored, matching how links resolve. The
 * host only matters for a target that names a path from its own folder
 * (`./Note`, `../Folder/Note`); whether any other target exists does not
 * depend on the note it stands in.
 */
export function isWikiTargetResolved(target: string, set: WikiTargetSet | null | undefined, hostPath?: string): boolean {
  if (!set) return true;
  const name = linkTargetName(target);
  if (!name) return true;
  return resolveLinkTargetIndexed(hostPath ?? "", name, set) !== null;
}

/**
 * The file `target` leads to from the note at `hostPath`, or null — the answer
 * behind `isWikiTargetResolved`, for a surface that has to know WHICH note a
 * stored link means (a relation picker: "is this candidate linked already").
 * A null set (index not loaded yet) answers null.
 */
export function wikiTargetPath(target: string, set: WikiTargetSet | null | undefined, hostPath?: string): string | null {
  if (!set) return null;
  const name = linkTargetName(target);
  return name ? resolveLinkTargetIndexed(hostPath ?? "", name, set) : null;
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
  // `/Folder/Note`, `./Note`, `../Folder/Note`: the note is created where the
  // link rule will look for it. A target that climbs out of the vault names no
  // place — no title, and the caller creates nothing.
  const named = explicitLinkPath(hostPath ?? "", base);
  if (named !== undefined) return named === null ? { path: "", title: "" } : { path: `${named}.md`, title };
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
