import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLeaveGuard } from "../hooks/useLeaveGuard";
import { AlertTriangle, Ban, FileText, Mail, Paperclip, RefreshCw, RotateCw, Send, X } from "lucide-react";
import { Banner, Button, EmptyState, ICON, IconButton, TextInput, toast, listTemplates, templateBodyOf } from "@plainva/ui";
import { applyTemplateInteractive } from "../services/templateInteractive";
import { getMobileSettings } from "../services/mobileSettings";
import { getMobileVault } from "../services/vaultService";
import { UndoSendQueue, secondsLeft, mailErrorText, mailAccountCanSend } from "@plainva/ui/mail";
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
/** A message on its way: what was sent, and the call that hands it over. */
interface QueuedSend {
  message: RefusedMessage;
  deliver: () => Promise<void>;
}
const undoQueue = new UndoSendQueue<QueuedSend>(async ({ message, deliver }) => {
  // The notice ends WITH the window, before the transport is asked. Whatever
  // brought the message here — the timer, the app going to the background, a
  // second message pushing this one out — "Undo" can no longer stop it, and
  // the notice is persistent: nothing but this takes it down. It is also the
  // last moment the id still names THIS message's notice; by the time the
  // transport has answered, a message sent in between has its own behind it.
  if (undoToastId !== null) toast.dismiss(undoToastId);
  undoToastId = null;
  try {
    await deliver();
    toast.success(i18n.t("mail.sent"));
  } catch (e) {
    // The screen closed eight seconds ago. Until 2026-10 the refusal was one
    // line of text and the message was gone; now it is kept, and the notice
    // that says why is its way back (`refusedSend.ts`).
    const say = (key: string, options?: Record<string, unknown>): string => i18n.t(key, options ?? {});
    holdRefusedSend(message, isImapUnavailable(e) ? say("mail.imapMobileUnavailable") : mailErrorText(e, say));
  }
});
// Guarded: the module is imported by tests that run in plain Node, where the
// Capacitor web shim reaches for `document` on construction.
if (typeof document !== "undefined") {
  void CapApp.addListener("appStateChange", ({ isActive }) => {
    if (!isActive) void undoQueue.flush();
  });
}
import type { CarriedRow, ForwardSource, MailAccountConfig, MailAttachment } from "@plainva/ui/mail";
import { appendDraft, bytesToBase64, carriedFailureText, carriedLimitText, carriedRowNote, composeChanged, guessAttachmentMime, leftBehindText, listMailboxesFor, resolveDraftsMailbox, sendMail, sendableAttachment, senderKey, senderOptions, splitSenderKey, useCarriedFiles, withSignature, withoutSignature } from "@plainva/ui/mail";
import { mConfirm, mSelect, mTargets } from "../services/mobileDialogs";
import { MailComposeEditor } from "./mail/MailComposeEditor";
import { composeDone } from "../services/mail/composeDone";
import { listActiveMobileMailAccounts, mailVaultId } from "../services/mail/mailRuntime";
import { isImapUnavailable } from "../services/mail/mobileMailPlatform";
import { claimRefusedSend, holdRefusedSend, readRefusedSend, type RefusedMessage } from "../services/mail/refusedSend";
import { AppBar } from "../components/AppBar";
import { AttachPickSheet } from "../components/AttachPickSheet";
import type { MobileVault } from "../services/vaultService";

export interface MailDraft {
  accountId: string;
  to: string;
  /**
   * Cc and Bcc, comma-separated like `to` (AI harness P5-6: a mail the
   * assistant drafted names every recipient). With either set, their rows
   * open — a recipient that is filled in is never out of sight.
   */
  cc?: string;
  bcc?: string;
  /**
   * Who to tell once this mail was sent or saved (`composeDone`): the
   * assistant's list of drafts keeps a mail until then, and for good when the
   * composer is left without either.
   */
  doneToken?: string;
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
  /**
   * The message a forward was made from, by reference: which mailbox, which
   * message, and the files its reader listed.
   *
   * NOT the files themselves. This draft is its own nav path, read again on
   * every render — megabytes do not belong in one. The composer fetches the
   * bytes once it is open and shows for each file how far it is.
   */
  forward?: ForwardSource;
  /**
   * A message the mail server refused, coming back: the id it is held under
   * (`refusedSend.ts`). The message itself is read from there — its text and
   * its files never travel through the nav path. The other fields of such a
   * draft are empty and are not read.
   */
  refused?: number;
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
export function MailComposeScreen({ draft, onBack, onDone, onOpenAccounts, vault }: {
  draft: MailDraft;
  /** The reader wants out. The shell asks first when the draft was changed. */
  onBack: () => void;
  /** The composer's own exit once the message is sent or filed as a draft:
   *  nothing is left to lose, so the shell must not ask about it. A host with
   *  one exit only gets `onBack` for both, and answers the question itself. */
  onDone?: () => void;
  onOpenAccounts?: () => void;
  vault: MobileVault;
}) {
  const { t } = useTranslation();
  const leaveDone = onDone ?? onBack;
  const [accounts, setAccounts] = useState<MailAccountConfig[]>([]);
  // Distinguishes "still loading" from "there is no mailbox": without it the
  // composer looks the same in both states, and the empty state would flash.
  const [accountsLoaded, setAccountsLoaded] = useState(false);
  /**
   * A message the mail server refused opens as it was SENT: sender, every
   * recipient field, text and the files that went along. It is read once, from
   * where it is held, and claimed when this screen is up (the effect below) —
   * from then on it is this screen's, like anything typed here.
   */
  const [refused] = useState(() => ({ id: draft.refused, message: readRefusedSend(draft.refused) }));
  const resent = refused.message;
  useEffect(() => {
    claimRefusedSend(refused.id);
  }, [refused]);
  const [accountId, setAccountId] = useState(resent?.accountId ?? draft.accountId);
  /** Chosen sender address within that account (an alias, or its own). */
  const [fromAddress, setFromAddress] = useState(resent?.fromAddress ?? "");
  const [to, setTo] = useState(resent?.to ?? draft.to);
  const [cc, setCc] = useState(resent?.cc ?? draft.cc ?? "");
  const [bcc, setBcc] = useState(resent?.bcc ?? draft.bcc ?? "");
  const [showCcBcc, setShowCcBcc] = useState(!!(resent?.cc || resent?.bcc || draft.cc?.trim() || draft.bcc?.trim()));
  const [subject, setSubject] = useState(resent?.subject ?? draft.subject);
  const [body, setBody] = useState(resent?.body ?? draft.body);
  /**
   * The body as an untouched composer shows it: the draft's own text plus what
   * the composer puts there itself, the sender's signature. Every change the
   * composer makes to the body on its own is made to this one too, so the two
   * differ exactly when a person changed something.
   *
   * A message that comes back unsent is unsaved work from the first moment:
   * its untouched state is an empty composer, so leaving it asks.
   */
  const [untouchedBody, setUntouchedBody] = useState(resent ? "" : draft.body);
  const [busy, setBusy] = useState(false);
  const vaultId = mailVaultId();
  /**
   * Attachments (S28). Everything below this line already existed and worked —
   * the type, the base64 encoding, the multipart MIME, both backends. The
   * phone's send call simply passed a hard-coded empty array, so a message
   * that needed a file with it could not be written here at all.
   *
   * `arrived` is what the draft came with (a note sent as an attachment) and is
   * held from the first render: the route reads the draft out of its nav path
   * on every render, so `draft.attachments` is a new list each time.
   */
  const [arrived] = useState<MailAttachment[]>(() => (resent ? [] : (draft.attachments ?? [])));
  const [attach, setAttach] = useState<MailAttachment[]>(resent?.attachments ?? arrived);
  const [picking, setPicking] = useState(false);
  /**
   * The files of a forwarded original (the shared rule, `carriedFiles.ts`).
   *
   * A forward used to carry the text of the original and none of its files.
   * They are fetched here, after the screen is up: each row says whether its
   * file is on its way, here, did not come or stays behind, and the bound it is
   * held against is the SENDING mailbox's — picking another sender can change
   * what goes.
   */
  const sender = accounts.find((a) => a.id === accountId) ?? null;
  const carried = useCarriedFiles({
    vaultPath: vaultId,
    source: draft.forward,
    accounts: accountsLoaded ? accounts : null,
    sender,
    others: attach,
  });
  /** What leaves with the message: the files of the original that are here,
   *  then every other file the sending mailbox takes — each in the form a
   *  transport takes. */
  const outgoing = [...carried.attachments, ...attach.filter((_, i) => carried.othersGo[i] !== false).map(sendableAttachment)];
  /** Send and Save draft wait while a file of the original is on its way. */
  const waiting = carried.loading;

  /**
   * Asked once before a message leaves without a file it is shown with — one
   * that did not come, or one the sending mailbox does not take. Whoever took
   * the file off by hand has answered already and is not asked.
   */
  const leaveBehind = (way: "send" | "draft"): Promise<boolean> => {
    if (carried.left.length === 0) return Promise.resolve(true);
    return mConfirm({
      title: t(way === "send" ? "mail.sendWithoutTitle" : "mail.draftWithoutTitle"),
      message: leftBehindText(carried.left, t),
      confirmLabel: t(way === "send" ? "mail.sendWithout" : "mail.draftWithout"),
    });
  };

  /**
   * A template into the message body (S22).
   *
   * The template's own frontmatter stays out — a mail body has none, and
   * sending YAML to the recipient is not what "insert template" means. The
   * engine runs INTERACTIVE, so a template with questions asks them in the
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
    // The template to insert: the target of an action (E20).
    const picked = await mTargets({
      title: t("mail.insertTemplate"),
      options: items.map((i) => ({ value: i.path, label: i.title })),
      search: t("templatePicker.placeholder"),
    });
    if (!picked) return;
    try {
      // Through the vault, as the desktop reads it: a template in another
      // encoding is refused there, not read with replacement characters into
      // a mail (finding 2026-10-11).
      const raw = await vault.files.readTextFile(picked);
      const title = subject || (picked.split("/").pop() ?? "").replace(/\.md$/i, "");
      // The template's own properties stay out, and its text is read as an
      // editor holds it: no byte order mark in the message. It goes through
      // the pipeline with questions ONCE, so its questions are asked. It was
      // filled once before that without them: every question became nothing,
      // its default too (Sammelplan § 3.97).
      const out = await applyTemplateInteractive(templateBodyOf(raw), { title, now: new Date(), folder: "" });
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

  /*
   * A tap on the navigation bar used to drop the whole draft without a word.
   *
   * The question is asked when the draft was CHANGED, and changed is measured
   * against what the composer opened with (finding 2026-10-09):
   *
   *  - the body against the signed body, not the draft's. Compared with the
   *    draft, the signature alone counted as unsaved work, and every composer
   *    of an account that signs its mail asked on the way out untouched;
   *  - the files against the files it arrived with. They were not looked at
   *    at all: a note that comes as an attachment is not unsaved work, a file
   *    put on or taken off by hand is, and it went without a word.
   *
   *  - the files of a forwarded original by NAME, not by content: whether they
   *    have arrived is not part of the question, so an untouched forward never
   *    asks — and one of them taken off by hand does.
   *
   * Sending and filing do not come past here — they leave through `onDone`.
   * The measure itself is the shared one (`composeChanged`): the desktop
   * composer asks the same question on its way out, and by the same rule.
   */
  useLeaveGuard(
    "mail-compose",
    composeChanged(
      // A drafted mail (AI harness P5-6) starts with its own Cc and Bcc: those are part of its untouched state.
      { to: draft.to, cc: draft.cc ?? "", bcc: draft.bcc ?? "", subject: draft.subject, body: untouchedBody, attachments: arrived, carried: carried.openedIndexes },
      { to, cc, bcc, subject, body, attachments: attach, carried: carried.indexes },
    ),
    t("mobile.leaveCompose", { defaultValue: "Der Entwurf wird nicht gespeichert." }),
  );

  useEffect(() => {
    void listActiveMobileMailAccounts().then((rows) => {
      setAccounts(rows);
      setAccountsLoaded(true);
      const account = rows.find((a) => a.id === accountId) ?? rows[0];
      if (account?.id !== accountId) setAccountId(account?.id ?? "");
      const options = account ? senderOptions(account) : [];
      // A message that comes back keeps the address it was sent from, and its
      // text is as it was sent — signature included, so none is put in again.
      const first = resent && options.includes(resent.fromAddress) ? resent.fromAddress : (options[0] ?? "");
      setFromAddress(first);
      if (account && !resent) {
        const sign = (b: string) => withSignature(b, account, first);
        setBody(sign);
        setUntouchedBody(sign);
      }
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
      const resign = (b: string) => withSignature(withoutSignature(b, previous, fromAddress), next, address);
      setBody(resign);
      setUntouchedBody(resign);
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
    if (!vaultId || !account || waiting) return;
    if (!(await leaveBehind("draft"))) return;
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
      await appendDraft(vaultId, account, box, to.trim(), subject, body, outgoing, cc.trim(), bcc.trim());
      toast.success(t("mail.draftSaved"));
      composeDone(draft.doneToken, "saved");
      leaveDone();
    } catch (e) {
      toast.error(isImapUnavailable(e) ? t("mail.imapMobileUnavailable") : mailErrorText(e, t));
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    const account = accounts.find((a) => a.id === accountId);
    if (!vaultId || !account || waiting) return;
    if (!to.trim()) {
      toast.error(t("mail.noRecipient"));
      return;
    }
    if (!(await leaveBehind("send"))) return;
    setBusy(true);
    try {
      // What goes out, held by the queue until the mailbox has taken it: a
      // message it refuses comes back with exactly this.
      const message: RefusedMessage = { accountId: account.id, fromAddress, to: to.trim(), cc: cc.trim(), bcc: bcc.trim(), subject, body, attachments: outgoing };
      const doneToken = draft.doneToken;
      const entry = undoQueue.enqueue({
        message,
        deliver: async () => {
          await sendMail(vaultId, account, message.to, subject, body, outgoing, undefined, message.cc, message.bcc, fromAddress);
          // The transport took it: whoever opened this composer for the mail is told now. A send that is undone in
          // its few seconds, or that the server refuses, tells nothing — and the draft is still theirs to offer.
          composeDone(doneToken, "sent");
        },
      });
      // Not `onBack`: that one asks whether to discard the draft, and this
      // draft is on its way.
      leaveDone();
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

  // The line under the files: why a file did not come, and the bound one was
  // held against — the same sentences the desktop composer says.
  const failureText = carriedFailureText(carried.rows, t);
  const limitText = carriedLimitText(carried.rows, carried.othersGo, carried.limits, t, i18n.language);

  // Whether the chosen account can send is the shared decision the transport
  // itself reads (finding 2026-10-08). The phone asked nothing: for a mailbox
  // connected for reading only, Send was offered, the screen closed, and the
  // refusal arrived seconds later — after the text was gone.
  const canSend = mailAccountCanSend(accounts.find((a) => a.id === accountId));

  return (
    <div className="m-page">
      <AppBar onBack={onBack} title={t("mail.newMessage")} actions={<><IconButton label={t("mail.send")} disabled={busy || !canSend || waiting} onClick={() => void send()}>
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

        {/* The files of a forwarded original, in the reader's order: one row
            each, saying what is with it. A file that stays behind keeps its
            row and its name — nothing is dropped without a word. */}
        {carried.rows.map((row) => (
          <div
            className={`m-row m-row--split m-mailfile m-mailfile--${row.state}`}
            data-testid="compose-carried"
            data-state={row.state}
            key={`carried:${row.file.index}`}
          >
            <span className="m-linestack">
              <span>
                {carriedIcon(row)} {row.file.name}
              </span>
              <small>{carriedRowNote(row, t, i18n.language)}</small>
            </span>
            {row.state === "failed" && (
              <IconButton label={t("mail.fileRetry")} data-testid="compose-carried-retry" onClick={() => carried.retry(row.file.index)}>
                <RotateCw size={ICON.ui} />
              </IconButton>
            )}
            <IconButton label={t("mail.removeAttachment")} data-testid="compose-carried-remove" onClick={() => carried.remove(row.file.index)}>
              <X size={ICON.ui} />
            </IconButton>
          </div>
        ))}
        {/* Attachments: one row per file with a way to take it off again. A
            list you cannot correct is worse than none — the file is already
            encoded at this point, so removing it must not need a restart. */}
        {attach.map((a, i) => {
          const stays = carried.othersGo[i] === false;
          return (
            <div
              className={stays ? "m-row m-row--split m-mailfile m-mailfile--left" : "m-row m-row--split m-mailfile"}
              data-testid="compose-attachment"
              data-state={stays ? "left" : "ready"}
              key={`${a.name}:${i}`}
            >
              <span className="m-linestack">
                <span>
                  {stays ? <Ban size={ICON.meta} /> : <Paperclip size={ICON.meta} />} {a.name}
                </span>
                <small>{stays ? t("mail.fileState.tooLarge") : a.mime}</small>
              </span>
              <IconButton
                label={t("mail.removeAttachment")}
                data-testid="compose-attachment-remove"
                onClick={() => setAttach((prev) => prev.filter((_, j) => j !== i))}
              >
                <X size={ICON.ui} />
              </IconButton>
            </div>
          );
        })}
        {waiting && (
          <p className="m-hint" data-testid="compose-files-loading">
            {t("mail.filesLoading", { count: carried.rows.filter((row) => row.state === "loading").length })} {t("mail.filesWaiting")}
          </p>
        )}
        {failureText && (
          <Banner
            kind="warning"
            rounded
            actions={
              <Button variant="ghost" data-testid="compose-carried-retry-all" onClick={() => carried.retry()}>
                {t("mail.fileRetry")}
              </Button>
            }
          >
            <span data-testid="compose-files-failed">{failureText}</span>
          </Banner>
        )}
        {limitText && (
          <p className="m-hint" data-testid="compose-files-limit">
            {limitText}
          </p>
        )}
        <Button variant="ghost" data-testid="compose-attach" onClick={() => setPicking(true)}>
          <Paperclip size={ICON.meta} /> {t("mail.attachFile")}
        </Button>
        {/* The other way out of the composer (S29): a message started here and
            finished at a desk. It lands in the account's own drafts folder, so
            every mail program on that mailbox sees it. */}
        <Button variant="ghost" disabled={busy || waiting} data-testid="compose-save-draft" onClick={() => void saveDraft()}>
          <FileText size={ICON.meta} /> {t("mail.draftAction")}
        </Button>

        <label className="m-field">
          <span>{t("mail.draftSubject")}</span>
          <TextInput value={subject} onChange={(e) => setSubject(e.target.value)} purpose="prose" />
        </label>

        <div className="m-field">
          <span>{t("mail.body")}</span>
          <MailComposeEditor value={body} onChange={setBody} placeholder={t("mail.body")} />
        </div>

        <Button variant="ghost" onClick={() => void insertTemplate()} data-testid="compose-insert-template">
          <FileText size={ICON.ui} /> {t("mail.insertTemplate")}
        </Button>

        {accountsLoaded && !canSend && <p className="m-hint" data-testid="compose-send-hint">{t("mail.noSmtpHint")}</p>}
        <Button variant="primary" disabled={busy || !canSend || waiting} onClick={() => void send()}>
          {t("mail.send")}
        </Button>
      </div>
    </div>
  );
}

/** The glyph a file of the original carries: its state, never colour alone. */
function carriedIcon(row: CarriedRow) {
  if (row.state === "loading") return <RefreshCw size={ICON.meta} className="m-spin" />;
  if (row.state === "failed") return <AlertTriangle size={ICON.meta} />;
  if (row.state === "left") return <Ban size={ICON.meta} />;
  return <Paperclip size={ICON.meta} />;
}
