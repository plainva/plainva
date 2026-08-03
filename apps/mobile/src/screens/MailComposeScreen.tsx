import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLeaveGuard } from "../hooks/useLeaveGuard";
import { FileText, Paperclip, Send, X } from "lucide-react";
import { Button, ICON, IconButton, TextInput, toast } from "@plainva/ui";
import type { MailAccountConfig, MailAttachment } from "@plainva/ui/mail";
import { appendDraft, bytesToBase64, guessAttachmentMime, listMailboxesFor, resolveDraftsMailbox, sendMail, senderKey, senderOptions, splitSenderKey, withSignature, withoutSignature } from "@plainva/ui/mail";
import { mSelect } from "../services/mobileDialogs";
import { MailComposeEditor } from "./mail/MailComposeEditor";
import { listMobileMailAccounts, mailVaultId } from "../services/mail/mailRuntime";
import { isImapUnavailable } from "../services/mail/mobileMailPlatform";
import { AppBar } from "../components/AppBar";
import { AttachPickSheet } from "../components/AttachPickSheet";
import type { MobileVault } from "../services/vaultService";

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
 * Since G3b the body is the shared Markdown editor with a formatting toolbar
 * and a "/" menu (`MailComposeEditor`), not a plain text area: the same message
 * now writes the same way on both platforms.
 */
export function MailComposeScreen({ draft, onBack, vault }: { draft: MailDraft; onBack: () => void; vault: MobileVault }) {
  const { t } = useTranslation();
  const [accounts, setAccounts] = useState<MailAccountConfig[]>([]);
  const [accountId, setAccountId] = useState(draft.accountId);
  /** Chosen sender address within that account (an alias, or its own). */
  const [fromAddress, setFromAddress] = useState("");
  const [to, setTo] = useState(draft.to);
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState("");
  const [showCcBcc, setShowCcBcc] = useState(false);
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(draft.body);
  const [busy, setBusy] = useState(false);
  const vaultId = mailVaultId();
  /**
   * Attachments (S28). Everything below this line already existed and worked —
   * the type, the base64 encoding, the multipart MIME, both backends. The
   * phone's send call simply passed a hard-coded empty array, so a message
   * that needed a file with it could not be written here at all.
   */
  const [attach, setAttach] = useState<MailAttachment[]>([]);
  const [picking, setPicking] = useState(false);

  const attachFromVault = async (path: string) => {
    setPicking(false);
    try {
      const bytes = await vault.files.readBinaryFile(path);
      const name = path.split("/").pop() ?? "attachment";
      setAttach((prev) => [...prev, { name, mime: guessAttachmentMime(name), contentBase64: bytesToBase64(bytes) }]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  // A tap on the navigation bar used to drop the whole draft without a word.
  useLeaveGuard(
    "mail-compose",
    to !== draft.to || cc !== "" || bcc !== "" || subject !== draft.subject || body !== draft.body,
    t("mobile.leaveCompose", { defaultValue: "Der Entwurf wird nicht gespeichert." }),
  );

  useEffect(() => {
    void listMobileMailAccounts().then((rows) => {
      setAccounts(rows);
      const account = rows.find((a) => a.id === accountId) ?? rows[0];
      if (account?.id !== accountId) setAccountId(account?.id ?? "");
      const first = account ? (senderOptions(account)[0] ?? "") : "";
      setFromAddress(first);
      if (account) setBody((b) => withSignature(b, account, first));
    });
    // The account list is fixed while a draft is open; re-reading it on every
    // keystroke would be pointless.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** The picker offers ADDRESSES, not accounts: each account contributes its
   * own address plus its configured aliases. */
  const fromOptions = accounts.flatMap((a) =>
    senderOptions(a).map((address) => ({
      value: senderKey(a.id, address),
      label: accounts.length > 1 ? `${address} · ${a.label}` : address,
    })),
  );

  const pickAccount = async () => {
    const picked = await mSelect({
      title: t("mail.from"),
      options: fromOptions,
      value: senderKey(accountId, fromAddress),
    });
    if (!picked) return;
    const { accountId: nextId, address } = splitSenderKey(picked);
    const previous = accounts.find((a) => a.id === accountId) ?? null;
    const next = accounts.find((a) => a.id === nextId) ?? null;
    setAccountId(nextId);
    setFromAddress(address);
    // Swapping sender swaps the signature — otherwise two of them stack up.
    // P8.2: keyed by ADDRESS, so switching between two aliases of one account
    // swaps too (the old id comparison silently kept the first signature).
    if (previous?.id !== next?.id || address !== fromAddress) {
      setBody((b) => withSignature(withoutSignature(b, previous, fromAddress), next, address));
    }
  };

  /**
   * Filing the message as a draft instead of sending it (S29).
   *
   * A phone is where a message gets STARTED — on the way somewhere, between
   * two things — and finished later at a desk. Without this the only exits
   * from the composer were "send it now" or "lose it".
   *
   * The draft goes into the account's own drafts folder, so it is waiting in
   * every mail program that talks to that mailbox, not in a phone-local box
   * nobody else can see. Which folder that is, is the shared decision.
   */
  const saveDraft = async () => {
    const account = accounts.find((a) => a.id === accountId);
    if (!vaultId || !account) return;
    setBusy(true);
    try {
      const boxes = await listMailboxesFor(vaultId, account);
      const box = resolveDraftsMailbox(boxes);
      if (!box) {
        // Better to say so than to invent a folder name and have the server
        // refuse the APPEND with something the user cannot act on.
        toast.error(t("mail.noDraftsMailbox"));
        return;
      }
      await appendDraft(vaultId, account, box, to.trim(), subject, body, attach, cc.trim(), bcc.trim());
      toast.success(t("mail.draftSaved"));
      onBack();
    } catch (e) {
      toast.error(isImapUnavailable(e) ? t("mail.imapMobileUnavailable") : String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
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
      await sendMail(vaultId, account, to.trim(), subject, body, attach, undefined, cc.trim(), bcc.trim(), fromAddress);
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
      <AppBar onBack={onBack} title={t("mail.newMessage")} actions={<><IconButton label={t("mail.send")} disabled={busy} onClick={() => void send()}>
          <Send size={ICON.head} />
        </IconButton></>} />

      {picking && <AttachPickSheet onClose={() => setPicking(false)} onPick={(p) => void attachFromVault(p)} vault={vault} />}

      <div className="m-sync">
        {fromOptions.length > 1 && (
          /* A sheet, not a native select — the mobile shell replaced every
             OS dropdown in package P3 and the design guard enforces it. */
          <button type="button" className="m-row" onClick={() => void pickAccount()}>
            <span className="m-linestack">
              {t("mail.from")}
              <small>{fromAddress || accounts.find((a) => a.id === accountId)?.label || ""}</small>
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
          <Button variant="ghost" onClick={() => setShowCcBcc(true)}>
            {t("mail.ccBcc")}
          </Button>
        )}

        {/* Attachments: one row per file with a way to take it off again. A
            list you cannot correct is worse than none — the file is already
            encoded at this point, so removing it must not need a restart. */}
        {attach.map((a, i) => (
          <div className="m-row m-row--split" key={`${a.name}:${i}`}>
            <span className="m-linestack">
              <Paperclip size={ICON.meta} /> {a.name}
              <small>{a.mime}</small>
            </span>
            <IconButton
              label={t("mail.removeAttachment")}
              onClick={() => setAttach((prev) => prev.filter((_, j) => j !== i))}
            >
              <X size={ICON.ui} />
            </IconButton>
          </div>
        ))}
        <Button variant="ghost" onClick={() => setPicking(true)}>
          <Paperclip size={ICON.meta} /> {t("mail.attachFile")}
        </Button>
        {/* The other way out of the composer (S29): a message started here and
            finished at a desk. It lands in the account's own drafts folder, so
            every mail program on that mailbox sees it. */}
        <Button variant="ghost" disabled={busy} onClick={() => void saveDraft()}>
          <FileText size={ICON.meta} /> {t("mail.draftAction")}
        </Button>

        <label className="m-field">
          <span>{t("mail.draftSubject")}</span>
          <TextInput value={subject} onChange={(e) => setSubject(e.target.value)} />
        </label>

        <div className="m-field">
          <span>{t("mail.body")}</span>
          <MailComposeEditor value={body} onChange={setBody} placeholder={t("mail.body")} />
        </div>

        <Button variant="primary" disabled={busy} onClick={() => void send()}>
          {t("mail.send")}
        </Button>
      </div>
    </div>
  );
}
