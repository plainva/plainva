import { parse as parseYaml } from "yaml";
import { getPlainvaMeta, type PlainvaDocMeta } from "@plainva/core";

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

/** Raw YAML text of the leading frontmatter block, or null when absent. */
export function frontmatterBlockOf(content: string): string | null {
  const match = content.match(FM_RE);
  return match ? match[1] : null;
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
