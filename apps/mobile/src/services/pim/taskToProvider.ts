import i18n from "@plainva/ui/i18n";
import {
  parseBaseConfig,
  resolveTaskListName,
  sendTaskToProviderList as sendShared,
  toast,
  type ProviderTaskAdapter,
  type SendTaskOutcome,
} from "@plainva/ui";
import { pimTaskListRuntime } from "./pimService";

/**
 * The phone's adapter onto the shared task→provider rule (C4, S17).
 *
 * The decisions — which list, what the anchor carries, what a failure costs —
 * live in `@plainva/ui`, the same copy the desktop uses. All this layer does is
 * hand the shared code the runtime and turn its answer into a message.
 */

/**
 * The name of the list this database sends new tasks to, or null when it names
 * none (or the named one is gone). The creation sheet asks with it; without a
 * name there is nothing to ask about, so no switch appears.
 */
export async function providerListLabel(adapter: Pick<ProviderTaskAdapter, "readTextFile">, dbPath: string): Promise<string | null> {
  const rt = pimTaskListRuntime();
  if (!rt) return null;
  try {
    const [config, accounts, lists] = await Promise.all([
      adapter.readTextFile(dbPath).then(parseBaseConfig),
      rt.listAccounts(),
      rt.listTaskLists(),
    ]);
    const enabled = new Set(accounts.filter((a) => a.enabled !== false).map((a) => a.id));
    return resolveTaskListName(
      config,
      (lists as ReadonlyArray<{ id: string; accountId: string; name?: string }>).filter((l) =>
        enabled.has(l.accountId)
      )
    );
  } catch {
    // Only decides whether a question is asked — never worth failing over.
    return null;
  }
}

/**
 * Creates the task at the provider and reports what happened. Never throws:
 * the note is already written when this runs, and a provider failure must not
 * read as "the whole capture failed".
 */
export async function sendTaskToProviderList(
  adapter: ProviderTaskAdapter,
  dbPath: string,
  notePath: string,
  title: string,
  dueDate?: string
): Promise<SendTaskOutcome> {
  const outcome = await sendShared({
    adapter,
    dbPath,
    notePath,
    title,
    ...(dueDate ? { dueDate } : {}),
    runtime: pimTaskListRuntime(),
  });
  if (outcome === "createFailed") toast.error(i18n.t("tasks.providerCreateFailed"));
  // The expensive one: the task exists remotely without a note pointing at it,
  // so the next sync imports a SECOND note for it.
  else if (outcome === "notAnchored") toast.error(i18n.t("tasks.providerAnchorFailed"));
  return outcome;
}
