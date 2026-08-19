import { readFrontmatterPath, setFrontmatterPath } from "@plainva/core";
import { verifiedProviderIdentityOf } from "../lib/accountProfile";

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

/**
 * What a note says about the provider task it belongs to.
 *
 * `account` used to be part of the identity and was the reason a reconnect
 * produced duplicates: every connect mints a fresh random account id, so the
 * anchor of an existing note stopped matching the very task it described. It is
 * still WRITTEN (an older shell reads it as a required field, and desktop and
 * phone ship separately), but it never decides a match again.
 *
 * `provider` and `identity` replace it. Both survive a reconnect, and both are
 * optional on purpose: CalDAV has no profile to verify an identity against, so
 * demanding one would exclude exactly the provider with the weakest uid
 * guarantees.
 */
export interface ProviderTaskAnchor {
  kind: "task";
  uid: string;
  list: string;
  /** Legacy local account id — written for compatibility, never compared. */
  account?: string;
  /** Stable across reconnects: "google" | "microsoft" | "caldav". */
  provider?: string;
  /** Verified account identity ("issuer:subject"), when the provider offers one. */
  identity?: string;
}

/** The identity an anchor carries, in a form that belongs in a note.
 *
 * Deliberately not `verifiedProviderIdentityKey` — that joins with a NUL byte,
 * which is fine for a Map key and unacceptable in a file: a note carrying one
 * counts as binary to git and grep. */
export function taskAnchorIdentity(
  account: { config?: Record<string, unknown> } | null | undefined
): string | undefined {
  if (!account) return undefined;
  const identity = verifiedProviderIdentityOf(account);
  return identity ? `${identity.issuer}:${identity.subject}` : undefined;
}

/** The single place an anchor is built — the reconciler used to assemble its
 *  own copy of this object, and two writers of one structure is the drift this
 *  project has paid for more than once. */
export function buildTaskAnchor(opts: {
  uid: string;
  listId: string;
  accountId?: string;
  provider?: string;
  identity?: string;
}): ProviderTaskAnchor {
  return {
    kind: "task",
    uid: opts.uid,
    list: opts.listId,
    ...(opts.accountId ? { account: opts.accountId } : {}),
    ...(opts.provider ? { provider: opts.provider } : {}),
    ...(opts.identity ? { identity: opts.identity } : {}),
  };
}

/**
 * Whether an anchored note describes this remote task (adoption rule E1).
 *
 * uid and list must match. Provider and identity are only compared when BOTH
 * sides carry them: an anchor written before this change has neither, and
 * refusing it would leave every existing note unadoptable — which is the
 * situation the fix exists to end.
 *
 * The list is not decoration. A uid is unique at ONE provider, not across two:
 * a CalDAV list id is an href that looks identical for two accounts on the same
 * server, and a VTODO uid travels through export and import.
 */
export function anchorMatchesTask(
  anchor: Pick<ProviderTaskAnchor, "uid" | "list" | "provider" | "identity">,
  task: { uid: string; list: string; provider?: string; identity?: string }
): boolean {
  if (anchor.uid !== task.uid || anchor.list !== task.list) return false;
  if (anchor.provider && task.provider && anchor.provider !== task.provider) return false;
  if (anchor.identity && task.identity && anchor.identity !== task.identity) return false;
  return true;
}

export interface CreateProviderTaskOptions {
  adapter: ProviderTaskAdapter;
  /** The note that was just written — it gets the anchor. */
  notePath: string;
  accountId: string;
  listId: string;
  /** Stable account identity for the anchor; see ProviderTaskAnchor. */
  provider?: string;
  identity?: string;
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
    const anchor = buildTaskAnchor({
      uid,
      listId: opts.listId,
      accountId: opts.accountId,
      provider: opts.provider,
      identity: opts.identity,
    });
    await opts.adapter.writeTextFile(opts.notePath, setFrontmatterPath(content, ["plainva", "pim"], anchor));
    anchored = true;
  } catch {
    anchored = false;
  }

  return { ok: true, uid, accountId: opts.accountId, listId: opts.listId, anchored };
}

/** The provider anchor of a note, or null when it carries none. Used to avoid
 * creating a second remote task for a note that already has one.
 *
 * `account` is read when present but no longer required: demanding it made an
 * anchor written after a reconnect — or by a newer shell — read as "no anchor
 * at all", and the caller then created a SECOND remote task. */
export function readProviderTaskAnchor(content: string): ProviderTaskAnchor | null {
  const raw = readFrontmatterPath(content, ["plainva", "pim"]);
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  if (rec.kind !== "task") return null;
  const { uid, list } = rec;
  if (typeof uid !== "string" || typeof list !== "string" || !uid || !list) return null;
  const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);
  return buildTaskAnchor({
    uid,
    listId: list,
    accountId: str(rec.account),
    provider: str(rec.provider),
    identity: str(rec.identity),
  });
}
