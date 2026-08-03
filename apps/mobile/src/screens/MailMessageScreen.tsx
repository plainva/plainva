import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { FileText, ListChecks, MoreVertical, Paperclip, Reply, ReplyAll, Forward, Star, Trash2 } from "lucide-react";
import { Banner, Button, createTaskInDatabase, EmptyState, ICON, IconButton, safeFileStem, toast } from "@plainva/ui";
import type { MailAccountConfig, MailMessage } from "@plainva/ui/mail";
import {
  buildMailFrameDoc,
  buildReplyBody,
  buildForwardBody,
  replyAllRecipients,
  cacheMessage,
  cachedMessage,
  captureMailAsNote,
  fetchRawMessage,
  saveEmlFile,
  mailDayKey,
  fetchAttachment,
  deleteMessagePermanently,
  fetchMessage,
  guessTrashMailbox,
  listMailboxesFor,
  listEnvelopes,
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
import { AppBar } from "../components/AppBar";
import { mailStatus } from "./mail/mailStatus";
import { RowActionSheet } from "../components/RowActionSheet";
import { undoMoveToTrash } from "./mail/undoMove";

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
  const [stale, setStale] = useState(false);
  const [menu, setMenu] = useState(false);
  const vaultId = mailVaultId();

  useEffect(() => {
    void listMobileMailAccounts().then((rows) => setAccount(rows.find((a) => a.id === accountId) ?? null));
  }, [accountId]);

  useEffect(() => {
    if (!vaultId || !account) return;
    let cancelled = false;
    // Cache first (F4a): a message read once appears instantly while the fetch
    // runs. Remote images stay blocked either way, so nothing loads early.
    void cachedMessage(vault?.db, accountId, mailbox, messageId).then((warm) => {
      if (cancelled || !warm) return;
      setMessage((shown) => shown ?? warm);
    });
    void fetchMessage(vaultId, account, mailbox, messageId)
      .then((m) => {
        if (cancelled) return;
        setMessage(m);
        void cacheMessage(vault?.db, accountId, mailbox, m);
        // Opening a message marks it read, like every mail client; a failure
        // here must not swallow the message itself.
        void setMessageSeen(vaultId, account, mailbox, messageId, true).catch(() => undefined);
      })
      .catch(async (e) => {
        if (cancelled) return;
        // Offline: show the copy from when it was last read, and say so.
        const cached = await cachedMessage(vault?.db, accountId, mailbox, messageId);
        if (cached) {
          setMessage(cached);
          setStale(true);
        } else {
          setError(describe(e, t));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [vaultId, account, vault, accountId, mailbox, messageId, t]);

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

  /**
   * One reply draft, two recipient sets: the quoting is identical, only WHO
   * receives it differs. The attribution line is built here because it needs
   * the app language and date format — and it marks where the quote begins,
   * so a signature lands above the original rather than inside it.
   */
  /** The ⋮ entries, hoisted so the JSX below stays a plain opening tag. */
  const menuActions = [
    { icon: <ListChecks size={ICON.head} />, label: t("mail.captureTask"), onClick: () => { setMenu(false); void capture("task"); } },
    { icon: <FileText size={ICON.head} />, label: t("mail.captureWithEml"), onClick: () => { setMenu(false); void capture("eml"); } },
    { icon: <Trash2 size={ICON.head} />, label: t("mail.delete"), danger: true, onClick: () => { setMenu(false); void remove(); } },
  ];

  const status = mailStatus({ error: null, unifiedErrors: [], stale, refreshing: false });

  const replyDraft = (to: string) => ({
    accountId,
    to,
    subject: message!.subject.toLowerCase().startsWith("re:") ? message!.subject : `Re: ${message!.subject}`,
    body: buildReplyBody(
      message!,
      message!.from
        ? t("mail.replyAttribution", {
            date: message!.dateTs > 0 ? new Date(message!.dateTs).toLocaleString(i18n.language) : "",
            sender: message!.from,
            defaultValue: "Am {{date}} schrieb {{sender}}:",
          })
        : "",
    ),
  });

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
  const undoMove = async (trash: string, back: string) => {
    if (!vaultId || !account || !message) return;
    try {
      const out = await undoMoveToTrash(
        {
          listNewest: async (box, limit) => (await listEnvelopes(vaultId, account, box, 0, limit)).messages,
          moveMessage: (from, id, to) => moveMessage(vaultId, account, from, id, to),
        },
        { subject: message.subject, dateTs: message.dateTs, from: message.from },
        trash,
        back,
      );
      if (out === "ok") toast.success(t("mail.undone"));
      else toast.info(t("mail.undoNotFound"));
    } catch (e) {
      toast.error(describe(e, t));
    }
  };

  /**
   * Deleting, with a way back (S30).
   *
   * Moving to Trash is reversible by construction — the message is still there,
   * in another folder — so it offers an undo instead of a confirmation: a
   * question before every delete trains people to dismiss questions, and the
   * cost of a wrong tap here is one tap back.
   *
   * Deleting FROM Trash is not reversible, and keeps its confirmation. The two
   * must not look alike, because only one of them can be taken back.
   */
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
        toast.success(t("mail.deleted"));
      } else if (trash) {
        const from = mailbox;
        await moveMessage(vaultId, account, mailbox, messageId, trash);
        toast.success(t("mail.movedToTrash"), {
          label: t("common.undo"),
          run: () => void undoMove(trash, from),
        });
      } else {
        toast.error(t("mail.noTrashFolder"));
        return;
      }
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

  /**
   * Filing a message into the vault (S30). Three destinations, because a mail
   * is not one kind of thing: a note to think in, a task to act on, and the
   * raw `.eml` for when the note is not enough — a signed message, an invoice,
   * anything that has to survive as the original.
   *
   * All three are anchor-first, so capturing the same mail twice reopens what
   * is there instead of making a second copy.
   */
  const capture = async (mode: "note" | "eml" | "task") => {
    if (!message || !account || !vaultId) return;
    setBusy(true);
    try {
      const folder = getMobileSettings().mailFolder || "Mail";
      if (mode === "task") {
        const dbPath = getMobileSettings().taskDatabase.trim();
        if (!dbPath) {
          toast.info(t("tasks.promoteNoDb"));
          return;
        }
        // The same creation path as a promoted checkbox and as "+ Entry", so
        // a task born from a mail is not subtly unlike the others.
        const res = await createTaskInDatabase({
          adapter: vault.files,
          dbPath,
          title: message.subject.trim() || t("mail.noSubject"),
          noteType: getMobileSettings().defaultNoteType,
          dueDate: mailDayKey(message),
          trailer: message.from ? `\n${t("mail.fromLabel")}: ${message.from}\n` : undefined,
        });
        if (!res.ok) {
          toast.error(res.reason === "noFolder" ? t("tasks.promoteNoFolder") : t("tasks.promoteNoDb"));
          return;
        }
        toast.success(t("tasks.promoted", { name: message.subject }));
        onOpenNote(res.notePath);
        return;
      }
      const res = await captureMailAsNote({ adapter: vault.files, message, accountId: account.id, mailbox, folder });
      if (mode === "eml" && res.created) {
        // The raw copy is fetched only when asked for: it is the whole message
        // over the wire again, which on a phone connection is not free.
        const raw = await fetchRawMessage(vaultId, account, mailbox, messageId);
        const emlPath = await saveEmlFile(vault.files, message, raw, folder);
        const content = await vault.files.readTextFile(res.path);
        await vault.files.writeTextFile(res.path, content.replace(/\s*$/, "\n\n") + `[[${emlPath}]]\n`);
      }
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
      {/* Flag stays in the header — it is the one action you take repeatedly
          while reading. Delete moved into ⋮ (S30): a destructive action one
          thumb-width from the back arrow is a mis-tap waiting to happen, and
          the menu is also where the two other capture destinations belong. */}
      <AppBar onBack={onBack} title={message?.subject || t("mail.noSubject")} actions={<><IconButton label={t("mail.flag")} active={flagged} onClick={() => void toggleFlag()}>
          <Star size={ICON.head} className={flagged ? "m-mailrow-flag" : undefined} />
        </IconButton>
        <IconButton label={t("common.moreActions")} data-testid="mail-message-menu" onClick={() => setMenu(true)}>
          <MoreVertical size={ICON.head} />
        </IconButton></>} />

      {menu && (
        <RowActionSheet actions={menuActions} onClose={() => setMenu(false)} title={message?.subject ?? ""} />
      )}

      {error ? (
        <EmptyState icon={<FileText size={ICON.head} />}>{error}</EmptyState>
      ) : !message ? (
        <p className="m-hint">{t("common.loading", { defaultValue: "…" })}</p>
      ) : (
        <>
          {/* Same ranking as the list (S30), so both surfaces phrase it alike. */}
        {status && (
          <Banner kind={status.kind === "info" ? "info" : status.kind} rounded>
            {status.raw ?? t(status.key, status.values)}
          </Banner>
        )}

          <div className="m-mailmeta">
            <p className="m-mailmeta-from">{message.from}</p>
            <p className="m-mailmeta-to">{message.to}</p>
            <p className="m-mailmeta-date">
              {message.dateTs ? new Date(message.dateTs).toLocaleString(i18n.language) : ""}
            </p>
          </div>

          {frame?.blocked ? (
            <Button variant="ghost" onClick={() => setShowRemote(true)}>
              {t("mail.showImages")}
            </Button>
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
                    <Paperclip size={ICON.ui} />
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
            <Button variant="tonal" onClick={() => onReply(replyDraft(message.from))}>
              <Reply size={ICON.ui} />
              {t("mail.reply")}
            </Button>
            {/* Reply-all and forward (S28). Both rules were already shared and
                already tested — the phone simply never called them, so a thread
                answered from the phone quietly dropped everyone but the sender
                and a message could not be passed on at all. */}
            <Button variant="tonal" onClick={() => onReply(replyDraft(replyAllRecipients(message, account?.user ?? "")))}>
              <ReplyAll size={ICON.ui} />
              {t("mail.replyAll")}
            </Button>
            <Button
              variant="tonal"
              onClick={() =>
                onReply({
                  accountId,
                  to: "",
                  subject: `Fwd: ${message.subject.trim().replace(/^(fwd|wg):\s*/i, "")}`.trim(),
                  body: buildForwardBody(message),
                })
              }
            >
              <Forward size={ICON.ui} />
              {t("mail.forward")}
            </Button>
            <Button variant="primary" disabled={busy} onClick={() => void capture("note")}>
              <FileText size={ICON.ui} />
              {t("mail.captureNote")}
            </Button>
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
