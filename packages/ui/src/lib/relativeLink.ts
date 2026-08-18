import { resolveOpenAction } from "./openTarget";

/**
 * Relative and bundle-absolute markdown links — resolution AND what a click on
 * one does (issue #61).
 *
 * The resolver below is not new. It was written for the read view on
 * 2026-07-04, for the links inside generated `index.md` listings, and it has
 * been correct ever since: it percent-decodes, walks `../` against the host
 * note's folder, treats a leading `/` as bundle-absolute, tells folders from
 * files and refuses a path that would leave the vault.
 *
 * What was missing is that it lived in the read view's own model file, so only
 * the read view could ask it. The editor's live preview sent every
 * non-http markdown link through the WIKI resolution path instead — an index
 * lookup on titles and paths. A relative link is neither, so the lookup missed,
 * and the miss branch of that path is the one built for unresolved wiki links:
 * create the note. `wikiTargetToPath` then appended `.md` to a `.mp3`, and the
 * write hit the vault's path guard:
 *
 *   Error creating: Path traversal detected: ../_resources/….mp3.md
 *
 * Four symptoms — `.md` on a non-markdown target, "creating" instead of
 * opening, `%20` left encoded, the guard firing on a legitimate `../` — one
 * cause: nobody resolved the path. This is the shape of #55/#56 again, where
 * "an attachment belongs to the operating system" existed in exactly one place.
 * So the rule lives here now, once, and every surface asks it.
 */

export interface RelativeTarget {
  kind: "file" | "folder";
  path: string; // vault-relative, "" = vault root (folders only)
}

/**
 * Resolves a markdown href against the source file's folder. Returns null for
 * anchors, URLs with a scheme (http, mailto, wiki://, …) and paths that would
 * escape the vault — those keep their existing handling. A leading "/" is
 * bundle-absolute (OKF SPEC recommendation) and resolves from the vault root.
 */
export function resolveRelativeTarget(sourcePath: string, href: string): RelativeTarget | null {
  if (!href || href.startsWith("#")) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return null;
  let raw: string;
  try {
    raw = decodeURI(href.split("#")[0]);
  } catch {
    return null;
  }
  if (!raw) return null;
  const isFolder = raw.endsWith("/");
  const rootRelative = raw.startsWith("/");
  const segs = rootRelative || !sourcePath.includes("/")
    ? []
    : sourcePath.replace(/\\/g, "/").split("/").slice(0, -1);
  for (const part of raw.replace(/\/+$/, "").split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (segs.length === 0) return null; // would escape the vault
      segs.pop();
      continue;
    }
    segs.push(part);
  }
  if (segs.length === 0) return isFolder ? { kind: "folder", path: "" } : null;
  return { kind: isFolder ? "folder" : "file", path: segs.join("/") };
}

/**
 * What a click on a relative markdown link does.
 *
 *   folder → the subfolder's `index.md` when it exists, otherwise reveal the
 *            folder in the tree
 *   file   → open it when it exists (the opener decides editor vs. viewer vs.
 *            operating system — that is `resolveOpenAction`, not our business)
 *   miss   → say so, and do NOT offer to create it
 *
 * The last line is the fix. Creating a note is right for an unresolved WIKI
 * link — a `[[…]]` that points nowhere is an invitation, Obsidian behaves the
 * same way, and the maintainer asked for it on 2026-07-18. A relative markdown
 * link is a different promise: it names a location on disk. When nothing is
 * there, the honest answer is that the file is missing, not a new note whose
 * name is the broken path with `.md` glued on.
 *
 * `exists` is injected rather than an adapter being imported, so this file
 * stays free of shell dependencies and the mobile host can pass its own.
 */
export type RelativeLinkOutcome =
  | { action: "open"; path: string }
  | { action: "revealFolder"; path: string }
  | { action: "notFound"; path: string };

export async function planRelativeLinkOpen(
  target: RelativeTarget,
  exists: (path: string) => Promise<boolean>,
): Promise<RelativeLinkOutcome> {
  if (target.kind === "folder") {
    const indexPath = target.path ? `${target.path}/index.md` : "index.md";
    try {
      if (await exists(indexPath)) return { action: "open", path: indexPath };
    } catch { /* fall through to reveal */ }
    return { action: "revealFolder", path: target.path };
  }
  try {
    if (await exists(target.path)) return { action: "open", path: target.path };
  } catch { /* treated as not found */ }
  return { action: "notFound", path: target.path };
}

/**
 * True when this markdown href is a link into the vault rather than something
 * for the browser or the wiki index. The editor asks it to decide whether to
 * resolve relatively at all; a bare `Note` (no slash, no extension) is left to
 * the index lookup, because that is how a markdown link to a note by title has
 * always worked here.
 *
 * A target that carries a slash, or an extension that is not `.md`, is a path
 * claim — `../_resources/x.mp3` and `img/shot.png` both are. Those must never
 * reach the create-a-note branch.
 */
export function isVaultPathLink(href: string): boolean {
  const raw = href.split("#")[0];
  if (!raw) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return false;
  if (raw.includes("/")) return true;
  return /\.[a-z0-9_-]+$/i.test(raw) && resolveOpenAction(raw) !== "editor";
}
