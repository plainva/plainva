import {
  addTemplateForAssignment,
  createTemplateIn,
  listTemplatesScoped,
  removeTemplateForAssignment,
  type ScopedTemplateItem,
} from "@plainva/ui";
import { getMobileSettings } from "./mobileSettings";
import { configuredNoteType } from "./newNote";
import { syncSoon } from "./syncService";
import { vaultOps, type MobileVault } from "./vaultService";

/**
 * Which templates belong to which database on the phone (parity
 * `base-template-assignment`): the reads and the one write behind the
 * Templates sheet of a database and the target-databases sheet of a template.
 * The rules — what an assignment is written as, what matches a database, how
 * the templates are grouped — are the shared ones (`templateFiles`).
 */

/** The vault's template folder as this device keeps it. */
export function mobileTemplateFolder(): string {
  return getMobileSettings().templateFolder || "Templates";
}

/** The templates with the databases each one is assigned to (an unreadable template counts as unassigned). */
export async function loadScopedTemplates(v: MobileVault): Promise<{ folder: string; items: ScopedTemplateItem[] }> {
  const folder = mobileTemplateFolder();
  return { folder, items: await listTemplatesScoped(v.files, folder) };
}

/** Every file of the vault, which decides how an assignment is written (a bare name or a qualified path). */
async function vaultFilePaths(v: MobileVault): Promise<string[]> {
  const rows = (await v.queryService?.db.query<{ path: string }>("SELECT path FROM files")) ?? [];
  return rows.map((r) => r.path);
}

/**
 * Writes or takes away ONE `plainva.templateFor` entry of a template. The change
 * runs on the template as it lies there. A template whose properties block
 * cannot be written throws the reason — the caller says it. Answers whether the
 * template changed.
 */
export async function setTemplateAssignment(v: MobileVault, templatePath: string, basePath: string, assign: boolean): Promise<boolean> {
  const paths = assign ? await vaultFilePaths(v) : [];
  const update = await vaultOps.update(v, templatePath, (content) => {
    const result = assign ? addTemplateForAssignment(content, basePath, paths) : removeTemplateForAssignment(content, basePath);
    return result.changed ? result.content : null;
  });
  if (update.changed) syncSoon();
  return update.changed;
}

/** Creates a fresh template in the vault's template folder, already assigned to `basePath`. */
export async function createTemplateForBase(v: MobileVault, basePath: string, stem: string): Promise<string> {
  const allFilePaths = await vaultFilePaths(v);
  const created = await createTemplateIn(
    v.files,
    { folder: mobileTemplateFolder(), noteType: configuredNoteType() },
    stem,
    { basePath, allFilePaths },
  );
  if (v.indexer) await v.reindexPaths([created]);
  window.dispatchEvent(new CustomEvent("m-vault-changed"));
  syncSoon();
  return created;
}
