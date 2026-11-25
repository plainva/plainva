import { useCallback, useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Mail } from "lucide-react";
import { accountInputProps, Banner, Button, connectSecretLabelKey, EndpointConfirmBlock, ICON, mailboxEndpoints, Modal, serviceConnectionMessage, TextInput, useEndpointConfirmation } from "@plainva/ui";
import { MailPasswordMissingError, saveEditedImapMailbox, useImapMailboxForm, type MailAccountConfig } from "@plainva/ui/mail";

/**
 * The servers of an IMAP mailbox, changed in place on the desktop — the
 * phone's edit sheet as a dialog on the mailbox row, the same form
 * (`useImapMailboxForm`) and the same save (`saveEditedImapMailbox`). Until
 * now a desktop could change a mailbox's servers only by connecting it again
 * in the account wizard, which starts empty.
 *
 * The address rule (review of F57, O3): a server changed here is typed and
 * confirmed by the save; one the dialog came with, unchanged, must have been
 * confirmed on this device first — the block at the top asks for that, as on
 * the phone. An empty password field keeps the stored password.
 */
export function MailServersDialog({ vaultPath, account, onClose, onSaved }: { vaultPath: string; account: MailAccountConfig; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const id = useId();
  const form = useImapMailboxForm({ editing: account });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const endpoints = useMemo(() => mailboxEndpoints(account).map((endpoint) => ({ vaultKey: vaultPath, endpoint })), [account, vaultPath]);
  const confirmation = useEndpointConfirmation(endpoints, useCallback(() => void window.dispatchEvent(new CustomEvent("plainva-mail-settings-changed")), []));

  const save = async () => {
    if (busy || !form.complete) return;
    setBusy(true);
    setError("");
    try {
      await saveEditedImapMailbox(vaultPath, account, form.values());
      window.dispatchEvent(new CustomEvent("plainva-mail-settings-changed"));
      onSaved();
    } catch (e) {
      // The same translation as the phone's form: the server's answer word for word.
      setError(e instanceof MailPasswordMissingError ? t("mail.passwordMissing") : serviceConnectionMessage(e, t));
    } finally {
      setBusy(false);
    }
  };

  const text = (key: "host" | "smtpHost", label: string) => (
    <>
      <label className="pv-modal-label" htmlFor={`${id}-${key}`}>{label}</label>
      <TextInput id={`${id}-${key}`} {...accountInputProps("address")} value={form.effective[key]} onChange={(e) => form.setServer(key, e.target.value)} data-testid={`mail-servers-${key}`} />
    </>
  );
  const port = (key: "port" | "smtpPort", label: string) => (
    <>
      <label className="pv-modal-label" htmlFor={`${id}-${key}`}>{label}</label>
      <TextInput id={`${id}-${key}`} {...accountInputProps("port")} value={String(form.effective[key])} onChange={(e) => form.setServer(key, e.target.value)} data-testid={`mail-servers-${key}`} />
    </>
  );

  return (
    <Modal
      title={t("common.edit")}
      headerNote={account.label}
      icon={<Mail size={ICON.ui} />}
      size="md"
      onClose={onClose}
      // A typed password or server is not dropped by a stray close (as the phone's sheet guards it).
      unsaved={form.dirty}
      testId="mail-servers"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" disabled={busy || !form.complete} onClick={() => void save()} data-testid="mail-servers-save">
            {t("common.save")}
          </Button>
        </>
      }
    >
      <EndpointConfirmBlock confirmation={confirmation} testId="mail-servers-confirm" />
      <label className="pv-modal-label" htmlFor={`${id}-email`}>{t("mail.emailAddress")}</label>
      <TextInput id={`${id}-email`} {...accountInputProps("email")} value={form.email} onChange={(e) => form.setEmail(e.target.value)} placeholder="name@example.com" data-testid="mail-servers-email" />
      <label className="pv-modal-label" htmlFor={`${id}-pass`}>{t(connectSecretLabelKey(form.plan.secret ?? "password"))}</label>
      <TextInput id={`${id}-pass`} {...accountInputProps("secret")} value={form.pass} onChange={(e) => form.setPass(e.target.value)} placeholder={t("mail.passwordKeep")} data-testid="mail-servers-pass" />
      {text("host", t("mail.imapHost"))}
      {port("port", t("mail.imapPort"))}
      {text("smtpHost", t("mail.smtpHost"))}
      {port("smtpPort", t("mail.smtpPort"))}
      {error && (
        <Banner kind="error" rounded>
          <span data-testid="mail-servers-error">{error}</span>
        </Banner>
      )}
    </Modal>
  );
}
