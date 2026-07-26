import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, FileText } from "lucide-react";
import { EmptyState, toast } from "@plainva/ui";
import type { MailAccountConfig, MailMessage } from "@plainva/ui/mail";
import { buildMailFrameDoc, captureMailAsNote, fetchMessage, sanitizeEmailHtml, setMessageSeen } from "@plainva/ui/mail";
import { listMobileMailAccounts, mailVaultId } from "../services/mail/mailRuntime";
import { isImapUnavailable } from "../services/mail/mobileMailPlatform";
import { getMobileSettings } from "../services/mobileSettings";
import type { MobileVault } from "../services/vaultService";

/**
 * Reading one message (mail feinplan G1). Two things carry over unchanged from
 * the desktop because they are safety decisions, not styling:
 *
 *  - the body is sanitised and rendered in a sandboxed frame with remote
 *    content BLOCKED by default; loading images is a per-message opt-in.
 *  - "Save as note" is the anchor-first capture, so capturing twice opens the
 *    existing note instead of piling up copies.
 *
 * Flagging, moving and deleting are deliberately NOT here yet: they belong
 * with multi-select in G3, and a star that always starts empty (the envelope
 * flag is not part of a fetched message) would be a lying control.
 */
export function MailMessageScreen({
  vault,
  accountId,
  mailbox,
  messageId,
  onBack,
  onOpenNote,
}: {
  vault: MobileVault;
  accountId: string;
  mailbox: string;
  messageId: string;
  onBack: () => void;
  onOpenNote: (path: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const [account, setAccount] = useState<MailAccountConfig | null>(null);
  const [message, setMessage] = useState<MailMessage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showRemote, setShowRemote] = useState(false);
  const [busy, setBusy] = useState(false);
  const vaultId = mailVaultId();

  useEffect(() => {
    void listMobileMailAccounts().then((rows) => setAccount(rows.find((a) => a.id === accountId) ?? null));
  }, [accountId]);

  useEffect(() => {
    if (!vaultId || !account) return;
    let cancelled = false;
    void fetchMessage(vaultId, account, mailbox, messageId)
      .then((m) => {
        if (cancelled) return;
        setMessage(m);
        // Opening a message marks it read, like every mail client; a failure
        // here must not swallow the message itself.
        void setMessageSeen(vaultId, account, mailbox, messageId, true).catch(() => undefined);
      })
      .catch((e) => !cancelled && setError(isImapUnavailable(e) ? t("mail.imapMobileUnavailable") : String(e instanceof Error ? e.message : e)));
    return () => {
      cancelled = true;
    };
  }, [vaultId, account, mailbox, messageId, t]);

  const alwaysRemote = getMobileSettings().mailRemoteImages === true;
  const frame = useMemo(() => {
    if (!message) return null;
    if (message.html) {
      const allowRemote = showRemote || alwaysRemote;
      const clean = sanitizeEmailHtml(message.html, { allowRemoteImages: allowRemote });
      return { doc: buildMailFrameDoc(clean.html, { allowRemoteImages: allowRemote }), blocked: clean.blockedRemote };
    }
    return null;
  }, [message, showRemote, alwaysRemote]);

  const capture = async () => {
    if (!message || !account) return;
    setBusy(true);
    try {
      const folder = getMobileSettings().mailFolder || "Mail";
      const res = await captureMailAsNote({ adapter: vault.files, message, accountId: account.id, mailbox, folder });
      toast.success(res.created ? t("mail.captured", { name: res.path }) : t("mail.noteExists"));
      onOpenNote(res.path);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="m-page">
      <header className="m-header">
        <button aria-label={t("common.back", { defaultValue: "Zurück" })} className="m-iconbtn" onClick={onBack}>
          <ChevronLeft size={20} />
        </button>
        <h1>{message?.subject || t("mail.noSubject")}</h1>
      </header>

      {error ? (
        <EmptyState icon={<FileText size={20} />}>{error}</EmptyState>
      ) : !message ? (
        <p className="m-hint">{t("common.loading", { defaultValue: "…" })}</p>
      ) : (
        <>
          <div className="m-mailmeta">
            <p className="m-mailmeta-from">{message.from}</p>
            <p className="m-mailmeta-to">{message.to}</p>
            <p className="m-mailmeta-date">
              {message.dateTs ? new Date(message.dateTs).toLocaleString(i18n.language) : ""}
            </p>
          </div>

          {frame?.blocked ? (
            <button type="button" className="m-btn m-btn--ghost" onClick={() => setShowRemote(true)}>
              {t("mail.showImages")}
            </button>
          ) : null}

          {frame ? (
            <iframe className="m-mailframe" sandbox="" srcDoc={frame.doc} title={message.subject || "E-Mail"} />
          ) : (
            <pre className="m-mailtext">{message.text ?? ""}</pre>
          )}

          {message.attachments.length > 0 && (
            <p className="m-hint">{t("mail.attachmentsMobile", { count: message.attachments.length })}</p>
          )}

          <button type="button" className="m-btn m-btn--filled" disabled={busy} onClick={() => void capture()}>
            <FileText size={16} />
            {t("mail.captureNote")}
          </button>
        </>
      )}
    </div>
  );
}
