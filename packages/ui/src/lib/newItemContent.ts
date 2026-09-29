import { parseMarkdownAst, extractFrontmatter, upsertFrontmatterKeys } from "@plainva/core";
import { applyTemplatePlaceholders } from "../base/templateFiles";
import { withOkfDefaults } from "./newNoteContent";

/**
 * How a freshly created note is assembled — shared by both shells (S23).
 *
 * The desktop built this here, the phone rebuilt the OKF frontmatter with a
 * template literal of its own. Two spellings of "what a new note looks like"
 * is exactly the divergence this package exists to remove: the literal wrote
 * `type` and `okf_version` unconditionally, so a template that already carried
 * a `type` silently got a second, contradictory one.
 *
 * Pure: no I/O, no settings, no React. The caller supplies the template text
 * it read and the configured note type.
 */

/**
 * Initial content of a new item: template (placeholders applied) or a bare H1,
 * OKF frontmatter defaults (template keys win — the OKF write path only adds
 * what is missing), inherited source tags merged with the template's, and
 * filter pre-fills (an existing template key always wins).
 */
export function buildNewItemContent(opts: {
  templateText: string | null;
  noteType: string;
  title: string;
  inheritTags: string[];
  prefills: Record<string, unknown>;
}): string {
  // Without a template the item starts with an H1 so the caret target is
  // visible (maintainer, 2026-07-04); a template fully defines the body.
  const base =
    opts.templateText != null ? applyTemplatePlaceholders(opts.templateText, opts.title) : `# ${opts.title}\n`;
  return finalizeItemContent(base, opts.noteType, opts.inheritTags, opts.prefills);
}

/**
 * OKF defaults, inherited tags and pre-fills on top of a body — the shared
 * tail of every "new item" builder. Exported for the pinboard entry
 * (`planPinboardEntry`), whose body is either empty or a template the shell
 * has already resolved with its questions.
 */
export function finalizeItemContent(
  base: string,
  noteType: string,
  inheritTags: string[],
  prefills: Record<string, unknown>
): string {
  const content = withOkfDefaults(base, noteType);
  let existing: Record<string, unknown> = {};
  try {
    const fm = extractFrontmatter(parseMarkdownAst(content));
    existing = fm.success && fm.data ? (fm.data as Record<string, unknown>) : {};
  } catch {
    /* unparseable template frontmatter — pre-fill on top of nothing */
  }
  const updates: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(prefills)) {
    if (existing[k] === undefined) updates[k] = v;
  }
  if (inheritTags.length > 0) {
    const prev = existing.tags;
    const prevList = Array.isArray(prev) ? prev.map(String) : prev != null && prev !== "" ? [String(prev)] : [];
    const merged = [...prevList];
    for (const tag of inheritTags) if (!merged.includes(tag)) merged.push(tag);
    if (prev === undefined || merged.length !== prevList.length) updates.tags = merged;
  }
  try {
    return Object.keys(updates).length > 0 ? upsertFrontmatterKeys(content, updates) : content;
  } catch {
    return content;
  }
}
