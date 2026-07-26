import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronDown, Mail, Settings, Star } from "lucide-react";
import { EmptyState, toast } from "@plainva/ui";
import type { MailAccountConfig, MailEnvelope, MailboxInfo } from "@plainva/ui/mail";
import { listEnvelopes, listMailboxesFor, mailFolderLabel, sortMailFolders } from "@plainva/ui/mail";
import { listMobileMailAccounts, mailVaultId, MAIL_CHANGED_EVENT } from "../services/mail/mailRuntime";
import { isImapUnavailable } from "../services/mail/mobileMailPlatform";
import { usePullToRefresh } from "../lib/usePullToRefresh";

const PAGE = 30;

/**
 * The mobile inbox (mail feinplan G1). Online-only by design in this stage:
 * every open asks the server, exactly like the desktop does — the offline
 * cache is its own stage and the plan keeps it separate on purpose.
 *
 * The account/folder line under the title carries the two things a phone
 * screen cannot show in a sidebar: which mailbox this is, and how many unread
 * messages it holds. Tapping it opens the folder sheet.
 */
export function MailListScreen({
  bump,
  onBack,
  onOpenMessage,
  onOpenAccounts,
}: {
  bump: number;
  onBack?: () => void;
  onOpenMessage: (accountId: string, mailbox: string, id: string) => void;
  onOpenAccounts: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [accounts, setAccounts] = useState<MailAccountConfig[]>([]);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [folders, setFolders] = useState<MailboxInfo[]>([]);
  const [mailbox, setMailbox] = useState<string | null>(null);
  const [rows, setRows] = useState<MailEnvelope[]>([]);
  const [unseen, setUnseen] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState(false);

  const account = useMemo(() => accounts.find((a) => a.id === accountId) ?? null, [accounts, accountId]);
  const vault = mailVaultId();

  // Accounts first — everything else hangs off the chosen one.
  useEffect(() => {
    void listMobileMailAccounts().then((rowsA) => {
      setAccounts(rowsA);
      setAccountId((cur) => cur ?? rowsA[0]?.id ?? null);
    });
  }, [bump]);

  useEffect(() => {
    const onChanged = () => void listMobileMailAccounts().then(setAccounts);
    window.addEventListener(MAIL_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(MAIL_CHANGED_EVENT, onChanged);
  }, []);

  // Folders of the chosen account; the inbox is the natural landing folder.
  useEffect(() => {
    if (!vault || !account) return;
    let cancelled = false;
    setError(null);
    void listMailboxesFor(vault, account)
      .then((list) => {
        if (cancelled) return;
        setFolders(list);
        const names = sortMailFolders(list.map((f) => f.name), list[0]?.delimiter);
        const inbox = names.find((n) => n.toLowerCase() === "inbox") ?? names[0] ?? null;
        setMailbox((cur) => (cur && names.includes(cur) ? cur : inbox));
      })
      .catch((e) => !cancelled && setError(describe(e, t)));
    return () => {
      cancelled = true;
    };
  }, [vault, account, t]);

  const load = useCallback(async () => {
    if (!vault || !account || !mailbox) return;
    setLoading(true);
    setError(null);
    try {
      const page = await listEnvelopes(vault, account, mailbox, 0, PAGE);
      setRows(page.messages);
      setUnseen(page.unseen);
      setTotal(page.total);
    } catch (e) {
      setError(describe(e, t));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [vault, account, mailbox, t]);

  useEffect(() => {
    void load();
  }, [load, bump]);

  const loadMore = async () => {
    if (!vault || !account || !mailbox || loading || rows.length >= total) return;
    setLoading(true);
    try {
      const page = await listEnvelopes(vault, account, mailbox, rows.length, PAGE);
      // De-duplicate: a message arriving during paging would otherwise appear
      // twice (the server counts from the top, our offset does not move with it).
      const seen = new Set(rows.map((r) => r.id));
      setRows([...rows, ...page.messages.filter((m) => !seen.has(m.id))]);
      setTotal(page.total);
    } catch (e) {
      toast.error(describe(e, t));
    } finally {
      setLoading(false);
    }
  };

  const ptrRef = useRef<HTMLDivElement>(null);
  const ptrIndicator = usePullToRefresh(ptrRef, load);

  // Only rendered when pushed; as a tab root the shell owns the top bar.
  const backHeader = (
    <header className="m-header">
      <button aria-label={t("common.back", { defaultValue: "Zurück" })} className="m-iconbtn" onClick={onBack}>
        <ChevronLeft size={20} />
      </button>
      <h1>{t("mail.title")}</h1>
    </header>
  );

  const folderNames = useMemo(
    () => sortMailFolders(folders.map((f) => f.name), folders[0]?.delimiter),
    [folders],
  );

  if (accounts.length === 0) {
    return (
      <div className="m-page">
        {onBack && backHeader}
        <EmptyState icon={<Mail size={20} />}>{t("mail.noAccounts")}</EmptyState>
        <button type="button" className="m-btn m-btn--filled" onClick={onOpenAccounts}>
          {t("mail.addAccount")}
        </button>
      </div>
    );
  }

  return (
    <div className="m-page" ref={ptrRef}>
      {onBack && backHeader}
      {ptrIndicator}

      {/* Which mailbox am I looking at, and how much is unread. */}
      <button type="button" className="m-mboxline" onClick={() => setSheet(true)}>
        <span className="m-mboxline-name">{mailbox ? mailFolderLabel(mailbox, folders[0]?.delimiter) : "…"}</span>
        {unseen > 0 && <span className="m-mboxline-badge">{unseen}</span>}
        <span className="m-mboxline-acct">{account?.label ?? ""}</span>
        <ChevronDown size={16} />
      </button>

      {error ? (
        <EmptyState icon={<Mail size={20} />}>{error}</EmptyState>
      ) : rows.length === 0 && !loading ? (
        <EmptyState icon={<Mail size={20} />}>{t("mail.folderEmpty")}</EmptyState>
      ) : (
        <ul className="m-maillist">
          {rows.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                className={m.seen ? "m-mailrow" : "m-mailrow is-unread"}
                onClick={() => account && mailbox && onOpenMessage(account.id, mailbox, m.id)}
              >
                <span className="m-mailrow-top">
                  <span className="m-mailrow-from">{m.from || t("mail.unknownSender")}</span>
                  <span className="m-mailrow-date">{formatDate(m.dateTs, i18n.language)}</span>
                </span>
                <span className="m-mailrow-subject">
                  {m.flagged && <Star size={13} className="m-mailrow-flag" />}
                  {m.subject || t("mail.noSubject")}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {rows.length < total && (
        <button type="button" className="m-btn m-btn--ghost" disabled={loading} onClick={() => void loadMore()}>
          {t("mail.loadMore")}
        </button>
      )}

      {sheet && (
        <div className="m-sheet-backdrop" onClick={() => setSheet(false)}>
          <div className="m-sheet m-sheet--folders" onClick={(e) => e.stopPropagation()}>
            <div className="m-sheet-grip" />
            <h2>{t("mail.folders")}</h2>
            <ul>
              {folderNames.map((name) => (
                <li key={name}>
                  <button
                    type="button"
                    className={name === mailbox ? "m-row is-active" : "m-row"}
                    onClick={() => {
                      setMailbox(name);
                      setRows([]);
                      setSheet(false);
                    }}
                  >
                    {mailFolderLabel(name, folders[0]?.delimiter)}
                  </button>
                </li>
              ))}
            </ul>
            {accounts.length > 1 && (
              <>
                <h2>{t("mail.accounts")}</h2>
                <ul>
                  {accounts.map((a) => (
                    <li key={a.id}>
                      <button
                        type="button"
                        className={a.id === accountId ? "m-row is-active" : "m-row"}
                        onClick={() => {
                          setAccountId(a.id);
                          setMailbox(null);
                          setRows([]);
                          setSheet(false);
                        }}
                      >
                        {a.label}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
            <button type="button" className="m-row" onClick={onOpenAccounts}>
              <Settings size={16} />
              <span>{t("mail.accounts")}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** IMAP has its own message on mobile — a generic failure would hide the fact
 * that this mailbox simply needs the desktop until the native plugin lands. */
function describe(e: unknown, t: (k: string) => string): string {
  if (isImapUnavailable(e)) return t("mail.imapMobileUnavailable");
  return e instanceof Error ? e.message : String(e);
}

function formatDate(ts: number, lang: string): string {
  if (!ts) return "";
  const d = new Date(ts);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? d.toLocaleTimeString(lang, { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString(lang, { day: "2-digit", month: "2-digit" });
}
