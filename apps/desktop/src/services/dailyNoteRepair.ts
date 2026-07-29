import { deleteFrontmatterPath, readFrontmatterPath } from "@plainva/core";
import { parseDailyNoteDate } from "@plainva/ui";
import { getSettingsStore } from "./settingsStore";
import { dailyNotesFolderKey, dailyNotesFormatKey } from "../contexts/VaultContext";

/**
 * TEMPORARY — scheduled for removal by 2026-11-01, or two minor releases after
 * P0 ships, whichever comes first. See plan Vorlagen-Engine (decision E4) and
 * Sammelplan entry C13. Everything for the removal lives here plus one call
 * site (the maintenance settings page) and one modal, so it comes out in a
 * single commit.
 *
 * WHY IT EXISTS: until P0, the desktop daily-note path interpolated templates
 * with three raw string replaces instead of the shared engine. The engine also
 * strips the template-only `plainva` keys — that step was missing, so every
 * daily note created from a template made with "create new template" inherited
 * `plainva.tasks: false` and disappeared from the Tasks view, silently. Fixing
 * the write path stops new damage; existing notes stay broken forever unless
 * they are cleaned, which is what this offers.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: run on its own. A vault-wide rewrite
 * without asking does not fit Plainva's data-safety line, and `plainva.tasks:
 * false` CAN be a deliberate choice (the Tasks view has a per-note eye
 * toggle). The user sees every affected note and can deselect any of them.
 */

/** A template-only key that must never survive into a created note. */
export type InheritedMarker = "tasks" | "templateFor";

const MARKER_PATHS: Record<InheritedMarker, readonly string[]> = {
  tasks: ["plainva", "tasks"],
  templateFor: ["plainva", "templateFor"],
};

/**
 * The template-only markers a note carries. `tasks` counts only when it is
 * literally `false` — that is the value templates are stamped with; a `true`
 * would be someone's own doing. `templateFor` counts whenever it holds
 * anything, since a created note is never a template.
 */
export function inheritedMarkersOf(content: string): InheritedMarker[] {
  const out: InheritedMarker[] = [];
  try {
    if (readFrontmatterPath(content, MARKER_PATHS.tasks) === false) out.push("tasks");
  } catch {
    /* unparseable frontmatter — nothing to claim */
  }
  try {
    const raw = readFrontmatterPath(content, MARKER_PATHS.templateFor);
    const value = raw && typeof raw === "object" && "toJSON" in raw ? (raw as { toJSON(): unknown }).toJSON() : raw;
    const empty = value == null || value === "" || (Array.isArray(value) && value.length === 0);
    if (!empty) out.push("templateFor");
  } catch {
    /* see above */
  }
  return out;
}

/** Removes the given markers; malformed frontmatter is returned untouched. */
export function stripInheritedMarkers(content: string, markers: readonly InheritedMarker[]): string {
  let out = content;
  for (const marker of markers) {
    try {
      out = deleteFrontmatterPath(out, MARKER_PATHS[marker]);
    } catch {
      return content;
    }
  }
  return out;
}

export interface AffectedDailyNote {
  path: string;
  /** The day the note belongs to — shown so the list reads like a calendar. */
  date: Date;
  markers: InheritedMarker[];
}

export type RepairScanAdapter = {
  listDir(path: string): Promise<Array<{ path: string; isDirectory: boolean }>>;
  readTextFile(path: string): Promise<string>;
};

/**
 * Daily notes of this vault that carry inherited template markers.
 *
 * Scope is deliberately narrow: only paths that {@link parseDailyNoteDate}
 * accepts as this vault's daily note (its folder AND its date format, with the
 * existing round-trip guard). That is exactly the set the broken write path
 * could produce — no other note is touched or even read. The cheap pure check
 * runs first, so only real daily notes cost a file read.
 */
export async function scanInheritedTemplateMarkers(opts: {
  adapter: RepairScanAdapter;
  vaultPath: string;
  signal?: AbortSignal;
  onProgress?: (scanned: number) => void;
}): Promise<AffectedDailyNote[]> {
  const store = await getSettingsStore();
  const folder = (await store.get<string>(dailyNotesFolderKey(opts.vaultPath))) || "";
  const rawFormat = (await store.get<string>(dailyNotesFormatKey(opts.vaultPath))) || "YYYY-MM-DD";

  let entries: Array<{ path: string; isDirectory: boolean }>;
  try {
    entries = await opts.adapter.listDir(folder);
  } catch {
    return [];
  }

  const out: AffectedDailyNote[] = [];
  let scanned = 0;
  for (const entry of entries) {
    if (opts.signal?.aborted) break;
    if (entry.isDirectory) continue;
    const date = parseDailyNoteDate(entry.path, rawFormat, folder);
    if (!date) continue;
    scanned++;
    opts.onProgress?.(scanned);
    try {
      const markers = inheritedMarkersOf(await opts.adapter.readTextFile(entry.path));
      if (markers.length > 0) out.push({ path: entry.path, date, markers });
    } catch {
      /* unreadable note — skip, a repair offer must never fail over one file */
    }
  }
  return out.sort((a, b) => b.date.getTime() - a.date.getTime());
}

export interface RepairResult {
  repaired: string[];
  failed: Array<{ path: string; error: string }>;
}

/**
 * Strips the markers from the chosen notes. Writes go through the adapter the
 * caller hands in — the app passes the full chain, so every rewrite lands in
 * the version history and the sync queue like any other edit.
 */
export async function repairDailyNotes(opts: {
  adapter: RepairScanAdapter & { writeTextFile(path: string, content: string): Promise<void> };
  notes: readonly AffectedDailyNote[];
  onProgress?: (done: number) => void;
}): Promise<RepairResult> {
  const result: RepairResult = { repaired: [], failed: [] };
  let done = 0;
  for (const note of opts.notes) {
    try {
      const before = await opts.adapter.readTextFile(note.path);
      const after = stripInheritedMarkers(before, note.markers);
      // Re-read guards against a note edited between scan and repair: if the
      // markers are gone already there is nothing to write.
      if (after !== before) await opts.adapter.writeTextFile(note.path, after);
      result.repaired.push(note.path);
    } catch (e) {
      result.failed.push({ path: note.path, error: e instanceof Error ? e.message : String(e) });
    }
    opts.onProgress?.(++done);
  }
  return result;
}
