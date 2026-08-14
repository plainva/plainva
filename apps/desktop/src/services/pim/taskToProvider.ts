import { createProviderTask, parseBaseConfig, resolveTaskListTarget } from "@plainva/ui";
import type { IVaultAdapter } from "@plainva/core";
import type { PimRuntime } from "./pimRuntime";

/**
 * Sending a newly created task to the provider list its database names (C4, S16).
 *
 * Every way of creating a task in Plainva ends here: the "+ New task" button,
 * a promoted checkbox, a mail captured as a task. That is the whole point of
 * the module — the alternative was the same thirty lines in each view, and then
 * it would depend on WHERE a task was created whether it reached the provider.
 * That split is exactly the bug class the shared open rule was written against.
 *
 * Silent when the database names no list: that is the default and means "stays
 * a note". Never throws — the note already exists when this runs, and no
 * failure here may cost it.
 */

export type SendTaskOutcome =
  /** No list chosen, or the chosen one no longer resolves — nothing to do. */
  | "skipped"
  /** Created at the provider and the note is anchored to it. */
  | "created"
  /** The provider refused. The task exists only locally. */
  | "createFailed"
  /**
   * Created at the provider, but the note could not be anchored to it. The
   * expensive one: the next sync finds a remote task with no local note and
   * imports a SECOND note for it.
   */
  | "notAnchored";

export async function sendTaskToProviderList(opts: {
  adapter: IVaultAdapter;
  /** The task database (`.base`) whose choice decides the list. */
  dbPath: string;
  /** The note that was just written — it receives the anchor. */
  notePath: string;
  title: string;
  /** ISO date; a task captured from a mail carries that mail's day. */
  dueDate?: string;
  pimRuntime: PimRuntime | null;
}): Promise<SendTaskOutcome> {
  if (!opts.pimRuntime) return "skipped";
  try {
    const config = parseBaseConfig(await opts.adapter.readTextFile(opts.dbPath));
    const [accounts, lists] = await Promise.all([
      opts.pimRuntime.cache.listAccounts(),
      opts.pimRuntime.cache.listTaskLists(),
    ]);
    // A disabled account is not reachable at all, so its lists are not targets.
    const enabled = new Set(accounts.filter((a) => a.enabled !== false).map((a) => a.id));
    // The SAME rule the configuration row displays: a list that is gone
    // resolves to nothing, and nothing is created rather than guessing another.
    const target = resolveTaskListTarget(config, lists.filter((l) => enabled.has(l.accountId)));
    if (!target) return "skipped";

    const account = accounts.find((a) => a.id === target.accountId);
    const pim = account ? await opts.pimRuntime.buildTarget(account) : null;
    if (!pim) return "createFailed";

    const res = await createProviderTask({
      adapter: opts.adapter,
      notePath: opts.notePath,
      accountId: target.accountId,
      listId: target.listId,
      draft: { title: opts.title, ...(opts.dueDate ? { due: opts.dueDate } : {}) },
      createTask: (listId, draft) => pim.createTask(listId, draft),
    });
    if (!res.ok) return "createFailed";
    return res.anchored ? "created" : "notAnchored";
  } catch (e) {
    console.error("[taskToProvider] creating the task at the provider failed", e);
    return "createFailed";
  }
}
