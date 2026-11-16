import i18n from "../i18n";
import { toast } from "../services/toastStore";

/** A worker whose queue the mass-deletion guard can hold: the plain sync's and the encrypted workspace's. */
export interface MassDeletionAnswers {
  approveMassDeletion(): void;
  discardMassDeletion(): Promise<number>;
}

/** The question's texts, ready for the shell's dialog (desktop `appConfirm`, phone `mConfirm`). */
export interface MassDeletionQuestion {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
}

/**
 * The mass-deletion question, once for both shells and both workers
 * (release 0.9.0 A4: the encrypted workspace asks it too, with the plain
 * sync's texts). A large share of the synced files is queued for deletion
 * on the other devices, and nobody deleted them in Plainva — typically the
 * vault folder was emptied, moved or its drive unmounted. Never carried out
 * silently: asked. Dismissing takes the safe branch: the deletions are
 * discarded and the files restored. The person learns whether the restore
 * worked (desktop rule, carried over 2026-08-19) — going quiet would mean
 * believing the files are back while the deletions still stand.
 */
export async function askMassDeletion(
  worker: MassDeletionAnswers,
  info: { pendingDeletes: number; syncedTotal: number },
  confirm: (question: MassDeletionQuestion) => Promise<boolean>,
): Promise<void> {
  const confirmed = await confirm({
    title: i18n.t("sync.massDeleteTitle"),
    message: i18n.t("sync.massDeleteBody", { n: info.pendingDeletes, total: info.syncedTotal }),
    confirmLabel: i18n.t("sync.massDeleteConfirm"),
    cancelLabel: i18n.t("sync.massDeleteRestore"),
  });
  if (confirmed) {
    worker.approveMassDeletion();
    return;
  }
  try {
    const discarded = await worker.discardMassDeletion();
    toast.info(i18n.t("sync.massDeleteRestored", { n: discarded }));
  } catch (error) {
    console.error("[massDeletion] discarding the held deletions failed", error);
    toast.error(i18n.t("sync.massDeleteRestoreFailed"));
  }
}
