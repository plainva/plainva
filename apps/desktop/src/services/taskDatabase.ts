import { defineBase, serializeBaseConfig } from "@plainva/ui";
import { getSettingsStore } from "./settingsStore";
import { taskDatabaseKey } from "../contexts/VaultContext";

/**
 * Standard task database (PIM plan, package 1a). A vault can designate one
 * `.base` as its task database; checkbox tasks from the Tasks view are promoted
 * into it (and later stages sync external provider tasks into the same place).
 * This module owns the setting read and the "create a fresh task database"
 * scaffold — the created `.base` follows the vault-template convention exactly
 * (root-level `<Name>.base` + `<Name>/` source folder, `status`/due columns,
 * table + status board views) so it is byte-identical to a template save and
 * valid in Obsidian.
 */

/** Localized strings the creation scaffold needs (passed in by the caller so
 * this module stays i18n-free and unit-testable). Values mirror the per-language
 * vault-template modules (e.g. de: frist / Offen / In Arbeit / Erledigt). */
export interface TaskDbLabels {
  /** Name of the table view (i18n `database.viewTable`). */
  viewTable: string;
  /** Name of the status board view (i18n `database.viewBoard`). */
  viewBoard: string;
  /** Localized frontmatter key of the due-date column (i18n `tasks.dbDueKey`). */
  dueKey: string;
  /** Status option values open / in progress / done (i18n `tasks.dbStatus*`). */
  statusOptions: [string, string, string];
}

/** Minimal adapter surface the creation needs (satisfied by IVaultAdapter). */
export interface TaskDbAdapter {
  exists(path: string): Promise<boolean>;
  createDir(path: string): Promise<void>;
  writeTextFile(path: string, content: string): Promise<void>;
}

/**
 * Sanitized file stem for a user-typed database name: path separators and
 * OS-forbidden characters are dropped, whitespace collapsed. Returns null for
 * a name with no usable characters.
 */
export function taskDbFileStem(name: string): string | null {
  const stem = name
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    // A trailing dot would collide with the ".base" extension on Windows.
    .replace(/\.+$/, "");
  return stem.length > 0 ? stem : null;
}

/** The `.base` path + source folder + serialized content for a new task DB. */
export function buildTaskDbFile(stem: string, labels: TaskDbLabels): { path: string; folder: string; content: string } {
  const spec = defineBase({
    path: `${stem}.base`,
    sourceFolder: stem,
    columns: [
      { key: "status", input: "status", options: [...labels.statusOptions] },
      { key: labels.dueKey, input: "date" },
    ],
    views: [
      { name: labels.viewTable, type: "table" },
      { name: labels.viewBoard, type: "board", groupBy: "status" },
    ],
  });
  return { path: spec.path, folder: stem, content: serializeBaseConfig(spec.config) };
}

/**
 * Creates the task database (source folder + `.base`) unless it already
 * exists — an existing `.base` of that name is simply adopted (idempotent, so
 * "create" on a name that is already a database selects it). Returns the
 * vault-relative `.base` path, or null for an unusable name.
 */
export async function createTaskDatabase(
  adapter: TaskDbAdapter,
  name: string,
  labels: TaskDbLabels
): Promise<string | null> {
  const stem = taskDbFileStem(name);
  if (!stem) return null;
  const { path, folder, content } = buildTaskDbFile(stem, labels);
  if (!(await adapter.exists(folder))) await adapter.createDir(folder);
  if (!(await adapter.exists(path))) await adapter.writeTextFile(path, content);
  return path;
}

/** The vault's configured standard task database (vault-relative `.base` path),
 * or null when none is set. */
export async function getTaskDatabasePath(vaultPath: string): Promise<string | null> {
  try {
    const store = await getSettingsStore();
    const value = await store.get<string>(taskDatabaseKey(vaultPath));
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
  } catch {
    return null;
  }
}
