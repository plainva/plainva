import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { toast } from "@plainva/ui";
import i18n from "@plainva/ui/i18n";
import type { CommentBundleFault } from "@plainva/core";

/**
 * A comment file that could not be read (Nachschaerfung, N3).
 *
 * The store and the sideband never overwrite such a file: this device's own is
 * set aside, anybody else's is left where it is. What used to happen next was
 * nothing - the next cycle wrote the local state over the broken remote, and a
 * toast without a reason went by. Now the file stays, and the person gets ONE
 * message per file and reason with what happened, plus a diagnosis to export
 * - the same shape as the workspace quarantine, without the epochs and
 * signatures a plain vault does not have. The export carries paths and reason
 * codes, never comment text.
 */
export function describeCommentFaults(faults: readonly CommentBundleFault[]): string {
  const t = i18n.t.bind(i18n);
  return faults
    .map((fault) => {
      const reason = t(`workspaceSecurity.commentFaultReason.${fault.reason}`, { defaultValue: fault.reason });
      const file = fault.path.replace(/^remote:/, "");
      return fault.movedTo
        ? t("workspaceSecurity.commentFileSetAside", { file: fault.movedTo, reason })
        : t("workspaceSecurity.commentFileUnreadable", { file, reason });
    })
    .join("\n");
}

/** The diagnosis file: what could not be read, why, and where it went - no content. */
export function commentFaultDiagnostics(faults: readonly CommentBundleFault[]): string {
  return JSON.stringify(
    {
      format: "plainva-comment-fault-diagnostics",
      version: 1,
      exportedAt: new Date().toISOString(),
      faults: faults.map((fault) => ({ path: fault.path, reason: fault.reason, message: fault.message, movedTo: fault.movedTo ?? null })),
    },
    null,
    2,
  );
}

/**
 * Listens for faults from the store and the sideband, and says each once.
 * Installed by the owner window for the life of a vault; a client window has
 * no store and no sideband, so nothing reaches it.
 */
export function installCommentFaultReporter(vaultPath: string): () => void {
  const reported = new Set<string>();
  const onFaults = (event: Event) => {
    const detail = (event as CustomEvent<{ vaultPath?: string; faults?: CommentBundleFault[] }>).detail;
    if (!detail?.faults || (detail.vaultPath && detail.vaultPath !== vaultPath)) return;
    const fresh = detail.faults.filter((fault) => {
      const key = `${fault.path}|${fault.reason}`;
      if (reported.has(key)) return false;
      reported.add(key);
      return true;
    });
    if (fresh.length === 0) return;
    toast.warning(describeCommentFaults(fresh), {
      label: i18n.t("workspaceSecurity.commentFaultExport"),
      run: () => {
        void (async () => {
          const target = await save({ defaultPath: `Plainva-Comments-Diagnostics-${new Date().toISOString().slice(0, 10)}.json` });
          if (target) await writeFile(target, new TextEncoder().encode(commentFaultDiagnostics(fresh)));
        })().catch((error) => toast.error(error instanceof Error ? error.message : String(error)));
      },
    });
  };
  window.addEventListener("plainva-comment-faults", onFaults);
  return () => window.removeEventListener("plainva-comment-faults", onFaults);
}
