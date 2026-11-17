import { deleteWithSafetyNet, type DeletionConfirmation, type IVaultAdapter, type SnapshotBeforeDeleteError } from "@plainva/core";
import i18n from "../i18n";

/**
 * "Delete without a backup?" — the one question both shells put where a
 * deletion has no net (D1 of the data-safety plan of 2026-11-06).
 *
 * The rule is the core's (`BackupVaultAdapter.deleteItem`): a deletion that
 * could not be undone — no system trash takes the item, and the snapshot
 * before it could not be written — is not carried out, and says what would be
 * gone (`SnapshotBeforeDeleteError`). The words of the question live here,
 * the dialog that shows it is the shell's: each registers its confirmation at
 * start (`registerDeletionNetQuestion`). "Cancel" is the safe answer and the
 * preselected one; only "Delete anyway" deletes, with `withoutSnapshot`.
 *
 * Without a registration the answer is no: shared code must not delete
 * without a net on a shell that never asks.
 */

export interface DeletionNetQuestion {
  title: string;
  message: string;
  confirmLabel: string;
}

type Translate = (key: string, options?: Record<string, unknown>) => string;
type Refusal = Pick<SnapshotBeforeDeleteError, "path" | "uncovered" | "total" | "net" | "folder">;

/** At most this many paths are named; the rest is counted. */
export const DELETION_NET_LIST_MAX = 8;

const TEXTS = {
  "no-trash": {
    file: "backup.deleteWithoutSnapshotNoTrashFile",
    folder: "backup.deleteWithoutSnapshotNoTrashFolder",
    fileGone: "backup.deleteWithoutSnapshotNoTrashFileGone",
    folderGone: "backup.deleteWithoutSnapshotNoTrashFolderGone",
  },
  "trash-unavailable": {
    file: "backup.deleteWithoutSnapshotTrashFile",
    folder: "backup.deleteWithoutSnapshotTrashFolder",
    fileGone: "backup.deleteWithoutSnapshotTrashFileGone",
    folderGone: "backup.deleteWithoutSnapshotTrashFolderGone",
  },
} as const;

/**
 * The question for one refused deletion: a file; a folder with the files
 * below it that have no copy; or a folder that could not be listed at all
 * (`total` 0), which is named itself.
 */
export function deletionNetQuestion(t: Translate, refusal: Refusal): DeletionNetQuestion {
  const texts = TEXTS[refusal.net];
  const file = !refusal.folder;
  const shown = refusal.uncovered.slice(0, DELETION_NET_LIST_MAX);
  const rest = refusal.uncovered.length - shown.length;
  const intro = file
    ? t(texts.file)
    : refusal.total === 0
      ? t("backup.deleteWithoutSnapshotUnlisted")
      : t(texts.folder, { failed: refusal.uncovered.length, total: refusal.total });
  const list = [...shown, ...(rest > 0 ? [t("backup.deleteWithoutSnapshotMore", { rest })] : [])].join("\n");
  return {
    title: t("backup.deleteWithoutSnapshotTitle"),
    message: `${intro}\n${list}\n\n${t(file ? texts.fileGone : texts.folderGone)}`,
    confirmLabel: t("backup.deleteAnyway"),
  };
}

const MANY_TEXTS = {
  "no-trash": "backup.deleteWithoutSnapshotNoTrashMany",
  "trash-unavailable": "backup.deleteWithoutSnapshotTrashMany",
} as const;

/**
 * The ONE question for several refused deletions of one batch (a selection,
 * a cascade): every file without a copy, named together — not a question per
 * file. One refusal is asked as itself.
 */
export function deletionNetManyQuestion(t: Translate, refusals: readonly Refusal[]): DeletionNetQuestion {
  if (refusals.length === 1) return deletionNetQuestion(t, refusals[0]!);
  const net = refusals[0]!.net;
  const uncovered = refusals.flatMap((refusal) => (refusal.uncovered.length > 0 ? refusal.uncovered : [refusal.path]));
  const shown = uncovered.slice(0, DELETION_NET_LIST_MAX);
  const rest = uncovered.length - shown.length;
  const list = [...shown, ...(rest > 0 ? [t("backup.deleteWithoutSnapshotMore", { rest })] : [])].join("\n");
  return {
    title: t("backup.deleteWithoutSnapshotTitle"),
    message: `${t(MANY_TEXTS[net], { items: refusals.length })}\n${list}\n\n${t(TEXTS[net].folderGone)}`,
    confirmLabel: t("backup.deleteAnyway"),
  };
}

let host: ((question: DeletionNetQuestion) => Promise<boolean>) | null = null;

/** The shell's dialog for the question (danger, "Cancel" preselected); true = delete anyway. */
export function registerDeletionNetQuestion(ask: ((question: DeletionNetQuestion) => Promise<boolean>) | null): void {
  host = ask;
}

/** Puts the question for `refusal`; false without a registered dialog. */
export async function askDeleteWithoutSnapshot(refusal: Refusal): Promise<boolean> {
  if (!host) return false;
  return host(deletionNetQuestion((key, options) => i18n.t(key, options), refusal));
}

/** Who answers "Delete without a backup?" for one deletion: true = delete anyway. */
export type DeletionNetAsk = (refusal: Refusal) => Promise<boolean>;

/**
 * A deletion a person asked for, through the chain and its net rule: true
 * where it was deleted, false where the person kept it at the question.
 * Every way a person deletes a file or folder in either shell goes here
 * (`deletionNetGuard.test.ts`). `ask` is the question's dialog; a batch
 * hands in its own (`deleteEachWithNet`).
 */
export function deleteWithNet(
  files: Pick<IVaultAdapter, "deleteItem">,
  path: string,
  recursive?: boolean,
  confirmation: DeletionConfirmation = { confirmed: true },
  ask: DeletionNetAsk = askDeleteWithoutSnapshot,
): Promise<boolean> {
  return deleteWithSafetyNet((c) => files.deleteItem(path, recursive, c), ask, confirmation);
}

/** What became of one item of a batch: deleted, kept at the question, or failed. */
export type DeletionOutcome<T> = { item: T; deleted: boolean } | { item: T; error: unknown };

/**
 * Several deletions a person asked for at once — a selection, a cascade —
 * with ONE question for every item that has no net (finding A12 of release
 * 0.9.0: a full phone asked once per file).
 *
 * First every item is deleted where it has a net; an item without one is
 * kept and its refusal noted. Then one question names them all; only a
 * "Delete anyway" runs those items again, each through `remove` with an
 * answer that is already yes. `remove` is the shell's whole deletion of one
 * item (flushes, index, notifications) and hands `ask` to `deleteWithNet`.
 * An error of one item does not stop the others. Outcomes keep the order
 * of `items`.
 */
export async function deleteEachWithNet<T>(
  items: readonly T[],
  remove: (item: T, ask: DeletionNetAsk) => Promise<boolean>,
): Promise<DeletionOutcome<T>[]> {
  const outcomes: DeletionOutcome<T>[] = [];
  const refused: { at: number; refusal: Refusal }[] = [];
  for (const item of items) {
    const seen: { refusal: Refusal | null } = { refusal: null };
    const note: DeletionNetAsk = async (refusal) => {
      seen.refusal = refusal;
      return false;
    };
    try {
      const deleted = await remove(item, note);
      if (!deleted && seen.refusal) refused.push({ at: outcomes.length, refusal: seen.refusal });
      outcomes.push({ item, deleted });
    } catch (error) {
      outcomes.push({ item, error });
    }
  }
  if (refused.length === 0 || !host) return outcomes;
  const yes = await host(deletionNetManyQuestion((key, options) => i18n.t(key, options), refused.map((r) => r.refusal)));
  if (!yes) return outcomes;
  for (const { at } of refused) {
    const item = outcomes[at]!.item;
    try {
      outcomes[at] = { item, deleted: await remove(item, async () => true) };
    } catch (error) {
      outcomes[at] = { item, error };
    }
  }
  return outcomes;
}

/**
 * An exit of a conflict comparison through the same rule: the copy it lets
 * go is deleted with a net, or after the person's "Delete anyway" — `settle`
 * runs again with `withoutSnapshot`. False where the person kept the copy;
 * both files are then as they were. Both shells' comparisons settle here.
 */
export function settleWithNet(settle: (noNet: { withoutSnapshot?: true }) => Promise<void>): Promise<boolean> {
  return deleteWithSafetyNet((c) => settle(c.withoutSnapshot ? { withoutSnapshot: true } : {}), askDeleteWithoutSnapshot);
}
