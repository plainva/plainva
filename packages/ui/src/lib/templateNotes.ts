import { trimEndChars } from "@plainva/core";
import { isOfferedTemplateName } from "../base/templateFiles";
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
 * Which notes of a vault are templates (Fehlerliste 0.9.0, B26): what the app
 * offers as one — the notes directly in the templates folder, as
 * `listTemplates` lists them — and every template a setting names wherever it
 * lies, in a subfolder too: the daily note's, the meeting note's, those of the
 * folder and type rules. The index takes a file's name for a title such a note
 * gives with a placeholder (`VaultIndexerOptions.templateNotes`).
 *
 * Paths are compared without regard to Unicode form or case: on Windows and
 * macOS `Templates` and `templates` are one folder. The limit of that: under
 * Linux and Android, where they are two, a second folder `templates` beside
 * `Templates` counts as the templates folder too.
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
    if (named.has(at)) return true;
    if (within === "" || !at.startsWith(within)) return false;
    const name = at.slice(within.length);
    return !/[/\\]/.test(name) && isOfferedTemplateName(name);
  };
}

/** The indexer `followTemplateNotes` keeps with the settings. */
export interface TemplateNotesIndexer {
  setTemplateNotes(templateNotes: (path: string) => boolean): Promise<unknown>;
}

/**
 * Keeps an indexer's `templateNotes` with the settings (B26). It listens
 * first and reads after: `first` is the rule to build the indexer with, and a
 * save that comes while it is read or the indexer is built — before `attach` —
 * has the settings read again once the indexer is there, so no save between
 * the reading and the listening is lost until the vault is opened again.
 *
 * On `event` — a save of the settings, in this window or, carried over, in
 * another — the settings are read again and the notes whose title that
 * changes are read again (`VaultIndexer.setTemplateNotes`). Of two readings
 * that come back out of order the later one counts: an earlier answer is
 * dropped. `forVault` passes over a save for another vault. Until `signal`
 * ends it.
 */
export function followTemplateNotes(o: {
  read: () => Promise<(path: string) => boolean>;
  event: string;
  forVault?: (event: Event) => boolean;
  signal: AbortSignal;
  onError: (error: unknown) => void;
}): { first: Promise<(path: string) => boolean>; attach(indexer: TemplateNotesIndexer): void } {
  let indexer: TemplateNotesIndexer | null = null;
  let latest = 0;
  let missed = false;
  const readAgain = (into: TemplateNotesIndexer) => {
    const reading = ++latest;
    void o
      .read()
      .then((templateNotes) => (reading === latest && !o.signal.aborted ? into.setTemplateNotes(templateNotes) : undefined))
      .catch(o.onError);
  };
  const follow = (event: Event) => {
    if (o.forVault && !o.forVault(event)) return;
    if (indexer) readAgain(indexer);
    else missed = true;
  };
  window.addEventListener(o.event, follow);
  o.signal.addEventListener("abort", () => window.removeEventListener(o.event, follow), { once: true });
  const first = o.read();
  return {
    first,
    attach(into) {
      indexer = into;
      if (missed) readAgain(into);
    },
  };
}
