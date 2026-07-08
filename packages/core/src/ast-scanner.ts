import { visit } from "unist-util-visit";
import { MarkdownAst } from "./markdown-ast.js";
import { extractFrontmatter } from "./metadata-extractor.js";
import { PLAINVA_NAMESPACE_KEY } from "./metadata.js";

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
};

export type ExtractedData = {
  tags: TagOccurrence[];
  links: LinkOccurrence[];
};

export function extractLinksAndTags(ast: MarkdownAst): ExtractedData {
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

  // 2. Traverse AST for inline tags and links
  visit(ast as any, (node: any) => {
    if (node.type === "text") {
      // Find tags in text: #tag
      const tagRegex = /(?:^|\s)#([\p{L}\p{N}_/-]+)/gu;
      let match;
      while ((match = tagRegex.exec(node.value)) !== null) {
        const tagName = match[1];
        // Obsidian tags must not be only digits
        if (!/^\d+$/.test(tagName)) {
          result.tags.push({ name: tagName, source: "inline" });
        }
      }
    } else if (node.type === "html") {
      const value = node.value as string;
      if (value.startsWith("![[") && value.endsWith("]]")) {
        const inner = value.slice(3, -2);
        const [targetRaw, ...aliasParts] = inner.split("|");
        const { target, anchor } = parseLinkTarget(targetRaw);
        result.links.push({
          type: "embed",
          target,
          rawTarget: targetRaw.trim(),
          anchor,
          alias: aliasParts.length > 0 ? aliasParts.join("|") : undefined,
        });
      } else if (value.startsWith("[[") && value.endsWith("]]")) {
        const inner = value.slice(2, -2);
        const [targetRaw, ...aliasParts] = inner.split("|");
        const { target, anchor } = parseLinkTarget(targetRaw);
        result.links.push({
          type: "wikilink",
          target,
          rawTarget: targetRaw.trim(),
          anchor,
          alias: aliasParts.length > 0 ? aliasParts.join("|") : undefined,
        });
      }
    } else if (node.type === "link") {
      const decodedUrl = decodeURI(node.url);
      const { target, anchor } = parseLinkTarget(decodedUrl);
      result.links.push({
        type: "markdown-link",
        target,
        rawTarget: decodedUrl,
        anchor,
        alias: getChildrenText(node) || undefined,
      });
    }
  });

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
