import { providerListLabel as labelShared, sendTaskToProviderList as sendShared, type ProviderTaskAdapter, type SendTaskOutcome } from "@plainva/ui";
import type { PimRuntime } from "./pimRuntime";

/**
 * The desktop's adapter onto the shared rule (C4, S16/S17).
 *
 * The decisions — which list, what the anchor carries, what a failure costs —
 * live in `@plainva/ui`, so the phone makes the same ones instead of its own.
 * All this layer does is hand the shared code the three things it cannot know:
 * how to list accounts, how to list task lists, and how to reach a provider.
 */

export type { SendTaskOutcome };

/**
 * The name of the list this database would send a new task to, for the question
 * the creation dialog asks (C18). Only the two listing calls are needed here —
 * naming a list does not require the ability to reach it.
 */
export function providerListLabel(opts: {
  adapter: Pick<ProviderTaskAdapter, "readTextFile">;
  dbPath: string;
  pimRuntime: PimRuntime | null;
}): Promise<string | null> {
  const rt = opts.pimRuntime;
  return labelShared({
    adapter: opts.adapter,
    dbPath: opts.dbPath,
    runtime: rt
      ? {
          listAccounts: () => rt.cache.listAccounts(),
          listTaskLists: () => rt.cache.listTaskLists(),
          createTaskFor: async () => null,
        }
      : null,
  });
}

export async function sendTaskToProviderList(opts: {
  adapter: ProviderTaskAdapter;
  dbPath: string;
  notePath: string;
  title: string;
  dueDate?: string;
  pimRuntime: PimRuntime | null;
}): Promise<SendTaskOutcome> {
  const rt = opts.pimRuntime;
  return sendShared({
    adapter: opts.adapter,
    dbPath: opts.dbPath,
    notePath: opts.notePath,
    title: opts.title,
    ...(opts.dueDate ? { dueDate: opts.dueDate } : {}),
    runtime: rt
      ? {
          listAccounts: () => rt.cache.listAccounts(),
          listTaskLists: () => rt.cache.listTaskLists(),
          createTaskFor: async (accountId) => {
            const account = (await rt.cache.listAccounts()).find((a) => a.id === accountId);
            const target = account ? await rt.buildTarget(account) : null;
            return target ? (listId, draft) => target.createTask(listId, draft) : null;
          },
        }
      : null,
  });
}
