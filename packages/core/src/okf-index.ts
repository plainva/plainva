import { encodeMarkdownLinkAnchor, encodeMarkdownLinkPath } from "./linkEncoding.js";
import { rewriteNoteLinks } from "./linkRewrite.js";
import { serializeMarkdownLink } from "./markdown-serializer.js";
import { buildLinkTargetIndex, resolveLinkTargetIndexed, type LinkCorpusFile } from "./vault/LinkResolver.js";
import { OKF_VERSION } from "./metadata.js";
import { wikiLinkParts } from "./wikiLink.js";

/**
 * OKF index.md support (SPEC §6/§11): spec-shaped directory listings,
 * candidate detection for adopting existing overview notes (MOC, Übersicht, …)
 * and the wikilink→markdown-link transform used when preparing an adopted
 * file. Generation and adoption are always user-driven — Plainva only suggests.
 */

/** Vault-relative markdown URL from a folder to a file (spec index entries are relative). */
export function relativeMarkdownUrl(fromFolder: string, toPath: string): string {
  const from = fromFolder ? fromFolder.replace(/\\/g, "/").split("/") : [];
  const to = toPath.replace(/\\/g, "/").split("/");
  let common = 0;
  while (common < from.length && common < to.length - 1 && from[common] === to[common]) common++;
  const ups = from.length - common;
  const rel = [...Array<string>(ups).fill(".."), ...to.slice(common)].join("/");
  return encodeMarkdownLinkPath(rel);
}

export interface IndexFileEntry {
  path: string;
  title?: string;
  description?: string;
}

export interface IndexSubfolderEntry {
  name: string;
  description?: string;
  /**
   * Whether the subfolder has its own index.md. When true the listing links to
   * that note (portable — both Plainva and Obsidian open it); when false the
   * entry stays plain text so a click never fabricates a stray note (Issue #9).
   */
  hasIndex?: boolean;
}

export interface GenerateIndexOptions {
  /** Folder the index.md lives in ("" for the vault root). */
  folder: string;
  /** Section heading (usually the folder or vault name — caller localizes). */
  heading: string;
  files: IndexFileEntry[];
  subfolders: IndexSubfolderEntry[];
  /** Heading for the subfolder section (only rendered when subfolders exist). */
  subfoldersHeading?: string;
  /** The vault-root index.md may declare the bundle's okf_version (SPEC §11). */
  bundleRoot?: boolean;
  okfVersion?: string;
  /** Appends the managed marker — the auto-updater only rewrites marked files. */
  managedMarker?: boolean;
}

/**
 * Marker line of Plainva-managed index.md files. An HTML comment on purpose:
 * invisible in Obsidian's reading view and NOT frontmatter (frontmatter on a
 * non-root index.md is an OKF reserved-name violation). Deleting the line is
 * the supported opt-out — the file stops being auto-updated.
 */
export const PLAINVA_INDEX_MARKER = "<!-- plainva:index generated -->";
const PLAINVA_INDEX_MARKER_RE = /<!--\s*plainva:index\s+generated\s*-->/;

/** Whether Plainva generated (and therefore may auto-update) this index.md. */
export function isPlainvaManagedIndex(content: string): boolean {
  return PLAINVA_INDEX_MARKER_RE.test(content);
}

/** Removes the marker line ("Trotzdem bearbeiten" — the file becomes manual). */
export function stripPlainvaIndexMarker(content: string): string {
  return content
    .split(/\r?\n/)
    .filter((line) => !PLAINVA_INDEX_MARKER_RE.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}

function displayTitle(entry: IndexFileEntry): string {
  if (entry.title && entry.title.trim() !== "") return entry.title.trim();
  return entry.path.split("/").pop()!.replace(/\.md$/i, "");
}

/** Deterministic, spec-shaped listing: sections with `* [Title](url) - description` bullets. */
export function generateIndexContent(options: GenerateIndexOptions): string {
  const lines: string[] = [];
  if (options.bundleRoot) {
    lines.push("---", `okf_version: "${options.okfVersion ?? OKF_VERSION}"`, "---", "");
  }
  lines.push(`# ${options.heading}`, "");

  const sortedFiles = [...options.files].sort((a, b) =>
    displayTitle(a).localeCompare(displayTitle(b), undefined, { sensitivity: "base" })
  );
  for (const file of sortedFiles) {
    const url = relativeMarkdownUrl(options.folder, file.path);
    const description = file.description?.trim();
    lines.push(`* [${displayTitle(file)}](${url})${description ? ` - ${description}` : ""}`);
  }

  const sortedFolders = [...options.subfolders].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
  );
  if (sortedFolders.length > 0) {
    lines.push("", `# ${options.subfoldersHeading ?? "Subdirectories"}`, "");
    for (const sub of sortedFolders) {
      const description = sub.description?.trim();
      const suffix = description ? ` - ${description}` : "";
      if (sub.hasIndex) {
        // Link to the subfolder's own index.md — an existing note both Plainva
        // AND Obsidian open. A trailing-slash folder link (`Name/`) only
        // navigates inside Plainva; Obsidian has no target for it, so clicking
        // one fabricates a stray empty note named after the folder (Issue #9).
        lines.push(`* [${sub.name}](${encodeMarkdownLinkPath(sub.name)}/index.md)${suffix}`);
      } else {
        // No index.md to point at — a plain (non-link) entry so a click can
        // never create a junk note in either app.
        lines.push(`* ${sub.name}${suffix}`);
      }
    }
  }

  if (options.managedMarker) lines.push("", PLAINVA_INDEX_MARKER);

  return lines.join("\n").replace(/\n{3,}/g, "\n\n") + "\n";
}

export interface IndexCandidate {
  path: string;
  score: number;
  reason: "folder-note" | "name-pattern";
}

const EXACT_NAME_SCORES: Record<string, number> = {
  moc: 90,
  "map of content": 85,
  "map of contents": 85,
  index: 85,
  "übersicht": 80,
  uebersicht: 80,
  "überblick": 80,
  ueberblick: 80,
  overview: 80,
  home: 60,
  start: 55,
  readme: 50,
};

const CONTAINS_PATTERNS: { re: RegExp; score: number }[] = [
  { re: /(^|[\s\-_.])moc([\s\-_.]|$)/i, score: 70 },
  { re: /(^|[\s\-_.])(übersicht|uebersicht|überblick|ueberblick|overview)([\s\-_.]|$)/i, score: 65 },
  { re: /map of contents?/i, score: 65 },
];

/**
 * Ranks existing files in a folder that look like a directory overview
 * (candidates for a user-driven rename to index.md). Nothing is preselected.
 */
export function findIndexCandidates(folder: string, fileNames: string[]): IndexCandidate[] {
  const folderName = folder ? folder.replace(/\\/g, "/").split("/").pop()!.toLowerCase() : "";
  const candidates: IndexCandidate[] = [];

  for (const name of fileNames) {
    if (!name.toLowerCase().endsWith(".md")) continue;
    const base = name.replace(/\.md$/i, "");
    const lower = base.toLowerCase();
    if (lower === "index") continue; // already reserved — handled separately

    if (folderName && lower === folderName) {
      candidates.push({ path: folder ? `${folder}/${name}` : name, score: 100, reason: "folder-note" });
      continue;
    }
    const exact = EXACT_NAME_SCORES[lower];
    if (exact !== undefined) {
      candidates.push({ path: folder ? `${folder}/${name}` : name, score: exact, reason: "name-pattern" });
      continue;
    }
    const contains = CONTAINS_PATTERNS.find((p) => p.re.test(base));
    if (contains) {
      candidates.push({ path: folder ? `${folder}/${name}` : name, score: contains.score, reason: "name-pattern" });
    }
  }

  return candidates.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
}

export interface WikilinkConversionResult {
  converted: number;
  /** Embeds (`![[…]]`) are left untouched and only counted. */
  embeds: number;
  /** Wikilinks whose target could not be resolved stay wikilinks. */
  unresolved: number;
  /**
   * Wikilinks in the label of a link stay wikilinks: a link cannot stand
   * inside a link, and the one around it would be text afterwards.
   */
  inLabels: number;
}

/**
 * Converts the wikilinks of ONE document into relative markdown links (used by
 * "OKF-konform aufbereiten" when adopting a note as index.md). Embeds and
 * unresolvable targets are preserved and reported.
 *
 * Each link is replaced where it stands in the text, and nothing else of the
 * document changes (finding 2026-10-09). The document used to be written back
 * from its tree, which reformatted all of it: list markers, emphasis, table
 * rules, the blank lines between its blocks.
 *
 * `allFilePaths` is what the link rule resolves over — the whole vault, so a
 * link leads where it leads in the editor. `only` names the files a link may
 * be converted for (the notes a listing points at); a link that leads to any
 * other file stays a wikilink and counts as unresolved, and so does one whose
 * place in the text cannot be told. Without `only`, every file of the list may
 * be linked.
 *
 * A wikilink in the label of a link is not converted (finding 2026-10-12).
 * `[see [[Alpha]] here](Beta.md)` became a Markdown link inside a Markdown
 * link; links do not nest, so the outer one was text afterwards and the link
 * to `Beta.md` was lost without a word. It stays a wikilink and is counted.
 *
 * `becomes` is the path the document is about to take, where it is converted
 * on its way to another name (a note adopted as `index.md`). The links are
 * written to be read from there, and a link that leads to the document itself
 * names that path — under the old name there will be no file. It names it
 * from the document's own folder, explicitly: `./index.md`. `index.md` is the
 * one name a vault holds in every folder; an explicit path means this one for
 * every reader, whichever of the others a bare `index.md` would be taken for
 * (the editor and the graph took it for the one at the vault's root). Its
 * label is the one every converted link gets, what the wikilink showed: the
 * note reads as it did, and only where the link leads follows the file
 * (decided 2026-10-12; renaming first and converting then would have put the
 * new file name there, "index").
 */
export function convertWikilinksToMarkdownLinks(
  content: string,
  opts: { sourcePath: string; allFilePaths: readonly (string | LinkCorpusFile)[]; only?: ReadonlySet<string>; becomes?: string }
): { content: string; result: WikilinkConversionResult } {
  const result: WikilinkConversionResult = { converted: 0, embeds: 0, unresolved: 0, inLabels: 0 };
  const slashed = (path: string) => path.replace(/\\/g, "/");
  const here = slashed(opts.sourcePath);
  const lands = slashed(opts.becomes ?? opts.sourcePath);
  const landsIn = lands.includes("/") ? lands.slice(0, lands.lastIndexOf("/")) : "";
  // One corpus index for the whole document (P2.3) instead of per wikilink.
  const corpusIndex = buildLinkTargetIndex(opts.allFilePaths);

  const rewritten = rewriteNoteLinks(content, (link) => {
    if (link.type === "embed") result.embeds++;
    if (link.type !== "wikilink") return null;
    if (link.inLabel) {
      result.inLabels++;
      return null;
    }

    // What stands between the brackets is read by the one rule for it; an
    // alias's `\|` is the bar it spells, and the new link's label is that text.
    const { rawTarget: head, alias } = wikiLinkParts(link.inner);
    const hashIdx = head.indexOf("#");
    const target = hashIdx >= 0 ? head.slice(0, hashIdx) : head;
    const anchor = hashIdx >= 0 ? head.slice(hashIdx) : "";

    const resolved = resolveLinkTargetIndexed(opts.sourcePath, target, corpusIndex);
    const leadsTo = resolved === null ? null : slashed(resolved);
    if (leadsTo === null || (opts.only && !opts.only.has(leadsTo))) {
      result.unresolved++;
      return null;
    }

    const file = leadsTo === here ? `./${encodeMarkdownLinkPath(lands.slice(lands.lastIndexOf("/") + 1))}` : relativeMarkdownUrl(landsIn, leadsTo);
    const url = file + encodeMarkdownLinkAnchor(anchor);
    const text = alias ?? (hashIdx >= 0 ? head : target.split("/").pop()!);
    return { replacement: serializeMarkdownLink(text, url, { inTable: link.inTable }) };
  });

  result.converted = rewritten.rewritten;
  for (const link of rewritten.unplaced) {
    if (link.type === "embed") result.embeds++;
    else if (link.type === "wikilink") result.unresolved++;
  }
  return { content: rewritten.content, result };
}
