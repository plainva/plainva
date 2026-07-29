import type { IVaultAdapter } from "@plainva/core";
import {
  buildNewNoteContent,
  parseFolderTemplateRules,
  parseTypeTemplateRules,
  resolveTemplateForNewNote,
  withOkfDefaults,
  type FolderTemplateRule,
  type TypeTemplateRule,
} from "@plainva/ui";
import i18n from "@plainva/ui/i18n";
import { getSettingsStore } from "./settingsStore";
import { folderTemplatesKey, typeTemplatesKey, templateFolderKey } from "../contexts/VaultContext";
import { getConfiguredNoteType } from "./newNote";
import { makeDailyLinkProvider } from "./dailyNotes";
import { applyTemplateInteractive, withShellContext } from "./templateInteractive";

/**
 * What a new note starts from (plan Vorlagen-Engine, P4/P4b).
 *
 * Every place a PERSON creates a note — the file tree, the "+ New" button, the
 * command palette, the quick switcher — comes through here, so a folder rule
 * cannot apply in one of them and not in the other. The background paths keep
 * their own headless builders; a rule that opened a dialog inside a sync cycle
 * would be worse than no rule at all.
 */

export interface TemplateRules {
  folders: FolderTemplateRule[];
  types: TypeTemplateRule[];
}

export async function getTemplateRules(vaultPath: string): Promise<TemplateRules> {
  const store = await getSettingsStore();
  return {
    folders: parseFolderTemplateRules(await store.get(folderTemplatesKey(vaultPath))),
    types: parseTypeTemplateRules(await store.get(typeTemplatesKey(vaultPath))),
  };
}

export async function saveTemplateRules(vaultPath: string, rules: TemplateRules): Promise<void> {
  const store = await getSettingsStore();
  await store.set(folderTemplatesKey(vaultPath), rules.folders);
  await store.set(typeTemplatesKey(vaultPath), rules.types);
  await store.save();
}

/** Vault-relative path of a template file named in a rule or picked by hand. */
export async function resolveTemplatePath(vaultPath: string, name: string): Promise<string> {
  const trimmed = name.trim().replace(/^[/\\]+/, "");
  if (!trimmed) return "";
  // A rule may name the file alone ("Projekt.md") or its full vault path; the
  // settings surface offers the templates folder, so the bare name is the
  // normal case and the full path is what a hand-edited profile might carry.
  // A missing extension is completed — Plainva templates are markdown files,
  // so "Projekt" can only mean one thing.
  const named = /\.[a-z0-9]+$/i.test(trimmed) ? trimmed : `${trimmed}.md`;
  if (named.includes("/")) return named;
  const store = await getSettingsStore();
  const folder = ((await store.get<string>(templateFolderKey(vaultPath))) || "Templates").replace(/[/\\]+$/, "");
  return folder ? `${folder}/${named}` : named;
}

export interface NewNoteContent {
  /** Full file content, OKF frontmatter included. */
  content: string;
  /** Caret offset in that content from `{{cursor}}`, or null. */
  caret: number | null;
  /** Template the content came from — null when the note starts blank. */
  templatePath: string | null;
}

export interface NewNoteRequest {
  vaultPath: string;
  adapter: IVaultAdapter;
  /** Vault-relative target folder; `""` is the vault root. */
  folder: string;
  /** Note name without extension — becomes `{{title}}` and the H1. */
  title: string;
  /**
   * Template chosen explicitly ("New note from template…"). It beats every
   * rule: someone who picks one has already answered the question the rules
   * exist to answer.
   */
  explicitTemplate?: string | null;
}

/**
 * Builds the content for a new note.
 *
 * Returns `null` when the person cancelled the template's questions — the
 * caller then creates nothing at all, rather than a note with empty answers.
 */
export async function buildNewNoteFromTemplate(req: NewNoteRequest): Promise<NewNoteContent | null> {
  const { vaultPath, adapter, folder, title } = req;
  const type = await getConfiguredNoteType(vaultPath);

  let name = req.explicitTemplate?.trim() || "";
  if (!name) {
    const rules = await getTemplateRules(vaultPath);
    name = resolveTemplateForNewNote(rules.folders, rules.types, folder, type) ?? "";
  }

  const templatePath = name ? await resolveTemplatePath(vaultPath, name) : "";
  // A rule pointing at a template that has since been renamed or deleted must
  // not stop the note from being created — it falls back to a blank one.
  if (!templatePath || !(await adapter.exists(templatePath))) {
    return { content: buildNewNoteContent(type, title), caret: null, templatePath: null };
  }

  const raw = await adapter.readTextFile(templatePath);
  const now = new Date();
  const answered = await applyTemplateInteractive(
    raw,
    await withShellContext(raw, {
      title,
      now,
      folder,
      vaultName: vaultPath.split(/[/\\]/).filter(Boolean).pop() ?? "",
      dailyLink: await makeDailyLinkProvider(vaultPath, now),
    }),
    i18n.t("templatePicker.answersTitle", { defaultValue: "Angaben für die Vorlage" })
  );
  if (!answered) return null;

  // `{{cursor}}` is measured in the template body; OKF frontmatter may be
  // prepended, so the offset shifts by however much grew in front.
  const bodyLength = answered.text.length;
  const content = withOkfDefaults(answered.text, type);
  const caret = answered.cursor === null ? null : answered.cursor + (content.length - bodyLength);
  return { content, caret, templatePath };
}
