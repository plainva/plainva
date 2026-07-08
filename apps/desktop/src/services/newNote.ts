import { Store } from "@tauri-apps/plugin-store";
import { ensureOkfFrontmatter } from "@plainva/core";
import {
  STORE_KEY,
  defaultNoteTypeKey,
  dailyNoteTypeKey,
  DEFAULT_NOTE_TYPE,
  DEFAULT_DAILY_NOTE_TYPE,
} from "../contexts/VaultContext";

/**
 * OKF write path for files Plainva creates (Masterplan §9.2, owner decision):
 * every new .md file carries at least `type` + `okf_version`. Existing
 * frontmatter (e.g. from a template) wins — only missing pieces are added.
 */

/** Per-vault configured default `type` for new notes (fallback "Note"). */
export async function getConfiguredNoteType(vaultPath: string): Promise<string> {
  const store = await Store.load(STORE_KEY);
  const value = await store.get<string>(defaultNoteTypeKey(vaultPath));
  return value?.trim() || DEFAULT_NOTE_TYPE;
}

/** Per-vault configured default `type` for daily notes (fallback "Daily Note"). */
export async function getConfiguredDailyNoteType(vaultPath: string): Promise<string> {
  const store = await Store.load(STORE_KEY);
  const value = await store.get<string>(dailyNoteTypeKey(vaultPath));
  return value?.trim() || DEFAULT_DAILY_NOTE_TYPE;
}

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
