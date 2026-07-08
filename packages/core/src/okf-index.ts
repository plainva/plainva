import { visit } from "unist-util-visit";
import { MarkdownAst, MarkdownHtmlNode } from "./markdown-ast.js";
import { buildLinkTargetIndex, resolveLinkTargetIndexed } from "./vault/LinkResolver.js";
import { OKF_VERSION } from "./metadata.js";

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
  return encodeURI(rel);
}

export interface IndexFileEntry {
  path: string;
  title?: string;
  description?: string;
}

export interface IndexSubfolderEntry {
  name: string;
  description?: string;
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
      lines.push(`* [${sub.name}](${encodeURI(sub.name)}/)${description ? ` - ${description}` : ""}`);
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
}

/**
 * Converts the wikilinks of ONE document into relative markdown links (used by
 * "OKF-konform aufbereiten" when adopting a note as index.md). Embeds and
 * unresolvable targets are preserved and reported.
 */
export function convertWikilinksToMarkdownLinks(
  ast: MarkdownAst,
  opts: { sourcePath: string; allFilePaths: string[] }
): WikilinkConversionResult {
  const result: WikilinkConversionResult = { converted: 0, embeds: 0, unresolved: 0 };
  const sourceFolder = opts.sourcePath.includes("/")
    ? opts.sourcePath.slice(0, opts.sourcePath.lastIndexOf("/"))
    : "";
  // One corpus index for the whole document (P2.3) instead of per wikilink.
  const corpusIndex = buildLinkTargetIndex(opts.allFilePaths);

  visit(ast as any, "html", (node: MarkdownHtmlNode, index: number | undefined, parent: any) => {
    const value = node.value;
    if (value.startsWith("![[") && value.endsWith("]]")) {
      result.embeds++;
      return;
    }
    if (!value.startsWith("[[") || !value.endsWith("]]") || index === undefined || !parent) return;

    const inner = value.slice(2, -2);
    const pipe = inner.split("|");
    const alias = pipe.length > 1 ? pipe.slice(1).join("|") : undefined;
    const hashIdx = pipe[0].indexOf("#");
    const target = hashIdx >= 0 ? pipe[0].slice(0, hashIdx) : pipe[0];
    const anchor = hashIdx >= 0 ? pipe[0].slice(hashIdx) : "";

    const resolved = resolveLinkTargetIndexed(opts.sourcePath, target, corpusIndex);
    if (!resolved) {
      result.unresolved++;
      return;
    }

    const url = relativeMarkdownUrl(sourceFolder, resolved) + encodeURI(anchor);
    const text = alias ?? (hashIdx >= 0 ? pipe[0] : target.split("/").pop()!);
    parent.children[index] = {
      type: "link",
      url,
      children: [{ type: "text", value: text }],
    };
    result.converted++;
  });

  return result;
}
