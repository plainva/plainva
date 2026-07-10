import { ensureOkfFrontmatter, generateIndexContent, upsertFrontmatterKeys } from "@plainva/core";
import { Store } from "@tauri-apps/plugin-store";
import { readDir } from "@tauri-apps/plugin-fs";
import {
  STORE_KEY,
  dailyNotesFolderKey,
  templateFolderKey,
  dailyNoteTemplateKey,
  DEFAULT_NOTE_TYPE,
} from "../../contexts/VaultContext";
import { serializeBaseConfig } from "../baseFormat";
import { matchAppLanguage } from "@plainva/ui";
import type { VaultTemplateDefinition, VaultTemplateNote } from "./types";
import { templates as templatesDe } from "./templates.de";
import { templates as templatesEn } from "./templates.en";
import { templates as templatesEs } from "./templates.es";
import { templates as templatesFr } from "./templates.fr";
import { templates as templatesIt } from "./templates.it";
import { templates as templatesJa } from "./templates.ja";
import { templates as templatesNl } from "./templates.nl";
import { templates as templatesPl } from "./templates.pl";
import { templates as templatesPtBr } from "./templates.pt-BR";
import { templates as templatesZhCn } from "./templates.zh-CN";

/**
 * Vault structure templates for the "Create New Vault" chooser (Gesamtplan
 * 2026-07-04, Masterplan §5.6): optional one-click scaffolds — a starting
 * point, never a prescription. Folder/file NAMES follow the app language
 * (maintainer decision); `type` VALUES stay at the app defaults so notes
 * created later match the scaffolded ones.
 *
 * OKF (SPEC v0.1): every scaffolded note gets `type` + `okf_version` via
 * `ensureOkfFrontmatter`; every folder gets a Plainva-managed `index.md`
 * (frontmatter-free — only the bundle root declares `okf_version`), which also
 * switches on the index.md auto-updater for the new vault.
 *
 * One template module per language (templates.<code>.ts); languages without
 * their own module fall back to English.
 */

export { templatePreviewFolders, templatePreviewBases } from "./types";
export type { VaultTemplateBase, VaultTemplateDefinition, VaultTemplateId, VaultTemplateNote } from "./types";

const TEMPLATES_BY_LANGUAGE: Record<string, () => VaultTemplateDefinition[]> = {
  de: templatesDe,
  en: templatesEn,
  es: templatesEs,
  fr: templatesFr,
  it: templatesIt,
  ja: templatesJa,
  nl: templatesNl,
  pl: templatesPl,
  "pt-BR": templatesPtBr,
  "zh-CN": templatesZhCn,
};

/** Localized template set — folder/file names follow the app language. */
export function getVaultTemplates(language: string): VaultTemplateDefinition[] {
  const set = TEMPLATES_BY_LANGUAGE[matchAppLanguage(language)];
  return (set ?? templatesEn)();
}

/** Frontmatter (description + typed properties + OKF type/okf_version) for a
 * scaffolded note. Description and properties are YAML-encoded via the surgical
 * writer (safe for wiki-links, lists, umlauts); OKF defaults are added on top. */
function buildTemplateNoteContent(note: VaultTemplateNote): string {
  let content = note.body;
  const fm: Record<string, unknown> = {};
  if (note.description) fm.description = note.description;
  if (note.properties) Object.assign(fm, note.properties);
  if (Object.keys(fm).length > 0) content = upsertFrontmatterKeys(content, fm);
  return ensureOkfFrontmatter(content, { type: note.type ?? DEFAULT_NOTE_TYPE }).content;
}

/** The minimal adapter surface the scaffolder needs (subset of IVaultAdapter). */
export interface ScaffoldAdapter {
  exists(path: string): Promise<boolean>;
  createDir(path: string): Promise<void>;
  writeTextFile(path: string, content: string): Promise<void>;
}

/**
 * Writes the template structure (or, with `template: null`, just the bundle
 * root index.md) into the vault folder. Never overwrites an existing file —
 * scaffolding into a non-empty folder only fills the gaps. The generated
 * listings match what the index.md auto-updater would produce (same heading
 * rules, titles fall back to the basename, descriptions come from the notes'
 * `description` frontmatter), so the first auto-update rewrites nothing.
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

  // `.base` databases (Gesamtplan DB-Vorlagen 2026-07-04): serialized to
  // Obsidian-native YAML, byte-identical to an app save. `.base` files are not
  // notes, so they never appear in the index.md listings below. Never overwrite.
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
      .map((name) => ({ name: name.slice(prefix.length) }));

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

/** OS junk that must not count as "the folder already has content". */
const OS_JUNK_NAMES = new Set([".ds_store", "thumbs.db", "desktop.ini"]);

/** Emptiness check before scaffolding (absolute path — the vault is not open yet). */
export async function isVaultFolderEmpty(absolutePath: string): Promise<boolean> {
  try {
    const entries = await readDir(absolutePath);
    return entries.every((e) => OS_JUNK_NAMES.has((e.name ?? "").toLowerCase()));
  } catch {
    // Unreadable/nonexistent — adapter.initialize() will create it.
    return true;
  }
}

/**
 * Wires the scaffolded structure into the vault's per-vault settings. Only the
 * keys a template actually defines are written: the Journal template sets the
 * full daily-notes trio, the database templates set only `templateFolder` so
 * their `.base` "Neu" button and the editor's template picker find the shipped
 * note templates.
 */
export async function applyVaultTemplateSettings(
  vaultPath: string,
  template: VaultTemplateDefinition | null
): Promise<void> {
  const settings = template?.settings;
  if (!settings) return;
  const store = await Store.load(STORE_KEY);
  if (settings.dailyNotesFolder !== undefined) await store.set(dailyNotesFolderKey(vaultPath), settings.dailyNotesFolder);
  if (settings.templateFolder !== undefined) await store.set(templateFolderKey(vaultPath), settings.templateFolder);
  if (settings.dailyNoteTemplate !== undefined) await store.set(dailyNoteTemplateKey(vaultPath), settings.dailyNoteTemplate);
  await store.save();
}
