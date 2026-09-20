import { ensureDailyNote, noteStamp, setPendingTemplateCaret, type DailyNoteCreateConfig, type DailyNoteFiles } from "@plainva/ui";
import { getSettingsStore } from "./settingsStore";
import { appConfirm } from "./appDialogs";
import {
  dailyNotesFolderKey,
  dailyNotesFormatKey,
  templateFolderKey,
  dailyNoteTemplateKey,
  dailyNoteTypeKey,
  DEFAULT_DAILY_NOTE_TYPE,
} from "../contexts/VaultContext";
import { buildDailyNotePath, existingDailyNoteDays, parseDailyNoteDate } from "@plainva/ui";

export { buildDailyNotePath };

/**
 * Returns the date a note path represents if it is the vault's daily note for
 * that day, else null. Reads the vault's configured daily-notes folder + format
 * (same source as {@link listExistingDailyNotes}) and delegates the pure match
 * to {@link parseDailyNoteDate}. Used to highlight the open daily note in the
 * calendar (with precedence over "today").
 */
export async function resolveActiveDailyNoteDate(path: string | null, vaultPath: string): Promise<Date | null> {
  if (!path || !vaultPath) return null;
  const store = await getSettingsStore();
  const folder = (await store.get<string>(dailyNotesFolderKey(vaultPath))) || "";
  const rawFormat = (await store.get<string>(dailyNotesFormatKey(vaultPath))) || "YYYY-MM-DD";
  return parseDailyNoteDate(path, rawFormat, folder);
}

/**
 * Returns the set of local-date keys (YYYY-MM-DD) from `dates` that already have
 * a daily note on disk. Format-agnostic: it forward-builds the expected path for
 * each date with the vault's configured folder + format and checks existence, so
 * it matches however notes are actually created. Used to dot calendar days.
 */
export async function listExistingDailyNotes(
  dates: Date[],
  opts: { vaultPath: string; adapter: Pick<DailyNoteAdapter, "exists"> },
): Promise<Set<string>> {
  const store = await getSettingsStore();
  const folder = (await store.get<string>(dailyNotesFolderKey(opts.vaultPath))) || "";
  const rawFormat = (await store.get<string>(dailyNotesFormatKey(opts.vaultPath))) || "YYYY-MM-DD";
  // The rule itself lives in packages/ui since the Build-91 feedback round
  // (P4): the phone's Today card and month grid run the same one.
  return existingDailyNoteDays(dates, { folder, format: rawFormat }, (p) => opts.adapter.exists(p));
}

// Minimal adapter surface the daily-note logic needs (subset of IVaultAdapter).
export interface DailyNoteAdapter {
  exists(path: string): Promise<boolean>;
  createDir(path: string): Promise<void>;
  writeTextFile(path: string, content: string): Promise<void>;
  readTextFile(path: string): Promise<string>;
}

export interface DailyNoteOptions {
  vaultPath: string;
  adapter: DailyNoteAdapter;
  /** Re-index callback run after a new note is created. */
  /** Re-index after creating the note; the result (a scan report) is not used. */
  onIndex: () => Promise<unknown>;
  /** Ask the user before creating a missing note (calendar uses this; the
   *  "today" button does not). */
  confirmCreate: boolean;
  /** Localized confirm message for the create dialog. */
  confirmMessage?: (path: string) => string;
  /** Localized title for the create dialog. */
  confirmTitle?: string;
  /** Fired once when the note was actually created (index.md auto-update). */
  onCreated?: (path: string) => void;
  /**
   * Resolves the template interactively — asks the questions it contains and
   * returns the finished text plus the caret offset, or null when the user
   * cancels. Injected so this service stays UI-free; without it the template
   * is applied headless (the background behaviour). Plan Vorlagen-Engine, P3.
   */
  resolveTemplate?: (raw: string, ctx: { title: string; now: Date; folder: string }) =>
    Promise<{ text: string; cursor: number | null } | null>;
}

export { noteStamp };

/**
 * Resolver for `{{daily+1}}` / `{{daily-1}}` (plan Vorlagen-Engine, E6): the
 * PATH of the daily note that many days from the reference instant. The
 * template engine wraps it into the wiki link, so `{{daily+1:tomorrow}}` can
 * give that link a label.
 *
 * The settings are read ONCE and handed back as a plain function, because the
 * template engine resolves tokens synchronously — and a template may well name
 * several days.
 *
 * The path carries the folder when there is one. A bare `2026-07-30` would be
 * ambiguous the moment any other note in the vault has that name, and a daily
 * note's name is a date — exactly the kind that repeats.
 */
export async function makeDailyPathProvider(
  vaultPath: string,
  now: Date
): Promise<(offset: number) => string> {
  const store = await getSettingsStore();
  const folder = (await store.get<string>(dailyNotesFolderKey(vaultPath))) || "";
  const rawFormat = (await store.get<string>(dailyNotesFormatKey(vaultPath))) || "YYYY-MM-DD";
  return (offset: number) => {
    const when = new Date(now);
    when.setDate(when.getDate() + offset);
    const { fullPath } = buildDailyNotePath(when, rawFormat, folder);
    return fullPath.replace(/\.md$/i, "");
  };
}

/** The vault's daily-note settings, in the shape the shared building block takes. */
export async function readDailyNoteConfig(vaultPath: string): Promise<DailyNoteCreateConfig> {
  const store = await getSettingsStore();
  return {
    folder: (await store.get<string>(dailyNotesFolderKey(vaultPath))) || "",
    format: (await store.get<string>(dailyNotesFormatKey(vaultPath))) || "YYYY-MM-DD",
    templateFolder: (await store.get<string>(templateFolderKey(vaultPath))) || "Templates",
    template: (await store.get<string>(dailyNoteTemplateKey(vaultPath))) || "",
    noteType: (await store.get<string>(dailyNoteTypeKey(vaultPath)))?.trim() || DEFAULT_DAILY_NOTE_TYPE,
  };
}

/** Writes a new note through the adapter, creating the folders on the way. */
export function dailyNoteFiles(adapter: DailyNoteAdapter): DailyNoteFiles {
  return {
    exists: (path) => adapter.exists(path),
    readTextFile: (path) => adapter.readTextFile(path),
    createNote: async (path, content) => {
      const parts = path.split(/[/\\]/).filter(Boolean).slice(0, -1);
      let curr = "";
      for (const part of parts) {
        curr = curr ? `${curr}/${part}` : part;
        if (!(await adapter.exists(curr))) await adapter.createDir(curr);
      }
      await adapter.writeTextFile(path, content);
    },
  };
}

/**
 * Resolves the daily note for `date`: returns its path if it exists, otherwise
 * creates it (from the configured template, creating the folder as needed) and
 * returns the new path. Returns null if the user declined the create dialog or
 * the template's questions. Opening/refresh is left to the caller.
 */
export async function resolveOrCreateDailyNote(date: Date, opts: DailyNoteOptions): Promise<string | null> {
  const { vaultPath, adapter, onIndex, confirmCreate, confirmMessage, confirmTitle } = opts;
  // The rule itself lives in packages/ui (plan Journal, J2): the phone and the
  // journal capture run the same one. The template goes through the SHARED
  // engine there, never through raw replaces (plan Vorlagen-Engine, P0) — raw
  // replaces left `{{cursor}}`/`{{prompt:…}}` in the file as literals and let
  // the template-only `plainva` keys leak into every daily note.
  const ensured = await ensureDailyNote(date, await readDailyNoteConfig(vaultPath), dailyNoteFiles(adapter), {
    confirmCreate: confirmCreate
      ? (path) => appConfirm({ title: confirmTitle ?? "Daily note", message: confirmMessage ? confirmMessage(path) : `Create ${path}?`, kind: "info" })
      : undefined,
    resolveTemplate: opts.resolveTemplate,
  });
  if (!ensured) return null;
  if (!ensured.created) return ensured.path;
  if (ensured.cursor !== null) setPendingTemplateCaret({ path: ensured.path, offset: ensured.cursor });
  await onIndex();
  opts.onCreated?.(ensured.path);
  return ensured.path;
}
