import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Modal, Button, TextInput, toast } from "@plainva/ui";
import { useVault } from "../../contexts/VaultContext";
import { Select } from "../Select";
import { listMailAccounts, type MailAccountConfig } from "../../services/mail/mailAccounts";
import { listMailboxesFor } from "../../services/mail/mailClient";
import { appendDraft, guessDraftsMailbox } from "../../services/mail/mailOut";

/**
 * "Als E-Mail-Entwurf ins Postfach" (stage 6): appends the note as a \Draft
 * into the chosen mailbox via IMAP — the user's mail program opens and SENDS
 * it. Plainva never speaks SMTP. The mailbox list loads from the account and
 * pre-selects the drafts folder.
 */

interface MailDraftModalProps {
  /** Prefill: the active note's title + markdown body. */
  subject: string;
  markdown: string;
  onClose: () => void;
}

export function MailDraftModal({ subject: initialSubject, markdown, onClose }: MailDraftModalProps) {
  const { t } = useTranslation();
  const { vaultPath } = useVault();
  const [accounts, setAccounts] = useState<MailAccountConfig[]>([]);
  const [accountId, setAccountId] = useState("");
  const [mailboxes, setMailboxes] = useState<string[]>([]);
  const [mailbox, setMailbox] = useState("");
  const [to, setTo] = useState("");
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
      await appendDraft(vaultPath, account, mailbox, to.trim(), subject.trim(), markdown);
      toast.info(t("mail.draftSaved", { defaultValue: "Entwurf im Postfach abgelegt — zum Senden im Mail-Programm öffnen." }));
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }, [vaultPath, accounts, accountId, busy, to, subject, mailbox, markdown, onClose, t]);

  return (
    <Modal
      title={t("mail.draftTitle", { defaultValue: "E-Mail-Entwurf ablegen" })}
      onClose={onClose}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel", { defaultValue: "Abbrechen" })}
          </Button>
          <Button variant="primary" data-testid="draft-save" disabled={busy || accounts.length === 0} onClick={() => void submit()}>
            {busy ? t("pim.connecting", { defaultValue: "Verbinde…" }) : t("common.save", { defaultValue: "Speichern" })}
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
              {t("mail.draftHint", { defaultValue: "Plainva sendet nie selbst — der Entwurf landet im Postfach und wird im Mail-Programm verschickt." })}
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
