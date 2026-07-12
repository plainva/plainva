import { ensureOkfFrontmatter, generateIndexContent, upsertFrontmatterKeys } from "@plainva/core";
import { serializeBaseConfig } from "../base/baseFormat";
import type { VaultTemplateDefinition, VaultTemplateNote } from "./types";

/**
 * Shared vault-template scaffolder (M3E package I): the desktop's adapter-
 * abstracted writer, lifted so the mobile shell scaffolds the same starting
 * structures through its own adapter chain. Never overwrites an existing
 * file — scaffolding into a non-empty folder only fills the gaps; generated
 * listings are byte-identical to the index.md auto-updater's output.
 */

/** OKF type of scaffolded notes without an explicit one (desktop default). */
export const DEFAULT_SCAFFOLD_NOTE_TYPE = "Note";

/** The minimal adapter surface the scaffolder needs (subset of IVaultAdapter). */
export interface ScaffoldAdapter {
  exists(path: string): Promise<boolean>;
  createDir(path: string): Promise<void>;
  writeTextFile(path: string, content: string): Promise<void>;
}

/** Frontmatter (description + typed properties + OKF type/okf_version) for a
 * scaffolded note. Description and properties are YAML-encoded via the surgical
 * writer (safe for wiki-links, lists, umlauts); OKF defaults are added on top. */
export function buildTemplateNoteContent(note: VaultTemplateNote): string {
  let content = note.body;
  const fm: Record<string, unknown> = {};
  if (note.description) fm.description = note.description;
  if (note.properties) Object.assign(fm, note.properties);
  if (Object.keys(fm).length > 0) content = upsertFrontmatterKeys(content, fm);
  return ensureOkfFrontmatter(content, { type: note.type ?? DEFAULT_SCAFFOLD_NOTE_TYPE }).content;
}

/**
 * Writes the template structure (or, with `template: null`, just the bundle
 * root index.md) into the vault folder.
 */
export async function scaffoldVaultTemplate(opts: {
  adapter: ScaffoldAdapter;
  template: VaultTemplateDefinition | null;
  /** Heading of the root index.md (the vault folder's name). */
  vaultName: string;
  /** Localized heading of the subfolder sections (i18n `indexMd.subfoldersHeading`). */
  subfoldersHeading: string;
}): Promise<void> {
  const { adapter, template, vaultName, subfoldersHeading } = opts;
  const folders = template?.folders ?? [];
  const notes = template?.notes ?? [];
  const bases = template?.bases ?? [];

  for (const folder of folders) {
    if (!(await adapter.exists(folder))) await adapter.createDir(folder);
  }

  for (const note of notes) {
    if (await adapter.exists(note.path)) continue;
    await adapter.writeTextFile(note.path, buildTemplateNoteContent(note));
  }

  // `.base` databases: serialized to Obsidian-native YAML, byte-identical to
  // an app save. `.base` files are not notes, so they never appear in the
  // index.md listings below. Never overwrite.
  for (const base of bases) {
    if (await adapter.exists(base.path)) continue;
    await adapter.writeTextFile(base.path, serializeBaseConfig(base.config));
  }

  // Managed index.md for the bundle root and every template folder (SPEC §11:
  // only the root carries okf_version; all listings get the managed marker).
  for (const folder of ["", ...folders]) {
    const indexPath = folder ? `${folder}/index.md` : "index.md";
    if (await adapter.exists(indexPath)) continue;

    const prefix = folder ? `${folder}/` : "";
    const files = notes
      .filter((n) => n.path.startsWith(prefix) && !n.path.slice(prefix.length).includes("/"))
      .map((n) => ({ path: n.path, description: n.description }));
    const subfolders = folders
      .filter((f) => f !== folder && f.startsWith(prefix) && !f.slice(prefix.length).includes("/"))
      // Every template folder gets its own managed index.md (loop above), so
      // each listed subfolder always has one to link to (Issue #9).
      .map((f) => ({ name: f.slice(prefix.length), hasIndex: true }));

    const content = generateIndexContent({
      folder,
      heading: folder ? folder.split("/").pop()! : vaultName,
      files,
      subfolders,
      subfoldersHeading,
      bundleRoot: folder === "",
      managedMarker: true,
    });
    await adapter.writeTextFile(indexPath, content);
  }
}
