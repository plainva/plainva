import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Modal, Button, TextInput, toast } from "@plainva/ui";
import { useVault } from "../../contexts/VaultContext";
import { Select } from "../Select";
import { listMailAccounts, type MailAccountConfig } from "../../services/mail/mailAccounts";
import { listMailboxesFor } from "../../services/mail/mailClient";
import { appendDraft, guessDraftsMailbox, sendMail, type MailAttachment } from "../../services/mail/mailOut";
import { Paperclip } from "lucide-react";

/**
 * Compose dialog (mail-client E3). Two ways OUT: SEND directly via the
 * account's SMTP submission host, or (as before) append the message as a
 * \Draft into the mailbox for the mail program to send. The mailbox list
 * loads from the account and pre-selects the drafts folder; Send is offered
 * when the account has an SMTP host configured.
 */

interface MailDraftModalProps {
  /** Prefill: the active note's title + markdown body. */
  subject: string;
  markdown: string;
  /** Optional file attachments (mail-client E5: "…as attachment"). */
  attachments?: MailAttachment[];
  /** Optional recipient prefill (E6: invite attendees). */
  initialTo?: string;
  onClose: () => void;
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
      await appendDraft(vaultPath, account, mailbox, to.trim(), subject.trim(), markdown, attachments);
      toast.info(t("mail.draftSaved", { defaultValue: "Entwurf im Postfach abgelegt — zum Senden im Mail-Programm öffnen." }));
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }, [vaultPath, accounts, accountId, busy, to, subject, mailbox, markdown, attachments, onClose, t]);

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
      await sendMail(vaultPath, account, to.trim(), subject.trim(), markdown, attachments);
      toast.info(t("mail.sent", { defaultValue: "Nachricht gesendet." }));
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }, [vaultPath, accounts, accountId, busy, to, subject, markdown, attachments, onClose, t]);

  const canSend = !!accounts.find((a) => a.id === accountId)?.smtpHost;

  return (
    <Modal
      title={t("mail.composeTitle", { defaultValue: "Nachricht verfassen" })}
      onClose={onClose}
      size="sm"
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
            <label style={{ fontSize: "var(--text-sm)" }}>
              {t("mail.draftTo", { defaultValue: "An" })}
              <TextInput value={to} onChange={(e) => setTo(e.target.value)} data-testid="draft-to" autoFocus style={{ display: "block", width: "100%", marginTop: 2 }} />
            </label>
            <label style={{ fontSize: "var(--text-sm)" }}>
              {t("mail.draftSubject", { defaultValue: "Betreff" })}
              <TextInput value={subject} onChange={(e) => setSubject(e.target.value)} data-testid="draft-subject" style={{ display: "block", width: "100%", marginTop: 2 }} />
            </label>
            {attachments && attachments.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }} data-testid="draft-attachments">
                {attachments.map((a) => (
                  <span key={a.name} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: "var(--text-xs)", color: "var(--text-muted)", border: "1px solid var(--border-color-light)", borderRadius: "var(--radius-pill)", padding: "1px 8px" }}>
                    <Paperclip size={11} />
                    {a.name}
                  </span>
                ))}
              </div>
            )}
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
