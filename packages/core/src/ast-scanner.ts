import { decodeMarkdownLinkTarget, markdownLinkTarget } from "./linkEncoding.js";
import { MarkdownAst } from "./markdown-ast.js";
import { extractFrontmatter } from "./metadata-extractor.js";
import { PLAINVA_NAMESPACE_KEY } from "./metadata.js";
import { findInlineTags } from "./tagRule.js";
import { wikiLinkInner, wikiLinkParts } from "./wikiLink.js";
import { inBoundedRanges as inRanges, readAsTextParts, type BoundedRange } from "./inlineParseBudget.js";
import { forEachReadPiece } from "./markdown-parser.js";

export type TagOccurrence = {
  name: string;
  source: "frontmatter" | "inline";
};

export type LinkOccurrence = {
  type: "wikilink" | "embed" | "markdown-link";
  target: string;
  rawTarget: string;
  alias?: string;
  anchor?: string;
  /** 1-based line of the link in the source — what a backlink shows as its context (Build-91 feedback, P7). */
  line?: number;
};

export type ExtractedData = {
  tags: TagOccurrence[];
  links: LinkOccurrence[];
};

/**
 * The tags and links of a note's tree. With the note's `text`, also those of
 * the blocks the note's budget reads as text, which the tree holds as one
 * paragraph of their characters (L14): read from their pieces by the parser
 * itself (`forEachReadPiece`), as a rename reads them (`readNoteLinks`), so
 * that the index lists what a rename rewrites. What the budget leaves unread
 * (`readAsTextParts`) gives nothing; the note's notice says so.
 */
export function extractLinksAndTags(ast: MarkdownAst, text?: string): ExtractedData {
  const result: ExtractedData = {
    tags: [],
    links: [],
  };

  // 1. Get Frontmatter tags
  const fmResult = extractFrontmatter(ast);
  if (fmResult.success && fmResult.data && fmResult.data.tags) {
    for (const tag of fmResult.data.tags) {
      result.tags.push({ name: tag, source: "frontmatter" });
    }
  }

  // 2. Walk the tree for inline tags and links, in the order of the text. A
  // wiki link is a node of its own (`wikiLinkSyntax.ts`): what stands between
  // its brackets is read as it is written, whatever Markdown would read into
  // it — `[[_private_]]` names the file "_private_" (finding 2026-10-11).
  // With the note: the blocks read as text, whose characters the tree holds as text — their facts come from their pieces.
  const parts = text !== undefined ? readAsTextParts(text) : null;
  const blocks = parts ? parts.ranges.filter((range) => range.block) : [];
  const walk = (node: any, inPiece = false): void => {
    if (!inPiece && blocks.length > 0 && node.type !== "root" && inRanges(blocks, node.position?.start?.offset)) return;
    if (node.type === "text") {
      // Inline tags: the one rule in tagRule.ts (the task scan, the rename and
      // the editor's pill read the same one).
      for (const tag of findInlineTags(node.value)) result.tags.push({ name: tag.name, source: "inline" });
    } else if (node.type === "wikiLink") {
      const parts = wikiLinkParts(wikiLinkInner(node));
      result.links.push({
        type: node.embed ? "embed" : "wikilink",
        target: parts.target,
        rawTarget: parts.rawTarget,
        anchor: parts.anchor,
        alias: parts.alias,
        line: node.position?.start?.line,
      });
    } else if (node.type === "link") {
      // Split the RAW destination at the anchor marker, then decode each
      // part: a "#" that belongs to the file name arrives encoded ("%23",
      // link-encoding 2026-09-04) and must not be read as the anchor marker,
      // which it would be once the whole string were decoded first. The
      // target itself is `markdownLinkTarget`'s to read — the one reading a
      // click and a rename share. Until 2026-10-22 a URL without a marker of
      // its own was cut once more AFTER decoding, at the first `#` or `^`:
      // `Draft%20%231.md` was listed as a link to `Draft`.
      const rawUrl = node.url;
      const markerIdx = rawUrl.indexOf("#");
      const decodedPath = decodeMarkdownLinkTarget(markerIdx >= 0 ? rawUrl.slice(0, markerIdx) : rawUrl);
      const decodedAnchor = markerIdx >= 0 ? decodeMarkdownLinkTarget(rawUrl.slice(markerIdx)) : "";
      const { target, anchor } = markdownLinkTarget(rawUrl);
      result.links.push({
        type: "markdown-link",
        target,
        rawTarget: decodedPath + decodedAnchor,
        anchor: anchor ?? undefined,
        alias: getChildrenText(node) || undefined,
        line: node.position?.start?.line,
      });
    }
    for (const child of node.children ?? []) walk(child, inPiece);
  };
  walk(ast);
  // What of a block read as text is not read (`ReadAsTextParts.unread`) gives no link and no tag: the tag rule over its
  // characters read `#include` in a fence and in a code span as tags the note read whole does not have (review of L14,
  // 2026-11-26) — no tag rather than a wrong one. A paragraph over the inline budget inside a piece gives its tags from
  // the piece's tree, once, as one outside the blocks does from the note's tree.
  if (parts && text !== undefined && parts.pieces.length > 0) {
    // Each piece's links and tags, at its place in the order of the text: the walk lists the tree's in that order.
    const fromTree = result.links.length;
    const places = placesOf(ast, fromTree, blocks);
    forEachReadPiece(text, parts, ast, { preserveObsidianSyntax: true }, (tree) => {
      // The walk and this visit meet the same links in the same order.
      const visit = (node: any): void => {
        if (node.type === "wikiLink" || node.type === "link") places.push(node.position?.start?.offset ?? 0);
        for (const child of node.children ?? []) visit(child);
      };
      visit(tree);
      walk(tree, true);
    });
    if (result.links.length > fromTree) {
      const order = result.links.map((_, i) => i).sort((a, b) => places[a] - places[b] || a - b);
      result.links = order.map((i) => result.links[i]);
    }
  }

  return result;
}

export type FrontmatterLinkOccurrence = {
  propertyKey: string;
  /** Anchor-free target, same semantics as body LinkOccurrence.target. */
  target: string;
  /** Target incl. anchor, excl. alias — same semantics as body links. */
  rawTarget: string;
  anchor?: string;
  alias?: string;
};

// Whole-value wiki link only: relation values are stored as `"[[X]]"` scalars or
// list items. Links embedded in longer text and embeds (`![[..]]`) are NOT
// frontmatter references.
const FRONTMATTER_WIKILINK_RE = /^\s*\[\[([^[\]]+)\]\]\s*$/;

/**
 * Extracts wiki-links from frontmatter property values: string values and string
 * items of list values whose ENTIRE content is one `[[...]]` link. Used by the
 * indexer to record property-scoped link rows (relations, see links.property_key).
 */
export function extractFrontmatterLinks(fm: Record<string, unknown>): FrontmatterLinkOccurrence[] {
  const result: FrontmatterLinkOccurrence[] = [];

  const scan = (propertyKey: string, value: unknown) => {
    if (typeof value !== "string") return;
    const match = FRONTMATTER_WIKILINK_RE.exec(value);
    if (!match) return;
    const inner = match[1];
    const [targetRaw, ...aliasParts] = inner.split("|");
    const { target, anchor } = parseLinkTarget(targetRaw);
    if (!target) return;
    result.push({
      propertyKey,
      target,
      rawTarget: targetRaw.trim(),
      anchor,
      alias: aliasParts.length > 0 ? aliasParts.join("|") : undefined,
    });
  };

  for (const [key, value] of Object.entries(fm)) {
    if (key === PLAINVA_NAMESPACE_KEY) continue;
    if (Array.isArray(value)) {
      for (const item of value) scan(key, item);
    } else {
      scan(key, value);
    }
  }

  return result;
}

function parseLinkTarget(raw: string): { target: string; anchor?: string } {
  raw = raw.trim();
  const hashIdx = raw.indexOf("#");
  const caretIdx = raw.indexOf("^");
  let anchorIdx = -1;
  
  if (hashIdx !== -1 && caretIdx !== -1) anchorIdx = Math.min(hashIdx, caretIdx);
  else if (hashIdx !== -1) anchorIdx = hashIdx;
  else if (caretIdx !== -1) anchorIdx = caretIdx;

  if (anchorIdx !== -1) {
    return {
      target: raw.substring(0, anchorIdx).trim(),
      anchor: raw.substring(anchorIdx).trim()
    };
  }
  return { target: raw };
}

function getChildrenText(node: any): string {
  if (!node.children || node.children.length === 0) return "";
  return node.children.map((c: any) => c.value || "").join("");
}

/** Where each of the first `count` links of the tree starts, in the order the walk above lists them, outside `blocks`. */
function placesOf(ast: MarkdownAst, count: number, blocks: BoundedRange[]): number[] {
  const places: number[] = [];
  const visit = (node: any): void => {
    if (blocks.length > 0 && node.type !== "root" && inRanges(blocks, node.position?.start?.offset)) return;
    if (node.type === "wikiLink" || node.type === "link") places.push(node.position?.start?.offset ?? 0);
    for (const child of node.children ?? []) visit(child);
  };
  visit(ast);
  return places.slice(0, count);
}
