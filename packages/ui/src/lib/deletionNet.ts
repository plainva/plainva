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

/**
 * A deletion a person asked for, through the chain and its net rule: true
 * where it was deleted, false where the person kept it at the question.
 * Every way a person deletes a file or folder in either shell goes here
 * (`deletionNetGuard.test.ts`).
 */
export function deleteWithNet(
  files: Pick<IVaultAdapter, "deleteItem">,
  path: string,
  recursive?: boolean,
  confirmation: DeletionConfirmation = { confirmed: true },
): Promise<boolean> {
  return deleteWithSafetyNet((c) => files.deleteItem(path, recursive, c), askDeleteWithoutSnapshot, confirmation);
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
