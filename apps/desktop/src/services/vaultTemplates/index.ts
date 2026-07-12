import { getSettingsStore } from "../settingsStore";
import { readDir } from "@tauri-apps/plugin-fs";
import {
  dailyNotesFolderKey,
  templateFolderKey,
  dailyNoteTemplateKey,
} from "../../contexts/VaultContext";
import type { VaultTemplateDefinition } from "@plainva/ui";

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

export { templatePreviewFolders, templatePreviewBases, getVaultTemplates, scaffoldVaultTemplate } from "@plainva/ui";
export type { ScaffoldAdapter } from "@plainva/ui";
export type { VaultTemplateBase, VaultTemplateDefinition, VaultTemplateId, VaultTemplateNote } from "@plainva/ui";


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
  const store = await getSettingsStore();
  if (settings.dailyNotesFolder !== undefined) await store.set(dailyNotesFolderKey(vaultPath), settings.dailyNotesFolder);
  if (settings.templateFolder !== undefined) await store.set(templateFolderKey(vaultPath), settings.templateFolder);
  if (settings.dailyNoteTemplate !== undefined) await store.set(dailyNoteTemplateKey(vaultPath), settings.dailyNoteTemplate);
  await store.save();
}
