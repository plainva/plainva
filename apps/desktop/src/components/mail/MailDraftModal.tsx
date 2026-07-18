import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Modal, Button, toast } from "@plainva/ui";
import { Paperclip, X } from "lucide-react";
import { useVault } from "../../contexts/VaultContext";
import { Select } from "../Select";
import { listMailAccounts, type MailAccountConfig } from "../../services/mail/mailAccounts";
import { listMailboxesFor } from "../../services/mail/mailClient";
import { appendDraft, guessDraftsMailbox, sendMail, bytesToBase64, type MailAttachment } from "../../services/mail/mailOut";
import "./mail.css";

/**
 * Compose window (mail-client E3, real reply/forward/new-message). A proper
 * mail composer: To / Subject field rows, an editable Markdown message body,
 * attachments (from the caller — an attached note or an iCal invite — plus
 * files picked here), and two ways OUT: SEND directly via the account's SMTP
 * submission host, or append the message as a \Draft into the mailbox for the
 * mail program to send. Send is offered when the account has an SMTP host.
 */

interface MailDraftModalProps {
  /** Prefill: subject + the message body (Markdown). */
  subject: string;
  markdown: string;
  /** Optional file attachments (E5 note-as-attachment, E6 invite). */
  attachments?: MailAttachment[];
  /** Optional recipient prefill (reply / reply-all / invite attendees). */
  initialTo?: string;
  onClose: () => void;
}

const MIME_BY_EXT: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  md: "text/markdown",
  txt: "text/plain",
  csv: "text/csv",
  ics: "text/calendar",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  zip: "application/zip",
};

function guessMime(name: string): string {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

export function MailDraftModal({ subject: initialSubject, markdown, attachments, initialTo, onClose }: MailDraftModalProps) {
  const { t } = useTranslation();
  const { vaultPath } = useVault();
  const [accounts, setAccounts] = useState<MailAccountConfig[]>([]);
  const [accountId, setAccountId] = useState("");
  const [mailboxes, setMailboxes] = useState<string[]>([]);
  const [mailbox, setMailbox] = useState("");
  const [to, setTo] = useState(initialTo ?? "");
  const [subject, setSubject] = useState(initialSubject);
  const [body, setBody] = useState(markdown);
  const [attach, setAttach] = useState<MailAttachment[]>(attachments ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      if (!vaultPath) return;
      const list = await listMailAccounts(vaultPath);
      if (!alive) return;
      setAccounts(list);
      setAccountId(list[0]?.id ?? "");
    })();
    return () => {
      alive = false;
    };
  }, [vaultPath]);

  useEffect(() => {
    let alive = true;
    const account = accounts.find((a) => a.id === accountId);
    if (!vaultPath || !account) return;
    setMailboxes([]);
    void (async () => {
      try {
        const names = (await listMailboxesFor(vaultPath, account)).map((m) => m.name);
        if (!alive) return;
        setMailboxes(names);
        setMailbox(guessDraftsMailbox(names));
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, [vaultPath, accounts, accountId]);

  const pickFile = useCallback(async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const picked = await open({ multiple: false, title: t("mail.attachFile", { defaultValue: "Datei anhängen" }) });
      if (typeof picked !== "string") return;
      const { readFile } = await import("@tauri-apps/plugin-fs");
      const bytes = await readFile(picked);
      const name = picked.split(/[\\/]/).pop() ?? "attachment";
      setAttach((prev) => [...prev, { name, mime: guessMime(name), contentBase64: bytesToBase64(bytes) }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [t]);

  const submit = useCallback(async () => {
    const account = accounts.find((a) => a.id === accountId);
    if (!vaultPath || !account || busy) return;
    if (!to.trim() || !subject.trim() || !mailbox) {
      setError(t("pim.fillAllFields", { defaultValue: "Bitte alle Felder ausfüllen." }));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await appendDraft(vaultPath, account, mailbox, to.trim(), subject.trim(), body, attach);
      toast.info(t("mail.draftSaved", { defaultValue: "Entwurf im Postfach abgelegt — zum Senden im Mail-Programm öffnen." }));
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }, [vaultPath, accounts, accountId, busy, to, subject, mailbox, body, attach, onClose, t]);

  const send = useCallback(async () => {
    const account = accounts.find((a) => a.id === accountId);
    if (!vaultPath || !account || busy) return;
    if (!to.trim() || !subject.trim()) {
      setError(t("pim.fillAllFields", { defaultValue: "Bitte alle Felder ausfüllen." }));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await sendMail(vaultPath, account, to.trim(), subject.trim(), body, attach);
      toast.info(t("mail.sent", { defaultValue: "Nachricht gesendet." }));
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }, [vaultPath, accounts, accountId, busy, to, subject, body, attach, onClose, t]);

  const canSend = !!accounts.find((a) => a.id === accountId)?.smtpHost;

  return (
    <Modal
      title={t("mail.composeTitle", { defaultValue: "Nachricht verfassen" })}
      onClose={onClose}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel", { defaultValue: "Abbrechen" })}
          </Button>
          <Button variant="secondary" data-testid="draft-save" disabled={busy || accounts.length === 0} onClick={() => void submit()}>
            {t("mail.saveDraft", { defaultValue: "Als Entwurf" })}
          </Button>
          <Button
            variant="primary"
            data-testid="draft-send"
            disabled={busy || accounts.length === 0 || !canSend}
            onClick={() => void send()}
            title={!canSend ? t("mail.noSmtpHint", { defaultValue: "Für den Direktversand einen SMTP-Host im Konto hinterlegen." }) : undefined}
          >
            {busy ? t("pim.connecting", { defaultValue: "Verbinde…" }) : t("mail.send", { defaultValue: "Senden" })}
          </Button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }} data-testid="draft-form">
        {accounts.length === 0 ? (
          <p style={{ margin: 0, fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>
            {t("mail.noAccounts", { defaultValue: "Noch kein E-Mail-Konto verbunden." })}
          </p>
        ) : (
          <>
            {accounts.length > 1 && (
              <div>
                <label style={{ display: "block", fontSize: "var(--text-sm)", marginBottom: 2 }}>{t("mail.account", { defaultValue: "Konto" })}</label>
                <Select
                  ariaLabel={t("mail.account", { defaultValue: "Konto" })}
                  value={accountId}
                  onChange={setAccountId}
                  options={accounts.map((a) => ({ value: a.id, label: a.label }))}
                />
              </div>
            )}
            <label className="pv-mail-cmplabel">
              <span>{t("mail.draftTo", { defaultValue: "An" })}</span>
              <input className="pv-field" value={to} onChange={(e) => setTo(e.target.value)} data-testid="draft-to" autoFocus placeholder="name@example.org" />
            </label>
            <label className="pv-mail-cmplabel">
              <span>{t("mail.draftSubject", { defaultValue: "Betreff" })}</span>
              <input className="pv-field" value={subject} onChange={(e) => setSubject(e.target.value)} data-testid="draft-subject" />
            </label>
            <label className="pv-mail-cmplabel">
              <span>{t("mail.body", { defaultValue: "Nachricht" })}</span>
              <textarea
                className="pv-mail-cmpbody"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                data-testid="draft-body"
                placeholder={t("mail.bodyPlaceholder", { defaultValue: "Nachricht schreiben… (Markdown, wie im Editor)" })}
              />
            </label>
            <div className="pv-mail-cmpattach">
              {attach.map((a, i) => (
                <span key={`${a.name}-${i}`} className="pv-mail-attach-chip" data-testid="draft-attachments">
                  <Paperclip size={12} />
                  {a.name}
                  <button
                    type="button"
                    className="pv-mail-attach-remove"
                    onClick={() => setAttach((prev) => prev.filter((_, j) => j !== i))}
                    aria-label={t("mail.removeAttachment", { defaultValue: "Anhang entfernen" })}
                    data-testid="draft-attach-remove"
                  >
                    <X size={11} />
                  </button>
                </span>
              ))}
              <Button variant="ghost" size="sm" icon={<Paperclip size={13} />} onClick={() => void pickFile()} data-testid="draft-attach-file">
                {t("mail.attachFile", { defaultValue: "Datei anhängen" })}
              </Button>
            </div>
            {mailboxes.length > 0 && (
              <div>
                <label style={{ display: "block", fontSize: "var(--text-sm)", marginBottom: 2 }}>{t("mail.draftMailbox", { defaultValue: "Entwurfsordner" })}</label>
                <Select
                  ariaLabel={t("mail.draftMailbox", { defaultValue: "Entwurfsordner" })}
                  value={mailbox}
                  onChange={setMailbox}
                  options={mailboxes.map((m) => ({ value: m, label: m }))}
                />
              </div>
            )}
            <p style={{ margin: 0, fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
              {canSend
                ? t("mail.composeHint", { defaultValue: "„Senden“ verschickt direkt über SMTP; „Als Entwurf“ legt die Nachricht ins Postfach." })
                : t("mail.noSmtpHint", { defaultValue: "Für den Direktversand einen SMTP-Host im Konto hinterlegen." })}
            </p>
          </>
        )}
        {error && (
          <p style={{ color: "var(--error-text)", fontSize: "var(--text-sm)", margin: 0 }} data-testid="draft-error">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
