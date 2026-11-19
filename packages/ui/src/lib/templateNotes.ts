import { trimEndChars } from "@plainva/core";
import { dailyTemplatePath } from "./dailyNoteCreate";
import { templateFilePath } from "./folderTemplates";

/** What a vault's settings say about its templates — the same in both shells. */
export interface TemplateNoteSettings {
  /** The templates folder; empty means the default, `Templates`. */
  templateFolder: string;
  /** The daily note's template, a name in the templates folder or a vault path; "" = none. */
  dailyTemplate: string;
  /** The meeting note's template, likewise. */
  meetingTemplate: string;
  /** Folder → template rules. */
  folderTemplates: readonly { template: string }[];
  /** Type → template rules. */
  typeTemplates: readonly { template: string }[];
}

const key = (path: string) => path.normalize("NFC").toLowerCase();

/**
 * Which notes of a vault are templates (Fehlerliste 0.9.0, B26): every note in
 * the templates folder, and every template a setting names wherever it lies —
 * the daily note's, the meeting note's, those of the folder and type rules.
 * The index takes a file's name for a title such a note gives with a
 * placeholder (`VaultIndexerOptions.templateNotes`). Paths are compared as
 * the vault names them, without regard to case or Unicode form.
 */
export function templateNotesOf(settings: TemplateNoteSettings): (path: string) => boolean {
  const folder = key(trimEndChars(settings.templateFolder.trim() || "Templates", "/\\"));
  const within = folder ? `${folder}/` : "";
  const named = new Set<string>();
  const add = (path: string) => {
    if (path) named.add(key(path));
  };
  for (const name of [settings.dailyTemplate, settings.meetingTemplate, ...settings.folderTemplates.map((rule) => rule.template), ...settings.typeTemplates.map((rule) => rule.template)]) {
    if (!name?.trim()) continue;
    add(templateFilePath(name, settings.templateFolder));
  }
  add(dailyTemplatePath({ templateFolder: settings.templateFolder || "Templates", template: settings.dailyTemplate }));
  return (path) => {
    const at = key(path);
    return (within !== "" && at.startsWith(within)) || named.has(at);
  };
}

/**
 * Keeps an indexer's `templateNotes` with the settings (B26): on `event` — a
 * save of the settings, in this window or, carried over, in another — the
 * settings are read again and the notes whose title that changes are read
 * again (`VaultIndexer.setTemplateNotes`). `forVault` passes over a save for
 * another vault. Until `signal` ends it.
 */
export function followTemplateNotes(o: {
  indexer: { setTemplateNotes(templateNotes: (path: string) => boolean): Promise<unknown> };
  read: () => Promise<(path: string) => boolean>;
  event: string;
  forVault?: (event: Event) => boolean;
  signal: AbortSignal;
  onError: (error: unknown) => void;
}): void {
  const follow = (event: Event) => {
    if (o.forVault && !o.forVault(event)) return;
    void o.read().then((templateNotes) => o.indexer.setTemplateNotes(templateNotes)).catch(o.onError);
  };
  window.addEventListener(o.event, follow);
  o.signal.addEventListener("abort", () => window.removeEventListener(o.event, follow), { once: true });
}
