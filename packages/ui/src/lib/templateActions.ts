import { setFrontmatterPath, type IVaultAdapter } from "@plainva/core";
import { addTemplateForAssignment } from "../base/templateFiles";
import { buildNewNoteContent } from "./newNoteContent";

/**
 * Template actions shared by the .base "new template" menu, the command
 * palette (GitHub issue #6: "no 'create template' option in the command
 * menu") and the mobile template sheet. Kept UI-free so every entry point and
 * the tests reuse the same rules.
 *
 * The two settings these need — where templates live and which `type` a new
 * note carries — arrive as VALUES, not as a store lookup: the shells keep
 * different settings models (desktop reads per-vault keys out of the settings
 * store, the phone holds one object per vault), and neither belongs in here.
 */

export type TemplateFsAdapter = Pick<
  IVaultAdapter,
  "exists" | "createDir" | "writeTextFile" | "readTextFile"
>;

/** Ensures the template folder exists; false when it cannot be created. */
async function ensureFolder(adapter: TemplateFsAdapter, folder: string): Promise<boolean> {
  try {
    await adapter.createDir(folder);
    return true;
  } catch {
    return await adapter.exists(folder).catch(() => false);
  }
}

/** First non-colliding "<stem>.md" / "<stem> 2.md" / … path in the folder. */
async function uniqueTemplatePath(
  adapter: TemplateFsAdapter,
  folder: string,
  stem: string,
): Promise<string> {
  let name = stem;
  let n = 2;
  while (await adapter.exists(`${folder}/${name}.md`).catch(() => false)) name = `${stem} ${n++}`;
  return `${folder}/${name}.md`;
}

/**
 * Creates a fresh template in the vault's template folder and returns its
 * path (null when the folder cannot be created). Seeds `# {{title}}` so the
 * template is not blank AND notes created from it inherit their file name as
 * the H1 — {{title}} is interpolated by the new-item flow at creation time.
 * When created FROM a database, `assignTo` starts the template assigned to it
 * (plainva.templateFor, plan Vorlagen-Datenbank-Zuordnung P3): zero friction
 * for the most common case.
 */
export async function createTemplateIn(
  adapter: TemplateFsAdapter,
  opts: { folder: string; noteType: string },
  stem: string,
  assignTo?: { basePath: string; allFilePaths: readonly string[] },
): Promise<string | null> {
  if (!(await ensureFolder(adapter, opts.folder))) return null;
  const path = await uniqueTemplatePath(adapter, opts.folder, stem);
  // A template opts itself out of the Tasks view (`plainva.tasks: false`);
  // applyTemplatePlaceholders strips the marker again for notes created from it.
  let content = setFrontmatterPath(
    buildNewNoteContent(opts.noteType, "{{title}}"),
    ["plainva", "tasks"],
    false,
  );
  if (assignTo) {
    content = addTemplateForAssignment(content, assignTo.basePath, assignTo.allFilePaths).content;
  }
  await adapter.writeTextFile(path, content);
  return path;
}

/**
 * Copies an existing note verbatim into the template folder ("save current
 * note as template"). Name collisions get " 2", " 3", … — the source note is
 * never touched.
 */
export async function saveNoteAsTemplateIn(
  adapter: TemplateFsAdapter,
  folder: string,
  notePath: string,
): Promise<string | null> {
  if (!(await ensureFolder(adapter, folder))) return null;
  const base = notePath.split("/").pop() ?? notePath;
  const stem = base.replace(/\.md$/i, "");
  const path = await uniqueTemplatePath(adapter, folder, stem);
  const raw = await adapter.readTextFile(notePath);
  let content: string;
  try {
    // Mark the saved template as excluded from the Tasks view; the source note
    // is arbitrary, so fall back to a verbatim copy on malformed frontmatter.
    content = setFrontmatterPath(raw, ["plainva", "tasks"], false);
  } catch {
    content = raw;
  }
  await adapter.writeTextFile(path, content);
  return path;
}
