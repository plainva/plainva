import { parseBaseConfig } from "@plainva/ui";
import { getTaskDatabasePath, resolveTaskCompletionModel, classifyTaskCompletion } from "../taskDatabase";

/**
 * Due-dated entries of the standard task database, projected onto calendar
 * surfaces (the calendar tab's task overlay and the sidebar calendar's day
 * peek). One loader so both use the same status classification as the task
 * reconciler.
 */

export interface DueTask {
  path: string;
  title: string;
  /** YYYY-MM-DD */
  due: string;
  done: boolean;
}

export interface DueTaskDeps {
  vaultPath: string;
  vaultAdapter: { readTextFile(path: string): Promise<string> };
  queryService: { queryDatabaseFiles(config: unknown): Promise<Record<string, unknown>[]> };
}

export async function loadDueTasks(deps: DueTaskDeps): Promise<DueTask[]> {
  const dbPath = await getTaskDatabasePath(deps.vaultPath);
  if (!dbPath) return [];
  let config: any;
  try {
    config = parseBaseConfig(await deps.vaultAdapter.readTextFile(dbPath));
  } catch {
    return [];
  }
  const cols: Record<string, any> = config?.columns ?? {};
  const dueKey = Object.keys(cols).find((k) => cols[k]?.input === "date" || cols[k]?.input === "datetime") ?? null;
  if (!dueKey) return [];
  const completion = resolveTaskCompletionModel(config);
  const statusModel = completion?.kind === "checkbox" ? completion.status : completion?.status ?? null;
  const rows = await deps.queryService.queryDatabaseFiles(config);
  const out: DueTask[] = [];
  for (const r of rows as any[]) {
    const dueRaw = r[dueKey];
    if (dueRaw == null || dueRaw === "") continue;
    const due = String(dueRaw).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) continue;
    const statusRaw = statusModel && r[statusModel.key] != null && r[statusModel.key] !== "" ? String(r[statusModel.key]) : null;
    const done = completion
      ? classifyTaskCompletion(completion, {
          checkbox: completion.kind === "checkbox" ? r[completion.key] : undefined,
          status: statusRaw,
        }) === true
      : false;
    out.push({
      path: String(r["file.path"] ?? ""),
      title: String(r["file.name"] ?? String(r["file.path"] ?? "").split("/").pop()?.replace(/\.md$/i, "") ?? ""),
      due,
      done,
    });
  }
  return out;
}
