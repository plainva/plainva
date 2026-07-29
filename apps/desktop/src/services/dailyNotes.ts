import { applyTemplatePlaceholders, setPendingTemplateCaret } from "@plainva/ui";
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
import { buildDailyNotePath, localIsoKey, parseDailyNoteDate } from "@plainva/ui";
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

/**
 * The reference instant a daily-note template interpolates against: the day the
 * note is FOR, carrying the CURRENT wall-clock time. Both halves matter —
 * `{{date}}` (and later `{{date+N}}`) must follow the note's day even when a
 * past or future daily is created, while `{{time}}` means the moment of
 * creation. Passing the raw midnight `date` would silently turn every
 * `{{time}}` into "00:00".
 */
export function noteStamp(date: Date, now: Date = new Date()): Date {
  const stamp = new Date(date);
  stamp.setHours(now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds());
  return stamp;
}

/**
 * Resolves the daily note for `date`: returns its path if it exists, otherwise
 * creates it (from the configured template, creating the folder as needed) and
 * returns the new path. Returns null if the user declined the create dialog.
 * Opening/refresh is left to the caller.
 */
/**
 * Resolver for `{{daily+1}}` / `{{daily-1}}` (plan Vorlagen-Engine, E6): a wiki
 * link to the daily note that many days from the reference instant.
 *
 * The settings are read ONCE and handed back as a plain function, because the
 * template engine resolves tokens synchronously — and a template may well name
 * several days.
 *
 * The link carries the folder when there is one. A bare `[[2026-07-30]]` would
 * be ambiguous the moment any other note in the vault has that name, and a
 * daily note's name is a date — exactly the kind that repeats.
 */
export async function makeDailyLinkProvider(
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
    return `[[${fullPath.replace(/\.md$/i, "")}]]`;
  };
}

export async function resolveOrCreateDailyNote(date: Date, opts: DailyNoteOptions): Promise<string | null> {
  const { vaultPath, adapter, onIndex, confirmCreate, confirmMessage, confirmTitle } = opts;
  const store = await getSettingsStore();
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
  let caretInBody: number | null = null;
  if (tmplName) {
    const tmplPath = tmplFolder ? `${tmplFolder.replace(/[/\\]+$/, "")}/${tmplName}` : tmplName;
    if (await adapter.exists(tmplPath)) {
      // The template goes through the SHARED engine, never through raw
      // replaces (plan Vorlagen-Engine, P0). Three raw `.replace` calls used to
      // stand here, and everything else the engine does was silently missing:
      //   - `{{cursor}}` / `{{prompt:…}}` stayed in the file as LITERALS;
      //   - the template-only plainva keys were INHERITED. Every template made
      //     with "create new template" carries `plainva.tasks: false`, so each
      //     daily note built from one opted itself out of the Tasks view —
      //     its tasks were invisible with no hint anywhere. `templateFor`
      //     leaked the same way and filed the daily note as a template.
      // Mobile has always called the engine here; this closes that divergence.
      const raw = await adapter.readTextFile(tmplPath);
      const stamp = noteStamp(date);
      if (opts.resolveTemplate) {
        const answered = await opts.resolveTemplate(raw, { title: dateStr, now: stamp, folder });
        if (!answered) return null; // cancelled → no daily note is created
        content = answered.text;
        caretInBody = answered.cursor;
      } else {
        content = applyTemplatePlaceholders(raw, dateStr, stamp);
      }
    }
  }

  // Blank daily notes get an H1 with the date name (same rule as new notes) —
  // a template, when present, fully defines the body instead.
  if (!content) content = `# ${dateStr}\n`;

  // OKF write rule: a template's own `type` wins, missing pieces are added.
  const dailyType =
    (await store.get<string>(dailyNoteTypeKey(vaultPath)))?.trim() || DEFAULT_DAILY_NOTE_TYPE;
  const bodyLength = content.length;
  content = withOkfDefaults(content, dailyType);
  // `{{cursor}}` is measured in the template body; the written file may carry
  // OKF frontmatter in front of it, so shift by whatever was prepended.
  if (caretInBody !== null) {
    setPendingTemplateCaret({ path: fullPath, offset: caretInBody + (content.length - bodyLength) });
  }

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
