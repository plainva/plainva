import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLeaveGuard } from "../hooks/useLeaveGuard";
import { FileText, Mail, Paperclip, Send, X } from "lucide-react";
import { Button, EmptyState, ICON, IconButton, TextInput, toast, listTemplates, templateInsertText } from "@plainva/ui";
import { applyTemplateInteractive, withShellContext } from "../services/templateInteractive";
import { getMobileSettings } from "../services/mobileSettings";
import { getMobileVault } from "../services/vaultService";
import { UndoSendQueue, secondsLeft, mailErrorText } from "@plainva/ui/mail";
import { App as CapApp } from "@capacitor/app";
import i18n from "@plainva/ui/i18n";

/**
 * The delayed send (S23), outside the component so it outlives the screen.
 *
 * On the phone the window closes in a second way the desktop does not have:
 * going to the background. The answer is FLUSH, not drop — a message the user
 * asked to send must not disappear because they switched apps. The handbook
 * says so, because a client that quietly changed the rule would be worse than
 * one that never offered undo.
 */
let undoToastId: number | null = null;
const undoQueue = new UndoSendQueue<() => Promise<void>>(async (deliver) => {
  try {
    await deliver();
    toast.success(i18n.t("mail.sent"));
  } catch (e) {
    toast.error(String(e instanceof Error ? e.message : e));
  } finally {
    undoToastId = null;
  }
});
// Guarded: the module is imported by tests that run in plain Node, where the
// Capacitor web shim reaches for `document` on construction.
if (typeof document !== "undefined") {
  void CapApp.addListener("appStateChange", ({ isActive }) => {
    if (!isActive) void undoQueue.flush();
  });
}
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
  /**
   * Files the opening screen already picked (S30 follow-up, 2026-08-20).
   *
   * The composer could always ATTACH — this is the missing half: handing it a
   * draft that arrives with the file already on it, so "send this note as an
   * attachment" needs no second trip through the picker.
   */
  attachments?: MailAttachment[];
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
export function MailComposeScreen({ draft, onBack, onOpenAccounts, vault }: { draft: MailDraft; onBack: () => void; onOpenAccounts?: () => void; vault: MobileVault }) {
  const { t } = useTranslation();
  const [accounts, setAccounts] = useState<MailAccountConfig[]>([]);
  // Distinguishes "still loading" from "there is no mailbox": without it the
  // composer looks the same in both states, and the empty state would flash.
  const [accountsLoaded, setAccountsLoaded] = useState(false);
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
  const [attach, setAttach] = useState<MailAttachment[]>(draft.attachments ?? []);
  const [picking, setPicking] = useState(false);

  /**
   * A template into the message body (S22).
   *
   * `templateInsertText` strips the template's own frontmatter — a mail body has
   * none, and sending YAML to the recipient is not what "insert template" means.
   * The engine runs INTERACTIVE, so a template with questions asks them in the
   * one collected sheet rather than leaving `{{prompt:…}}` in the text.
   */
  const insertTemplate = async () => {
    const vault = await getMobileVault();
    if (!vault) return;
    const folder = getMobileSettings().templateFolder || "Templates";
    const items = await listTemplates(vault.adapter, folder);
    if (items.length === 0) {
      toast.info(t("templatePicker.noTemplates"));
      return;
    }
    const picked = await mSelect({
      title: t("mail.insertTemplate"),
      options: items.map((i) => ({ value: i.path, label: i.title })),
      search: t("templatePicker.placeholder"),
    });
    if (!picked) return;
    try {
      const raw = await vault.adapter.readTextFile(picked);
      const title = subject || (picked.split("/").pop() ?? "").replace(/\.md$/i, "");
      const body0 = templateInsertText(raw, title);
      const ctx = await withShellContext(body0, { title, now: new Date(), folder: "" });
      const out = await applyTemplateInteractive(body0, ctx);
      if (!out) return;
      setBody((prev) => (prev ? `${prev}\n\n${out.text}` : out.text));
    } catch {
      toast.error(t("mail.templateFailed"));
    }
  };

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
      setAccountsLoaded(true);
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
      toast.error(isImapUnavailable(e) ? t("mail.imapMobileUnavailable") : mailErrorText(e, t));
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
      const entry = undoQueue.enqueue(() =>
        sendMail(vaultId, account, to.trim(), subject, body, attach, undefined, cc.trim(), bcc.trim(), fromAddress)
      );
      onBack();
      undoToastId = toast.progress(t("mail.sendingWithUndo", { seconds: secondsLeft(entry) }), {
        label: t("common.undo"),
        run: () => {
          if (undoQueue.cancel(entry.id)) toast.info(t("mail.sendCancelled"));
          if (undoToastId !== null) toast.dismiss(undoToastId);
          undoToastId = null;
        },
      });
    } catch (e) {
      toast.error(isImapUnavailable(e) ? t("mail.imapMobileUnavailable") : mailErrorText(e, t));
    } finally {
      setBusy(false);
    }
  };

  // S20: the composer is reachable from a note ("send as mail") without any
  // mailbox at all. It used to render the whole form and then return WORDLESSLY
  // from send() and saveDraft() — the user wrote a message and tapping send did
  // nothing at all. Same empty state as the inbox, same way out.
  if (accountsLoaded && accounts.length === 0) {
    return (
      <div className="m-page">
        <AppBar onBack={onBack} title={t("mail.newMessage")} />
        <EmptyState
          icon={<Mail size={ICON.head} />}
          action={
            onOpenAccounts ? (
              <Button variant="primary" onClick={onOpenAccounts}>
                {t("mail.addAccount")}
              </Button>
            ) : undefined
          }
        >
          {t("mail.noAccounts")}
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="m-page">
      <AppBar onBack={onBack} title={t("mail.newMessage")} actions={<><IconButton label={t("mail.send")} disabled={busy} onClick={() => void send()}>
          <Send size={ICON.head} />
        </IconButton></>} />

      {picking && <AttachPickSheet onClose={() => setPicking(false)} onPick={(p) => void attachFromVault(p)} vault={vault} />}

      <div className="m-settings">
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

        <Button variant="ghost" onClick={() => void insertTemplate()} data-testid="compose-insert-template">
          <FileText size={ICON.ui} /> {t("mail.insertTemplate")}
        </Button>

        <Button variant="primary" disabled={busy} onClick={() => void send()}>
          {t("mail.send")}
        </Button>
      </div>
    </div>
  );
}
