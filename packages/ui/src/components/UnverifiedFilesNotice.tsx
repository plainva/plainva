import { useState } from "react";
import { useTranslation } from "react-i18next";
import { errorText } from "../lib/errorText";
import { readSeenUnverifiedFiles, unverifiedFilesSignature, writeSeenUnverifiedFiles } from "../lib/unverifiedFilesSeen";
import { toast } from "../services/toastStore";
import { Banner } from "./ui/Banner";
import { Button } from "./ui/Button";
import { GroupCard, Row, RowList } from "./ui/GroupedRows";
import { Modal } from "./ui/Modal";
import { cx } from "./ui/cx";

/**
 * "Google Drive no longer reports N files" (D7, mockup M2): ONE surface for
 * both shells. These are files with changes of this device that Drive's
 * listing does not carry and that could not be asked about by an id of their
 * own. Plainva neither deletes nor uploads them on its own — nothing says
 * whether the original still exists — and names them here. **Upload again**
 * sends one as a new file (a sentence says Drive may then hold two), **Hide**
 * puts the notice away until the set changes.
 *
 * The desktop lists the files inside the notice; on the phone the notice opens
 * the same list as a sheet (`sheet`).
 */
export interface UnverifiedFilesNoticeProps {
  paths: readonly string[];
  /** Hide is remembered per vault; null remembers nothing. */
  vaultKey: string | null;
  /** Sends these files up as new ones; the number queued. */
  onUploadAgain(paths: readonly string[]): Promise<number>;
  /** The phone: the notice opens the list as a sheet. */
  sheet?: boolean;
  className?: string;
}

export function UnverifiedFilesNotice({ paths, vaultKey, onUploadAgain, sheet, className }: UnverifiedFilesNoticeProps) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const signature = unverifiedFilesSignature(paths);
  const [hiddenFor, setHiddenFor] = useState<string | null>(() => readSeenUnverifiedFiles(vaultKey));
  if (paths.length === 0 || hiddenFor === signature) return null;
  const sorted = [...paths].sort();

  const run = async (which: readonly string[]) => {
    setBusy(true);
    try {
      const queued = await onUploadAgain(which);
      if (queued > 0) toast.success(t("sync.unverifiedDone", { count: queued }));
      if (which.length === sorted.length) setOpen(false);
    } catch (e) {
      toast.error(t("sync.collisionFailed", { error: errorText(e) }));
    } finally {
      setBusy(false);
    }
  };
  const hide = () => {
    writeSeenUnverifiedFiles(vaultKey, signature);
    setHiddenFor(signature);
    setOpen(false);
  };

  const list = (
    <>
      <GroupCard>
        <RowList>
          {sorted.map((path) => (
            <Row
              key={path}
              data-testid="sync-unverified-file"
              title={<span>{path}</span>}
              end={
                <Button variant="secondary" size="sm" disabled={busy} onClick={() => void run([path])} data-testid="sync-unverified-one">
                  {t("sync.unverifiedUploadAgain")}
                </Button>
              }
            />
          ))}
        </RowList>
      </GroupCard>
      <p className="pv-prow-hint">{t("sync.unverifiedTwice")}</p>
    </>
  );

  return (
    <div className={cx("pv-names-notice", className)} data-testid="sync-unverified">
      <Banner
        kind="warning"
        rounded
        actions={
          <>
            <Button variant="ghost" size="sm" disabled={busy} onClick={hide} data-testid="sync-unverified-hide">
              {t("sync.unverifiedHide")}
            </Button>
            {sheet ? (
              <Button variant="primary" size="sm" onClick={() => setOpen(true)} data-testid="sync-unverified-view">
                {t("sync.unverifiedView")}
              </Button>
            ) : (
              <Button variant="primary" size="sm" disabled={busy} onClick={() => void run(sorted)} data-testid="sync-unverified-all">
                {t("sync.unverifiedUploadAll")}
              </Button>
            )}
          </>
        }
      >
        <strong data-testid="sync-unverified-title">{t("sync.unverifiedTitle", { count: sorted.length })}</strong>{" "}
        {sheet ? t("sync.unverifiedBodyShort") : t("sync.unverifiedBody")}
      </Banner>
      {!sheet && list}
      {sheet && open && (
        <Modal
          onClose={() => setOpen(false)}
          title={t("sync.unverifiedSheetTitle")}
          testId="sync-unverified-sheet"
          footer={
            <Button variant="primary" disabled={busy} onClick={() => void run(sorted)} data-testid="sync-unverified-all">
              {t("sync.unverifiedUploadAll")}
            </Button>
          }
        >
          <div className="pv-names-notice">
            <p className="pv-prow-hint">{t("sync.unverifiedBody")}</p>
            {list}
          </div>
        </Modal>
      )}
    </div>
  );
}
