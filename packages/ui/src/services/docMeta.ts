import { frontmatterSpan, markdownLinks } from "@plainva/core";
import { parse as parseYaml } from "yaml";
import { getPlainvaMeta, type PlainvaDocMeta } from "@plainva/core";

/**
 * Raw YAML text of the leading frontmatter block, or null when absent. A block
 * without entries (`---` directly on `---`) is a block: its text is "".
 */
export function frontmatterBlockOf(content: string): string | null {
  return frontmatterSpan(content)?.yaml ?? null;
}

/** The document body with a leading frontmatter block removed (and the blank
 * line that followed it), or the content unchanged when there is none. Used
 * when a note becomes an email body so the YAML never leaks into the message. */
export function stripFrontmatter(content: string): string {
  const block = frontmatterSpan(content);
  return block ? content.slice(block.end).replace(/^\r?\n/, "") : content;
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
  for (const part of markdownLinks(content)) {
    if (part.index === 0 || content[part.index - 1] !== "!") continue;
    const target = /^\S+/.exec(part.destination)?.[0];
    if (!target) continue;
    if (!/^[a-z][a-z0-9+.-]*:/i.test(target)) return true;
  }
  return false;
}
