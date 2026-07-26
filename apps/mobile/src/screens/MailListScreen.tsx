import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronDown, FolderInput, Mail, MailOpen, PenLine, Search, Settings, Star, Trash2, X } from "lucide-react";
import { EmptyState, toast, useStableHandler } from "@plainva/ui";
import type { MailAccountConfig, MailEnvelope, MailboxInfo } from "@plainva/ui/mail";
import {
  deleteMessagePermanently,
  guessTrashMailbox,
  listEnvelopes,
  listMailboxesFor,
  mailFolderLabel,
  moveMessage,
  searchEnvelopes,
  setMessageSeen,
  sortMailFolders,
} from "@plainva/ui/mail";
import { listMobileMailAccounts, mailVaultId, MAIL_CHANGED_EVENT } from "../services/mail/mailRuntime";
import { isImapUnavailable } from "../services/mail/mobileMailPlatform";
import { rememberedMailPlace, rememberMailPlace, resolveMailAccount, resolveMailbox } from "../services/mail/mailPlace";
import { bulkSeenTarget, runBulk, selectedRows, toggleSelected } from "./mail/mailBulk";
import { mConfirm, mSelect } from "../services/mobileDialogs";
import { useLongPress } from "../lib/useLongPress";
import { SheetGrip } from "../components/SheetGrip";
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
  // Seeded from the remembered pair (B1), so a rebuild after the reader closes
  // lands where the user was — not in the first account's inbox.
  const [accountId, setAccountId] = useState<string | null>(() => rememberedMailPlace().accountId);
  const [folders, setFolders] = useState<MailboxInfo[]>([]);
  const [mailbox, setMailbox] = useState<string | null>(() => rememberedMailPlace().mailbox);
  const [rows, setRows] = useState<MailEnvelope[]>([]);
  const [unseen, setUnseen] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState(false);
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [stale, setStale] = useState(false);
  /** null = not in selection mode (G3a); a set = mode on, possibly empty. */
  const [selection, setSelection] = useState<Set<string> | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  const account = useMemo(() => accounts.find((a) => a.id === accountId) ?? null, [accounts, accountId]);
  const vault = mailVaultId();
  const vaultRef = vaultObj;

  // The effects below must not re-run just because i18n handed out a new `t`
  // (or the account array was rebuilt) — each re-run is another round of
  // requests at the mail provider. `useStableHandler` keeps one identity.
  const accountById = useStableHandler((id: string | null) => accounts.find((a) => a.id === id) ?? null);
  const describeError = useStableHandler((e: unknown) => describe(e, t));
  /**
   * WHICH accounts exist, as a value. `accountById` is deliberately identity-
   * stable, so neither the folder effect nor `load` noticed when the account
   * list finally arrived: on a rebuild the remembered id is already in state,
   * `resolveMailAccount` returns that same id, React bails out of the update —
   * and both effects had already given up on their first pass, when `accounts`
   * was still empty. The screen then sat there with no folders, no messages and
   * no error, for good (device report 2026-07-26, "second tap on E-Mail").
   * Keyed on the ids, not the array, so a refresh that changes nothing still
   * does not fire another round of requests at the provider.
   */
  const accountsKey = useMemo(() => accounts.map((a) => a.id).join(","), [accounts]);

  // Accounts first — everything else hangs off the chosen one. A remembered
  // account that no longer exists falls back to the first (resolveMailAccount).
  useEffect(() => {
    void listMobileMailAccounts().then((rowsA) => {
      setAccounts(rowsA);
      setAccountId((cur) => resolveMailAccount(cur, rowsA));
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
        setMailbox((cur) => resolveMailbox(cur, names));
      })
      .catch((e) => !cancelled && setError(describeError(e)));
    return () => {
      cancelled = true;
    };
  }, [vault, accountId, accountsKey, accountById, describeError]);

  const load = useCallback(async () => {
    // Reading the key here rather than only listing it as a dependency: the
    // closure otherwise reaches the account list solely through the
    // identity-stable `accountById`, which is invisible to both the linter and
    // to React. No accounts yet means there is nothing to ask for anyway.
    if (!accountsKey) return;
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
  }, [vault, accountId, accountsKey, mailbox, accountById, describeError, vaultRef]);

  useEffect(() => {
    void load();
  }, [load, bump]);

  // Remember the pair once both are resolved (B1). Writing here rather than in
  // the pickers also records the fallback, so a vanished account does not leave
  // a stale id behind. rememberMailPlace is a no-op when nothing changed.
  useEffect(() => {
    if (!accountId || !mailbox) return;
    void rememberMailPlace({ accountId, mailbox });
  }, [accountId, mailbox]);

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

  const folderNames = useMemo(
    () => sortMailFolders(folders.map((f) => f.name), folders[0]?.delimiter),
    [folders],
  );

  // ---- Selection mode (G3a) ------------------------------------------------
  // Long-press opens it, tapping then selects further. The desktop does this
  // with Ctrl/Shift; a phone has one finger, so the mode is the modifier.
  const press = useLongPress<string>((id) => setSelection(new Set([id])));
  const chosen = useMemo(() => (selection ? selectedRows(rows, selection) : []), [rows, selection]);

  /** Applies a bulk action to the chosen ids, one at a time, then refreshes. */
  const runOnSelection = async (action: (id: string) => Promise<void>, after: (done: string[]) => void) => {
    if (chosen.length === 0) return;
    setBulkBusy(true);
    try {
      const outcome = await runBulk(chosen.map((m) => m.id), action);
      after(outcome.done);
      if (outcome.failed.length > 0) {
        toast.error(t("mail.bulkPartial", { n: outcome.failed.length, error: outcome.error ?? "" }));
      }
      setSelection(null);
    } finally {
      setBulkBusy(false);
    }
  };

  const bulkSeen = () => {
    const account = accountById(accountId);
    if (!vault || !account || !mailbox) return;
    const target = bulkSeenTarget(rows, selection ?? new Set());
    void runOnSelection(
      (id) => setMessageSeen(vault, account, mailbox, id, target),
      (done) => {
        const set = new Set(done);
        setRows((prev) => prev.map((m) => (set.has(m.id) ? { ...m, seen: target } : m)));
        setUnseen((n) => Math.max(0, target ? n - done.length : n + done.length));
      },
    );
  };

  const bulkMove = async () => {
    const account = accountById(accountId);
    if (!vault || !account || !mailbox) return;
    const target = await mSelect({
      title: t("mail.moveTo"),
      options: folderNames.filter((n) => n !== mailbox).map((n) => ({ value: n, label: mailFolderLabel(n, folders[0]?.delimiter) })),
    });
    if (!target) return;
    void runOnSelection(
      (id) => moveMessage(vault, account, mailbox, id, target),
      (done) => setRows((prev) => prev.filter((m) => !done.includes(m.id))),
    );
  };

  /** Trash, not shred — same rule as a single message: only what is already in
   *  the trash is deleted for good, and that asks first. */
  const bulkDelete = async () => {
    const account = accountById(accountId);
    if (!vault || !account || !mailbox) return;
    const trash = guessTrashMailbox(folders.map((f) => f.name), folders[0]?.delimiter);
    const inTrash = trash !== null && trash === mailbox;
    if (!inTrash && !trash) {
      toast.error(t("mail.noTrashFolder"));
      return;
    }
    if (inTrash && !(await mConfirm({ title: t("mail.deleteForeverConfirm"), message: t("mobile.selectedCount", { n: chosen.length }), danger: true }))) return;
    void runOnSelection(
      (id) => (inTrash ? deleteMessagePermanently(vault, account, mailbox, id) : moveMessage(vault, account, mailbox, id, trash!)),
      (done) => setRows((prev) => prev.filter((m) => !done.includes(m.id))),
    );
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

  if (accounts.length === 0) {
    return (
      <div className="m-page">
        {onBack && backHeader}
        {/* The button belongs IN the empty state's action slot, like the
            calendar's — rendered as a sibling it sat left-aligned while the
            calendar's sat centred, for no reason a user could see. */}
        <EmptyState
          icon={<Mail size={20} />}
          action={
            <button type="button" className="m-btn m-btn--filled" onClick={onOpenAccounts}>
              {t("mail.addAccount")}
            </button>
          }
        >
          {t("mail.noAccounts")}
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="m-page" ref={ptrRef}>
      {onBack && backHeader}
      {ptrIndicator}

      {stale && <p className="m-hint m-hint--warn">{t("mail.offlineCopy")}</p>}

      {/* Which mailbox am I looking at, how much is unread, and search.
          A container with two buttons, not a button containing one: nested
          buttons are invalid HTML and the inner one never fires (the month-cell
          lesson from issue #34). The account shows its LOCAL PART here — the
          full address was truncated to nothing on a phone; it is in the sheet. */}
      <div className="m-mailbar">
        <button type="button" className="m-mboxline" onClick={() => setSheet(true)}>
          <span className="m-mboxline-name">{mailbox ? mailFolderLabel(mailbox, folders[0]?.delimiter) : "…"}</span>
          {unseen > 0 && <span className="m-mboxline-badge">{unseen}</span>}
          <span className="m-mboxline-acct">{mailAccountLabel(account?.label)}</span>
          <ChevronDown size={16} />
        </button>
        <button
          type="button"
          className="m-iconbtn"
          aria-label={t("mail.search")}
          data-testid="mail-search-toggle"
          onClick={() => {
            if (searchOpen && searching) clearSearch();
            setSearchOpen((v) => !v);
          }}
        >
          <Search size={18} />
        </button>
      </div>

      {/* Behind the magnifier on purpose: an always-visible field sat directly
          under the shell's vault-search pill — two search boxes doing different
          things, stacked (device report B3). */}
      {searchOpen && (
        <div className="m-mailsearch">
          <Search size={16} />
          <input
            type="search"
            value={query}
            autoFocus
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
      )}

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
                onClick={() => {
                  if (!press.clicked()) return; // the long-press already acted
                  if (selection) {
                    setSelection(toggleSelected(selection, m.id));
                    return;
                  }
                  if (account && mailbox) onOpenMessage(account.id, mailbox, m.id, m.flagged);
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setSelection(new Set([m.id]));
                }}
                onPointerCancel={press.clear}
                onPointerDown={() => press.start(m.id)}
                onPointerLeave={press.clear}
                onPointerUp={press.clear}
              >
                {/* Unread is a dot AND weight: a phone in sunlight loses the
                    weight difference long before it loses the dot. */}
                <span aria-hidden className="m-mailrow-dot" />
                <span className="m-mailrow-lines">
                  <span className="m-mailrow-top">
                    <span className="m-mailrow-from">{m.from || t("mail.unknownSender")}</span>
                    <span className="m-mailrow-date">{formatDate(m.dateTs, i18n.language)}</span>
                  </span>
                  <span className="m-mailrow-subject">
                    {m.flagged && <Star size={13} className="m-mailrow-flag" />}
                    {m.subject || t("mail.noSubject")}
                  </span>
                  {m.preview && <span className="m-mailrow-preview">{m.preview}</span>}
                </span>
                {selection && <span className={`m-slotmark${selection.has(m.id) ? " is-on" : ""}`} />}
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

      {/* Selection mode owns the bottom of the screen; the compose FAB would
          sit on top of the bulk bar and offer an unrelated action. */}
      {account && !selection && (
        <button
          type="button"
          /* Above the tab bar, like every other root-level FAB: 26px sits
             INSIDE the bar (device report B2, 2026-07-26). */
          className="pv-fab m-fab-float m-fab-float--above-tabs"
          aria-label={t("mail.newMessage")}
          onClick={() => onCompose(account.id)}
        >
          <PenLine size={22} />
        </button>
      )}

      {selection && (
        <div className="m-selectbar">
          <span>{t("mobile.selectedCount", { n: selection.size })}</span>
          <span className="m-headactions">
            <button
              aria-label={bulkSeenTarget(rows, selection) ? t("mail.markRead") : t("mail.markUnread")}
              className="m-iconbtn"
              disabled={bulkBusy || selection.size === 0}
              onClick={bulkSeen}
            >
              <MailOpen size={20} />
            </button>
            <button
              aria-label={t("mail.moveTo")}
              className="m-iconbtn"
              disabled={bulkBusy || selection.size === 0}
              onClick={() => void bulkMove()}
            >
              <FolderInput size={20} />
            </button>
            <button
              aria-label={t("common.delete")}
              className="m-iconbtn"
              disabled={bulkBusy || selection.size === 0}
              onClick={() => void bulkDelete()}
            >
              <Trash2 size={20} />
            </button>
            <button aria-label={t("common.cancel")} className="m-iconbtn" onClick={() => setSelection(null)}>
              <X size={20} />
            </button>
          </span>
        </div>
      )}

      {sheet && (
        <div className="m-sheet-backdrop" onClick={() => setSheet(false)}>
          <div className="m-sheet m-sheet--folders" onClick={(e) => e.stopPropagation()}>
            {/* The shared grip, not the bare bar: every other sheet in the app
                follows the finger and closes on a downward swipe, and this one
                was the last that only looked like it did. */}
            <SheetGrip onClose={() => setSheet(false)} />
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

/**
 * The account label for the mailbox bar, shortened without losing the part that
 * tells two accounts apart.
 *
 * This used to cut at the "@" — which made marco.kammradt@outlook.com and
 * marco.kammradt@gmail.com display identically, exactly the accounts a person is
 * most likely to hold at once. The domain is what distinguishes them, so the
 * domain is what we keep: the local part is elided instead, and only when the
 * whole address does not fit.
 */
export function mailAccountLabel(label: string | undefined, max = 24): string {
  if (!label) return "";
  const bare = (/<([^>]+)>/.exec(label)?.[1] ?? label).trim();
  if (bare.length <= max) return bare;
  const at = bare.lastIndexOf("@");
  if (at <= 0) return `${bare.slice(0, max - 1)}…`;
  const domain = bare.slice(at); // "@outlook.com"
  // Keep the domain whole; spend whatever is left on the local part. If even the
  // domain does not fit, showing it alone still beats showing the wrong half.
  const room = max - domain.length - 1;
  return room < 1 ? `…${domain}` : `${bare.slice(0, room)}…${domain}`;
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
