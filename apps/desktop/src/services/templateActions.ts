import {
  createTemplateIn,
  saveNoteAsTemplateIn,
  type TemplateFsAdapter as SharedTemplateFsAdapter,
} from "@plainva/ui";
import { getTemplateFolder } from "./newItemFlow";
import { getConfiguredNoteType } from "./newNote";

/**
 * Desktop wiring for the shared template actions.
 *
 * The rules themselves live in `@plainva/ui` (lib/templateActions) so the
 * phone can offer the same two entry points; this file is only the part that
 * reads the two per-vault settings out of the DESKTOP settings store. The
 * unchanged tests next to it are the proof that lifting changed no behaviour.
 */

type TemplateFsAdapter = SharedTemplateFsAdapter;

/** Creates a fresh template in the vault's template folder; null on failure. */
export async function createNewTemplate(
  adapter: TemplateFsAdapter,
  vaultPath: string,
  stem: string,
  assignTo?: { basePath: string; allFilePaths: readonly string[] }
): Promise<string | null> {
  const folder = await getTemplateFolder(vaultPath);
  const noteType = await getConfiguredNoteType(vaultPath);
  return createTemplateIn(adapter, { folder, noteType }, stem, assignTo);
}

/** Copies an existing note verbatim into the template folder; null on failure. */
export async function saveNoteAsTemplate(
  adapter: TemplateFsAdapter,
  vaultPath: string,
  notePath: string
): Promise<string | null> {
  const folder = await getTemplateFolder(vaultPath);
  return saveNoteAsTemplateIn(adapter, folder, notePath);
}
