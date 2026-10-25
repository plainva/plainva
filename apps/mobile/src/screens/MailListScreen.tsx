import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Ban, CheckSquare, ChevronDown, Folder, FolderInput, Mail, MailOpen, MessagesSquare, Paperclip, PenLine, Search, Settings, Star, Trash2, X } from "lucide-react";
import { firstAngleValue } from "@plainva/core";
import { Banner, Button, EmptyState, Fab, ICON, IconButton, mailRowActions, plainvaProducer, SearchField, toast, useStableHandler, useWeekStartDay } from "@plainva/ui";
import { addSnooze, filterSnoozed, parseSnoozeState, pruneSnoozes, SNOOZE_PRESETS, snoozeUntil, type SnoozeEntry, type SnoozePreset, mailErrorText } from "@plainva/ui/mail";
import { applyMailBulk, MailBulkReport, type MailBulkReportItem, type MailBulkAction } from "@plainva/ui/mail";
import { mailListView } from "./mail/mailListView";
import { useFloatingSelectionSpace } from "../hooks/useFloatingSelectionSpace";
import { mailStatus } from "./mail/mailStatus";
import { forgetMailSearch, keepMailSearch, keptMailSearch } from "../services/mail/mailSearchSession";
import { undoMoveToTrash } from "./mail/undoMove";
import { SwipeRow } from "../components/SwipeRow";
import { RowActionSheet, type RowAction } from "../components/RowActionSheet";
import { runJunkAction } from "./mail/junkAction";
import { SwipeHint } from "../components/SwipeHint";
import type { MailAccountConfig, MailEnvelope, MailboxInfo } from "@plainva/ui/mail";
import {
  cacheEnvelopes,
  forgetCachedMessages,
  cachedEnvelopes,
  cacheMessage,
  cachedMessage,
  deleteMessagePermanently,
  captureMailAsNote,
  fetchMessage,
  guessTrashMailbox,
  listEnvelopes,
  pickInboxFolder,
  mergeInboxes,
  isJunkFolder,
  listMailRules,
  parseUnifiedId,
  pickJunkFolder,
  rowAddress,
  runRules,
  unifiedId,
  listMailboxesFor,
  mailAccountKind,
  mailFolderLabel,
  moveMessage,
  pickSentFolder,
  searchEnvelopes,
  setMessageFlagged,
  setMessageSeen,
  listFlaggedEnvelopes,
  sortMailFolders,
  threadRows,
} from "@plainva/ui/mail";
import { listMobileMailAccounts, mailVaultId, MAIL_CHANGED_EVENT } from "../services/mail/mailRuntime";
import { DeviceSignInCard } from "../components/DeviceSignInRow";
import { accountRowState, deviceSignInState, type DeviceSignInState } from "../services/deviceSignIn";
import { isImapUnavailable } from "../services/mail/mobileMailPlatform";
import { rememberedMailPlace, rememberMailPlace, resolveMailAccount, resolveMailbox } from "../services/mail/mailPlace";
import { getMobileSettings, updateMobileSettings } from "../services/mobileSettings";
import { getMobileVault } from "../services/vaultService";
import { bulkTargets, toggleSelected } from "./mail/mailBulk";
import { mActions, mConfirm, mTargets } from "../services/mobileDialogs";
import { useLongPress } from "../lib/useLongPress";
import { SheetGrip } from "../components/SheetGrip";
import { usePullToRefresh } from "../lib/usePullToRefresh";
import type { MobileVault } from "../services/vaultService";
import { AppBar } from "../components/AppBar";
import { ChoiceMark } from "../components/ChoiceMark";

const PAGE = 30;

/** A place in the mail, as one value: the account and the folder that are shown. */
const placeOf = (accountId: string | null, mailbox: string | null): string => JSON.stringify([accountId ?? "", mailbox ?? ""]);

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
  onMenu,
  onOpenMessage,
  onOpenAccounts,
  onCompose,
}: {
  vault: MobileVault;
  bump: number;
  onBack?: () => void;
  /** App settings in the leading slot of a root surface (N1.5). */
  onMenu?: () => void;
  onOpenMessage: (accountId: string, mailbox: string, id: string, flagged: boolean, seen: boolean) => void;
  onOpenAccounts: () => void;
  onCompose: (accountId: string) => void;
}) {
  const { t, i18n } = useTranslation();
  // "Next week" begins where the week-start setting says (snoozeUntil).
  const weekStart = useWeekStartDay();
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
  /**
   * The two filters (S29). They are deliberately NOT the same kind of thing:
   * unread narrows what is already loaded, flagged asks the server — a starred
   * message three hundred rows down would never show up in a client-side pass
   * over the page on screen.
   */
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [flaggedRows, setFlaggedRows] = useState<MailEnvelope[] | null>(null);
  const [flaggedBusy, setFlaggedBusy] = useState(false);
  const [unified, setUnified] = useState(false);
  const [unifiedRows, setUnifiedRows] = useState<MailEnvelope[]>([]);
  const [unifiedErrors, setUnifiedErrors] = useState<Array<{ label: string; message: string }>>([]);
  const [rows, setRows] = useState<MailEnvelope[]>([]);
  /** Messages put aside (S22), from the per-vault settings so both devices agree. */
  const [snoozed, setSnoozed] = useState<SnoozeEntry[]>(() => pruneSnoozes(parseSnoozeState(getMobileSettings().mailSnoozed), Date.now()));
  /**
   * The clock the snooze filter reads.
   *
   * A minute tick rather than `Date.now()` inside the memo: a due message has to
   * come BACK on its own, and reading the wall clock during render is impure —
   * the same value would be memoised forever.
   */
  const [snoozeNow, setSnoozeNow] = useState(() => Date.now());
  useEffect(() => {
    const h = setInterval(() => setSnoozeNow(Date.now()), 60_000);
    return () => clearInterval(h);
  }, []);
  const persistSnoozed = async (next: SnoozeEntry[]) => {
    await updateMobileSettings({ mailSnoozed: next });
  };
  const [unseen, setUnseen] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  /** The merged list's own wait — it is not the folder's (`loading`). */
  const [unifiedLoading, setUnifiedLoading] = useState(false);
  /**
   * Which place's list has been answered — with its messages, a cached copy
   * or an error. Until the list of the place that is shown has come, the list
   * says nothing about it: a folder still being read, or an account whose
   * folders are still on their way, is not an empty folder.
   */
  const [listedFor, setListedFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState(false);
  /**
   * The search (TestFlight 02.10.2026, "the search field does not seem to
   * work"). Its hits have their OWN list: they used to be written into `rows`,
   * the folder's list, and the next background reload of the folder — every
   * sync run and every index update bumps this screen — put the folder back
   * while the screen still believed it was showing a search. A search that is
   * showing is also kept across the rebuild after a message was opened
   * (`mailSearchSession.ts`): the first hit used to cost the whole search.
   */
  const [kept] = useState(() => {
    const place = rememberedMailPlace();
    return keptMailSearch(place.accountId, place.mailbox);
  });
  const [query, setQuery] = useState(() => kept?.query ?? "");
  const [searchOpen, setSearchOpen] = useState(() => kept !== null);
  /** A search brought back with its hits is not waiting for input: the
   *  keyboard would cover the list one came back to read. */
  const [focusSearch, setFocusSearch] = useState(() => kept === null);
  const [searchRows, setSearchRows] = useState<MailEnvelope[] | null>(() => kept?.rows ?? null);
  const [searchBusy, setSearchBusy] = useState(false);
  const searchSeq = useRef(0);
  /** The flagged list, like the search: only the newest question may answer. */
  const flaggedSeq = useRef(0);
  /**
   * And the folder's own list. A folder left while its list was on its way
   * got that list under the name of the next one — with numbers that name
   * other messages there, which a tap or a swipe then acted on.
   */
  const listSeq = useRef(0);
  const searching = searchRows !== null;
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
  const selectionBarRef = useFloatingSelectionSpace(!!selection);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkReport, setBulkReport] = useState<MailBulkReportItem[]>([]);
  const [attachmentsOnly, setAttachmentsOnly] = useState(false);
  const bulkAbort = useRef<AbortController | null>(null);
  const [bulkRunning, setBulkRunning] = useState(false);

  const account = useMemo(() => accounts.find((a) => a.id === accountId) ?? null, [accounts, accountId]);
  const vault = mailVaultId();
  const bulkContext = useRef("");
  useLayoutEffect(() => {
    bulkContext.current = JSON.stringify([vault, accountId, mailbox]);
    return () => { bulkAbort.current?.abort(); };
  }, [vault, accountId, mailbox]);
  const vaultRef = vaultObj;

  /**
   * Is the failure a missing SIGN-IN rather than a broken server? The card this
   * feeds was written for exactly this case ("an empty calendar, an empty
   * mailbox") and the calendar has rendered it since P7 — mail kept showing the
   * raw message instead, so the one surface that could offer the fix did not.
   *
   * `accountRowState` is the shared rule, not a second reading of it: no slot
   * means "sign in", a slot the provider rejects means "expired", and anything
   * else keeps the provider's own message — an unreachable server must not be
   * relabelled as a sign-in problem.
   */
  const [signInState, setSignInState] = useState<DeviceSignInState>("active");
  useEffect(() => {
    if (!error || !account || !vault) {
      setSignInState("active");
      return;
    }
    let alive = true;
    void (async () => {
      const slot = await deviceSignInState("mail", vault, account.id);
      if (alive) setSignInState(accountRowState(slot, error));
    })();
    return () => {
      alive = false;
    };
  }, [error, account, vault]);

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
    setUnifiedLoading(true);
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
    setUnifiedLoading(false);
  }, [vault, accounts, t, describeError]);

  useEffect(() => {
    if (unified) void loadUnified();
  }, [unified, loadUnified]);

  /**
   * Local rules over the page that was just fetched (S14).
   *
   * On a phone "local" is narrower than on a desktop: the app only runs while
   * it is in the foreground, so a rule here acts on mail the moment it is
   * looked at, not the moment it arrives. The rules card names that difference
   * rather than letting it be discovered.
   *
   * Each message is handled at most once per session, so pulling to refresh
   * does not re-file mail that was moved by hand in between.
   */
  const seenByRules = useRef(new Set<string>());
  // One handle on its newest version: the rules act with the folder list of
  // the moment, and that list arriving is no reason to read the folder again.
  // It was: the loader hung on this function, so every folder opened first was
  // read twice — and since a list answers only for the newest question, its
  // first answer was thrown away and the second waited for.
  const applyLocalRules = useStableHandler(async (messages: readonly MailEnvelope[], box: string, acct: MailAccountConfig) => {
    if (!vault) return;
    const rules = await listMailRules(vault).catch(() => []);
    if (rules.length === 0) return;
    const fresh = messages.filter((m) => !seenByRules.current.has(m.id));
    for (const m of fresh) seenByRules.current.add(m.id);
    if (fresh.length === 0) return;

    const trash = guessTrashMailbox(folders.map((f) => f.name), folders[0]?.delimiter);
    const junkBox = pickJunkFolder(folders);
    const result = await runRules(rules, fresh.map((m) => ({ id: m.id, from: m.from, subject: m.subject })), {
      moveTo: (id, target) => moveMessage(vault, acct, box, id, target),
      markRead: (id) => setMessageSeen(vault, acct, box, id, true),
      flag: (id) => setMessageFlagged(vault, acct, box, id, true),
      junk: (id) => (junkBox ? moveMessage(vault, acct, box, id, junkBox) : Promise.reject(new Error("no junk folder"))),
      trash: (id) => (trash ? moveMessage(vault, acct, box, id, trash) : Promise.reject(new Error("no trash folder"))),
      // Filing needs the BODY, which an envelope does not carry — so the
      // message is fetched, and only for the ones a rule actually matched.
      capture: async (id) => {
        const message = await fetchMessage(vault, acct, box, id);
        const v = await getMobileVault();
        const filed = await captureMailAsNote({
          adapter: v.files,
          message,
          accountId: acct.id,
          mailbox: box,
          folder: getMobileSettings().mailFolder || "Mail",
          generatedBy: await plainvaProducer("mail-capture"),
        });
        // The index hears of the note now, not at the next full scan (finding 2026-10-12).
        void v.reindexPaths([filed.path]);
      },
    });
    if (result.removed.length > 0) setRows((prev) => prev.filter((m) => !result.removed.includes(m.id)));
    if (result.acted.length > 0) toast.info(t("rules.appliedN", { n: result.acted.length }));
  });

  const load = useCallback(async () => {
    // Reading the key here rather than only listing it as a dependency: the
    // closure otherwise reaches the account list solely through the
    // identity-stable `accountById`, which is invisible to both the linter and
    // to React. No accounts yet means there is nothing to ask for anyway.
    if (!accountsKey) return;
    const account = accountById(accountId);
    if (!vault || !account || !mailbox) return;
    const seq = ++listSeq.current;
    const current = () => seq === listSeq.current;
    const place = placeOf(accountId, mailbox);
    setLoading(true);
    setError(null);
    // Cache FIRST, network second (report 2026-07-29 F4a) — the phone had the
    // same weakness as the desktop: the cache was read only in the `catch`, so
    // opening a folder you had opened before still waited for the full
    // roundtrip. The banner keeps saying it is not confirmed.
    const warm = await cachedEnvelopes(vaultRef?.db, account.id, mailbox, PAGE);
    if (!current()) return;
    if (warm.length > 0) {
      setRows(warm);
      setTotal(warm.length);
      setStale(true);
      setRefreshing(true);
      setLoading(false);
    }
    try {
      const page = await listEnvelopes(vault, account, mailbox, 0, PAGE);
      if (!current()) return;
      setStale(false);
      setRows(page.messages);
      setListedFor(place);
      setUnseen(page.unseen);
      setTotal(page.total);
      void cacheEnvelopes(vaultRef?.db, account.id, mailbox, page.messages);
      // Local rules over what was just fetched (S14). On the phone that means
      // "while the app was in the foreground" — the settings card says so.
      void applyLocalRules(page.messages, mailbox, account);
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
      if (!current()) return;
      setRows(cached);
      setListedFor(place);
      setTotal(cached.length);
      setError(cached.length > 0 ? null : describeError(e));
      setStale(cached.length > 0);
    } finally {
      if (current()) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [vault, accountId, accountsKey, mailbox, accountById, describeError, vaultRef, applyLocalRules]);

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
    // The next page belongs to the list on screen: a folder chosen, or the
    // list read anew, before it comes turns it away.
    const seq = listSeq.current;
    setLoading(true);
    try {
      const page = await listEnvelopes(vault, account, mailbox, rows.length, PAGE);
      if (seq !== listSeq.current) return;
      // De-duplicate: a message arriving during paging would otherwise appear
      // twice (the server counts from the top, our offset does not move with it).
      const seen = new Set(rows.map((r) => r.id));
      setRows([...rows, ...page.messages.filter((m) => !seen.has(m.id))]);
      setTotal(page.total);
    } catch (e) {
      if (seq === listSeq.current) toast.error(describeError(e));
    } finally {
      if (seq === listSeq.current) setLoading(false);
    }
  };

  /** Server-side search (G3): the phone holds one page, so filtering locally
   *  would only ever find what is already on screen. */
  const runSearch = async (termOverride?: string) => {
    const account = accountById(accountId);
    const term = (termOverride ?? query).trim();
    if (!vault || !account || !mailbox || !term) return;
    // Only the newest question may answer: a slow first search must not
    // overwrite the hits of the one typed after it.
    const seq = ++searchSeq.current;
    setSearchBusy(true);
    try {
      const hits = await searchEnvelopes(vault, account, mailbox, term);
      if (seq !== searchSeq.current) return;
      setSearchRows(hits);
      keepMailSearch({ accountId: account.id, mailbox, query: term, rows: hits });
    } catch (e) {
      // The folder stays on screen: a failed search is said, not shown as an
      // empty mailbox.
      if (seq === searchSeq.current) toast.error(describeError(e));
    } finally {
      if (seq === searchSeq.current) setSearchBusy(false);
    }
  };

  /** Ends the search. The folder's own list was never touched, so there is
   *  nothing to load again. */
  const clearSearch = () => {
    searchSeq.current++;
    setQuery("");
    setSearchRows(null);
    setSearchBusy(false);
    forgetMailSearch();
  };

  /** Leaving the folder or the account ends the search: it asked ONE folder. */
  const leaveSearch = () => {
    clearSearch();
    setSearchOpen(false);
  };

  // A search brought back after a message was opened shows its kept hits at
  // once — and asks again, because the message just read may have been
  // moved, deleted or marked in between. Once per mount, when the account is
  // there to ask.
  const refreshedKept = useRef(false);
  const refreshKeptSearch = useStableHandler(() => {
    if (!kept || searchRows === null) return;
    // The remembered folder may be gone (the list fell back to the inbox):
    // hits of another folder must not stand under this one's name.
    if (account?.id !== kept.accountId || mailbox !== kept.mailbox) {
      leaveSearch();
      return;
    }
    void runSearch(kept.query);
  });
  useEffect(() => {
    if (refreshedKept.current || !kept || !account || !mailbox) return;
    refreshedKept.current = true;
    refreshKeptSearch();
  }, [kept, account, mailbox, refreshKeptSearch]);

  /** One change for every list a message can be in on this screen — the
   *  folder, the search hits, the flagged messages. Patching only the folder
   *  left a deleted message standing under a search. */
  const patchRows = (change: (rows: MailEnvelope[]) => MailEnvelope[]) => {
    setRows(change);
    setSearchRows((prev) => (prev ? change(prev) : prev));
    setFlaggedRows((prev) => (prev ? change(prev) : prev));
  };

  const folderNames = useMemo(
    () => sortMailFolders(folders.map((f) => f.name), folders[0]?.delimiter),
    [folders],
  );
  /**
   * Where a mail can move to, as target rows (E20): every folder, the inbox
   * with its own sign. One list for a single mail and for a selection; the
   * folder the mail lies in is passed as `here` and stays in it, unselectable.
   */
  const inboxBox = useMemo(() => pickInboxFolder(folders), [folders]);
  const moveTargets = useMemo(
    () =>
      folderNames.map((n) => ({
        value: n,
        label: mailFolderLabel(n, folders[0]?.delimiter),
        icon: n === inboxBox ? <Mail size={ICON.head} /> : <Folder size={ICON.head} />,
      })),
    [folderNames, folders, inboxBox],
  );

  // ---- Selection mode (G3a) ------------------------------------------------
  // Long-press opens it, tapping then selects further. The desktop does this
  // with Ctrl/Shift; a phone has one finger, so the mode is the modifier.
  /** The account's Sent folder — only consulted while grouping is on. */
  const sentBox = useMemo(() => pickSentFolder(folders), [folders]);

  /**
   * Holding a row opens its sheet (Design-Runde E1, 2026-09-04). It used to
   * SELECT — the one place on the phone where a hold meant something other
   * than "show me what this row can do". Now the sheet's first entry is
   * "select several", named, like everywhere else; selecting is the one action
   * that changes what the LIST does, so it comes first.
   */
  const [rowSheet, setRowSheet] = useState<string | null>(null);
  const press = useLongPress<string>((id) => setRowSheet(id));

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
    // The folder's page AND a server answer standing in for it: a search hit
    // or a starred message further down than the loaded page is not in `rows`,
    // and could be ticked but not acted on.
    for (const m of rows) out.set(selId(m, mailbox), m);
    for (const m of searchRows ?? []) out.set(selId(m, mailbox), m);
    for (const m of flaggedRows ?? []) out.set(selId(m, mailbox), m);
    if (threadMode) for (const m of sentRows) out.set(selId(m, sentBox), m);
    return out;
  }, [rows, searchRows, flaggedRows, sentRows, threadMode, mailbox, sentBox, selId]);
  const chosen = useMemo(
    () => (selection ? [...selection].map((id) => selectable.get(id)).filter((m): m is MailEnvelope => !!m) : []),
    [selection, selectable],
  );
  /**
   * Opens the message a row stands for, at ITS address — `rowAddress`, the
   * rule the desktop reads too. A row of "All inboxes" names its own account,
   * folder and uid, and so does a conversation row built from one: those were
   * opened in the account that is open, with the whole address handed on as
   * the uid, so nothing came (finding 2026-10-11).
   */
  const openRow = (m: MailEnvelope & { mailbox?: string }) => {
    const at = rowAddress(m, { accountId: account?.id ?? "", mailbox: mailbox ?? "" });
    if (at.accountId && at.mailbox) onOpenMessage(at.accountId, at.mailbox, at.uid, m.flagged, m.seen);
  };

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
  // In "all inboxes" the folder's error, its sign-in card and its offline
  // banner belong to the folder behind the merged list, not to it — as on the
  // desktop. A folder whose mailbox has lost its sign-in used to put that card
  // where the other mailboxes' mail was.
  const folderError = unified ? null : error;
  // And the other way round: which mailbox the merged list could not reach is
  // not a word about the folder shown after it.
  const status = mailStatus({ error: folderError, unifiedErrors: unified ? unifiedErrors : [], stale: !unified && stale, refreshing });

  const view = mailListView({
    unified,
    unifiedRows,
    rows,
    searchRows,
    flaggedRows,
    total,
    loading: (unified ? unifiedLoading : loading || listedFor !== placeOf(accountId, mailbox)) || searchBusy,
    error: folderError,
    unreadOnly,
    isUnread: (m: MailEnvelope) => !m.seen,
    attachmentsOnly,
    hasAttachment: (m: MailEnvelope) => m.hasAttachments === true,
  });
  // Search hits and the flagged messages stay flat — grouping them would hide
  // the very mail that matched — and in the merged view neither is on screen.
  const answerShown = view.replaced;
  // Snoozed messages leave the list until their time (S22). Only in the folder
  // they were put aside in — a snooze says "not in my way", not "gone".
  const listRows = useMemo(
    () =>
      filterSnoozed(view.listRows, {
        state: snoozed,
        now: snoozeNow,
        folder: mailbox ?? "",
        accountOf: () => account?.id ?? "",
        idOf: (m) => m.id,
      }),
    [view.listRows, snoozed, snoozeNow, mailbox, account]
  );

  const threads = useMemo(
    () =>
      threadMode && !answerShown
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
    [threadMode, answerShown, rows, sentRows, mailbox, sentBox, account, unified, unifiedRows]
  );
  const showThreads = !attachmentsOnly && threadMode && !answerShown && threads.length > 0;

  /**
   * Ends the flagged list — and turns away its answer if it is still on its
   * way. A folder, an account or "all inboxes" chosen in the meantime used to
   * get it: the starred mail of the mailbox that was left, under the name of
   * the one that is shown (the S21 symptom, by the late road).
   */
  const leaveFlagged = () => {
    flaggedSeq.current++;
    setFlaggedRows(null);
    setFlaggedBusy(false);
  };

  /**
   * Leaves the folder that is shown: its list still on its way is turned
   * away, and what it said — its rows, its error, the offline banner — goes
   * with it.
   */
  const leaveList = () => {
    listSeq.current++;
    setRows([]);
    setListedFor(null);
    setTotal(0);
    setUnseen(0);
    setLoading(false);
    setRefreshing(false);
    setStale(false);
    setError(null);
  };

  /**
   * Flagged is a QUERY, not a filter: it replaces the list with everything the
   * server has marked in this mailbox, which is the only way a star further
   * down than the loaded page can be found. Switching it off restores the
   * folder rather than re-fetching it.
   *
   * It stays out of "all inboxes" for the same reason the desktop keeps it out:
   * the query names one mailbox, and there is no honest cross-account answer.
   */
  const toggleFlagged = async () => {
    if (flaggedRows !== null) {
      leaveFlagged();
      return;
    }
    if (!vault || !account || !mailbox) return;
    const seq = ++flaggedSeq.current;
    setFlaggedBusy(true);
    try {
      const starred = await listFlaggedEnvelopes(vault, account, mailbox);
      if (seq === flaggedSeq.current) setFlaggedRows(starred);
    } catch (e) {
      if (seq === flaggedSeq.current) toast.error(describe(e, t));
    } finally {
      if (seq === flaggedSeq.current) setFlaggedBusy(false);
    }
  };

  /**
   * Says what it did, not just that it happened.
   *
   * The mode was reported as a switch that "cannot be activated at all".
   * Measured, it flips correctly and the button shows it — but in a mailbox
   * where every conversation is a single message the list looks EXACTLY the
   * same afterwards, because a one-message conversation is deliberately the
   * same row. Nothing was wrong; nothing was said either, and an action with no
   * visible consequence reads as an action that failed.
   *
   * So the toggle reports its result, and in the confusing case it reports the
   * REASON rather than a number: "every message is its own conversation". The
   * count is computed here rather than read from the memo, which still holds
   * the previous mode at this point.
   */
  const toggleThreadMode = () => {
    const next = !threadMode;
    setThreadMode(next);
    setOpenThreads(new Set());
    void updateMobileSettings({ mailThreads: next });
    if (!next) {
      toast.info(t("mail.threadsOff"));
      return;
    }
    const source = unified
      ? unifiedRows.map((m) => {
          const origin = parseUnifiedId(m.id);
          return { ...m, mailbox: origin?.mailbox ?? "", account: origin?.accountId };
        })
      : [
          ...rows.map((m) => ({ ...m, mailbox: mailbox ?? "", account: account?.id })),
          ...sentRows.map((m) => ({ ...m, mailbox: sentBox ?? "", account: account?.id })),
        ];
    const grouped = threadRows(source, unified ? {} : { anchorMailbox: mailbox ?? "" });
    // Counted over the threads that are actually SHOWN, not over the source:
    // the source carries Sent as well, and the anchor drops whatever has no
    // message in the open folder — comparing against it would report grouping
    // that never happened. An empty mailbox falls through to the count and says
    // "0", which is true, rather than claiming something about messages it does
    // not have.
    const messages = grouped.reduce((n, row) => n + row.count, 0);
    toast.info(
      grouped.length === messages && messages > 0
        ? t("mail.threadsOnSingles")
        : t("mail.threadsOnGrouped", { count: grouped.length }),
    );
  };


  /** Preserve account, mailbox and epoch for every selected UID. */
  const runOnSelection = async (action: MailBulkAction, after: (done: string[]) => void) => {
    const owner = accountById(accountId);
    if (!vault || !owner || !selection?.size || bulkBusy) return;
    const controller = new AbortController(); bulkAbort.current = controller;
    const context = bulkContext.current;
    setBulkBusy(true); setBulkRunning(true); setBulkReport([]);
    const report: MailBulkReportItem[] = [];
    try {
      const ids = [...selection].filter(id => selectable.has(id));
      const targets = bulkTargets(ids, mailbox || "");
      const groups = new Map<string, Array<{ id: string; uidValidity?: number; selectionId: string; label: string }>>();
      ids.forEach((id, index) => {
        const target = targets[index], row = selectable.get(id)!;
        const group = groups.get(target.box) ?? [];
        group.push({ id: target.uid, uidValidity: row.uidValidity, selectionId: id, label: (row.subject || t("mail.noSubject")) + " · " + target.box });
        groups.set(target.box, group);
      });
      for (const [box, rows] of groups) {
        const result = await applyMailBulk(vault, owner, box, rows, action, controller.signal);
        if (context !== bulkContext.current) return;
        if (action.kind === "move" || action.kind === "delete") await forgetCachedMessages(vaultRef.db, owner.id, box, result.filter(r => r.status === "done").map(r => r.id)).catch(() => toast.error(t("mail.cacheUpdateFailed")));
        for (const item of result) {
          const row = rows.find(r => r.id === item.id)!;
          report.push({ ...item, id: row.selectionId, label: row.label });
        }
        setBulkReport([...report]);
        if (result.some(r => r.status === "uncertain")) controller.abort();
      }
      after(report.filter(r => r.status === "done").map(r => r.id));
      const remaining = report.filter(r => r.status !== "done").map(r => r.id);
      setSelection(remaining.length ? new Set(remaining) : null);
    } finally { setBulkBusy(false); setBulkRunning(false); }
  };

  const bulkSeen = () => {
    const account = accountById(accountId);
    if (!vault || !account || !mailbox) return;
    const target = chosen.some((m) => !m.seen);
    void runOnSelection(
      { kind: "seen", value: target },
      (done) => {
        const set = new Set(done);
        patchRows((prev) => prev.map((m) => (set.has(selId(m, mailbox)) ? { ...m, seen: target } : m)));
        setSentRows((prev) => prev.map((m) => (set.has(selId(m, sentBox)) ? { ...m, seen: target } : m)));
        const changed = rows.filter(m => set.has(selId(m, mailbox)) && m.seen !== target).length;
        setUnseen(n => Math.max(0, n + (target ? -changed : changed)));
      },
    );
  };

  /**
   * Spam and not-spam (S12). One place decides what the button means: the
   * shared plan reads the open folder, so inside the junk folder every entry
   * — swipe, selection, ⋮ — turns into "not spam" together.
   *
   * The toast says which of the two things happened: a server that refuses the
   * `$Junk` keyword still gets the message moved, and saying "trained" then
   * would be a claim nobody can keep.
   */
  const junkLabel = useMemo(
    () => (mailbox && isJunkFolder(mailbox, folders) ? t("mail.notJunk") : t("mail.reportJunk")),
    [mailbox, folders, t],
  );

  const junkItems = (messages: readonly MailEnvelope[]) =>
    messages.map((m) => ({ mailbox: (parseUnifiedId(m.id)?.mailbox ?? mailbox) || "", uid: parseUnifiedId(m.id)?.uid ?? m.id }));

  const reportJunk = async (messages: readonly MailEnvelope[], onDone: (ids: string[]) => void) => {
    const account = accountById(accountId);
    const items = junkItems(messages).filter((i) => i.mailbox);
    if (!vault || !account || items.length === 0) return;
    // The junk folder below is the open mailbox's: a row of another mailbox
    // (the merged list) is never reported into it.
    if (messages.some((m) => { const own = parseUnifiedId(m.id); return !!own && own.accountId !== account.id; })) return;
    try {
      const out = await runJunkAction({
        vault,
        account,
        folders,
        items,
        confirmCreate: () => mConfirm({ title: t("mail.junkNoFolderTitle"), message: t("mail.junkNoFolderMsg") }),
      });
      if (out.kind !== "done") {
        if (out.kind === "noTarget") toast.error(t("mail.junkNoFolder"));
        return;
      }
      onDone(messages.map((m) => m.id));
      const folder = mailFolderLabel(out.folder, folders[0]?.delimiter);
      toast.success(
        out.direction === "notJunk"
          ? t("mail.junkCleared", { n: out.moved, folder })
          : out.flagged > 0
            ? t("mail.junkReported", { n: out.moved, folder })
            : t("mail.junkMovedOnly", { n: out.moved, folder }),
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const swipeJunk = (m: MailEnvelope) =>
    reportJunk([m], (ids) => patchRows((prev) => prev.filter((r) => !ids.includes(r.id))));

  /**
   * Where a row's message lives: its own folder in the conversation view, the
   * screen's otherwise — and its own MAILBOX where the row carries one (a row
   * of the merged list). Read and star act there; they went to the open
   * mailbox with the row's folder and number, where that number names another
   * message or none.
   */
  const originOf = (m: MailEnvelope) => {
    const own = parseUnifiedId(m.id);
    return {
      account: accountById(own?.accountId ?? accountId),
      box: (own?.mailbox ?? mailbox) || "",
      uid: own?.uid ?? m.id,
    };
  };

  /** Read/unread for ONE row — the sheet's entry; the bar's version works on the selection. */
  const setOneSeen = async (m: MailEnvelope, seen: boolean) => {
    const { account, box, uid } = originOf(m);
    if (!vault || !account || !box) return;
    try {
      await setMessageSeen(vault, account, box, uid, seen);
      patchRows((prev) => prev.map((r) => (r.id === m.id ? { ...r, seen } : r)));
      setSentRows((prev) => prev.map((r) => (r.id === m.id ? { ...r, seen } : r)));
      // The count is the shown folder's; a row of the merged list is not in it.
      if (m.seen !== seen && !unified) setUnseen((n) => Math.max(0, seen ? n - 1 : n + 1));
    } catch (e) {
      toast.error(describeError(e));
    }
  };

  const setOneFlagged = async (m: MailEnvelope, flagged: boolean) => {
    const { account, box, uid } = originOf(m);
    if (!vault || !account || !box) return;
    try {
      await setMessageFlagged(vault, account, box, uid, flagged);
      patchRows((prev) => prev.map((r) => (r.id === m.id ? { ...r, flagged } : r)));
      setSentRows((prev) => prev.map((r) => (r.id === m.id ? { ...r, flagged } : r)));
    } catch (e) {
      toast.error(describeError(e));
    }
  };

  const moveOne = async (m: MailEnvelope) => {
    const account = accountById(accountId);
    const { account: own, box, uid } = originOf(m);
    // The targets are the open mailbox's folders: a row of another mailbox is
    // never moved into them.
    if (!vault || !account || own?.id !== account.id || !box) return;
    // Where the mail goes (E20): the targets of the move. Its own folder stays
    // in the list as "here", unselectable, so the list reads complete.
    const target = await mTargets({
      title: t("mail.moveTo"),
      options: moveTargets,
      here: box,
    });
    if (!target) return;
    try {
      await moveMessage(vault, account, box, uid, target);
      patchRows((prev) => prev.filter((r) => r.id !== m.id));
      setSentRows((prev) => prev.filter((r) => r.id !== m.id));
    } catch (e) {
      toast.error(describeError(e));
    }
  };

  /**
   * What a mail row can do, from the ONE list both shells read (Design-Runde
   * E2). The sheet shows all of it; the swipe keeps the entries the list marks
   * as swipe-worthy, in the same order. The trash folder and the junk folder
   * change the words, not the entries.
   */
  const rowActionsFor = (m: MailEnvelope) => {
    const { box } = originOf(m);
    const trash = guessTrashMailbox(folders.map((f) => f.name), folders[0]?.delimiter);
    return mailRowActions(t, {
      markRead: m.seen ? undefined : () => void setOneSeen(m, true),
      markUnread: m.seen ? () => void setOneSeen(m, false) : undefined,
      flagged: m.flagged,
      flag: () => void setOneFlagged(m, true),
      unflag: () => void setOneFlagged(m, false),
      // In "all inboxes" a row offers no move, spam or delete, as on the
      // desktop: each needs a folder of the row's mailbox, and each mailbox has
      // its own — they wait for the message to be opened (the handbook says
      // so). Offered here, they acted in the OPEN mailbox, on the message with
      // the row's number there. (Read and the star take the row's mailbox,
      // `originOf`; the sheet that offers them does not open for a merged row
      // yet — the catalog's mail-unified-row-read-star.)
      move: unified ? undefined : () => void moveOne(m),
      snooze: () => void swipeSnooze(m),
      junkDirection: box && isJunkFolder(box, folders) ? "restore" : "report",
      junk: unified ? undefined : () => void swipeJunk(m),
      inTrash: trash !== null && trash === box,
      delete: unified ? undefined : () => void swipeDelete(m),
    });
  };
  const swipeFor = (m: MailEnvelope) =>
    rowActionsFor(m)
      .filter((a) => a.swipe)
      .map((a) => ({ icon: <a.icon size={ICON.ui} />, label: a.label, danger: a.danger, onClick: a.run }));

  /**
   * Putting a message aside (S22). The marker lives in the per-vault settings,
   * so a mail set aside here also rests on the desktop — a device-local one
   * would let the same message come back on one machine and stay hidden on the
   * other.
   */
  const swipeSnooze = async (m: MailEnvelope) => {
    if (!account) return;
    const chosenPreset = (await mActions({
      title: t("mail.snooze"),
      options: SNOOZE_PRESETS.map((p) => ({ value: p, label: t(`mail.snooze_${p}`) })),
    })) as SnoozePreset | null;
    if (!chosenPreset) return;
    const until = snoozeUntil(chosenPreset, new Date(), weekStart);
    const next = addSnooze(snoozed, { account: account.id, id: m.id, folder: mailbox ?? "", until });
    setSnoozed(next);
    patchRows((prev) => prev.filter((r) => r.id !== m.id));
    await persistSnoozed(next);
    toast.info(
      t("mail.snoozedUntil", {
        when: new Date(until).toLocaleString(i18n.language, { dateStyle: "short", timeStyle: "short" }),
      })
    );
  };

  const bulkJunk = async () => {
    setBulkBusy(true);
    try {
      await reportJunk(chosen, (ids) => {
        patchRows((prev) => prev.filter((m) => !ids.includes(m.id)));
        setSentRows((prev) => prev.filter((m) => !ids.includes(m.id)));
      });
    } finally {
      setBulkBusy(false);
      setSelection(null);
    }
  };

  const bulkMove = async () => {
    const account = accountById(accountId);
    if (!vault || !account || !mailbox) return;
    const target = await mTargets({
      title: t("mail.moveTo"),
      options: moveTargets,
      here: mailbox,
    });
    if (!target) return;
    void runOnSelection(
      { kind: "move", target },
      (done) => {
        patchRows((prev) => prev.filter((m) => !done.includes(selId(m, mailbox))));
        setSentRows((prev) => prev.filter((m) => !done.includes(selId(m, sentBox))));
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
      inTrash ? { kind: "delete" } : { kind: "move", target: trash! },
      (done) => {
        patchRows((prev) => prev.filter((m) => !done.includes(selId(m, mailbox))));
        setSentRows((prev) => prev.filter((m) => !done.includes(selId(m, sentBox))));
      },
    );
  };

  /**
   * Deleting one row by swiping it away (S30). The list already carried the
   * gesture contract for note rows — the same one, so a swipe means the same
   * thing wherever the user does it.
   *
   * A move to Trash offers an undo instead of a dialog; deleting FROM Trash
   * still asks, because only one of the two can be taken back. The row leaves
   * at once and comes back if the undo runs — waiting for the server first
   * makes the gesture feel broken.
   */
  const swipeDelete = async (m: MailEnvelope) => {
    const account = accountById(accountId);
    const own = parseUnifiedId(m.id);
    const box = (own?.mailbox ?? mailbox) || "";
    const uid = own?.uid ?? m.id;
    // The trash below is the open mailbox's: a row of another mailbox (the
    // merged list) is never deleted with it.
    if (!vault || !account || !box || (own && own.accountId !== account.id)) return;
    const trash = guessTrashMailbox(folders.map((f) => f.name), folders[0]?.delimiter);
    const inTrash = trash !== null && trash === box;
    if (!trash) {
      toast.error(t("mail.noTrashFolder"));
      return;
    }
    if (inTrash) {
      if (!(await mConfirm({ title: t("mail.deleteForeverConfirm"), message: m.subject, danger: true }))) return;
      try {
        await deleteMessagePermanently(vault, account, box, uid);
        patchRows((prev) => prev.filter((r) => r.id !== m.id));
        toast.success(t("mail.deleted"));
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e));
      }
      return;
    }
    try {
      await moveMessage(vault, account, box, uid, trash);
      patchRows((prev) => prev.filter((r) => r.id !== m.id));
      toast.success(t("mail.movedToTrash"), {
        label: t("common.undo"),
        run: () =>
          void (async () => {
            const out = await undoMoveToTrash(
              {
                listNewest: async (b, limit) => (await listEnvelopes(vault, account, b, 0, limit)).messages,
                moveMessage: (from, id, to) => moveMessage(vault, account, from, id, to),
              },
              { subject: m.subject, dateTs: m.dateTs, from: m.from },
              trash,
              box,
            ).catch(() => "notFound" as const);
            if (out === "ok") {
              patchRows((prev) => [m, ...prev.filter((r) => r.id !== m.id)]);
              toast.success(t("mail.undone"));
            } else {
              toast.info(t("mail.undoNotFound"));
            }
          })(),
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  /**
   * Swiping a CONVERSATION means the whole conversation (E3b) — the same thing
   * picking one already means for the multi-select, so the two do not disagree.
   *
   * It reuses the single-message path per message rather than restating the
   * trash rules: one place decides what "delete" means for a mail, and it is
   * the one that already handles trash-vs-shred and the undo. What differs is
   * the report: a single message offers an undo, several get one honest count
   * — an undo that only takes back the last of five would be a lie.
   */
  const swipeDeleteThread = async (messages: Array<MailEnvelope & { mailbox?: string }>) => {
    if (messages.length === 0) return;
    if (messages.length === 1) {
      await swipeDelete(messages[0]);
      return;
    }
    const account = accountById(accountId);
    if (!vault || !account) return;
    const trash = guessTrashMailbox(folders.map((f) => f.name), folders[0]?.delimiter);
    if (!trash) {
      toast.error(t("mail.noTrashFolder"));
      return;
    }
    if (!(await mConfirm({ title: t("mail.deleteThreadConfirm", { n: messages.length }), message: messages[0].subject, danger: true }))) return;
    let done = 0;
    for (const m of messages) {
      const own = parseUnifiedId(m.id);
      const box = (m.mailbox ?? own?.mailbox ?? mailbox) || "";
      const uid = own?.uid ?? m.id;
      // Into the open mailbox's trash only what lives in that mailbox.
      if (!box || (own && own.accountId !== account.id)) continue;
      try {
        if (box === trash) await deleteMessagePermanently(vault, account, box, uid);
        else await moveMessage(vault, account, box, uid, trash);
        patchRows((prev) => prev.filter((r) => r.id !== m.id));
        setSentRows((prev) => prev.filter((r) => r.id !== m.id));
        done += 1;
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e));
        break;
      }
    }
    if (done > 0) toast.success(t("mail.threadMovedToTrash", { n: done }));
  };

  const onMailKeyDown = (event: React.KeyboardEvent<HTMLUListElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest("input, textarea, select, [contenteditable=true]") || event.ctrlKey || event.metaKey || event.altKey) return;
    const list = event.currentTarget;
    const buttons = Array.from(list.querySelectorAll<HTMLButtonElement>("button.m-mailrow, button.m-mailthread-head"));
    const current = target.closest("button") as HTMLButtonElement | null;
    const index = current ? buttons.indexOf(current) : -1;
    if (event.key === "Escape") { event.preventDefault(); if (bulkBusy) bulkAbort.current?.abort(); else setSelection(null); return; }
    if ((event.key === "ArrowLeft" || event.key === "ArrowRight") && current?.hasAttribute("aria-expanded")) {
      event.preventDefault();
      if ((current.getAttribute("aria-expanded") === "true") !== (event.key === "ArrowRight")) current.click();
      return;
    }
    const delta = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
    const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : delta ? Math.max(0, Math.min(buttons.length - 1, index + delta)) : -1;
    if (next >= 0 && buttons[next]) { event.preventDefault(); buttons[next].focus(); buttons[next].scrollIntoView({ block: "nearest" }); }
    // Enter/Space use the native button click, including the current selection
    // mode. Text inputs and other screens never enter this handler.
  };

  const ptrRef = useRef<HTMLDivElement>(null);
  // Pulled in "all inboxes", it is the merged list that is read again (as the
  // desktop's refresh does), not the folder behind it.
  const ptrIndicator = usePullToRefresh(ptrRef, unified ? loadUnified : load);

  // Every surface carries its own bar since S11 — large at a tab root, compact
  // when pushed. The shell owns no header any more.
  const backHeader = <AppBar large={!onBack} onBack={onBack} onMenu={onMenu} title={t("mail.title")} />;

  if (accounts.length === 0) {
    return (
      <div className="m-page">
        {backHeader}
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
    <div className="m-page m-page--mail-list" ref={ptrRef}>
      {backHeader}
      {ptrIndicator}

      {/* ONE line, ranked (S30). One unreachable account still names itself
          and its reason; several become a count, because five names and five
          reasons is a wall rather than a warning. */}
      {/* Not while the empty state below IS the error (N7): the banner warns
          about a state you cannot otherwise see, and when the whole surface is
          that state, saying it twice makes the offer harder to find, not the
          warning louder. */}
      <MailBulkReport items={bulkReport} busy={bulkRunning} onCancel={() => bulkAbort.current?.abort()} onDismiss={() => setBulkReport([])} />
      {attachmentsOnly && <Banner kind="info">{t("mail.attachmentsLoaded", { known: view.sourceRows.filter(m => m.hasAttachments !== undefined).length, loaded: view.sourceRows.length })}</Banner>}
      {status && !folderError && (
        <Banner kind={status.kind === "info" ? "info" : status.kind} rounded>
          {status.raw ?? t(status.key, status.values)}
        </Banner>
      )}

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
          {!unified && unseen > 0 && <span className="m-mboxline-badge">{unseen}</span>}
          <span className="m-mboxline-acct">{mailAccountLabel(account?.label)}</span>
          <ChevronDown size={ICON.ui} />
        </button>
        <IconButton
          label={t("mail.filterUnread")}
          active={unreadOnly}
          data-testid="mail-filter-unread"
          onClick={() => setUnreadOnly((v) => !v)}
        >
          <Mail size={ICON.head} />
        </IconButton>
        <IconButton label={t("mail.filterAttachments")} active={attachmentsOnly} data-testid="mail-filter-attachments" onClick={() => setAttachmentsOnly(v => !v)}><Paperclip size={ICON.head} /></IconButton>
        {!unified && (
          <IconButton
            label={t("mail.filterFlagged")}
            active={flaggedRows !== null}
            data-testid="mail-filter-flagged"
            disabled={flaggedBusy}
            onClick={() => void toggleFlagged()}
          >
            <Star size={ICON.head} />
          </IconButton>
        )}
        <IconButton
          label={t("mail.conversations")}
          active={threadMode}
          data-testid="mail-threads-toggle"
          onClick={toggleThreadMode}
        >
          <MessagesSquare size={ICON.head} />
        </IconButton>
        {/* The search asks ONE folder on the server; in the merged list it
            would answer a question nobody asked — and its hits could not be
            shown there. Same rule, same place as the desktop (P9.3b). */}
        {!unified && (
          <IconButton
            label={t("mail.search")}
            active={searchOpen}
            data-testid="mail-search-toggle"
            onClick={() => {
              if (searchOpen) clearSearch();
              setFocusSearch(true);
              setSearchOpen((v) => !v);
            }}
          >
            <Search size={ICON.head} />
          </IconButton>
        )}
      </div>

      {/* Behind the magnifier on purpose: an always-visible field sat directly
          under the shell's vault-search pill — two search boxes doing different
          things, stacked (device report B3). */}
      {searchOpen && !unified && (
        <SearchField
          autoFocus={focusSearch}
          clearLabel={t("sidebar.clearSearch")}
          data-testid="mail-search"
          /* The key that starts the search says so ("Search" instead of a
             bare return) — the field has no button of its own. */
          enterKeyHint="search"
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            // The on-screen keyboard has done its job; the hits are below it.
            e.currentTarget.blur();
            void runSearch();
          }}
          /* Escape on an EMPTY field leaves the search — the field's own first
             Escape clears, which is the app-wide contract. Leaving the mail
             search open with nothing in it is a dead end. */
          onEscapeWhenEmpty={leaveSearch}
          /* Emptying the field ends the search (the clear button, or deleting
             the text): hits for a question that is no longer in the field
             would be a list nobody can account for. */
          onValueChange={(next) => {
            setQuery(next);
            if (!next.trim() && searching) clearSearch();
          }}
          placeholder={t("mail.search")}
          value={query}
        />
      )}

      {folderError ? (
        signInState !== "active" ? (
          /* "Try again" is the wrong offer for a mailbox that was never signed
             in here: repeating the request cannot produce a password. Same card
             the calendar shows for the same fact, so the two cannot drift. */
          <div className="m-scroll">
            <DeviceSignInCard
              accountLabel={account?.label ?? ""}
              providerLabel={account ? (account.kind === "gmail" ? "Gmail" : mailAccountKind(account) === "microsoft" ? "Microsoft" : account.host) : ""}
              oauth={account ? mailAccountKind(account) !== "imap" : false}
              state={signInState}
              reason={folderError}
              onSignIn={onOpenAccounts}
            />
          </div>
        ) : (
          /* A failed fetch is the one empty state whose action is obvious and was
             missing: try the same request again (N7). Leaving only the message
             made the surface a dead end that needed a tab change to escape. */
          <EmptyState
            action={
              <Button data-testid="mail-error-retry" onClick={() => void load()} variant="tonal">
                {t("sync.retryNow")}
              </Button>
            }
            icon={<Mail size={ICON.head} />}
          >
            {folderError}
          </EmptyState>
        )
      ) : view.isEmpty ? (
        /* "Nothing unread" and "nothing here" are different answers, and the
           first one must not read as the second: the folder is full, the
           filter is simply hiding it. Which is why only THAT one carries an
           action: the filter is the thing standing in the way (N7). */
        <EmptyState
          action={
            view.isEmptyByFilter ? (
              <Button data-testid="mail-empty-showall" onClick={() => { setUnreadOnly(false); setAttachmentsOnly(false); }} variant="tonal">
                {t("mail.showAll")}
              </Button>
            ) : undefined
          }
          icon={<Mail size={ICON.head} />}
        >
          {view.isEmptyByFilter ? t(attachmentsOnly ? "mail.noAttachmentMatches" : "mail.noUnread") : view.isEmptyBySearch ? t("mail.noSearchResults") : t("mail.folderEmpty")}
        </EmptyState>
      ) : (
        <>
        {/* Above the list, once per vault (R1.1). Not inside the <ul>: a hint
            is not a message. */}
        <SwipeHint />
        <ul className="m-maillist" onKeyDown={onMailKeyDown}>
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
                      {/* A one-message conversation is a message, so it swipes
                          like one — the branch that had no SwipeRow at all
                          until round 3. */}
                      <SwipeRow actions={swipeFor(latest)}>
                        <button
                          type="button"
                          className={latest.seen ? "m-mailrow" : "m-mailrow is-unread"}
                          aria-selected={!!selection?.has(sid)}
                          onClick={() => {
                            if (!press.clicked()) return; // the long-press already acted
                            if (selection) { toggleMany([sid]); return; }
                            openRow(latest);
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
                          {selection && <ChoiceMark multiple on={selection.has(sid)} />}
                        </button>
                      </SwipeRow>
                    </li>
                  );
                }
                const threadIds = row.thread.messages.map((m) => selId(m, m.mailbox ?? mailbox));
                const threadPicked = threadIds.length > 0 && threadIds.every((id) => !!selection?.has(id));
                return (
                  <li key={row.thread.key} data-testid="mail-thread">
                    {/* A swipe here means the WHOLE conversation (E3b) — the
                        same thing a tap means while picking. */}
                    <SwipeRow
                      actions={mailRowActions(t, { delete: unified ? undefined : () => void swipeDeleteThread(row.thread.messages) }).map((a) => ({
                        icon: <a.icon size={ICON.ui} />,
                        label: a.label,
                        danger: a.danger,
                        onClick: a.run,
                      }))}
                    >
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
                    </SwipeRow>
                    {open &&
                      row.thread.messages.map((m) => {
                        const mid = selId(m, m.mailbox ?? mailbox);
                        return (
                        <SwipeRow key={`${m.mailbox}|${m.id}`} actions={swipeFor(m)}>
                          <button
                            type="button"
                            className={`m-mailrow m-mailrow--in-thread${m.seen ? "" : " is-unread"}`}
                            aria-selected={!!selection?.has(mid)}
                            data-testid="mail-thread-message"
                            onClick={() => {
                              if (!press.clicked()) return; // the long-press already acted
                              if (selection) { toggleMany([mid]); return; }
                              openRow(m);
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
                            {selection && <ChoiceMark multiple on={selection.has(mid)} />}
                          </button>
                        </SwipeRow>
                        );
                      })}
                  </li>
                );
              })
            : listRows.map((m) => (
            <li key={m.id}>
              {/* Same gesture contract as the note rows (S30): swipe acts on
                  the row, hold selects, tap opens. */}
              <SwipeRow actions={swipeFor(m)}>
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
                    openRow(m);
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
                  {selection && <ChoiceMark multiple on={selection.has(m.id)} />}
                </button>
              </SwipeRow>
            </li>
          ))}
        </ul>
        </>
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
        <div className="m-selectbar m-selectbar--mail" ref={selectionBarRef}>
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
              label={junkLabel}
              disabled={bulkBusy || selection.size === 0}
              onClick={() => void bulkJunk()}
            >
              <Ban size={ICON.head} />
            </IconButton>
            <IconButton
              label={t("common.delete")}
              disabled={bulkBusy || selection.size === 0}
              onClick={() => void bulkDelete()}
            >
              <Trash2 size={ICON.head} />
            </IconButton>
            <IconButton label={t("common.cancel")} onClick={() => { if (bulkBusy) bulkAbort.current?.abort(); else setSelection(null); }}>
              <X size={ICON.head} />
            </IconButton>
          </span>
        </div>
      )}

      {rowSheet && (() => {
        const m = selectable.get(rowSheet);
        if (!m) return null;
        const actions: RowAction[] = [
          // Not in "all inboxes": a selection there carries unified ids the
          // bar cannot resolve, so it appeared with every action enabled and
          // every action doing nothing (S45). The row's own actions still work
          // — they read the message's origin, not the screen's.
          ...(unified
            ? []
            : [{
                icon: <CheckSquare size={ICON.head} />,
                label: t("mobile.selectMany", { defaultValue: "Mehrere auswählen" }),
                testId: "mail-sheet-select-many",
                onClick: () => {
                  const id = rowSheet;
                  setRowSheet(null);
                  setSelection(new Set([id]));
                },
              }]),
          ...rowActionsFor(m).map((a) => ({
            icon: <a.icon size={ICON.head} />,
            label: a.label,
            danger: a.danger,
            testId: `mail-sheet-${a.id}`,
            onClick: () => {
              setRowSheet(null);
              a.run();
            },
          })),
        ];
        return <RowActionSheet actions={actions} onClose={() => setRowSheet(null)} title={m.subject || t("mail.noSubject")} />;
      })()}

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
                      leaveSearch();
                      setSelection(null);
                      // The filter names ONE mailbox, and this mode has no such
                      // thing — its own comment says so. It must not survive
                      // into a view where its answer cannot be true.
                      leaveFlagged();
                      // Turned on, the merged list is read — until then it is
                      // on its way, not empty. Chosen while it is on, it is
                      // read again.
                      if (unified) void loadUnified();
                      else setUnifiedLoading(true);
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
                      // The folder that is shown, chosen again (out of "all
                      // inboxes", say): its list, its search and its filter
                      // stand as they are. Emptying the list here left it empty,
                      // for nothing reads the same folder again.
                      if (name !== mailbox) {
                        leaveSearch();
                        leaveList();
                        setMailbox(name);
                        // S21: the flagged filter is a SERVER answer about one
                        // mailbox. Left standing across a switch it showed the old
                        // folder's starred mail under the new folder's name.
                        leaveFlagged();
                      }
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
                          // The account that is shown, chosen again: nothing to
                          // leave. Its folder used to be dropped, and nothing
                          // asked for the same account's folders again.
                          if (a.id !== accountId) {
                            leaveSearch();
                            leaveList();
                            setAccountId(a.id);
                            setMailbox(null);
                            leaveFlagged();
                          }
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
  // Everything the CORE can name (a mailbox without a password on this device)
  // is translated there, once, for both shells.
  return mailErrorText(e, t);
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
/**
 * How many characters the account slot can carry in THIS window.
 *
 * 24 was measured on a 375 px phone and then applied to every device, so a
 * tablet showed the same stub as a phone next to three times the empty space
 * (finding 2026-08-21). The row's own ellipsis handles the last pixel; this
 * only decides how much is offered to it — and it stays a shortening with a
 * kept domain rather than a plain cut, because two accounts of the same person
 * differ in the domain, not in the local part.
 */
function labelRoomForWindow(): number {
  if (typeof window === "undefined") return 24;
  const width = window.innerWidth || 375;
  // One character per ~12 px of extra width, capped: past a full address there
  // is nothing left to reveal.
  return Math.max(18, Math.min(64, 24 + Math.round((width - 375) / 12)));
}

export function mailAccountLabel(label: string | undefined, max = labelRoomForWindow()): string {
  if (!label) return "";
  const bare = (firstAngleValue(label) ?? label).trim();
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
