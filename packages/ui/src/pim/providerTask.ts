import { readFrontmatterPath, setFrontmatterPath } from "@plainva/core";

/**
 * Creating a task in Plainva that also exists at the provider (C4, S16).
 *
 * Until now the task reconciler only mirrored remote → local: a task created in
 * Plainva stayed a note and never appeared in Google Tasks, the iCloud
 * reminders or Microsoft To Do. The capability to create one was finished in
 * all three providers (`IPimTarget.createTask`) and had, in the whole
 * repository, no caller at all. This is that caller — shared, so the phone (S17)
 * makes the same three decisions instead of its own.
 *
 * The three decisions:
 *
 * 1. **The note is the deliverable, the remote task is the addition.** The note
 *    is already written when this runs. If the provider call fails, the note
 *    stays and the caller is told — losing the note because a network call
 *    failed would be the worse trade by far.
 *
 * 2. **The anchor is what stops a double.** `plainva.pim` is exactly what the
 *    reconciler looks a note up by (`findNoteByAnchor`: uid + account + list);
 *    without it the next sync sees a remote task it has no local note for and
 *    imports a SECOND one. So the anchor is written with the same four fields
 *    the mirror path writes, and a failure to write it is REPORTED
 *    (`anchored: false`) rather than swallowed — the same shape
 *    `createTaskTimeBlock` uses, and for the same reason.
 *
 * 3. **`setFrontmatterPath`, never `upsertFrontmatterKeys`.** The latter
 *    replaces the whole `plainva` map, which would silently drop a sibling
 *    `plainva.blocks` anchor of a time-blocked task.
 */

export interface ProviderTaskAdapter {
  readTextFile(path: string): Promise<string>;
  writeTextFile(path: string, content: string): Promise<void>;
}

/** What the provider needs to create a task. Mirrors `PimTaskDraft` without
 * importing the PIM types into this layer. */
export interface ProviderTaskDraft {
  title: string;
  /** ISO date (YYYY-MM-DD), day-granular like every task due date in Plainva. */
  due?: string;
  notes?: string;
}

export interface ProviderTaskAnchor {
  kind: "task";
  uid: string;
  account: string;
  list: string;
}

export interface CreateProviderTaskOptions {
  adapter: ProviderTaskAdapter;
  /** The note that was just written — it gets the anchor. */
  notePath: string;
  accountId: string;
  listId: string;
  draft: ProviderTaskDraft;
  /** The provider call. Injected so this module stays free of the PIM runtime
   * and can be tested without one. */
  createTask(listId: string, draft: { title: string; due?: string; notes?: string; completed: boolean }): Promise<{ uid: string }>;
}

export type CreateProviderTaskResult =
  | { ok: true; uid: string; accountId: string; listId: string; anchored: boolean }
  | { ok: false; reason: "createFailed" };

/**
 * Creates the task at the provider and anchors the note to it.
 *
 * Returns `ok: false` only when the PROVIDER call failed; the note is untouched
 * in that case and still exists. `anchored: false` means the task was created
 * but the note could not be linked to it — the caller should say so, because
 * the next sync will then import the task as a second note.
 */
export async function createProviderTask(
  opts: CreateProviderTaskOptions
): Promise<CreateProviderTaskResult> {
  let uid: string;
  try {
    const res = await opts.createTask(opts.listId, {
      title: opts.draft.title,
      ...(opts.draft.due ? { due: opts.draft.due } : {}),
      ...(opts.draft.notes ? { notes: opts.draft.notes } : {}),
      // A task created here is open by definition — nobody creates a task in
      // order to have it already done.
      completed: false,
    });
    uid = res.uid;
  } catch {
    return { ok: false, reason: "createFailed" };
  }

  let anchored: boolean;
  try {
    const content = await opts.adapter.readTextFile(opts.notePath);
    const anchor: ProviderTaskAnchor = {
      kind: "task",
      uid,
      account: opts.accountId,
      list: opts.listId,
    };
    await opts.adapter.writeTextFile(opts.notePath, setFrontmatterPath(content, ["plainva", "pim"], anchor));
    anchored = true;
  } catch {
    anchored = false;
  }

  return { ok: true, uid, accountId: opts.accountId, listId: opts.listId, anchored };
}

/** The provider anchor of a note, or null when it carries none. Used to avoid
 * creating a second remote task for a note that already has one. */
export function readProviderTaskAnchor(content: string): ProviderTaskAnchor | null {
  const raw = readFrontmatterPath(content, ["plainva", "pim"]);
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  if (rec.kind !== "task") return null;
  const { uid, account, list } = rec;
  if (typeof uid !== "string" || typeof account !== "string" || typeof list !== "string") return null;
  if (!uid || !account || !list) return null;
  return { kind: "task", uid, account, list };
}
