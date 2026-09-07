import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "@plainva/ui";
import type { CommentBundleFault } from "@plainva/core";
import { shareVaultText } from "../services/shareFile";
import type { MobileVault } from "../services/vaultService";

/**
 * A comment file that could not be read (Nachschaerfung, N3).
 *
 * The store and the sideband never overwrite such a file: this phone's own is
 * set aside, anybody else's is left where it is. The person gets ONE message
 * per file and reason with what happened, plus a diagnosis to share - paths
 * and reason codes, never comment text. The desktop's counterpart is
 * `services/commentFaults.ts`; the phone shares the file instead of saving it.
 */
export function describeCommentFaults(faults: readonly CommentBundleFault[], t: (key: string, vars?: Record<string, string>) => string): string {
  return faults
    .map((fault) => {
      const reason = t(`workspaceSecurity.commentFaultReason.${fault.reason}`);
      const file = fault.path.replace(/^remote:/, "");
      return fault.movedTo
        ? t("workspaceSecurity.commentFileSetAside", { file: fault.movedTo, reason })
        : t("workspaceSecurity.commentFileUnreadable", { file, reason });
    })
    .join("\n");
}

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

export function useCommentFaults(vault: MobileVault | null): void {
  const { t } = useTranslation();
  useEffect(() => {
    if (!vault) return;
    const reported = new Set<string>();
    const onFaults = (event: Event) => {
      const detail = (event as CustomEvent<{ vaultId?: string; faults?: CommentBundleFault[] }>).detail;
      if (!detail?.faults || (detail.vaultId && detail.vaultId !== vault.vaultId)) return;
      const fresh = detail.faults.filter((fault) => {
        const key = `${fault.path}|${fault.reason}`;
        if (reported.has(key)) return false;
        reported.add(key);
        return true;
      });
      if (fresh.length === 0) return;
      toast.warning(describeCommentFaults(fresh, t), {
        label: t("workspaceSecurity.commentFaultExport"),
        run: () => {
          void shareVaultText(`Plainva-Comments-Diagnostics-${new Date().toISOString().slice(0, 10)}.json`, commentFaultDiagnostics(fresh), "application/json").catch((error) => toast.error(error instanceof Error ? error.message : String(error)));
        },
      });
    };
    window.addEventListener("plainva-comment-faults", onFaults);
    return () => window.removeEventListener("plainva-comment-faults", onFaults);
  }, [vault, t]);
}
