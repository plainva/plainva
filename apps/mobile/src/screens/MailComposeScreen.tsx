import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, Send } from "lucide-react";
import { TextInput, toast } from "@plainva/ui";
import type { MailAccountConfig } from "@plainva/ui/mail";
import { sendMail } from "@plainva/ui/mail";
import { mSelect } from "../services/mobileDialogs";
import { listMobileMailAccounts, mailVaultId } from "../services/mail/mailRuntime";
import { isImapUnavailable } from "../services/mail/mobileMailPlatform";

export interface MailDraft {
  accountId: string;
  to: string;
  subject: string;
  body: string;
}

/**
 * Writing a message (mail feinplan G1). The body is Markdown, exactly like the
 * desktop composer — `sendMail` turns it into the HTML + plain-text pair, so a
 * reply written on the phone looks the same as one written on the desktop.
 *
 * Deliberately a plain text area rather than the desktop's live-preview
 * composer: that one is a CodeMirror instance with its own toolbar, and a
 * half-ported version would behave differently on the two platforms. Bringing
 * it over properly is G3.
 */
export function MailComposeScreen({ draft, onBack }: { draft: MailDraft; onBack: () => void }) {
  const { t } = useTranslation();
  const [accounts, setAccounts] = useState<MailAccountConfig[]>([]);
  const [accountId, setAccountId] = useState(draft.accountId);
  const [to, setTo] = useState(draft.to);
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState("");
  const [showCcBcc, setShowCcBcc] = useState(false);
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(draft.body);
  const [busy, setBusy] = useState(false);
  const vaultId = mailVaultId();

  useEffect(() => {
    void listMobileMailAccounts().then((rows) => {
      setAccounts(rows);
      if (!rows.some((a) => a.id === accountId)) setAccountId(rows[0]?.id ?? "");
    });
    // The account list is fixed while a draft is open; re-reading it on every
    // keystroke would be pointless.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pickAccount = async () => {
    const picked = await mSelect({
      title: t("mail.from"),
      options: accounts.map((a) => ({ value: a.id, label: a.label })),
      value: accountId,
    });
    if (picked) setAccountId(picked);
  };

  const send = async () => {
    const account = accounts.find((a) => a.id === accountId);
    if (!vaultId || !account) return;
    if (!to.trim()) {
      toast.error(t("mail.noRecipient"));
      return;
    }
    setBusy(true);
    try {
      await sendMail(vaultId, account, to.trim(), subject, body, [], undefined, cc.trim(), bcc.trim());
      toast.success(t("mail.sent"));
      onBack();
    } catch (e) {
      toast.error(isImapUnavailable(e) ? t("mail.imapMobileUnavailable") : String(e instanceof Error ? e.message : e));
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
        <h1>{t("mail.newMessage")}</h1>
        <button type="button" className="m-iconbtn" aria-label={t("mail.send")} disabled={busy} onClick={() => void send()}>
          <Send size={18} />
        </button>
      </header>

      <div className="m-sync">
        {accounts.length > 1 && (
          /* A sheet, not a native select — the mobile shell replaced every
             OS dropdown in package P3 and the design guard enforces it. */
          <button type="button" className="m-row" onClick={() => void pickAccount()}>
            <span className="m-linestack">
              {t("mail.from")}
              <small>{accounts.find((a) => a.id === accountId)?.label ?? ""}</small>
            </span>
          </button>
        )}

        <label className="m-field">
          <span>{t("mail.draftTo")}</span>
          <TextInput value={to} onChange={(e) => setTo(e.target.value)} inputMode="email" placeholder="name@example.com" />
        </label>

        {showCcBcc ? (
          <>
            <label className="m-field">
              <span>{t("mail.cc")}</span>
              <TextInput value={cc} onChange={(e) => setCc(e.target.value)} inputMode="email" />
            </label>
            <label className="m-field">
              <span>{t("mail.bcc")}</span>
              <TextInput value={bcc} onChange={(e) => setBcc(e.target.value)} inputMode="email" />
            </label>
          </>
        ) : (
          <button type="button" className="m-btn m-btn--ghost" onClick={() => setShowCcBcc(true)}>
            {t("mail.ccBcc")}
          </button>
        )}

        <label className="m-field">
          <span>{t("mail.draftSubject")}</span>
          <TextInput value={subject} onChange={(e) => setSubject(e.target.value)} />
        </label>

        <label className="m-field">
          <span>{t("mail.body")}</span>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={12} />
        </label>

        <button type="button" className="m-btn m-btn--filled" disabled={busy} onClick={() => void send()}>
          {t("mail.send")}
        </button>
      </div>
    </div>
  );
}
