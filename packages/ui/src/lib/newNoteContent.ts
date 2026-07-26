import { ensureOkfFrontmatter } from "@plainva/core";

/**
 * OKF write path for freshly created note content (Masterplan §9.2). Extracted
 * from the desktop's `services/newNote.ts` (feinplan G0.1) because the shared
 * mail code builds notes too; the settings-dependent parts of that module
 * (per-vault default `type`) stay in the shell.
 */

/**
 * Ensures OKF minimum frontmatter on freshly created content. A template with
 * unparseable frontmatter must not block note creation — the content is then
 * returned unchanged (the conversion wizard is the place to repair files).
 */
export function withOkfDefaults(content: string, type: string): string {
  try {
    return ensureOkfFrontmatter(content, { type }).content;
  } catch {
    return content;
  }
}

/**
 * Initial content for a brand-new note: OKF frontmatter plus an H1 with the
 * note's name so the caret target is visible (maintainer, 2026-07-04). Callers
 * that intentionally start blank (e.g. template scaffolds) omit `title`.
 */
export function buildNewNoteContent(type: string, title?: string): string {
  const heading = title?.trim();
  return withOkfDefaults(heading ? `# ${heading}\n` : "", type);
}
