import { parse as parseYaml } from "yaml";
import { getPlainvaMeta, type PlainvaDocMeta } from "@plainva/core";

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

/** Raw YAML text of the leading frontmatter block, or null when absent. */
export function frontmatterBlockOf(content: string): string | null {
  const match = content.match(FM_RE);
  return match ? match[1] : null;
}

/** The document body with a leading frontmatter block removed (and the blank
 * line that followed it), or the content unchanged when there is none. Used
 * when a note becomes an email body so the YAML never leaks into the message. */
export function stripFrontmatter(content: string): string {
  const stripped = content.replace(FM_RE, "");
  return stripped === content ? content : stripped.replace(/^\r?\n/, "");
}

/** The `to:` recipient from a note's frontmatter (a reply-as-note stores the
 * original sender there), trimmed, or null. Never throws. */
export function frontmatterToAddress(content: string): string | null {
  const block = frontmatterBlockOf(content);
  if (!block) return null;
  try {
    const parsed = parseYaml(block);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const to = (parsed as Record<string, unknown>).to;
      if (typeof to === "string" && to.trim()) return to.trim();
    }
  } catch {
    /* malformed frontmatter — no recipient */
  }
  return null;
}

/**
 * Plainva presentation metadata (icon, header color) parsed from a frontmatter
 * block. Never throws — presentation metadata must not break rendering.
 */
export function plainvaMetaFromBlock(block: string | null): PlainvaDocMeta {
  if (!block) return {};
  try {
    const parsed = parseYaml(block);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    return getPlainvaMeta(parsed as Record<string, unknown>);
  } catch {
    return {};
  }
}

export function plainvaMetaFromContent(content: string): PlainvaDocMeta {
  return plainvaMetaFromBlock(frontmatterBlockOf(content));
}
