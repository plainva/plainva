import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, FloatingWindow, ICON, Select, toast } from "@plainva/ui";
import { Paperclip, X } from "lucide-react";
import { useVault } from "../../contexts/VaultContext";
import { listMailAccounts, type MailAccountConfig } from "../../services/mail/mailAccounts";
import { listMailboxesFor } from "../../services/mail/mailClient";
import { appendDraft, guessDraftsMailbox, sendMail, bytesToBase64, mailFolderLabel, type MailAttachment } from "../../services/mail/mailOut";
import { ComposeEditor } from "./ComposeEditor";
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
  onClose: () => void;
}

const MIME_BY_EXT: Record<string, string> = {
  pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", svg: "image/svg+xml", md: "text/markdown", txt: "text/plain", csv: "text/csv",
  ics: "text/calendar", doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", zip: "application/zip",
};

function guessMime(name: string): string {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
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

export function MailDraftModal({ subject: initialSubject, markdown, attachments, initialTo, onClose }: MailDraftModalProps) {
  const { t } = useTranslation();
  const { vaultPath } = useVault();
  const [accounts, setAccounts] = useState<MailAccountConfig[]>([]);
  const [accountId, setAccountId] = useState("");
  const [mailboxes, setMailboxes] = useState<string[]>([]);
  const [mailbox, setMailbox] = useState("");
  const [to, setTo] = useState(initialTo ?? "");
  // Recipients render as chips (like the event attendee field); each stays a
  // comma-joined string for the SMTP/IMAP layer. `*Draft` is the text in flight.
  const [toDraft, setToDraft] = useState("");
  const [cc, setCc] = useState("");
  const [ccDraft, setCcDraft] = useState("");
  const [bcc, setBcc] = useState("");
  const [bccDraft, setBccDraft] = useState("");
  const [showCc, setShowCc] = useState(false);
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
    return () => { alive = false; };
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
    return () => { alive = false; };
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
    // Fold a typed-but-not-yet-chipped recipient into each list.
    const recips = foldRecips(to, toDraft);
    if (!recips || !subject.trim() || !mailbox) {
      setError(t("pim.fillAllFields", { defaultValue: "Bitte alle Felder ausfüllen." }));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await appendDraft(vaultPath, account, mailbox, recips, subject.trim(), body, attach, foldRecips(cc, ccDraft), foldRecips(bcc, bccDraft));
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
      await sendMail(vaultPath, account, recips, subject.trim(), body, files, calendar, foldRecips(cc, ccDraft), foldRecips(bcc, bccDraft));
      toast.info(t("mail.sent", { defaultValue: "Nachricht gesendet." }));
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }, [vaultPath, accounts, accountId, busy, to, toDraft, cc, ccDraft, bcc, bccDraft, subject, body, attach, onClose, t]);

  // Chip-field wiring per recipient list (To / Cc / Bcc).
  const chipList = (val: string, setVal: (v: string) => void, setDraft: (v: string) => void) => {
    const list = splitRecipients(val);
    return {
      list,
      commit: (raw: string) => {
        const parsed = splitRecipients(raw);
        if (parsed.length === 0) return;
        setVal([...new Set([...list, ...parsed])].join(", "));
        setDraft("");
      },
      remove: (r: string) => setVal(list.filter((x) => x !== r).join(", ")),
    };
  };
  const toRow = chipList(to, setTo, setToDraft);
  const ccRow = chipList(cc, setCc, setCcDraft);
  const bccRow = chipList(bcc, setBcc, setBccDraft);

  const renderChips = (
    row: { list: string[]; commit: (r: string) => void; remove: (r: string) => void },
    draft: string,
    setDraft: (v: string) => void,
    testid: string,
    placeholder: string,
    autoFocus = false
  ) => (
    <div
      className="pv-field pv-chipfield"
      data-testid={`${testid}-field`}
      onClick={(e) => { if (e.target === e.currentTarget) (e.currentTarget.querySelector("input") as HTMLInputElement | null)?.focus(); }}
    >
      {row.list.map((r) => (
        <span key={r} className="pv-chip pv-chip--removable" data-testid={`${testid}-chip`}>
          <span>{r}</span>
          <button
            type="button"
            className="pv-chip-x"
            onClick={() => row.remove(r)}
            aria-label={t("mail.recipientRemove", { defaultValue: "Empfänger entfernen: {{email}}", email: r })}
            data-testid={`${testid}-remove`}
          >
            <X size={ICON.meta} />
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === "," || e.key === ";") { e.preventDefault(); row.commit(draft); }
          else if (e.key === "Backspace" && draft === "" && row.list.length > 0) { row.remove(row.list[row.list.length - 1]); }
        }}
        onBlur={() => row.commit(draft)}
        data-testid={testid}
        autoFocus={autoFocus}
        placeholder={row.list.length === 0 ? placeholder : ""}
      />
    </div>
  );

  const canSend = !!accounts.find((a) => a.id === accountId)?.smtpHost;
  const title = t("mail.composeTitle", { defaultValue: "Nachricht verfassen" });

  return (
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
            <button type="button" className="pv-peek-btn" onClick={onClose} aria-label={t("common.close", { defaultValue: "Schließen" })} data-tip={t("common.close", { defaultValue: "Schließen" })}>
              <X size={ICON.ui} />
            </button>
          </div>
        </>
      }
    >

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
                {accounts.length > 1 ? (
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <Select ariaLabel={t("mail.from", { defaultValue: "Von" })} value={accountId} onChange={setAccountId} options={accounts.map((a) => ({ value: a.id, label: a.label }))} />
                  </div>
                ) : (
                  <input className="pv-field" value={accounts[0]?.label ?? ""} readOnly data-testid="draft-from" />
                )}
              </div>
              <div className="pv-mail-addr">
                <span className="k">{t("mail.draftTo", { defaultValue: "An" })}</span>
                {renderChips(toRow, toDraft, setToDraft, "draft-to", "name@example.org", true)}
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
                    {renderChips(ccRow, ccDraft, setCcDraft, "draft-cc", "")}
                  </div>
                  <div className="pv-mail-addr">
                    <span className="k">{t("mail.bcc", { defaultValue: "Bcc" })}</span>
                    {renderChips(bccRow, bccDraft, setBccDraft, "draft-bcc", "")}
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
              </div>
              {mailboxes.length > 0 && (
                <div>
                  <label style={{ display: "block", fontSize: "var(--text-sm)", marginBottom: 2 }}>{t("mail.draftMailbox", { defaultValue: "Entwurfsordner" })}</label>
                  <Select ariaLabel={t("mail.draftMailbox", { defaultValue: "Entwurfsordner" })} value={mailbox} onChange={setMailbox} options={mailboxes.map((m) => ({ value: m, label: mailFolderLabel(m) }))} />
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
            <p style={{ color: "var(--error-text)", fontSize: "var(--text-sm)", margin: 0 }} data-testid="draft-error">{error}</p>
          )}
        </div>
      </div>

      <div className="pv-mail-winfoot">
        <Button variant="ghost" onClick={onClose}>{t("common.cancel", { defaultValue: "Abbrechen" })}</Button>
        <span style={{ flex: 1 }} />
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
      </div>
    </FloatingWindow>
  );
}
