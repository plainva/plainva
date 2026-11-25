import { getSettingsStore } from "../settingsStore";
import { vaultFeaturesSaved } from "../vaultFeaturesRelay";
import { readDir, readTextFile } from "@tauri-apps/plugin-fs";
import { isSystemJunkName } from "@plainva/core";
import {
  dailyNotesFolderKey,
  templateFolderKey,
  dailyNoteTemplateKey,
  taskDatabaseKey,
  folderTemplatesKey,
} from "../../contexts/VaultContext";
import { scaffoldObstacle, type ScaffoldPlan, type VaultTemplateDefinition } from "@plainva/ui";
import { trimEndChars } from "@plainva/core";

/**
 * Vault structure templates for the "Create New Vault" chooser (Gesamtplan
 * 2026-07-04, Masterplan §5.6): optional one-click scaffolds — a starting
 * point, never a prescription. Folder/file NAMES follow the app language
 * (maintainer decision); `type` VALUES stay at the app defaults so notes
 * created later match the scaffolded ones.
 *
 * OKF: every scaffolded note gets `type` via `ensureOkfFrontmatter`; every
 * folder gets a Plainva-managed `index.md` (frontmatter-free — only the bundle
 * root declares `okf_version`), which also
 * switches on the index.md auto-updater for the new vault.
 *
 * One template module per language (templates.<code>.ts); languages without
 * their own module fall back to English.
 */

export { templatePreviewFolders, templatePreviewBases, getVaultTemplates, getTourTemplate, scaffoldVaultTemplate } from "@plainva/ui";
export type { ScaffoldAdapter } from "@plainva/ui";
export type { VaultTemplateBase, VaultTemplateDefinition, VaultTemplateId, VaultTemplateNote } from "@plainva/ui";


/** Whether Plainva knows `absolutePath` as a vault: a recent one, or one it set up. Unreadable settings: known. */
async function isKnownVaultFolder(absolutePath: string): Promise<boolean> {
  try {
    const store = await getSettingsStore();
    const known = [...(await store.get<string[]>("recentVaults") ?? []), ...(await store.get<string[]>("initializedVaultPaths") ?? [])];
    const normalize = (path: string) => trimEndChars(path.replace(/\\/g, "/"), "/").toLowerCase();
    return known.some(path => normalize(path) === normalize(absolutePath));
  } catch {
    // silent: settings that cannot be read are not evidence of an unknown folder — the folder counts as known
    return true;
  }
}

/** Emptiness check before scaffolding (absolute path — the vault is not open yet). */
export async function isVaultFolderEmpty(absolutePath: string): Promise<boolean> {
  try {
    if (await isKnownVaultFolder(absolutePath)) return false;
    const entries = await readDir(absolutePath);
    // OS junk does not count as "the folder already has content" (the core's
    // one list, E10).
    return entries.every((e) => isSystemJunkName(e.name ?? ""));
  } catch {
    // An unreadable destination is not evidence of an empty folder.
    return false;
  }
}

/**
 * Whether `plan` may be written into `absolutePath` (fourth review of O8): an
 * unknown folder that is empty, or holds nothing but what a failed attempt of
 * the same plan left — files with exactly the text it writes, in folders it
 * makes (`scaffoldObstacle`). A retry then goes through where a take-back
 * could not remove everything.
 */
export async function isVaultFolderFreeFor(absolutePath: string, plan: ScaffoldPlan): Promise<boolean> {
  try {
    if (await isKnownVaultFolder(absolutePath)) return false;
    const at = (rel = "") => (rel ? `${absolutePath}/${rel}` : absolutePath);
    const reader = {
      listDir: async (rel?: string) => (await readDir(at(rel))).map((e) => ({ name: e.name ?? "", isDirectory: e.isDirectory })),
      readTextFile: (rel: string) => readTextFile(at(rel)),
    };
    return (await scaffoldObstacle(reader, plan)) === null;
  } catch {
    // An unreadable destination is not evidence of an empty folder.
    return false;
  }
}

/**
 * Wires the scaffolded structure into the vault's per-vault settings. Only the
 * keys a template actually defines are written: the Journal template sets the
 * full daily-notes trio, ACE sets only the folder (its Calendar is where dated
 * notes belong), the database templates set only `templateFolder` so
 * their `.base` "Neu" button and the editor's template picker find the shipped
 * note templates, and a template that ships a task database also points the
 * Tasks view at it (`taskDatabase`), so its database section is populated from
 * the first launch instead of asking the user to pick one.
 */
export async function applyVaultTemplateSettings(
  vaultPath: string,
  template: VaultTemplateDefinition | null
): Promise<void> {
  const settings = template?.settings;
  if (!settings) return;
  const store = await getSettingsStore();
  if (settings.dailyNotesFolder !== undefined) await store.set(dailyNotesFolderKey(vaultPath), settings.dailyNotesFolder);
  if (settings.templateFolder !== undefined) await store.set(templateFolderKey(vaultPath), settings.templateFolder);
  if (settings.dailyNoteTemplate !== undefined) await store.set(dailyNoteTemplateKey(vaultPath), settings.dailyNoteTemplate);
  if (settings.taskDatabase !== undefined) await store.set(taskDatabaseKey(vaultPath), settings.taskDatabase);
  if (settings.folderTemplates !== undefined) await store.set(folderTemplatesKey(vaultPath), settings.folderTemplates);
  await store.save();
  // A vault already open in another window reads its templates again.
  vaultFeaturesSaved(vaultPath);
}
