import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { WorkspacePublicationRecord } from "@plainva/core";
import { Banner, Button } from "@plainva/ui";
import { SheetGrip } from "./SheetGrip";

/**
 * Withdrawing a publication from the phone (M5) — the mobile shape of the
 * desktop's withdraw dialog, on the same three warnings.
 *
 * The sheet leads with the boundary rather than burying it: withdrawing does
 * not take back what somebody already copied. It buys that nothing new arrives
 * and that the next epoch is unreadable — which is a smaller promise than
 * "access revoked" and the only one this can keep (SE4).
 *
 * A confirmation step rather than a straight tap, because the action cannot be
 * undone: the recipients' keys stop working and the publication is forgotten
 * here (SC3).
 */

/** Brand names, not translatable strings — identical in all ten languages. */
const PROVIDER_NAMES: Record<string, string> = {
  "google-drive": "Google Drive",
  onedrive: "OneDrive",
  nextcloud: "Nextcloud",
  dropbox: "Dropbox",
  webdav: "WebDAV",
  s3: "S3",
};

export function WithdrawPublicationSheet({
  record,
  onClose,
  onWithdraw,
}: {
  record: WorkspacePublicationRecord;
  onClose: () => void;
  /** Retracts every object and forgets the publication; resolves when done. */
  onWithdraw: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /* Two taps, one sheet: the first names what happens, the second does it. A
     separate confirm dialog would put the warnings on the screen the reader
     just dismissed. */
  const [confirming, setConfirming] = useState(false);

  const submit = () => {
    if (busy) return;
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setBusy(true);
    setError(null);
    void onWithdraw().catch((e: unknown) => {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    });
  };

  return (
    <div className="m-sheet-backdrop m-sheet-backdrop--dialog" onClick={onClose}>
      <div className="pv-sheet m-sheet" data-testid="withdraw-publication-sheet" onClick={(e) => e.stopPropagation()}>
        <SheetGrip onClose={onClose} />
        <p className="m-sheet-title">
          {t("workspaceSecurity.withdrawPublication", { defaultValue: "Withdraw publication" })}
        </p>
        <p className="m-hint">{record.config.name}</p>

        {/* The boundary first — it is the part a reader is most likely to get
            wrong, and the one that cannot be softened. */}
        <Banner kind="warning" rounded>
          {t("workspaceSecurity.withdrawBoundary", {
            defaultValue:
              "Withdrawing does not take back what someone already has. Whoever copied the bytes and holds the key can still read them. What it does: from now on nothing new reaches them, and the next epoch is unreadable for them.",
          })}
        </Banner>

        <p className="m-hint">
          {t("workspaceSecurity.withdrawPublicationHint", {
            defaultValue:
              "Every object this publication holds is retracted and the publication is forgotten here. Recipients keep no working key.",
          })}
        </p>
        {/* Named rather than silently left behind: Plainva does not manage other
            systems' sharing settings, so the folder stays shared until somebody
            unshares it there. */}
        <p className="m-hint">
          {t("workspaceSecurity.withdrawProviderHint", {
            provider: PROVIDER_NAMES[record.config.provider] ?? record.config.provider,
            defaultValue:
              "The folder at {{provider}} stays where it is. Plainva does not manage other systems' sharing settings - remove the share there yourself.",
          })}
        </p>

        {error && (
          <Banner kind="error" rounded>
            {error}
          </Banner>
        )}

        <div className="m-btnrow">
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="danger"
            data-testid="withdraw-publication-submit"
            disabled={busy}
            onClick={submit}
          >
            {busy ? <span className="m-actionspin" aria-hidden /> : null}
            {confirming
              ? t("common.confirm", { defaultValue: "Confirm" })
              : t("workspaceSecurity.withdrawPublication", { defaultValue: "Withdraw publication" })}
          </Button>
        </div>
      </div>
    </div>
  );
}
