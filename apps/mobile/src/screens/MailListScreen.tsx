import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronDown, Mail, PenLine, Search, Settings, Star, X } from "lucide-react";
import { EmptyState, toast, useStableHandler } from "@plainva/ui";
import type { MailAccountConfig, MailEnvelope, MailboxInfo } from "@plainva/ui/mail";
import { listEnvelopes, listMailboxesFor, mailFolderLabel, searchEnvelopes, sortMailFolders } from "@plainva/ui/mail";
import { listMobileMailAccounts, mailVaultId, MAIL_CHANGED_EVENT } from "../services/mail/mailRuntime";
import { isImapUnavailable } from "../services/mail/mobileMailPlatform";
import { usePullToRefresh } from "../lib/usePullToRefresh";
import { cacheEnvelopes, cachedEnvelopes } from "../services/mail/mailCache";
import type { MobileVault } from "../services/vaultService";

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
  vault: vault_,
  bump,
  onBack,
  onOpenMessage,
  onOpenAccounts,
  onCompose,
}: {
  vault: MobileVault;
  bump: number;
  onBack?: () => void;
  onOpenMessage: (accountId: string, mailbox: string, id: string, flagged: boolean) => void;
  onOpenAccounts: () => void;
  onCompose: (accountId: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const vaultObj = vault_;
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
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [stale, setStale] = useState(false);

  const account = useMemo(() => accounts.find((a) => a.id === accountId) ?? null, [accounts, accountId]);
  const vault = mailVaultId();
  const vaultRef = vaultObj;

  // The effects below must not re-run just because i18n handed out a new `t`
  // (or the account array was rebuilt) — each re-run is another round of
  // requests at the mail provider. `useStableHandler` keeps one identity.
  const accountById = useStableHandler((id: string | null) => accounts.find((a) => a.id === id) ?? null);
  const describeError = useStableHandler((e: unknown) => describe(e, t));

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
  // Keyed on the account ID, not the account object: `listMobileMailAccounts`
  // hands back a fresh array each time, so an object dependency re-ran this on
  // every refresh — and several folder/message requests at once is exactly
  // what makes Graph answer 429 (device report 2026-07-26).
  useEffect(() => {
    const acc = accountById(accountId);
    if (!vault || !acc) return;
    let cancelled = false;
    setError(null);
    void listMailboxesFor(vault, acc)
      .then((list) => {
        if (cancelled) return;
        setFolders(list);
        const names = sortMailFolders(list.map((f) => f.name), list[0]?.delimiter);
        const inbox = names.find((n) => n.toLowerCase() === "inbox") ?? names[0] ?? null;
        setMailbox((cur) => (cur && names.includes(cur) ? cur : inbox));
      })
      .catch((e) => !cancelled && setError(describeError(e)));
    return () => {
      cancelled = true;
    };
  }, [vault, accountId, accountById, describeError]);

  const load = useCallback(async () => {
    const account = accountById(accountId);
    if (!vault || !account || !mailbox) return;
    setLoading(true);
    setError(null);
    try {
      setStale(false);
      const page = await listEnvelopes(vault, account, mailbox, 0, PAGE);
      setRows(page.messages);
      setUnseen(page.unseen);
      setTotal(page.total);
      void cacheEnvelopes(vaultRef, account.id, mailbox, page.messages);
    } catch (e) {
      // Offline or throttled: show what was last seen rather than an empty
      // screen. The banner still says the refresh failed — the cache is a
      // fallback, never a claim that this is current.
      const cached = await cachedEnvelopes(vaultRef, account.id, mailbox, PAGE);
      setRows(cached);
      setTotal(cached.length);
      setError(cached.length > 0 ? null : describeError(e));
      setStale(cached.length > 0);
    } finally {
      setLoading(false);
    }
  }, [vault, accountId, mailbox, accountById, describeError, vaultRef]);

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
      toast.error(describeError(e));
    } finally {
      setLoading(false);
    }
  };

  /** Server-side search (G3): the phone holds one page, so filtering locally
   *  would only ever find what is already on screen. */
  const runSearch = async () => {
    const account = accountById(accountId);
    const term = query.trim();
    if (!vault || !account || !mailbox || !term) return;
    setSearching(true);
    setLoading(true);
    setError(null);
    try {
      const hits = await searchEnvelopes(vault, account, mailbox, term);
      setRows(hits);
      setTotal(hits.length);
    } catch (e) {
      setError(describeError(e));
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  const clearSearch = () => {
    setQuery("");
    setSearching(false);
    void load();
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

      {stale && <p className="m-hint m-hint--warn">{t("mail.offlineCopy")}</p>}

      {/* Which mailbox am I looking at, and how much is unread. */}
      <button type="button" className="m-mboxline" onClick={() => setSheet(true)}>
        <span className="m-mboxline-name">{mailbox ? mailFolderLabel(mailbox, folders[0]?.delimiter) : "…"}</span>
        {unseen > 0 && <span className="m-mboxline-badge">{unseen}</span>}
        <span className="m-mboxline-acct">{account?.label ?? ""}</span>
        <ChevronDown size={16} />
      </button>

      <div className="m-mailsearch">
        <Search size={16} />
        <input
          type="search"
          value={query}
          placeholder={t("mail.search")}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void runSearch()}
        />
        {searching && (
          <button type="button" className="m-iconbtn" aria-label={t("sidebar.clearSearch")} onClick={clearSearch}>
            <X size={16} />
          </button>
        )}
      </div>

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
                onClick={() => account && mailbox && onOpenMessage(account.id, mailbox, m.id, m.flagged)}
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

      {!searching && rows.length < total && (
        <button type="button" className="m-btn m-btn--ghost" disabled={loading} onClick={() => void loadMore()}>
          {t("mail.loadMore")}
        </button>
      )}

      {account && (
        <button
          type="button"
          className="pv-fab m-fab-float"
          aria-label={t("mail.newMessage")}
          onClick={() => onCompose(account.id)}
        >
          <PenLine size={22} />
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
