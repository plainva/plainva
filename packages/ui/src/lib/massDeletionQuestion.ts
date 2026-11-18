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

/**
 * What the pull-side guard reports. The encrypted workspace's question is its
 * own (`fromWorkspaceDevice`, review of release 0.9.0): another device of the
 * workspace deleted the files — no cloud lost them, and nobody needs to look
 * whether they are still there. Its protocol carries no confirmation of a
 * deletion, so it asks even when that device confirmed it. `staysLocal`: how
 * many of the files this member may not put back for the others; keeping
 * those means here only, as the device's own version.
 */
export interface SuspendedDeletionInfo {
  missing: number;
  confirmed: number;
  probed: number;
  absent: number;
  fromWorkspaceDevice?: true;
  staysLocal?: number;
}

/** The pull-side question's texts, for both workers. */
export function suspendedDeletionQuestion(info: SuspendedDeletionInfo): MassDeletionQuestion {
  const { missing, confirmed, probed, absent } = info;
  if (info.fromWorkspaceDevice) {
    const local = info.staysLocal ?? 0;
    return {
      title: i18n.t("sync.workspacePullGuardTitle"),
      message: local > 0
        ? i18n.t("sync.workspacePullGuardBodyLocal", { n: missing, total: confirmed, local })
        : i18n.t("sync.workspacePullGuardBody", { n: missing, total: confirmed }),
      confirmLabel: i18n.t("sync.pullGuardApply"),
      cancelLabel: local === 0 ? i18n.t("sync.pullGuardKeep") : local >= missing ? i18n.t("sync.workspacePullGuardKeepHere") : i18n.t("sync.workspacePullGuardKeepMixed"),
    };
  }
  return {
    title: i18n.t("sync.pullGuardTitle"),
    message: absent > 0
      ? i18n.t("sync.pullGuardBody", { n: missing, total: confirmed, absent, probed })
      : i18n.t("sync.pullGuardBodyUnverified", { n: missing, total: confirmed }),
    confirmLabel: i18n.t("sync.pullGuardApply"),
    cancelLabel: i18n.t("sync.pullGuardKeep"),
  };
}

/** A worker whose incoming deletions the pull-side guard can hold: the plain sync's and the encrypted workspace's. */
export interface SuspendedDeletionAnswers {
  approveSuspendedDeletions(): void;
  keepSuspendedDeletionsLocal(): Promise<number>;
}

/**
 * The pull-side question, once for both shells and both workers (review of
 * release 0.9.0 A4: the encrypted workspace holds another device's mass
 * deletion too). Many synced files would go here, and nobody confirmed their
 * deletion in Plainva. Since 2026-09-20 the plain worker has asked the remote
 * about a sample first — had one been alive, there would be no question
 * (`onListingIncomplete`) — so the dialog says what was checked, or that
 * nothing could be. Dismissing takes the safe branch: the local copies stay
 * and go up again.
 */
export async function askSuspendedDeletions(
  worker: SuspendedDeletionAnswers,
  info: SuspendedDeletionInfo,
  confirm: (question: MassDeletionQuestion) => Promise<boolean>,
): Promise<void> {
  const applyHere = await confirm(suspendedDeletionQuestion(info));
  if (applyHere) {
    worker.approveSuspendedDeletions();
    return;
  }
  const staysLocal = info.fromWorkspaceDevice ? info.staysLocal ?? 0 : 0;
  try {
    const kept = await worker.keepSuspendedDeletionsLocal();
    toast.info(staysLocal > 0
      ? i18n.t("sync.workspacePullGuardKeptLocal", { count: kept, local: Math.min(staysLocal, kept) })
      : i18n.t("sync.pullGuardKept", { count: kept }));
  } catch (error) {
    console.error("[massDeletion] keeping the held deletions failed", error);
    toast.error(i18n.t("sync.pullGuardFailed"));
  }
}
