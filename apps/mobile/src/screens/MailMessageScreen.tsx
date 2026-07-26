import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, FileText, Paperclip, Reply, Star, Trash2 } from "lucide-react";
import { EmptyState, safeFileStem, toast } from "@plainva/ui";
import type { MailAccountConfig, MailMessage } from "@plainva/ui/mail";
import {
  buildMailFrameDoc,
  buildReplyBody,
  captureMailAsNote,
  fetchAttachment,
  deleteMessagePermanently,
  fetchMessage,
  guessTrashMailbox,
  listMailboxesFor,
  moveMessage,
  sanitizeEmailHtml,
  setMessageFlagged,
  setMessageSeen,
} from "@plainva/ui/mail";
import { mConfirm } from "../services/mobileDialogs";
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
  onReply,
  flagged: initialFlagged = false,
}: {
  vault: MobileVault;
  accountId: string;
  mailbox: string;
  messageId: string;
  onBack: () => void;
  onOpenNote: (path: string) => void;
  onReply: (draft: { accountId: string; to: string; subject: string; body: string }) => void;
  /** Envelope flag from the list — a fetched message carries none, so the star
   *  would otherwise always start empty (the reason G1 left it out). */
  flagged?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const [account, setAccount] = useState<MailAccountConfig | null>(null);
  const [message, setMessage] = useState<MailMessage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showRemote, setShowRemote] = useState(false);
  const [busy, setBusy] = useState(false);
  const [flagged, setFlagged] = useState(initialFlagged);
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
      .catch((e) => !cancelled && setError(describe(e, t)));
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

  const toggleFlag = async () => {
    if (!vaultId || !account) return;
    const next = !flagged;
    setFlagged(next); // optimistic: the star must answer the tap at once
    try {
      await setMessageFlagged(vaultId, account, mailbox, messageId, next);
    } catch (e) {
      setFlagged(!next);
      toast.error(describe(e, t));
    }
  };

  /** Trash, not shred: the message moves to the trash folder, exactly like the
   *  desktop. Only a message ALREADY in the trash is deleted for good. */
  const remove = async () => {
    if (!vaultId || !account) return;
    setBusy(true);
    try {
      const boxes = await listMailboxesFor(vaultId, account);
      const trash = guessTrashMailbox(boxes.map((b) => b.name), boxes[0]?.delimiter);
      const inTrash = trash !== null && trash === mailbox;
      if (inTrash) {
        if (!(await mConfirm({ title: t("mail.deleteForeverConfirm"), danger: true }))) return;
        await deleteMessagePermanently(vaultId, account, mailbox, messageId);
      } else if (trash) {
        await moveMessage(vaultId, account, mailbox, messageId, trash);
      } else {
        toast.error(t("mail.noTrashFolder"));
        return;
      }
      toast.success(t("mail.deleted"));
      onBack();
    } catch (e) {
      toast.error(describe(e, t));
    } finally {
      setBusy(false);
    }
  };

  /** Saves an attachment into the vault, next to where captured mail lands —
   *  a phone has no "download folder" the app may write to, and a file inside
   *  the vault syncs with everything else. */
  const saveAttachment = async (index: number, name: string) => {
    if (!vaultId || !account) return;
    setBusy(true);
    try {
      const base64 = await fetchAttachment(vaultId, account, mailbox, messageId, index);
      const folder = `${getMobileSettings().mailFolder || "Mail"}/Attachments`;
      await vault.files.createDir(folder).catch(() => undefined);
      const safe = safeFileStem(name.replace(/\.[^.]+$/, "")) ?? "attachment";
      const ext = /\.([^.]+)$/.exec(name)?.[1] ?? "bin";
      let path = `${folder}/${safe}.${ext}`;
      // Never overwrite: two mails may carry the same file name.
      for (let n = 2; await vault.files.exists(path); n++) path = `${folder}/${safe}-${n}.${ext}`;
      const bin = atob(base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      await vault.files.writeBinaryFile(path, bytes);
      toast.success(t("mail.attachmentSaved", { name: path }));
    } catch (e) {
      toast.error(describe(e, t));
    } finally {
      setBusy(false);
    }
  };

  const capture = async () => {
    if (!message || !account) return;
    setBusy(true);
    try {
      const folder = getMobileSettings().mailFolder || "Mail";
      const res = await captureMailAsNote({ adapter: vault.files, message, accountId: account.id, mailbox, folder });
      toast.success(res.created ? t("mail.captured", { name: res.path }) : t("mail.noteExists"));
      onOpenNote(res.path);
    } catch (e) {
      toast.error(describe(e, t));
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
        <button
          type="button"
          className="m-iconbtn"
          aria-label={t("mail.flag")}
          aria-pressed={flagged}
          onClick={() => void toggleFlag()}
        >
          <Star size={18} className={flagged ? "m-mailrow-flag" : undefined} />
        </button>
        <button type="button" className="m-iconbtn" aria-label={t("mail.delete")} disabled={busy} onClick={() => void remove()}>
          <Trash2 size={18} />
        </button>
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
            <ul className="m-maillist">
              {message.attachments.map((a) => (
                <li key={a.index}>
                  <button
                    type="button"
                    className="m-row"
                    disabled={busy}
                    onClick={() => void saveAttachment(a.index, a.name)}
                  >
                    <Paperclip size={16} />
                    <span className="m-linestack">
                      {a.name}
                      <small>{formatSize(a.size)}</small>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="m-btnrow">
            <button
              type="button"
              className="m-btn m-btn--tonal"
              onClick={() =>
                onReply({
                  accountId,
                  to: message.from,
                  subject: message.subject.toLowerCase().startsWith("re:") ? message.subject : `Re: ${message.subject}`,
                  body: buildReplyBody(message),
                })
              }
            >
              <Reply size={16} />
              {t("mail.reply")}
            </button>
            <button type="button" className="m-btn m-btn--filled" disabled={busy} onClick={() => void capture()}>
              <FileText size={16} />
              {t("mail.captureNote")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** IMAP has its own message where no socket exists (the web dev server). */
function describe(e: unknown, t: (k: string) => string): string {
  if (isImapUnavailable(e)) return t("mail.imapMobileUnavailable");
  return e instanceof Error ? e.message : String(e);
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
