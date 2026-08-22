import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, ChipField, FloatingWindow, ICON, Select, toast } from "@plainva/ui";
import { FileText, Paperclip, SquareArrowOutUpRight, X } from "lucide-react";
import { useVault } from "../../contexts/VaultContext";
import { listMailAccounts, type MailAccountConfig } from "@plainva/ui/mail";
import { listMailboxesFor } from "@plainva/ui/mail";
import { resolveDraftsMailbox, bytesToBase64, guessAttachmentMime, mailFolderLabel, senderKey, senderOptions, splitSenderKey, withSignature, withoutSignature, type MailAttachment } from "@plainva/ui/mail";
import { ComposeEditor } from "./ComposeEditor";
import { TemplatePickerModal } from "../TemplatePickerModal";
import { applyTemplateInteractive, withShellContext } from "../../services/templateInteractive";
import { templateInsertText } from "@plainva/ui";
import { submitDraft, submitSend } from "../../services/mail/sendQueue";
import type { ComposeSnapshot } from "../../services/mail/composeHandoff";
import "./mail.css";

/**
 * Compose window (mail-client E3, real reply/forward/new-message). A proper
 * mail composer as a FREE-FLOATING window: draggable by its header, resizable
 * from the bottom-right grip, non-modal (does not dim/block the app — work
 * beside it), remembers its position/size for the session, closable via X or
 * Escape. The message body is a Markdown editor with a formatting toolbar and a
 * `/` slash-command menu (see ComposeEditor). Two ways OUT: SEND directly via
 * the account's SMTP submission host, or append the message as a \Draft into
 * the mailbox for the mail program to send.
 */

interface MailDraftModalProps {
  /** Prefill: subject + the message body (Markdown). */
  subject: string;
  markdown: string;
  /** Optional file attachments (E5 note-as-attachment, E6 invite). */
  attachments?: MailAttachment[];
  /** Optional recipient prefill (reply / reply-all / invite attendees). */
  initialTo?: string;
  /**
   * How this composer is framed (multi-window P3). `floating` is the default —
   * a movable window inside the app, unchanged from before. `window` means the
   * composer IS the window: the OS frame and the aux title bar are the chrome,
   * so it fills the height and Escape belongs to the window, not to a dialog.
   */
  variant?: "floating" | "window";
  /**
   * A composer that was popped out picks up exactly where the writer left off —
   * including which sender was chosen and whether the Cc row was open. When
   * this is set the fields are NOT initialised from the account list.
   */
  restore?: ComposeSnapshot;
  /** Offered as a pop-out button when set (floating variant only). */
  onPopOut?: (snapshot: ComposeSnapshot) => void;
  onClose: () => void;
}

/** Split a recipient string into individual addresses on comma/semicolon/
 * newline only — spaces are preserved so a "Name <email>" entry stays intact. */
function splitRecipients(s: string): string[] {
  return s
    .split(/[,;\n]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

/** The committed recipients plus a typed-but-not-yet-chipped one, comma-joined. */
function foldRecips(val: string, draft: string): string {
  return (draft.trim() ? [...splitRecipients(val), draft.trim()] : splitRecipients(val)).join(", ");
}

export function MailDraftModal({ subject: initialSubject, markdown, attachments, initialTo, variant = "floating", restore, onPopOut, onClose }: MailDraftModalProps) {
  const { t } = useTranslation();
  const { vaultPath, vaultAdapter } = useVault();
  const [accounts, setAccounts] = useState<MailAccountConfig[]>([]);
  const [accountId, setAccountId] = useState(restore?.accountId ?? "");
  /** Chosen sender address within that account (an alias, or its own). */
  const [fromAddress, setFromAddress] = useState(restore?.fromAddress ?? "");
  const [mailboxes, setMailboxes] = useState<string[]>([]);
  const [folderDelimiter, setFolderDelimiter] = useState<string | undefined>(undefined);
  const [mailbox, setMailbox] = useState(restore?.mailbox ?? "");
  const [to, setTo] = useState(restore?.to ?? initialTo ?? "");
  // Recipients render as chips (like the event attendee field); each stays a
  // comma-joined string for the SMTP/IMAP layer. `*Draft` is the text in flight.
  const [toDraft, setToDraft] = useState("");
  const [cc, setCc] = useState(restore?.cc ?? "");
  const [ccDraft, setCcDraft] = useState("");
  const [bcc, setBcc] = useState(restore?.bcc ?? "");
  const [bccDraft, setBccDraft] = useState("");
  const [showCc, setShowCc] = useState(restore?.showCc ?? false);
  const [subject, setSubject] = useState(restore?.subject ?? initialSubject);
  const [body, setBody] = useState(restore?.body ?? markdown);
  const [attach, setAttach] = useState<MailAttachment[]>(restore?.attachments ?? attachments ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * The From picker offers ADDRESSES, not accounts: an account contributes its
   * own address plus its configured aliases (shared `senderKey` so both shells
   * encode the choice the same way).
   */
  const fromOptions = useMemo(
    () =>
      accounts.flatMap((a) =>
        senderOptions(a).map((address) => ({
          value: senderKey(a.id, address),
          label: accounts.length > 1 ? `${address} · ${a.label}` : address,
        }))
      ),
    [accounts]
  );

  /** Switching sender swaps the signature: the previous account's block goes,
   * the new one's comes in — otherwise two signatures stack up in one mail. */
  const selectFrom = useCallback(
    (value: string) => {
      const { accountId: nextId, address } = splitSenderKey(value);
      const previous = accounts.find((a) => a.id === accountId) ?? null;
      const next = accounts.find((a) => a.id === nextId) ?? null;
      setAccountId(nextId);
      setFromAddress(address);
      // Findings round P8.2: a signature belongs to an ADDRESS now, so the swap
      // has to run when only the address changes too. The old guard compared
      // account ids, which meant switching between two aliases of one account
      // silently kept the first one's signature.
      if (previous?.id !== next?.id || address !== fromAddress) {
        setBody((b) => withSignature(withoutSignature(b, previous, fromAddress), next, address));
      }
    },
    [accounts, accountId, fromAddress]
  );

  // The signature of the initially selected account lands in the body once the
  // accounts are loaded (the modal opens before that resolves).
  const signedFor = useRef<string | null>(restore ? senderKey(restore.accountId, restore.fromAddress) : null);
  useEffect(() => {
    const account = accounts.find((a) => a.id === accountId);
    if (!account) return;
    const key = senderKey(account.id, fromAddress);
    if (signedFor.current === key) return;
    signedFor.current = key;
    setBody((b) => withSignature(b, account, fromAddress));
  }, [accounts, accountId, fromAddress]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      if (!vaultPath) return;
      const list = await listMailAccounts(vaultPath);
      if (!alive) return;
      setAccounts(list);
      // A restored composer already knows its sender — picking the first
      // account here would silently switch it (and its signature).
      if (restore) return;
      setAccountId(list[0]?.id ?? "");
      setFromAddress(list[0] ? senderOptions(list[0])[0] ?? "" : "");
    })();
    return () => { alive = false; };
  }, [vaultPath, restore]);

  // The drafts folder the writer had chosen survives the pop-out too; the
  // lookup below re-guesses it otherwise.
  const restoredMailbox = useRef(!!restore?.mailbox);
  useEffect(() => {
    let alive = true;
    const account = accounts.find((a) => a.id === accountId);
    if (!vaultPath || !account) return;
    setMailboxes([]);
    void (async () => {
      try {
        const boxes = await listMailboxesFor(vaultPath, account);
        if (!alive) return;
        const names = boxes.map((m) => m.name);
        const delim = boxes.find((b) => b.delimiter)?.delimiter;
        setMailboxes(names);
        setFolderDelimiter(delim);
        // Backend-stated role first (Graph localizes "Entwürfe"), name guess
        // second — shared with the phone since S29, so both shells file a
        // draft into the same folder.
        if (!restoredMailbox.current) setMailbox(resolveDraftsMailbox(boxes) ?? "");
        restoredMailbox.current = false;
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { alive = false; };
  }, [vaultPath, accounts, accountId]);

  const [templatePicker, setTemplatePicker] = useState(false);
  const insertTemplate = useCallback(() => setTemplatePicker(true), []);

  /**
   * Puts a template into the message body.
   *
   * `templateInsertText` strips the template's OWN frontmatter — a mail body has
   * no frontmatter, and pasting one in would send YAML to the recipient. The
   * engine runs INTERACTIVE, so a template with questions asks them once in the
   * collected dialog instead of leaving `{{prompt:…}}` in the text.
   */
  const applyTemplate = useCallback(
    async (templatePath: string) => {
      setTemplatePicker(false);
      if (!vaultAdapter) return;
      try {
        const raw = await vaultAdapter.readTextFile(templatePath);
        const title = subject || (templatePath.split(/[/\\]/).pop() ?? "").replace(/\.md$/i, "");
        const body0 = templateInsertText(raw, title);
        const ctx = await withShellContext(body0, { title, now: new Date(), folder: "" });
        const out = await applyTemplateInteractive(body0, ctx, t("mail.insertTemplate"));
        if (!out) return; // cancelled → nothing is written
        setBody((prev) => (prev ? `${prev}\n\n${out.text}` : out.text));
      } catch {
        toast.error(t("mail.templateFailed"));
      }
    },
    [vaultAdapter, subject, t]
  );

  const pickFile = useCallback(async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const picked = await open({ multiple: false, title: t("mail.attachFile", { defaultValue: "Datei anhängen" }) });
      if (typeof picked !== "string") return;
      const { readFile } = await import("@tauri-apps/plugin-fs");
      const bytes = await readFile(picked);
      const name = picked.split(/[\\/]/).pop() ?? "attachment";
      setAttach((prev) => [...prev, { name, mime: guessAttachmentMime(name), contentBase64: bytesToBase64(bytes) }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [t]);

  const submit = useCallback(async () => {
    const account = accounts.find((a) => a.id === accountId);
    if (!vaultPath || !account || busy) return;
    // Fold a typed-but-not-yet-chipped recipient into each list.
    const recips = foldRecips(to, toDraft);
    if (!recips || !subject.trim() || !mailbox) {
      setError(t("pim.fillAllFields", { defaultValue: "Bitte alle Felder ausfüllen." }));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await submitDraft({
        vaultPath,
        accountId: account.id,
        mailbox,
        to: recips,
        subject: subject.trim(),
        body,
        attachments: attach,
        cc: foldRecips(cc, ccDraft),
        bcc: foldRecips(bcc, bccDraft),
      });
      toast.info(t("mail.draftSaved", { defaultValue: "Entwurf im Postfach abgelegt — zum Senden im Mail-Programm öffnen." }));
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }, [vaultPath, accounts, accountId, busy, to, toDraft, cc, ccDraft, bcc, bccDraft, subject, mailbox, body, attach, onClose, t]);

  const send = useCallback(async () => {
    const account = accounts.find((a) => a.id === accountId);
    if (!vaultPath || !account || busy) return;
    const recips = foldRecips(to, toDraft);
    if (!recips || !subject.trim()) {
      setError(t("pim.fillAllFields", { defaultValue: "Bitte alle Felder ausfüllen." }));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // A text/calendar; method=… attachment (from "Termin per Mail versenden")
      // is sent as an INLINE iMIP invitation so Gmail renders it as an event.
      const calIdx = attach.findIndex((a) => /^text\/calendar/i.test(a.mime));
      let calendar: { ics: string; method?: string } | undefined;
      let files = attach;
      if (calIdx >= 0) {
        const a = attach[calIdx];
        try {
          const bytes = Uint8Array.from(atob(a.contentBase64.trim()), (c) => c.charCodeAt(0));
          calendar = { ics: new TextDecoder("utf-8").decode(bytes), method: /method=([A-Za-z-]+)/i.exec(a.mime)?.[1]?.toUpperCase() };
          files = attach.filter((_, i) => i !== calIdx);
        } catch { /* fall back to a normal attachment */ }
      }
      // "Undo send" (S23) is a DELAY, not a recall: once SMTP has the message
      // there is no taking it back. The composer closes right away — the message
      // is on its way as far as the writer is concerned — and the toast holds
      // the one chance to stop it. The timer and that toast belong to the
      // CENTRAL window (multi-window §12.4): a compose window is the one most
      // likely to be closed while the timer runs, and closing a window must
      // never be what decides between sending and losing.
      await submitSend({
        vaultPath,
        accountId: account.id,
        to: recips,
        subject: subject.trim(),
        body,
        attachments: files,
        calendar,
        cc: foldRecips(cc, ccDraft),
        bcc: foldRecips(bcc, bccDraft),
        fromAddress,
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }, [vaultPath, accounts, accountId, fromAddress, busy, to, toDraft, cc, ccDraft, bcc, bccDraft, subject, body, attach, onClose, t]);

  /**
   * Everything the writer has entered, ready to travel to another window.
   *
   * Recipients are FOLDED first: a typed-but-not-yet-chipped address is part of
   * what someone wrote, and "loses nothing" has to mean nothing.
   */
  const snapshot = useCallback(
    (): ComposeSnapshot => ({
      accountId,
      fromAddress,
      to: foldRecips(to, toDraft),
      cc: foldRecips(cc, ccDraft),
      bcc: foldRecips(bcc, bccDraft),
      showCc,
      subject,
      body,
      attachments: attach,
      mailbox,
    }),
    [accountId, fromAddress, to, toDraft, cc, ccDraft, bcc, bccDraft, showCc, subject, body, attach, mailbox],
  );

  const popOut = useCallback(() => {
    onPopOut?.(snapshot());
    onClose();
  }, [onPopOut, snapshot, onClose]);

  // Recipient lists are stored as one comma-joined string (that is what the
  // send path takes); the field itself works on the split list.
  const renderChips = (
    value: string,
    setValue: (v: string) => void,
    setDraft: (v: string) => void,
    testid: string,
    placeholder: string,
    autoFocus = false
  ) => (
    <ChipField
      values={splitRecipients(value)}
      onChange={(next) => setValue(next.join(", "))}
      onDraftChange={setDraft}
      parse={splitRecipients}
      removeLabel={(r) => t("mail.recipientRemove", { defaultValue: "Empfänger entfernen: {{email}}", email: r })}
      placeholder={placeholder}
      testId={testid}
      autoFocus={autoFocus}
    />
  );

  const canSend = !!accounts.find((a) => a.id === accountId)?.smtpHost;
  const title = t("mail.composeTitle", { defaultValue: "Nachricht verfassen" });

  const panel = (
    <>
      <div className="pv-mail-winbody">
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", height: "100%" }} data-testid="draft-form">
          {accounts.length === 0 ? (
            <p style={{ margin: 0, fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>
              {t("mail.noAccounts", { defaultValue: "Noch kein E-Mail-Konto verbunden." })}
            </p>
          ) : (
            <>
              <div className="pv-mail-addr">
                <span className="k">{t("mail.from", { defaultValue: "Von" })}</span>
                {fromOptions.length > 1 ? (
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <Select
                      ariaLabel={t("mail.from", { defaultValue: "Von" })}
                      /* The SAME key the options are built with. Joining by hand
                         (this was a newline) matched no option, so Select fell
                         back to printing the raw value: the field read
                         "a1 me@example.org" instead of the sender's label
                         (report 2026-07-29, screenshot). */
                      value={senderKey(accountId, fromAddress)}
                      onChange={selectFrom}
                      data-testid="draft-from-select"
                      options={fromOptions}
                    />
                  </div>
                ) : (
                  <input className="pv-field" value={fromOptions[0]?.label ?? accounts[0]?.label ?? ""} readOnly data-testid="draft-from" />
                )}
              </div>
              <div className="pv-mail-addr">
                <span className="k">{t("mail.draftTo", { defaultValue: "An" })}</span>
                {renderChips(to, setTo, setToDraft, "draft-to", "name@example.org", true)}
                {!showCc && (
                  <button type="button" className="pv-mail-cctoggle" onClick={() => setShowCc(true)} data-testid="draft-cc-toggle">
                    {t("mail.ccBcc", { defaultValue: "Cc/Bcc" })}
                  </button>
                )}
              </div>
              {showCc && (
                <>
                  <div className="pv-mail-addr">
                    <span className="k">{t("mail.cc", { defaultValue: "Cc" })}</span>
                    {renderChips(cc, setCc, setCcDraft, "draft-cc", "")}
                  </div>
                  <div className="pv-mail-addr">
                    <span className="k">{t("mail.bcc", { defaultValue: "Bcc" })}</span>
                    {renderChips(bcc, setBcc, setBccDraft, "draft-bcc", "")}
                  </div>
                </>
              )}
              <div className="pv-mail-addr">
                <span className="k">{t("mail.draftSubject", { defaultValue: "Betreff" })}</span>
                <input className="pv-field" value={subject} onChange={(e) => setSubject(e.target.value)} data-testid="draft-subject" />
              </div>
              <ComposeEditor
                value={body}
                onChange={setBody}
                placeholder={t("mail.bodyPlaceholder", { defaultValue: "Nachricht schreiben… (Markdown, „/“ für Befehle)" })}
                data-testid="draft-body"
              />
              <div className="pv-mail-cmpattach">
                {attach.map((a, i) => (
                  <span key={`${a.name}-${i}`} className={/^text\/calendar/i.test(a.mime) ? "pv-mail-attach-chip pv-mail-attach-chip--ics" : "pv-mail-attach-chip"} data-testid="draft-attachments">
                    <Paperclip size={ICON.meta} />
                    {a.name}
                    <button type="button" className="pv-mail-attach-remove" onClick={() => setAttach((prev) => prev.filter((_, j) => j !== i))} aria-label={t("mail.removeAttachment", { defaultValue: "Anhang entfernen" })} data-testid="draft-attach-remove">
                      <X size={ICON.meta} />
                    </button>
                  </span>
                ))}
                <Button variant="ghost" size="sm" icon={<Paperclip size={ICON.ui} />} onClick={() => void pickFile()} data-testid="draft-attach-file">
                  {t("mail.attachFile", { defaultValue: "Datei anhängen" })}
                </Button>
                {/* Templates in the composer (S22). The engine already exists —
                    what was missing was the way in. It runs INTERACTIVE, so a
                    template with questions asks them in the one collected dialog
                    rather than dropping `{{prompt:…}}` into the message. */}
                <Button variant="ghost" size="sm" icon={<FileText size={ICON.ui} />} onClick={() => void insertTemplate()} data-testid="draft-insert-template">
                  {t("mail.insertTemplate")}
                </Button>
              </div>
              {mailboxes.length > 0 && (
                <div>
                  <label style={{ display: "block", fontSize: "var(--text-sm)", marginBottom: 2 }}>{t("mail.draftMailbox", { defaultValue: "Entwurfsordner" })}</label>
                  <Select ariaLabel={t("mail.draftMailbox", { defaultValue: "Entwurfsordner" })} value={mailbox} onChange={setMailbox} options={mailboxes.map((m) => ({ value: m, label: mailFolderLabel(m, folderDelimiter) }))} />
                </div>
              )}
              <p style={{ margin: "var(--space-1) 0 var(--space-2)", fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
                {canSend
                  ? t("mail.composeHint", { defaultValue: "„Senden“ verschickt direkt über SMTP; „Als Entwurf“ legt die Nachricht ins Postfach." })
                  : t("mail.noSmtpHint", { defaultValue: "Für den Direktversand einen SMTP-Host im Konto hinterlegen." })}
              </p>
            </>
          )}
          {templatePicker && (
      <TemplatePickerModal
        isOpen
        onClose={() => setTemplatePicker(false)}
        onPick={(p) => void applyTemplate(p)}
        title={t("mail.insertTemplate")}
      />
    )}
    {error && (
            <p style={{ color: "var(--error-text)", fontSize: "var(--text-sm)", margin: 0 }} data-testid="draft-error">{error}</p>
          )}
        </div>
      </div>

      <div className="pv-mail-winfoot">
        <Button variant="ghost" onClick={onClose}>{t("common.cancel", { defaultValue: "Abbrechen" })}</Button>
        <span style={{ flex: 1 }} />
        <Button variant="secondary" data-testid="draft-save" disabled={busy || accounts.length === 0} onClick={() => void submit()}>
          {t("mail.draftAction")}
        </Button>
        <Button
          variant="primary"
          data-testid="draft-send"
          disabled={busy || accounts.length === 0 || !canSend}
          onClick={() => void send()}
          data-tip={!canSend ? t("mail.noSmtpHint", { defaultValue: "Für den Direktversand einen SMTP-Host im Konto hinterlegen." }) : undefined}
        >
          {busy ? t("pim.connecting", { defaultValue: "Verbinde…" }) : t("mail.send", { defaultValue: "Senden" })}
        </Button>
      </div>
    </>
  );

  const floating = (
    <FloatingWindow
      persistKey="compose"
      defaultWidth={660}
      defaultHeight={600}
      minHeight={360}
      ariaLabel={title}
      onEscape={onClose}
      className="pv-mail-window"
      head={
        <>
          <span className="pv-peek-title">{title}</span>
          <div className="pv-peek-actions">
            {onPopOut && (
              <button
                type="button"
                className="pv-peek-btn"
                onClick={popOut}
                aria-label={t("window.popOutCompose")}
                data-tip={t("window.popOutCompose")}
                data-testid="draft-popout"
              >
                <SquareArrowOutUpRight size={ICON.ui} />
              </button>
            )}
            <button type="button" className="pv-peek-btn" onClick={onClose} aria-label={t("common.close", { defaultValue: "Schließen" })} data-tip={t("common.close", { defaultValue: "Schließen" })}>
              <X size={ICON.ui} />
            </button>
          </div>
        </>
      }
    >
      {panel}
    </FloatingWindow>
  );

  // As its own OS window the composer drops the floating chrome: the window
  // frame and the aux title bar above it are the chrome, and Escape belongs
  // to the window rather than to a dialog inside it.
  return variant === "window" ? <div className="pv-mail-winpane">{panel}</div> : floating;
}
