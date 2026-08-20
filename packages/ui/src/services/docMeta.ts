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

/**
 * True when the body references vault-relative attachments that a standalone
 * .md copy will not carry along: wiki embeds (`![[…]]`) or MD images whose
 * target is neither an absolute URL nor a data URI.
 *
 * Shared because both shells export a note out of the vault and owe the same
 * honest warning about what the copy leaves behind.
 */
export function referencesRelativeAttachments(content: string): boolean {
  if (/!\[\[/.test(content)) return true;
  const mdImage = /!\[[^\]]*\]\(([^)\s]+)[^)]*\)/g;
  let m: RegExpExecArray | null;
  while ((m = mdImage.exec(content)) !== null) {
    const target = m[1].trim();
    if (!/^[a-z][a-z0-9+.-]*:/i.test(target)) return true;
  }
  return false;
}
