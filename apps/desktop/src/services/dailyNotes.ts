import { format } from "date-fns";
import { Store } from "@tauri-apps/plugin-store";
import { appConfirm } from "./appDialogs";
import {
  STORE_KEY,
  dailyNotesFolderKey,
  dailyNotesFormatKey,
  templateFolderKey,
  dailyNoteTemplateKey,
  dailyNoteTypeKey,
  DEFAULT_DAILY_NOTE_TYPE,
} from "../contexts/VaultContext";
import { buildDailyNotePath, localIsoKey, parseDailyNoteDate } from "./dailyNotePath";
import { withOkfDefaults } from "./newNote";

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
  const store = await Store.load(STORE_KEY);
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
  const store = await Store.load(STORE_KEY);
  const folder = (await store.get<string>(dailyNotesFolderKey(opts.vaultPath))) || "";
  const rawFormat = (await store.get<string>(dailyNotesFormatKey(opts.vaultPath))) || "YYYY-MM-DD";
  const out = new Set<string>();
  await Promise.all(
    dates.map(async (d) => {
      const { fullPath } = buildDailyNotePath(d, rawFormat, folder);
      try {
        if (await opts.adapter.exists(fullPath)) out.add(localIsoKey(d));
      } catch { /* ignore */ }
    }),
  );
  return out;
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
  onIndex: () => Promise<void>;
  /** Ask the user before creating a missing note (calendar uses this; the
   *  "today" button does not). */
  confirmCreate: boolean;
  /** Localized confirm message for the create dialog. */
  confirmMessage?: (path: string) => string;
  /** Localized title for the create dialog. */
  confirmTitle?: string;
  /** Fired once when the note was actually created (index.md auto-update). */
  onCreated?: (path: string) => void;
}

/**
 * Resolves the daily note for `date`: returns its path if it exists, otherwise
 * creates it (from the configured template, creating the folder as needed) and
 * returns the new path. Returns null if the user declined the create dialog.
 * Opening/refresh is left to the caller.
 */
export async function resolveOrCreateDailyNote(date: Date, opts: DailyNoteOptions): Promise<string | null> {
  const { vaultPath, adapter, onIndex, confirmCreate, confirmMessage, confirmTitle } = opts;
  const store = await Store.load(STORE_KEY);
  const folder = (await store.get<string>(dailyNotesFolderKey(vaultPath))) || "";
  const rawFormat = (await store.get<string>(dailyNotesFormatKey(vaultPath))) || "YYYY-MM-DD";
  const tmplFolder = (await store.get<string>(templateFolderKey(vaultPath))) || "Templates";
  const tmplName = (await store.get<string>(dailyNoteTemplateKey(vaultPath))) || "";

  const { fullPath, dateStr } = buildDailyNotePath(date, rawFormat, folder);

  if (await adapter.exists(fullPath)) {
    return fullPath;
  }

  if (confirmCreate) {
    const msg = confirmMessage ? confirmMessage(fullPath) : `Create ${fullPath}?`;
    const ok = await appConfirm({ title: confirmTitle ?? "Daily note", message: msg, kind: "info" });
    if (!ok) return null;
  }

  let content = "";
  if (tmplName) {
    const tmplPath = tmplFolder ? `${tmplFolder.replace(/[/\\]+$/, "")}/${tmplName}` : tmplName;
    if (await adapter.exists(tmplPath)) {
      content = await adapter.readTextFile(tmplPath);
      content = content.replace(/{{date}}/g, format(date, "yyyy-MM-dd"));
      content = content.replace(/{{time}}/g, format(new Date(), "HH:mm"));
      content = content.replace(/{{title}}/g, dateStr);
    }
  }

  // Blank daily notes get an H1 with the date name (same rule as new notes) —
  // a template, when present, fully defines the body instead.
  if (!content) content = `# ${dateStr}\n`;

  // OKF write rule: a template's own `type` wins, missing pieces are added.
  const dailyType =
    (await store.get<string>(dailyNoteTypeKey(vaultPath)))?.trim() || DEFAULT_DAILY_NOTE_TYPE;
  content = withOkfDefaults(content, dailyType);

  if (folder) {
    const parts = folder.split(/[/\\]/).filter(Boolean);
    let curr = "";
    for (const p of parts) {
      curr = curr ? `${curr}/${p}` : p;
      if (!(await adapter.exists(curr))) {
        await adapter.createDir(curr);
      }
    }
  }

  await adapter.writeTextFile(fullPath, content);
  await onIndex();
  opts.onCreated?.(fullPath);
  return fullPath;
}
