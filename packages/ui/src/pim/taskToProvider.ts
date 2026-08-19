import { parseBaseConfig } from "../base/baseFormat";
import { resolveTaskListTarget } from "../lib/taskDatabase";
import { createProviderTask, taskAnchorIdentity, type ProviderTaskAdapter, type ProviderTaskDraft } from "./providerTask";

/**
 * Sending a newly created task to the provider list its database names (C4,
 * S16/S17).
 *
 * Every way of creating a task ends here — on both shells. Desktop: the
 * "+ New task" button, a promoted checkbox, a mail captured as a task. Phone:
 * the same three. That is the whole point of the module; the alternative was
 * the same thirty lines in each view, and then it would depend on WHERE (and
 * on which device) a task was created whether it reached the provider. That
 * split is the bug class the shared open rule was written against.
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

/**
 * The runtime slice this needs. Injected rather than imported so the module
 * stays free of either shell's PIM service — the desktop and the phone have
 * their own, with the same shape.
 */
export interface TaskListRuntime {
  /** Every known account. `enabled === false` means "not reachable at all".
   *  `provider` and `config` are optional because only the anchor needs them:
   *  they carry the identity that survives a reconnect. */
  listAccounts(): Promise<
    ReadonlyArray<{ id: string; enabled?: boolean; provider?: string; config?: Record<string, unknown> }>
  >;
  /** Every known task list, across accounts. */
  listTaskLists(): Promise<ReadonlyArray<{ id: string; accountId: string }>>;
  /** The provider call for one account, or null when it cannot be built. */
  createTaskFor(
    accountId: string
  ): Promise<
    | ((listId: string, draft: { title: string; due?: string; notes?: string; completed: boolean }) => Promise<{ uid: string }>)
    | null
  >;
}

export interface SendTaskOptions {
  adapter: ProviderTaskAdapter;
  /** The task database (`.base`) whose choice decides the list. */
  dbPath: string;
  /** The note that was just written — it receives the anchor. */
  notePath: string;
  title: string;
  /** ISO date; a task captured from a mail carries that mail's day. */
  dueDate?: string;
  runtime: TaskListRuntime | null;
}

export async function sendTaskToProviderList(opts: SendTaskOptions): Promise<SendTaskOutcome> {
  if (!opts.runtime) return "skipped";
  try {
    const config = parseBaseConfig(await opts.adapter.readTextFile(opts.dbPath));
    const [accounts, lists] = await Promise.all([
      opts.runtime.listAccounts(),
      opts.runtime.listTaskLists(),
    ]);
    // A disabled account is not reachable at all, so its lists are not targets.
    const enabled = new Set(accounts.filter((a) => a.enabled !== false).map((a) => a.id));
    // The SAME rule the configuration row displays: a list that is gone
    // resolves to nothing, and nothing is created rather than guessing another.
    const target = resolveTaskListTarget(config, lists.filter((l) => enabled.has(l.accountId)));
    if (!target) return "skipped";

    const createTask = await opts.runtime.createTaskFor(target.accountId);
    if (!createTask) return "createFailed";

    const draft: ProviderTaskDraft = { title: opts.title, ...(opts.dueDate ? { due: opts.dueDate } : {}) };
    // The anchor gets what survives a reconnect: the provider, and the verified
    // identity where there is one. Without them the note would only carry a
    // random local id, and the next connect would import a second copy of the
    // very task created here.
    const account = accounts.find((a) => a.id === target.accountId);
    const res = await createProviderTask({
      adapter: opts.adapter,
      notePath: opts.notePath,
      accountId: target.accountId,
      listId: target.listId,
      ...(account?.provider ? { provider: account.provider } : {}),
      ...(taskAnchorIdentity(account) ? { identity: taskAnchorIdentity(account)! } : {}),
      draft,
      createTask,
    });
    if (!res.ok) return "createFailed";
    return res.anchored ? "created" : "notAnchored";
  } catch (e) {
    console.error("[taskToProvider] creating the task at the provider failed", e);
    return "createFailed";
  }
}
