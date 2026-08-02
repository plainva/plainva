import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronDown, FolderInput, Mail, MailOpen, MessagesSquare, PenLine, Search, Settings, Star, Trash2, X } from "lucide-react";
import { Banner, Button, EmptyState, Fab, ICON, IconButton, SearchField, toast, useStableHandler } from "@plainva/ui";
import { mailListView } from "./mail/mailListView";
import type { MailAccountConfig, MailEnvelope, MailboxInfo } from "@plainva/ui/mail";
import {
  cacheEnvelopes,
  cachedEnvelopes,
  cacheMessage,
  cachedMessage,
  deleteMessagePermanently,
  fetchMessage,
  guessTrashMailbox,
  listEnvelopes,
  pickInboxFolder,
  mergeInboxes,
  parseUnifiedId,
  unifiedId,
  listMailboxesFor,
  mailFolderLabel,
  moveMessage,
  pickSentFolder,
  searchEnvelopes,
  setMessageSeen,
  sortMailFolders,
  threadRows,
} from "@plainva/ui/mail";
import { listMobileMailAccounts, mailVaultId, MAIL_CHANGED_EVENT } from "../services/mail/mailRuntime";
import { isImapUnavailable } from "../services/mail/mobileMailPlatform";
import { rememberedMailPlace, rememberMailPlace, resolveMailAccount, resolveMailbox } from "../services/mail/mailPlace";
import { getMobileSettings, updateMobileSettings } from "../services/mobileSettings";
import { bulkTargets, runBulk, toggleSelected } from "./mail/mailBulk";
import { mConfirm, mSelect } from "../services/mobileDialogs";
import { useLongPress } from "../lib/useLongPress";
import { SheetGrip } from "../components/SheetGrip";
import { usePullToRefresh } from "../lib/usePullToRefresh";
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
/**
 * Warms the newest message's body into the local cache (findings round P7.3).
 * Only ever ONE message, only when it is not cached yet, and only over the
 * connection the list load just used — the point is a free ride on a pooled
 * session, not a second login for content nobody asked for.
 */
async function preloadNewestBody(
  vaultId: string,
  db: MobileVault["db"] | undefined,
  account: MailAccountConfig,
  mailbox: string,
  messages: MailEnvelope[],
): Promise<void> {
  const newest = messages[0];
  if (!newest) return;
  try {
    if (await cachedMessage(db, account.id, mailbox, newest.id)) return;
    const msg = await fetchMessage(vaultId, account, mailbox, newest.id);
    await cacheMessage(db, account.id, mailbox, msg);
  } catch {
    // Preloading is a courtesy — never an error the user has to see.
  }
}

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
  /**
   * "All inboxes" (P9.3b): every account's inbox in one list. Its own state, so
   * switching the active account while opening a message does not disturb it.
   * Not remembered across launches — it is a way of looking, not a place.
   */
  const [unified, setUnified] = useState(false);
  const [unifiedRows, setUnifiedRows] = useState<MailEnvelope[]>([]);
  const [unifiedErrors, setUnifiedErrors] = useState<Array<{ label: string; message: string }>>([]);
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
  // A refresh running while a cached page is already on screen: the banner then
  // says "updating" instead of "offline" (F4a).
  const [refreshing, setRefreshing] = useState(false);
  /** null = not in selection mode (G3a); a set = mode on, possibly empty. */
  /**
   * Conversations (findings P9.3) — the same mode, the same shared row model and
   * the same default as the desktop: OFF is today's flat list, and the choice
   * lives in the vault-scoped settings (`mailThreads`), so a mailbox does not
   * look like two different things on two devices.
   */
  const [threadMode, setThreadMode] = useState(() => getMobileSettings().mailThreads === true);
  const [openThreads, setOpenThreads] = useState<Set<string>>(() => new Set());
  /** Sent read along while grouping: without it a thread shows only the other
   *  side of the exchange, as if you had never answered. */
  const [sentRows, setSentRows] = useState<MailEnvelope[]>([]);
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

  /**
   * Every account's inbox, merged. Tolerant per account: one mailbox whose
   * sign-in is gone must not empty the list of the others (report 2026-07-30) —
   * it is named instead. The row id becomes the message's ADDRESS, because a
   * uid is folder- AND account-local.
   */
  const loadUnified = useCallback(async () => {
    if (!vault || accounts.length === 0) return;
    setLoading(true);
    const pages: MailEnvelope[][] = [];
    const failures: Array<{ label: string; message: string }> = [];
    for (const acct of accounts) {
      try {
        const box = pickInboxFolder(await listMailboxesFor(vault, acct));
        if (!box) {
          failures.push({ label: mailAccountLabel(acct.label), message: t("mail.noInbox") });
          continue;
        }
        const page = await listEnvelopes(vault, acct, box, 0, PAGE);
        pages.push(page.messages.map((e) => ({ ...e, id: unifiedId({ accountId: acct.id, mailbox: box, uid: e.id }) })));
      } catch (e) {
        failures.push({ label: mailAccountLabel(acct.label), message: describeError(e) });
      }
    }
    setUnifiedRows(mergeInboxes(pages, PAGE));
    setUnifiedErrors(failures);
    setLoading(false);
  }, [vault, accounts, t, describeError]);

  useEffect(() => {
    if (unified) void loadUnified();
  }, [unified, loadUnified]);

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
    // Cache FIRST, network second (report 2026-07-29 F4a) — the phone had the
    // same weakness as the desktop: the cache was read only in the `catch`, so
    // opening a folder you had opened before still waited for the full
    // roundtrip. The banner keeps saying it is not confirmed.
    const warm = await cachedEnvelopes(vaultRef?.db, account.id, mailbox, PAGE);
    if (warm.length > 0) {
      setRows(warm);
      setTotal(warm.length);
      setStale(true);
      setRefreshing(true);
      setLoading(false);
    }
    try {
      const page = await listEnvelopes(vault, account, mailbox, 0, PAGE);
      setStale(false);
      setRows(page.messages);
      setUnseen(page.unseen);
      setTotal(page.total);
      void cacheEnvelopes(vaultRef?.db, account.id, mailbox, page.messages);
      // P7.3 preload: the newest message is the one that gets opened next in
      // almost every case, so warm its body into the cache while the connection
      // is still pooled. It rides the SAME IMAP session (no second login), and
      // the message screen then shows it without a roundtrip. Best-effort and
      // silent: a failure here must never colour the list.
      void preloadNewestBody(vault, vaultRef?.db, account, mailbox, page.messages);
    } catch (e) {
      // Offline or throttled: show what was last seen rather than an empty
      // screen. The banner still says the refresh failed — the cache is a
      // fallback, never a claim that this is current.
      const cached = await cachedEnvelopes(vaultRef?.db, account.id, mailbox, PAGE);
      setRows(cached);
      setTotal(cached.length);
      setError(cached.length > 0 ? null : describeError(e));
      setStale(cached.length > 0);
    } finally {
      setLoading(false);
      setRefreshing(false);
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
  /** The account's Sent folder — only consulted while grouping is on. */
  const sentBox = useMemo(() => pickSentFolder(folders), [folders]);

  const press = useLongPress<string>((id) => setSelection(new Set([id])));

  /**
   * The selection id of a row. In the conversation view a thread mixes folders,
   * so the id carries the message's origin (P9.3b) — otherwise a selected reply
   * from Sent would be marked in the open folder. The flat list keeps bare ids:
   * there the screen's own folder IS the origin.
   */
  const selId = useCallback(
    (m: { id: string; mailbox?: string }, box: string | null) =>
      threadMode && account ? unifiedId({ accountId: account.id, mailbox: box || "", uid: m.id }) : m.id,
    [threadMode, account],
  );
  /** Every message the list can act on, by selection id. */
  const selectable = useMemo(() => {
    const out = new Map<string, MailEnvelope>();
    for (const m of rows) out.set(selId(m, mailbox), m);
    if (threadMode) for (const m of sentRows) out.set(selId(m, sentBox), m);
    return out;
  }, [rows, sentRows, threadMode, mailbox, sentBox, selId]);
  const chosen = useMemo(
    () => (selection ? [...selection].map((id) => selectable.get(id)).filter((m): m is MailEnvelope => !!m) : []),
    [selection, selectable],
  );
  /** Whole conversation on or off in one go — what picking a thread means. */
  const toggleMany = useCallback((ids: string[]) => {
    setSelection((prev) => {
      const next = new Set(prev ?? []);
      const allOn = ids.every((id) => next.has(id));
      for (const id of ids) { if (allOn) next.delete(id); else next.add(id); }
      return next;
    });
  }, []);

  /**
   * Reads Sent alongside the open folder while conversations are on. Silent and
   * best-effort by design: this is context, not the list that was asked for, so
   * an account without a Sent folder just shows what the open folder holds
   * instead of putting an error where the mail should be.
   */
  useEffect(() => {
    let alive = true;
    if (!threadMode || !vault || !account || !sentBox || sentBox === mailbox) {
      setSentRows([]);
      return;
    }
    void listEnvelopes(vault, account, sentBox, 0, PAGE)
      .then((page) => {
        if (alive) setSentRows(page.messages);
      })
      .catch(() => {
        if (alive) setSentRows([]);
      });
    return () => {
      alive = false;
    };
  }, [threadMode, vault, account, sentBox, mailbox]);

  /**
   * Conversation rows, from the open folder plus Sent, every message carrying
   * the folder it came from (an IMAP uid is folder-local, so opening it needs
   * that). Search results stay flat: the question was about single messages, and
   * grouping the hits would hide the very mail that matched.
   */
  /**
   * What the list shows and what the surface may say about it. The empty state
   * used to ask `rows` while the merged list was on screen, so "all inboxes"
   * could claim the folder was empty with mail right there.
   */
  const view = mailListView({ unified, unifiedRows, rows, total, loading, searching, error });
  const listRows = view.listRows;

  const threads = useMemo(
    () =>
      threadMode && !searching
        ? unified
          ? // Merged list: every row carries its origin, and Sent is not read
            // along (five accounts would mean five extra pages for a browse
            // surface). Grouping stays per account either way.
            threadRows(
              unifiedRows.map((m) => {
                const origin = parseUnifiedId(m.id);
                return { ...m, mailbox: origin?.mailbox ?? "", account: origin?.accountId };
              }),
            )
          : threadRows(
              [
                ...rows.map((m) => ({ ...m, mailbox: mailbox ?? "", account: account?.id })),
                ...sentRows.map((m) => ({ ...m, mailbox: sentBox ?? "", account: account?.id })),
              ],
              // Anchored to the open folder: Sent completes threads, never adds rows.
              { anchorMailbox: mailbox ?? "" },
            )
        : [],
    [threadMode, searching, rows, sentRows, mailbox, sentBox, account, unified, unifiedRows]
  );
  const showThreads = threadMode && !searching && threads.length > 0;

  const toggleThreadMode = () => {
    const next = !threadMode;
    setThreadMode(next);
    setOpenThreads(new Set());
    void updateMobileSettings({ mailThreads: next });
  };


  /** Applies a bulk action to the chosen ids, one at a time, then refreshes. */
  /**
   * `action` is given the message's own folder, not the screen's: in the
   * conversation view a selection legitimately spans INBOX and Sent, and a uid
   * only means something inside its folder.
   */
  const runOnSelection = async (action: (box: string, uid: string) => Promise<void>, after: (done: string[]) => void) => {
    if (!selection || selection.size === 0 || chosen.length === 0) return;
    setBulkBusy(true);
    try {
      const ids = [...selection].filter((id) => selectable.has(id));
      const targets = bulkTargets(ids, mailbox || "");
      const outcome = await runBulk(ids, async (_id, i) => {
        await action(targets[i].box, targets[i].uid);
      });
      after(outcome.done.map((id) => parseUnifiedId(id)?.uid ?? id));
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
    const target = chosen.some((m) => !m.seen);
    void runOnSelection(
      (box, uid) => setMessageSeen(vault, account, box, uid, target),
      (done) => {
        const set = new Set(done);
        setRows((prev) => prev.map((m) => (set.has(m.id) ? { ...m, seen: target } : m)));
        setSentRows((prev) => prev.map((m) => (set.has(m.id) ? { ...m, seen: target } : m)));
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
      (box, uid) => moveMessage(vault, account, box, uid, target),
      (done) => {
        setRows((prev) => prev.filter((m) => !done.includes(m.id)));
        setSentRows((prev) => prev.filter((m) => !done.includes(m.id)));
      },
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
      (box, uid) => (inTrash ? deleteMessagePermanently(vault, account, box, uid) : moveMessage(vault, account, box, uid, trash!)),
      (done) => {
        setRows((prev) => prev.filter((m) => !done.includes(m.id)));
        setSentRows((prev) => prev.filter((m) => !done.includes(m.id)));
      },
    );
  };

  const ptrRef = useRef<HTMLDivElement>(null);
  const ptrIndicator = usePullToRefresh(ptrRef, load);

  // Only rendered when pushed; as a tab root the shell owns the top bar.
  const backHeader = (
    <header className="m-header">
      <IconButton label={t("common.back", { defaultValue: "Zurück" })} onClick={onBack}>
        <ChevronLeft size={ICON.head} />
      </IconButton>
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
          icon={<Mail size={ICON.head} />}
          action={
            <Button variant="primary" onClick={onOpenAccounts}>
              {t("mail.addAccount")}
            </Button>
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

      {stale && <Banner kind="warning" rounded>{t(refreshing ? "mail.cachedRefreshing" : "mail.offlineCopy")}</Banner>}
      {/* One unreachable account must not empty the list of the others — it says
          which one, and why (P9.3b). */}
      {unifiedErrors.map((f) => (
        <Banner key={f.label} kind="warning" rounded className="m-unified-error">
          {f.label}: {f.message}
        </Banner>
      ))}

      {/* Which mailbox am I looking at, how much is unread, and search.
          A container with two buttons, not a button containing one: nested
          buttons are invalid HTML and the inner one never fires (the month-cell
          lesson from issue #34). The account shows its LOCAL PART here — the
          full address was truncated to nothing on a phone; it is in the sheet. */}
      <div className="m-mailbar">
        <button type="button" className="m-mboxline" onClick={() => setSheet(true)}>
          <span className="m-mboxline-name">
            {unified ? t("mail.allInboxes") : mailbox ? mailFolderLabel(mailbox, folders[0]?.delimiter) : "…"}
          </span>
          {unseen > 0 && <span className="m-mboxline-badge">{unseen}</span>}
          <span className="m-mboxline-acct">{mailAccountLabel(account?.label)}</span>
          <ChevronDown size={ICON.ui} />
        </button>
        <IconButton
          label={t("mail.conversations")}
          active={threadMode}
          data-testid="mail-threads-toggle"
          onClick={toggleThreadMode}
        >
          <MessagesSquare size={ICON.head} />
        </IconButton>
        <IconButton
          label={t("mail.search")}
          data-testid="mail-search-toggle"
          onClick={() => {
            if (searchOpen && searching) clearSearch();
            setSearchOpen((v) => !v);
          }}
        >
          <Search size={ICON.head} />
        </IconButton>
      </div>

      {/* Behind the magnifier on purpose: an always-visible field sat directly
          under the shell's vault-search pill — two search boxes doing different
          things, stacked (device report B3). */}
      {searchOpen && (
        <SearchField
          autoFocus
          clearLabel={t("sidebar.clearSearch")}
          onKeyDown={(e) => e.key === "Enter" && void runSearch()}
          /* Escape on an EMPTY field leaves the search — the field's own first
             Escape clears, which is the app-wide contract. Leaving the mail
             search open with nothing in it is a dead end. */
          onEscapeWhenEmpty={clearSearch}
          onValueChange={setQuery}
          placeholder={t("mail.search")}
          value={query}
        />
      )}

      {error ? (
        <EmptyState icon={<Mail size={ICON.head} />}>{error}</EmptyState>
      ) : view.isEmpty ? (
        <EmptyState icon={<Mail size={ICON.head} />}>{t("mail.folderEmpty")}</EmptyState>
      ) : (
        <ul className="m-maillist">
          {showThreads
            ? threads.map((row) => {
                const open = openThreads.has(row.thread.key);
                const latest = row.latest;
                // A one-message conversation IS a message: the same row, and no
                // affordance promising something to unfold.
                if (row.count === 1) {
                  const sid = selId(latest, latest.mailbox ?? mailbox);
                  return (
                    <li key={row.thread.key}>
                      <button
                        type="button"
                        className={latest.seen ? "m-mailrow" : "m-mailrow is-unread"}
                        aria-selected={!!selection?.has(sid)}
                        onClick={() => {
                          if (!press.clicked()) return; // the long-press already acted
                          if (selection) { toggleMany([sid]); return; }
                          if (account && latest.mailbox) onOpenMessage(account.id, latest.mailbox, latest.id, latest.flagged);
                        }}
                        onPointerCancel={press.clear}
                        onPointerDown={() => press.start(sid)}
                        onPointerLeave={press.clear}
                        onPointerUp={press.clear}
                      >
                        <span aria-hidden className="m-mailrow-dot" />
                        <span className="m-mailrow-lines">
                          <span className="m-mailrow-top">
                            <span className="m-mailrow-from">{latest.from || t("mail.unknownSender")}</span>
                            <span className="m-mailrow-date">{formatDate(latest.dateTs, i18n.language)}</span>
                          </span>
                          <span className="m-mailrow-subject">
                            {row.flagged && <Star size={ICON.meta} className="m-mailrow-flag" />}
                            {latest.subject || t("mail.noSubject")}
                          </span>
                          {latest.preview && <span className="m-mailrow-preview">{latest.preview}</span>}
                        </span>
                        {selection && <span className={`m-slotmark${selection.has(sid) ? " is-on" : ""}`} />}
                      </button>
                    </li>
                  );
                }
                const threadIds = row.thread.messages.map((m) => selId(m, m.mailbox ?? mailbox));
                const threadPicked = threadIds.length > 0 && threadIds.every((id) => !!selection?.has(id));
                return (
                  <li key={row.thread.key} data-testid="mail-thread">
                    <button
                      type="button"
                      className={row.unseen ? "m-mailrow is-unread" : "m-mailrow"}
                      aria-expanded={open}
                      aria-selected={threadPicked}
                      data-testid="mail-thread-row"
                      onClick={() => {
                        if (!press.clicked()) return; // the long-press already acted
                        // While picking, a tap picks the WHOLE conversation —
                        // that is what choosing a thread means; otherwise it
                        // unfolds, as before.
                        if (selection) { toggleMany(threadIds); return; }
                        setOpenThreads((prev) => {
                          const next = new Set(prev);
                          if (next.has(row.thread.key)) next.delete(row.thread.key);
                          else next.add(row.thread.key);
                          return next;
                        });
                      }}
                      onPointerCancel={press.clear}
                      onPointerDown={() => press.start(threadIds[0])}
                      onPointerLeave={press.clear}
                      onPointerUp={press.clear}
                    >
                      <span aria-hidden className="m-mailrow-dot" />
                      <span className="m-mailrow-lines">
                        <span className="m-mailrow-top">
                          <span className="m-mailrow-from">{row.participants.join(", ")}</span>
                          <span className="m-mailrow-count" data-testid="mail-thread-count">{row.count}</span>
                          <span className="m-mailrow-date">{formatDate(row.thread.latestTs, i18n.language)}</span>
                        </span>
                        <span className="m-mailrow-subject">
                          {row.flagged && <Star size={ICON.meta} className="m-mailrow-flag" />}
                          {row.thread.subject || t("mail.noSubject")}
                        </span>
                      </span>
                    </button>
                    {open &&
                      row.thread.messages.map((m) => {
                        const mid = selId(m, m.mailbox ?? mailbox);
                        return (
                        <button
                          key={`${m.mailbox}|${m.id}`}
                          type="button"
                          className={`m-mailrow m-mailrow--in-thread${m.seen ? "" : " is-unread"}`}
                          aria-selected={!!selection?.has(mid)}
                          data-testid="mail-thread-message"
                          onClick={() => {
                            if (!press.clicked()) return; // the long-press already acted
                            if (selection) { toggleMany([mid]); return; }
                            if (account && m.mailbox) onOpenMessage(account.id, m.mailbox, m.id, m.flagged);
                          }}
                          onPointerCancel={press.clear}
                          onPointerDown={() => press.start(mid)}
                          onPointerLeave={press.clear}
                          onPointerUp={press.clear}
                        >
                          <span aria-hidden className="m-mailrow-dot" />
                          <span className="m-mailrow-lines">
                            <span className="m-mailrow-top">
                              <span className="m-mailrow-from">{m.from || t("mail.unknownSender")}</span>
                              {m.mailbox && m.mailbox !== mailbox && (
                                <span className="m-mailrow-box" data-testid="mail-thread-folder">
                                  {mailFolderLabel(m.mailbox, folders[0]?.delimiter)}
                                </span>
                              )}
                              <span className="m-mailrow-date">{formatDate(m.dateTs, i18n.language)}</span>
                            </span>
                            {m.preview && <span className="m-mailrow-preview">{m.preview}</span>}
                          </span>
                          {selection && <span className={`m-slotmark${selection.has(mid) ? " is-on" : ""}`} />}
                        </button>
                        );
                      })}
                  </li>
                );
              })
            : listRows.map((m) => (
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
                  // In the merged list the id IS the address (P9.3b).
                  const origin = parseUnifiedId(m.id);
                  if (origin) onOpenMessage(origin.accountId, origin.mailbox, origin.uid, m.flagged);
                  else if (account && mailbox) onOpenMessage(account.id, mailbox, m.id, m.flagged);
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  // Selection drives move and delete, and both need a target
                  // folder that a selection across accounts does not have.
                  if (!unified) setSelection(new Set([m.id]));
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
                    {m.flagged && <Star size={ICON.meta} className="m-mailrow-flag" />}
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

      {view.showsLoadMore && (
        <Button variant="ghost" disabled={loading} onClick={() => void loadMore()}>
          {t("mail.loadMore")}
        </Button>
      )}

      {/* Selection mode owns the bottom of the screen; the compose FAB would
          sit on top of the bulk bar and offer an unrelated action. */}
      {account && !selection && (
        <Fab
          /* Above the tab bar, like every other root-level FAB: 26px sits
             INSIDE the bar (device report B2, 2026-07-26). */
          className="m-fab-float m-fab-float--above-tabs"
          aria-label={t("mail.newMessage")}
          icon={<PenLine size={ICON.touch} />}
          onClick={() => onCompose(account.id)}
        />
      )}

      {selection && (
        <div className="m-selectbar">
          <span>{t("mobile.selectedCount", { n: selection.size })}</span>
          <span className="m-headactions">
            <IconButton
              label={chosen.some((m) => !m.seen) ? t("mail.markRead") : t("mail.markUnread")}
              disabled={bulkBusy || selection.size === 0}
              onClick={bulkSeen}
            >
              <MailOpen size={ICON.head} />
            </IconButton>
            <IconButton
              label={t("mail.moveTo")}
              disabled={bulkBusy || selection.size === 0}
              onClick={() => void bulkMove()}
            >
              <FolderInput size={ICON.head} />
            </IconButton>
            <IconButton
              label={t("common.delete")}
              disabled={bulkBusy || selection.size === 0}
              onClick={() => void bulkDelete()}
            >
              <Trash2 size={ICON.head} />
            </IconButton>
            <IconButton label={t("common.cancel")} onClick={() => setSelection(null)}>
              <X size={ICON.head} />
            </IconButton>
          </span>
        </div>
      )}

      {sheet && (
        <div className="m-sheet-backdrop" onClick={() => setSheet(false)}>
          <div className="pv-sheet m-sheet m-sheet--folders" onClick={(e) => e.stopPropagation()}>
            {/* The shared grip, not the bare bar: every other sheet in the app
                follows the finger and closes on a downward swipe, and this one
                was the last that only looked like it did. */}
            <SheetGrip onClose={() => setSheet(false)} />
            {accounts.length > 1 && (
              <ul>
                <li>
                  <button
                    type="button"
                    className={unified ? "m-row is-active" : "m-row"}
                    data-testid="mail-all-inboxes"
                    onClick={() => {
                      setUnified(true);
                      setSelection(null);
                      setSheet(false);
                    }}
                  >
                    {t("mail.allInboxes")}
                  </button>
                </li>
              </ul>
            )}
            <h2>{t("mail.folders")}</h2>
            <ul>
              {folderNames.map((name) => (
                <li key={name}>
                  <button
                    type="button"
                    className={name === mailbox ? "m-row is-active" : "m-row"}
                    onClick={() => {
                      setUnified(false);
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
                          setUnified(false);
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
              <Settings size={ICON.ui} />
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
