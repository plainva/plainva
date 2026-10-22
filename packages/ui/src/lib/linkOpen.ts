import { explicitLinkPath, isInternalPath, markdownDestinationUrl, markdownLinkPlaces, markdownLinkTarget, type MarkdownLinkAnswer } from "@plainva/core";
import { splitLinkAnchor } from "./linkAnchor";
import { wikiTargetToPath } from "./wikiResolver";

/**
 * What a click on a link does — decided once, for every surface of both shells
 * (finding 2026-10-09, recorded 2026-10-12; ADR 0027 addendum).
 *
 * Eight places opened a Markdown link, each in a way of its own. The reading
 * view read it from the linking note's folder and said "not found" for
 * everything else. The editor did that for a target with a slash and sent a
 * bare name through the wiki rule without decoding it, so the entry Plainva's
 * own listing writes for a note "My letter" — `[My letter](My%20letter.md)` —
 * created a note `My%20letter.md` beside the real one. A table cell lost the
 * way the link was written on its way to the shell and treated every link as a
 * wiki link: a link to a missing picture created a note `shot.png.md`, a link
 * to a folder a note called `.md`. The desktop's journal handed the raw text
 * to the opener as a path. The phone's journal did nothing at all.
 *
 * Where a link LEADS is the core's to say — `resolveLinkTargetIndexed` for a
 * wiki link, `resolveMarkdownLinkIndexed` for a Markdown link. This file says
 * what follows from the answer:
 *
 *   open     the file, at the link's anchor where it has one — for a folder
 *            the `index.md` in it
 *   folder   a folder without an `index.md`: the shell shows the folder
 *   create   nothing answers and the link is an invitation: a wiki link, or a
 *            Markdown link whose target is a bare note name (`[x](New)`,
 *            `[x](New.md)`) — Obsidian parity, maintainer 2026-07-18
 *   notFound nothing answers and the link names a PLACE: a path, a folder, a
 *            file that is no note. A place where nothing lies is a missing
 *            file, never a new note named after the path (issue 61)
 *   anchor   a place in the note the link stands in (`[x](#heading)`, `[[#Heading]]`)
 *   external a web, mail or phone address — the system's. Any other scheme is
 *            "not found": `javascript:` or `intent:` from a synced note or a
 *            guest's comment must never reach the shell's opener, which on
 *            the phone hands what is not a web address to `window.open`
 *            (review 2026-10-22)
 *
 * `deps` are injected so this file stays free of shell dependencies: each
 * shell hands in its index and its disk, and runs the outcome its own way.
 */

/** How a link is written. A wiki link names a note; a Markdown link is read from the linking note's folder first. */
export type LinkWriting = "wiki" | "markdown";

export interface LinkToOpen {
  /** A wiki link's text between its brackets (alias aside), or a Markdown link's destination as it is written. */
  text: string;
  kind: LinkWriting;
  /** The note the link stands in. */
  sourcePath?: string;
  /** A wiki link's anchor where the surface has split it off already (the wiki-link plugin does). */
  anchor?: string | null;
  /**
   * `text` is a Markdown link's URL as a parser already read it — angle
   * brackets, title and escapes off (the reading view's `href`). Read once
   * more, `<Projekt 'Alpha'>` lost its `'Alpha'` as if it were a title.
   */
  parsed?: boolean;
}

export type LinkOpenOutcome =
  | { action: "open"; path: string; anchor: string | null }
  | { action: "folder"; path: string }
  | { action: "create"; target: string; path: string; title: string }
  | { action: "notFound"; target: string }
  | { action: "anchor"; anchor: string }
  | { action: "external"; url: string };

export interface LinkOpenDeps {
  /** The wiki rule over the index (`VaultQueryService.resolveNotePath`). */
  resolveWiki: (target: string, sourcePath?: string) => Promise<string | null>;
  /** The Markdown rule over the index (`VaultQueryService.resolveMarkdownLink`). */
  resolveMarkdown: (target: string, sourcePath?: string) => Promise<MarkdownLinkAnswer>;
  /** A FILE lies at this vault path on disk — asked only where the index knows nothing. */
  fileExists: (path: string) => Promise<boolean>;
  /** A FOLDER lies at this vault path on disk. */
  folderExists: (path: string) => Promise<boolean>;
}

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
/** The schemes a shell hands to the system: the desktop's opener allows these and no other. */
const OPENS_OUTSIDE = /^(?:https?|mailto|tel):/i;

/** A web, mail or phone address: the only links a click hands to the system. */
export function opensOutside(url: string): boolean {
  return OPENS_OUTSIDE.test(url.trim());
}

/**
 * A target that names a note and no place: no folder in front of it, and no
 * extension or `.md`. A dot with a blank behind it is part of a name
 * (`Dr. Miller`), one before the last word an extension (`report.pdf`, `v1.2`).
 */
export function isBareNoteName(target: string): boolean {
  if (target.includes("/") || target.includes("\\")) return false;
  return /\.md$/i.test(target) || !/\.[^.\s]+$/.test(target);
}

/**
 * Where the note a Markdown link names will lie — the place the Markdown rule
 * looks FIRST, so the link finds it once it is there: `[x](Ablage/Neu.md)` in
 * `Projekte/Plan.md` names `Projekte/Ablage/Neu.md`, and `/x`, `./x` and
 * `../x` name their place. `target` is the link's target as
 * `markdownLinkTarget` reads it — decoded, without its anchor —, and a name
 * keeps every character: `Draft%20%231.md` names the note "Draft #1". The wiki
 * rule's reading cut it at the `#` and created `Draft.md` (review 2026-10-22).
 *
 * Null where the target names no note: a folder, a file of another kind, a
 * place outside the vault. A click and the clean-up's "create note" ask this.
 */
export function markdownLinkNotePlace(sourcePath: string, target: string): { path: string; title: string } | null {
  const trimmed = target.trim();
  const name = trimmed.slice(trimmed.lastIndexOf("/") + 1);
  if (name === "" || name === "." || name === "..") return null;
  if (!/\.md$/i.test(name) && /\.[^.\s]+$/.test(name)) return null;
  // `explicitLinkPath` reads `/x`, `./x` and `../x`; any other target is read
  // from the linking note's folder — the same reading with `./` in front.
  const explicit = explicitLinkPath(sourcePath, trimmed);
  const place = explicit === undefined ? explicitLinkPath(sourcePath, `./${trimmed}`) : explicit;
  if (!place) return null;
  // `.md` as the indexer reads a note: `[x](Neu.MD)` made `Neu.MD`, an
  // attachment without title or links (review 2026-10-22).
  const path = /\.md$/i.test(place) ? `${place.slice(0, -3)}.md` : `${place}.md`;
  const title = path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/i, "").trim();
  return title ? { path, title } : null;
}

const answersNo = () => false;

export async function planLinkOpen(link: LinkToOpen, deps: LinkOpenDeps): Promise<LinkOpenOutcome> {
  const fileThere = (path: string) => deps.fileExists(path).catch(answersNo);
  const folderThere = (path: string) => deps.folderExists(path).catch(answersNo);

  if (link.kind === "wiki") {
    // The anchor (issue 92) arrives split off or still sits in the text.
    const split = splitLinkAnchor(link.text);
    const anchor = link.anchor ?? split.anchor;
    if (!split.target) return anchor ? { action: "anchor", anchor } : { action: "notFound", target: link.text.trim() };
    const found = await deps.resolveWiki(split.target, link.sourcePath).catch(() => null);
    if (found) return { action: "open", path: found, anchor };
    // Not created yet. Where the note will lie is `wikiTargetToPath`'s to say;
    // a target that climbs out of the vault names no place.
    const { path, title } = wikiTargetToPath(split.target, link.sourcePath);
    if (!title) return { action: "notFound", target: split.target };
    // The index follows a save by one pass: a note that is there is opened, not created twice.
    if (await fileThere(path)) return { action: "open", path, anchor };
    return { action: "create", target: split.target, path, title };
  }

  const url = link.parsed ? link.text : markdownDestinationUrl(link.text);
  if (SCHEME.test(url)) return OPENS_OUTSIDE.test(url) ? { action: "external", url } : { action: "notFound", target: url };
  const { target, anchor } = markdownLinkTarget(url);
  if (!target) return anchor ? { action: "anchor", anchor } : { action: "notFound", target: url };

  const answer = await deps.resolveMarkdown(target, link.sourcePath).catch(() => null);
  if (answer !== null) {
    if (answer.kind === "file") return { action: "open", path: answer.path, anchor };
    return answer.index !== null ? { action: "open", path: answer.index, anchor: null } : { action: "folder", path: answer.path };
  }

  // The index knows nothing. A file it has not taken in yet is opened all the
  // same: the places the target names as paths are asked of the disk, in the
  // rule's order. The app's own folders are no link targets.
  for (const place of markdownLinkPlaces(link.sourcePath ?? "", target)) {
    if (place.path !== "" && isInternalPath(place.path)) continue;
    if (place.kind === "file") {
      if (await fileThere(place.path)) return { action: "open", path: place.path, anchor };
    } else if (place.path === "" || (await folderThere(place.path))) {
      const listing = place.path === "" ? "index.md" : `${place.path}/index.md`;
      return (await fileThere(listing)) ? { action: "open", path: listing, anchor: null } : { action: "folder", path: place.path };
    }
  }

  if (isBareNoteName(target)) {
    const place = markdownLinkNotePlace(link.sourcePath ?? "", target);
    if (place) return { action: "create", target, ...place };
  }
  return { action: "notFound", target };
}

/** What `planLinkOpen` asks of the disk, over a vault adapter: `exists` alone cannot tell a file from a folder. */
export function linkDiskProbe(adapter: { exists(path: string): Promise<boolean>; getFileInfo(path: string): Promise<{ isDirectory: boolean }> }): Pick<LinkOpenDeps, "fileExists" | "folderExists"> {
  const isFolder = async (path: string): Promise<boolean | null> => ((await adapter.exists(path)) ? (await adapter.getFileInfo(path)).isDirectory : null);
  return {
    fileExists: async (path) => (await isFolder(path)) === false,
    folderExists: async (path) => (await isFolder(path)) === true,
  };
}
