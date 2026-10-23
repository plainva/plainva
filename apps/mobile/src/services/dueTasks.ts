import {
  checkboxJumpTerm,
  dueTaskRows,
  isMirroredNamespace,
  isRecurringAtProviderNamespace,
  noteTaskTick,
  parseBaseConfig,
  repeatFromNamespace,
  resolveTaskCompletionModel,
  taskDbDueKey,
  taskDbRows,
  tickCompletes,
  type PlannerDbMeta,
  type PlannerRow,
} from "@plainva/ui";
import { getMobileSettings } from "./mobileSettings";
import { pimSyncNow } from "./pim/pimService";
import { syncSoon } from "./syncService";
import { setTaskDone, type TaskCompletionResult } from "./taskCompletionAction";
import { vaultOps, type MobileVault } from "./vaultService";

/**
 * The tasks a day surface of the phone shows — the Today screen, the calendar,
 * the widgets — loaded once, from both sources (TestFlight, build 136): the
 * task database when one is set, and the checkboxes in notes. Which of them
 * belong to a day is `dueTasksForDay`'s answer, the same the planner's Today
 * list gives.
 *
 * Each source is best-effort on its own: an unreadable database costs its
 * rows, not the checkboxes, and the other way round — a day surface that
 * empties because one of two sources failed tells nobody anything.
 */
export interface PhoneDueTasks {
  rows: PlannerRow[];
  /** The task database's date column, for a surface that moves a database task's day. */
  dueKey: string | null;
  /** A task database is set for this vault. */
  database: boolean;
  /**
   * The database can say "done" (it has a completion model). Without one a
   * tick on a database entry writes nothing, so its box is no control — as on
   * the task screen and in the desktop's calendar.
   */
  databaseTickable: boolean;
}

/** Where the search jump lands for a task: a checkbox at its line, by the line's own text. */
export function taskJumpTerm(row: PlannerRow): string | null {
  // The raw line, not the title: the title drops tags and Tasks fields from
  // the middle of the text, and what is left need not stand in the note.
  return row.source === "note" && row.line ? checkboxJumpTerm(row.line.text) : null;
}

export async function loadPhoneDueTasks(vault: MobileVault): Promise<PhoneDueTasks> {
  const service = vault.queryService;
  const db = getMobileSettings().taskDatabase.trim();
  if (!service) return { rows: [], dueKey: null, database: db !== "", databaseTickable: false };
  const fromDatabase = async () => {
    if (!db) return null;
    try {
      const config = parseBaseConfig(await vaultOps.read(vault, db));
      const raw = (await service.queryDatabaseFiles(config)) as Record<string, unknown>[];
      const meta = new Map<string, PlannerDbMeta>();
      for (const row of raw) {
        const ns = row["plainva"];
        meta.set(String(row["file.path"] ?? ""), {
          repeats: repeatFromNamespace(ns) !== null,
          mirrored: isMirroredNamespace(ns),
          repeatsAtProvider: isRecurringAtProviderNamespace(ns),
        });
      }
      const completion = resolveTaskCompletionModel(config);
      return { rows: taskDbRows(raw, config, completion), meta, dueKey: taskDbDueKey(config), tickable: completion !== null };
    } catch {
      return null;
    }
  };
  const [database, notes] = await Promise.all([fromDatabase(), service.listTasks().catch(() => [])]);
  return {
    rows: dueTaskRows({ database: database?.rows, databaseMeta: (path) => database?.meta.get(path), notes }),
    dueKey: database?.dueKey ?? null,
    database: db !== "",
    databaseTickable: database?.tickable ?? false,
  };
}

/**
 * A tick on a task row of a day surface: open or in progress becomes done,
 * done or cancelled open again — each source the way it is stored. A database
 * entry through `setTaskDone` (completion model, the next occurrence of a
 * repeating task, the provider sync); a checkbox through `vaultOps.update` on
 * the note as it lies there, with the line found again in it (`noteTaskTick`)
 * — the write the task screen's own box makes.
 *
 * Throws what the vault throws; the caller says it.
 */
export async function tickPhoneDueTask(vault: MobileVault, row: PlannerRow): Promise<TaskCompletionResult> {
  const done = tickCompletes(row);
  if (row.source === "database") {
    const result = await setTaskDone(row.path, done);
    if (result.changed) {
      syncSoon();
      // A task mirrored from a provider list goes there with the next cycle —
      // asked for now, not in two minutes.
      pimSyncNow();
    }
    return result;
  }
  if (!row.line) return { changed: false };
  const update = await vaultOps.update(vault, row.path, noteTaskTick(row.line, done));
  if (update.changed) syncSoon();
  return { changed: update.changed };
}
