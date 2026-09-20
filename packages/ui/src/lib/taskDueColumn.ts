import { parseBaseConfig, serializeBaseConfig } from "../base/baseFormat";
import { taskDbDueKey } from "./taskDatabase";

/**
 * The due column and the time of day (plan Aufgaben-Oberfläche, E9).
 *
 * A task's time lives in its due value (`2026-09-21T14:00`), which the planner
 * and the reminders read whatever the column is typed as. A database made
 * before tasks had times types that column as a plain `date`: its table then
 * shows the day only, and its cell editor cannot set a time. Plainva does not
 * retype a column by itself — it OFFERS it, once per database and device, the
 * first time a task with a time is captured there. The values are not touched:
 * a day stays a day in a date & time column.
 */
type OfferStorage = Pick<Storage, "getItem" | "setItem">;

function defaultStorage(): OfferStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

const offerKey = (vault: string, dbPath: string) => `plainva-task-duetime-offer-${vault}|${dbPath}`;

/** The key of a due column that is typed as a plain day, or null. */
export function dayOnlyDueColumn(config: unknown): string | null {
  const key = taskDbDueKey(config);
  const cols = (config as { columns?: Record<string, { input?: string }> } | null)?.columns ?? {};
  return key && cols[key]?.input === "date" ? key : null;
}

/**
 * Whether to make the offer now: the database types its due column as a day,
 * and this device has not asked about this database before. Asking marks it as
 * asked — an offer that comes back with every task is a nag.
 */
export async function shouldOfferDueTimeColumn(
  readTextFile: (path: string) => Promise<string>,
  vault: string,
  dbPath: string,
  storage: OfferStorage | null = defaultStorage()
): Promise<string | null> {
  try {
    if (storage?.getItem(offerKey(vault, dbPath))) return null;
    const key = dayOnlyDueColumn(parseBaseConfig(await readTextFile(dbPath)));
    if (key) storage?.setItem(offerKey(vault, dbPath), "1");
    return key;
  } catch {
    return null;
  }
}

/** Retypes the due column as date & time. Returns the column's key, or null when there was nothing to do. */
export async function convertDueColumnToDateTime(
  adapter: { readTextFile(path: string): Promise<string>; writeTextFile(path: string, content: string): Promise<void> },
  dbPath: string
): Promise<string | null> {
  const config = parseBaseConfig(await adapter.readTextFile(dbPath));
  const key = dayOnlyDueColumn(config);
  if (!key) return null;
  config.columns[key] = { ...config.columns[key], input: "datetime" };
  await adapter.writeTextFile(dbPath, serializeBaseConfig(config));
  return key;
}
