import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactElement, type SyntheticEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { Archive, Ban, BellOff, Clock, Copy, ExternalLink, FilePlus2, FileText, Folder, FolderInput, Forward, Inbox, Link2, ListChecks, Mail, MailOpen, MessagesSquare, Paperclip, Pencil, PenLine, RefreshCw, Reply, ReplyAll, Search, Send, ShieldOff, Star, Trash2, TriangleAlert, X } from "lucide-react";
import { Banner, Button, EmptyState, ICON, IconButton, mailboxesSwitchedOn, mailRowActions, MenuItem, MenuLabel, MenuSeparator, MenuSurface, RowActionList, SelectionBar, plainvaProducer, toast, useStableHandler, useWeekStartDay, type LinkTarget, type MailRowCaps } from "@plainva/ui";
import { CLOUD_ACCOUNTS_EVENT, loadCloudAccounts } from "../../services/cloudAccounts";
import { openExternalUrl as openUrl } from "../../services/openExternal";
import { firstAngleValue, nameBeforeAngle } from "@plainva/core";
import "./mail.css";
import { useVault, mailFolderKey, DEFAULT_MAIL_FOLDER, mailRemoteImagesKey, taskDatabaseKey } from "../../contexts/VaultContext";
import { mailSnoozedKey } from "../../services/settingsProfile";
import {
  parseUnsubscribe,
  preferredRoute,
  addSnooze,
  filterSnoozedRows,
  onlySnoozedRows,
  snoozeEntryFor,
  parseSnoozeState,
  pruneSnoozes,
  removeSnooze,
  SNOOZE_PRESETS,
  snoozeUntil,
  undoSnoozes,
  type SnoozeEntry,
  type SnoozePreset, mailErrorText } from "@plainva/ui/mail";
import { applyMailBulk, MailBulkReport, type MailBulkReportItem, type MailBulkAction } from "@plainva/ui/mail";
import { flatMailRows, mailListKeyAction, stepMailRow, stepMailRowInto, threadNavId, threadedMailRows, type MailNavStep } from "@plainva/ui/mail";
import { getSettingsStore } from "../../services/settingsStore";
import { templateVaultOf } from "../../services/dailyNotes";
import { activeDocument } from "../../services/activeDocument";
import { MAIL_TAB_PATH } from "../graph/virtualPaths";
import { applyIndexChanges } from "../../services/fileActions";
import { Select } from "../Select";
import { keepUnchangedAccounts, listMailAccounts, mailAccountKind, onMailAccountsChanged, pickDefaultMailAccount, releaseMailSessions, type MailAccountConfig } from "@plainva/ui/mail";
import { loadDefaultMailAccount } from "../../services/mail/defaultMailAccount";
import { accountRowState, deviceSignInState, type DeviceSignInState } from "../../services/deviceSignIn";
import { cacheEnvelopes, cachedEnvelopes, cacheMessage, cachedMessage, forgetCachedMessages, listEnvelopes, listMailboxesFor, fetchMessage, fetchRawMessage, setMessageSeen, setMessageFlagged, listFlaggedEnvelopes, moveMessage, setMessageJunk, createMailbox, searchEnvelopes, type MailEnvelope, type MailMessage, type MailboxInfo } from "@plainva/ui/mail";
import { sanitizeEmailHtml, buildMailFrameDoc, applyFrameFit, useMailCanvas } from "@plainva/ui/mail";
import { attachMailLinks, LinkTargetText, MailPlainText, mailtoDraft, messageJunkState, remoteImagesDecision } from "@plainva/ui/mail";
import { addEmlToMailNote, captureMailAsNote, loadMailAccountAliases, mailCaptureNotice, mailDayKey, writeReplyNote } from "@plainva/ui/mail";
import { fetchAttachment, formatAttachmentSize, forwardSource, saveMailAttachment, type ForwardSource, type MailAttachmentInfo } from "@plainva/ui/mail";
import { AUTO_READ_DELAY_MS, applyManualSeen, retainOnlyOpen, shouldScheduleAutoRead } from "@plainva/ui/mail";
import { buildReplyBody, replyAllRecipients, buildForwardBody, classifyFolderRole, applyJunk, planJunkAction, pickJunkFolder, listMailRules, runRules, mailFolderLabel, sortMailFolders, pickInboxFolder, pickSentFolder, pickTrashFolder, isTrashMailbox, isJunkFolder, threadRows, groupByOrigin, mergeInboxes, parseUnifiedId, rowAddress, unifiedId, addressRows, uidOf, inPlace } from "@plainva/ui/mail";
import { appConfirm } from "../../services/appDialogs";
import {
  clampMailColumns,
  showListLabels,
  mailColumnsKey,
  mailThreadsKey,
  mailGridTemplate,
  parseMailColumns,
  MAIL_HANDLE_WIDTH,
  type MailColumns,
} from "./mailColumns";
import { createTaskInDatabase } from "../../services/taskPromotion";
import { getConfiguredNoteType } from "../../services/newNote";
import { sendTaskToProviderList } from "../../services/pim/taskToProvider";

/**
 * Opens the composer — the one the window hosts, through the event the
 * editor's "send this note" already uses (finding 2026-10-09).
 *
 * This view used to render a composer of its own. The composer is a floating
 * window to work BESIDE, and the view is a tab: opening a note to look
 * something up replaced the tab, the view was unmounted, and the composer went
 * with it — a written message gone without a word, on the one route that asks
 * nobody. Every window that shows this view answers the event (the central and
 * the full window in `MailComposeHost`, beside their shell; an auxiliary window
 * through `useAuxBridge`), so the draft now lives where no tab can take it
 * away — and, in the first two, no reload of the vault either.
 */
function composeMail(draft: {
  /**
   * The mailbox the message is written from (finding 2026-10-09). Not
   * optional here: the event went out without it, so the composer started
   * with the first mailbox that is stored and with its signature — a reply to
   * a message in the second one left under the first one's address unless
   * "From" was changed by hand. Every way into the composer from this view
   * has a mailbox, so every one of them has to name it.
   */
  accountId: string;
  subject: string;
  markdown: string;
  to?: string;
  /** A forward names the message whose files it carries; the composer loads them. */
  forward?: ForwardSource;
}): void {
  window.dispatchEvent(new CustomEvent("plainva-compose-mail", { detail: draft }));
}

/**
 * Mail workspace (virtual path plainva://mail): a provider-neutral browser for
 * reading, flagging, moving and capturing messages into the vault. Left:
 * envelope list of the selected mailbox (newest
 * first). Right: the message in a hard-sandboxed viewer (see mailSanitize —
 * no scripts, remote content blocked; links open in the system browser on an
 * explicit click) plus mail and capture actions. Reads remain non-mutating;
 * mailbox changes only happen after an explicit user action.
 */

const PAGE_SIZE = 50;

/**
 * What the view shows, as a value: one folder of one account in one vault.
 * What the view holds about a folder is kept or dropped by comparing THIS —
 * never by asking whether a function that loads it has become a new one.
 */
function shownMailbox(vaultPath: string | null | undefined, accountId: string, mailbox: string): string {
  return JSON.stringify([vaultPath ?? "", accountId, mailbox]);
}

// ---- Display helpers (mockup section 05: designed list + reader) ----

/** Stable palette color for a sender/account avatar, from --palette-1..10. */
function avatarVar(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return `var(--palette-${(h % 10) + 1})`;
}

/** "Name <addr>" -> the display name (or the whole string when unnamed). */
function fromName(from: string): string {
  // Linear reading of `/^\s*"?([^"<]+?)"?\s*<[^>]*>\s*$/`: a sender header is
  // written by a stranger, and that pattern was cubic on a run of blanks.
  return (nameBeforeAngle(from, true) ?? from).trim() || from;
}

/** "Name <addr>" -> just the address (or the whole string when bare). */
function fromAddr(from: string): string {
  return (firstAngleValue(from) ?? from).trim();
}

function avatarInitial(name: string): string {
  const c = name.trim()[0];
  return c ? c.toUpperCase() : "?";
}

/** Icon per mailbox role — matches the mockup's folder rail. */
function FolderGlyph({ name, delimiter }: { name: string; delimiter?: string }): ReactElement {
  switch (classifyFolderRole(name, delimiter)) {
    case "inbox": return <Inbox size={ICON.ui} />;
    case "sent": return <Send size={ICON.ui} />;
    case "drafts": return <FileText size={ICON.ui} />;
    case "archive": return <Archive size={ICON.ui} />;
    case "trash": return <Trash2 size={ICON.ui} />;
    case "junk": return <ShieldOff size={ICON.ui} />;
    default: return <Folder size={ICON.ui} />;
  }
}

interface MailViewProps {
  onOpenPath: (path: string, newTab?: boolean) => void;
  /** Only the focused pane publishes the status-bar info line (#4). */
  isActivePane?: boolean;
}

/** Gmail's "All Mail" view in the languages it is named in: deleting there removes a message from every label. */
const GMAIL_ALL_MAIL = /all mail|alle nachrichten|todos|tous les messages|tutta la posta|すべてのメール/i;

export function MailView({ onOpenPath, isActivePane = true }: MailViewProps) {
  const { t, i18n } = useTranslation();
  // "Next week" begins where the week-start setting says (snoozeUntil).
  const weekStart = useWeekStartDay();
  const { vaultPath, vaultAdapter, indexer, triggerFileTreeUpdate, dbAdapter, pimRuntime } = useVault();

  const [accounts, setAccounts] = useState<MailAccountConfig[]>([]);
  const [accountId, setAccountId] = useState<string>("");
  /**
   * The selected mailbox is BOUND TO THE ACCOUNT it was chosen for. Without
   * that binding, switching accounts loaded the previous provider's folder
   * name against the new one — Graph's "Posteingang" against Gmail's IMAP
   * threw "Unknown Mailbox: Posteingang" (maintainer finding 2026-07-20).
   * A foreign selection reads as "" = nothing to load yet.
   */
  const [mailboxSel, setMailboxSel] = useState<{ accountId: string; name: string }>({ accountId: "", name: "" });
  /** "All inboxes" (P9.3b): the merged list is on. Declared here because the
   *  folder helpers below already ask whether it is. */
  const [unified, setUnified] = useState(false);
  const mailbox = mailboxSel.accountId === accountId ? mailboxSel.name : "";
  /** What is shown, as one value: vault, account and folder (finding 2026-10-11). */
  const shown = shownMailbox(vaultPath, accountId, mailbox);
  const selectMailbox = useCallback((name: string) => setMailboxSel({ accountId, name }), [accountId]);
  /** The account's mailboxes in display order (with their backend role). */
  const [boxes, setBoxes] = useState<MailboxInfo[]>([]);
  /**
   * WHOSE mailboxes `boxes` are: the account whose folder list has been
   * answered — with a list, or with a failure and none. Empty while the
   * question is still out. The list of the account that was open a moment ago
   * says nothing about a message of another one (M2).
   */
  const [boxesAccount, setBoxesAccount] = useState("");
  const folders = useMemo(() => boxes.map((b) => b.name), [boxes]);
  /** Server-stated hierarchy delimiter, so folder labels split at the real
   * separator instead of guessing "." vs "/". */
  const delimiter = useMemo(() => boxes.find((b) => b.delimiter)?.delimiter, [boxes]);
  /** The account's Sent folder — read along in conversation mode, so a thread
   *  shows your own replies and not just the other side of the exchange. */
  const sentBox = useMemo(() => (unified ? null : pickSentFolder(boxes)), [boxes, unified]);
  /** Stale-response guards: only the newest request per channel writes state. */
  const listSeq = useRef(0);
  const msgSeq = useRef(0);
  const searchSeq = useRef(0);
  const flaggedSeq = useRef(0);
  const [envelopes, setEnvelopes] = useState<MailEnvelope[]>([]);
  const envelopesRef = useRef<MailEnvelope[]>([]);
  useEffect(() => { envelopesRef.current = envelopes; }, [envelopes]);
  const [total, setTotal] = useState(0);
  const [unseen, setUnseen] = useState(0);
  const [loadingList, setLoadingList] = useState(false);
  /**
   * Which shown folder's list has been answered — with its messages, or with
   * an error. A folder waits for the folders of its account before its list is
   * read, and its list is asked for only after the render in which they come;
   * in between, an empty list is a list nobody has read.
   */
  const [listAnsweredFor, setListAnsweredFor] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  // Showing the cached copy because the refresh failed (offline / throttled).
  const [stale, setStale] = useState(false);
  // A network refresh is in flight WHILE a cached page is already on screen —
  // the banner then says "updating", not "offline" (F4a): the cache is shown
  // first now, so "offline" would be a false claim in the normal case.
  const [refreshing, setRefreshing] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [message, setMessage] = useState<MailMessage | null>(null);
  /**
   * Where the open message LIVES (plan Befunde 06.10., M2): its account and
   * its folder. In conversation mode a message can come from another folder
   * than the open one, and whether remote images may load is a question about
   * the message's folder — spam stays spam when it is read from a thread.
   */
  const [openOrigin, setOpenOrigin] = useState<{ accountId: string; mailbox: string } | null>(null);
  /**
   * The folder the open message was opened INTO — what `shownMailbox` says of
   * the view once that opening has taken effect. Mostly that is the folder that
   * was shown already; a row of the merged list that lies in another mailbox
   * takes the open mailbox along, and the change it causes must not close the
   * message again (see the effect that empties the view).
   */
  const openedInto = useRef<string | null>(null);
  /**
   * The mailbox a message written from the reader goes out from: the one the
   * open message is in (finding 2026-10-09). A reply, a forward and the
   * message a list asks for to unsubscribe all answer for THAT mailbox — in
   * "All inboxes" every row has one of its own.
   */
  const messageAccountId = openOrigin?.accountId ?? accountId;
  /** The link under the pointer or holding the keyboard focus (M1). */
  const [pointedLink, setPointedLink] = useState<LinkTarget | null>(null);
  /** The link that was right-clicked, and where: open it, or copy its address. */
  const [linkMenu, setLinkMenu] = useState<{ link: LinkTarget; x: number; y: number } | null>(null);
  const [loadingMessage, setLoadingMessage] = useState(false);
  // Remote https images: global per-vault opt-in (settings) or a one-shot
  // per-message reveal — default stays blocked (loading = tracking beacon).
  const [remoteOptIn, setRemoteOptIn] = useState(false);
  const [showRemoteOnce, setShowRemoteOnce] = useState(false);
  // Mailbox actions (E4): a text search over the current folder, plus a
  // "Move to…" menu anchored on the reader toolbar.
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<MailEnvelope[] | null>(null);
  const [searchBusy, setSearchBusy] = useState(false);
  // The "Move to…" menu carries the ids it acts on (one message from the reader,
  // or the whole selection from the list context menu / bulk bar).
  const [moveMenu, setMoveMenu] = useState<{ x: number; y: number; ids: string[] } | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  // List selection (multi-select via Ctrl/Cmd+click and Shift+click) + the
  // range anchor. A plain click clears it and opens the message.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  // Messages the user turned unread BY HAND while open — they keep no auto-read
  // timer until they are left and opened again (autoRead.ts).
  const [heldUnread, setHeldUnread] = useState<Set<string>>(() => new Set());
  const anchorRef = useRef<string | null>(null);
  const threadAnchorRef = useRef<string | null>(null);
  // Quick filter over the loaded list (server search still works alongside).
  const [filterUnread, setFilterUnread] = useState(false);
  const [filterAttachments, setFilterAttachments] = useState(false);
  const [bulkReport, setBulkReport] = useState<MailBulkReportItem[]>([]);
  const bulkAbort = useRef<AbortController | null>(null);
  const [bulkRunning, setBulkRunning] = useState(false);
  const bulkContext = useRef("");
  useLayoutEffect(() => {
    bulkContext.current = JSON.stringify([vaultPath, accountId, mailbox]);
    return () => { bulkAbort.current?.abort(); };
  }, [vaultPath, accountId, mailbox]);
  /** Messages put aside (S22) — from the profile, so both devices agree. */
  const [snoozed, setSnoozed] = useState<SnoozeEntry[]>([]);
  const [showSnoozed, setShowSnoozed] = useState(false);
  const [snoozeMenu, setSnoozeMenu] = useState<{ x: number; y: number; ids: string[] } | null>(null);
  const [filterFlagged, setFilterFlagged] = useState(false);
  const [flaggedResults, setFlaggedResults] = useState<MailEnvelope[] | null>(null);
  /** The flagged list is a server query of its own, beside the search: each says when it is done. */
  const [flaggedBusy, setFlaggedBusy] = useState(false);
  /**
   * Conversations (findings P9.3, W2). OFF is today's behaviour to the pixel —
   * a flat list of messages — so nobody's mail rearranges itself after an
   * update. Per vault: a work account with threaded discussions and a private
   * one with newsletters do not want the same answer.
   */
  const [threadMode, setThreadMode] = useState(
    () => (vaultPath ? localStorage.getItem(mailThreadsKey(vaultPath)) : null) === "1"
  );
  /** Which conversations are unfolded. Session state: a thread is opened to read
   *  it, not as a setting worth carrying to the next launch. */
  const [openThreads, setOpenThreads] = useState<Set<string>>(() => new Set());
  // Keyboard navigation (2026-09-04): the row that holds the keyboard — a
  // message id or a conversation header's `threadNavId`. Follows the open
  // message; the arrow keys move it and open what it lands on.
  const [navId, setNavId] = useState<string | null>(null);
  const navFocusRef = useRef(false);
  const listRef = useRef<HTMLDivElement>(null);
  const readerRef = useRef<HTMLDivElement>(null);
  /**
   * The Sent folder, read along in conversation mode. Your own replies live
   * there, so without it a thread shows only the other side of the exchange —
   * which reads as if you never answered. One extra page, only while grouping is
   * on, and every message keeps its own folder.
   */
  const [sentEnvelopes, setSentEnvelopes] = useState<MailEnvelope[]>([]);
  // Right-click context menu on a list row.
  const [ctxMenu, setCtxMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  /**
   * "All inboxes" (P9.3b): every account's inbox in ONE list, newest first.
   *
   * It keeps its own state instead of pretending to be a folder of the active
   * account. Opening a message from it switches the active account and folder to
   * that message's — which is what makes reply, move, trash and capture right
   * afterwards without a second code path — and this state is what stays on
   * screen while that happens.
   */
  const [unifiedEnvelopes, setUnifiedEnvelopes] = useState<MailEnvelope[]>([]);
  const [unifiedBusy, setUnifiedBusy] = useState(false);
  /** Accounts whose inbox could not be read, with the reason. One failing
   *  account must not empty the list of the others. */
  const [unifiedErrors, setUnifiedErrors] = useState<Array<{ label: string; message: string }>>([]);

  useEffect(() => {
    let alive = true;
    if (!vaultPath) return;
    getSettingsStore()
      .then((s) => s.get<boolean>(mailRemoteImagesKey(vaultPath)))
      .then((v) => {
        if (alive) setRemoteOptIn(v === true);
      })
      .catch(() => {});
    const onChanged = () => {
      void getSettingsStore()
        .then((s) => s.get<boolean>(mailRemoteImagesKey(vaultPath)))
        .then((v) => setRemoteOptIn(v === true))
        .catch(() => {});
    };
    window.addEventListener("plainva-mail-settings-changed", onChanged);
    return () => {
      alive = false;
      window.removeEventListener("plainva-mail-settings-changed", onChanged);
    };
  }, [vaultPath]);

  const account = useMemo(() => accounts.find((a) => a.id === accountId) ?? null, [accounts, accountId]);
  /**
   * Whether the folder list of the OPEN account has been answered. Two things
   * wait for it: the list of a folder is read once its account's folders are
   * known (local rules act with them), and "Move to…", "Spam" and "Delete" in
   * the reader's bar — each goes to a folder that every account names
   * differently, and the list of the account that was open a moment ago is
   * the wrong place to look. The open message itself does not wait: it is
   * read, marked read and starred where it lives. "Move to…" from a row's
   * menu needs no guard of its own: the merged list does not offer it, no row
   * of a folder stands before that folder has been read, and the menu offers
   * only the folders that are in.
   *
   * With one mailbox open this was never a question: the folder list comes
   * first and names the folder to show. A row of the merged list names its own
   * folder (finding 2026-10-11), so its message is on screen while the folders
   * of its account are still on their way.
   */
  const foldersAnswered = !!account && boxesAccount === account.id;
  /**
   * Whether the list on screen is still on its way — the merged list, or the
   * folder's, until the list of the folder that is shown has been answered.
   * Until then, "No messages." would be a claim about a list nobody has read.
   */
  const listPending = unified ? unifiedBusy : loadingList || listAnsweredFor !== shown;

  /**
   * Is the failure in front of the user a MISSING SIGN-IN rather than a broken
   * server? (P2 follow-up.)
   *
   * The desktop answered `missing mail credentials` in raw text where the mail
   * should be, and the fix — one password field — sat in the settings, which is
   * exactly the surface the user is not on. The phone already renders the offer
   * where the absence hurts (`DeviceSignInCard` in the calendar); mail inherits
   * that idea here.
   *
   * The decision itself is NOT restated: `accountRowState` is the shared rule
   * (no slot -> "signin"; slot present but the provider rejects it -> "expired";
   * anything else stays "active" and keeps the raw message, because a server
   * that is down must not be dressed up as a sign-in problem).
   *
   * Read only WHEN a list error exists: this is a keychain hit, and the answer
   * is worthless while everything works.
   */
  const [signInState, setSignInState] = useState<DeviceSignInState>("active");
  useEffect(() => {
    if (!listError || !account || !vaultPath) {
      setSignInState("active");
      return;
    }
    let alive = true;
    void (async () => {
      const slot = await deviceSignInState("mail", vaultPath, account.id);
      if (alive) setSignInState(accountRowState(slot, listError));
    })();
    return () => {
      alive = false;
    };
  }, [listError, account, vaultPath]);

  /**
   * A Microsoft mailbox signs in through an OAuth consent, an IMAP one through
   * a password — so the offer points at the settings page that actually HAS the
   * matching control, rather than at a generic one that would make the user
   * hunt for the second hop.
   */
  const mailIsOauth = account ? mailAccountKind(account) !== "imap" : false;
  const mailProviderName = account ? (account.kind === "gmail" ? "Gmail" : mailIsOauth ? "Microsoft" : account.host) : "";

  /**
   * The snooze list, and the one place it is pruned.
   *
   * Pruning belongs to LOADING, not to reading: `dueSnoozes` deliberately does
   * not remove anything, because a read that writes would run on every render.
   */
  /** See the phone: a minute tick, so a due message comes back on its own. */
  const [snoozeNow, setSnoozeNow] = useState(() => Date.now());
  useEffect(() => {
    const h = setInterval(() => setSnoozeNow(Date.now()), 60_000);
    return () => clearInterval(h);
  }, []);

  const persistSnoozes = useCallback(
    async (next: SnoozeEntry[]) => {
      if (!vaultPath) return;
      const store = await getSettingsStore();
      await store.set(mailSnoozedKey(vaultPath), next);
      await store.save();
    },
    [vaultPath]
  );

  useEffect(() => {
    let alive = true;
    if (!vaultPath) return;
    const load = () =>
      void getSettingsStore()
        .then((st) => st.get<unknown>(mailSnoozedKey(vaultPath)))
        .then((raw) => {
          if (!alive) return;
          const parsed = parseSnoozeState(raw);
          const pruned = pruneSnoozes(parsed, Date.now());
          setSnoozed(pruned);
          if (pruned.length !== parsed.length) void persistSnoozes(pruned);
        })
        .catch(() => {});
    load();
    // A fold of duplicate mailboxes moves messages put aside onto the kept
    // one (finding 2026-11-06, M2): read them again, or this view writes its
    // older copy back over the moved entries.
    const stop = onMailAccountsChanged(vaultPath, load);
    return () => {
      alive = false;
      stop();
    };
  }, [vaultPath, persistSnoozes]);

  /**
   * Each row is put aside where it LIES — its address (plan P1). It was noted
   * under the open account and folder: a row of "All inboxes" or a reply from
   * Sent in a conversation was then hidden nowhere it actually is (open-items
   * plan 3.137 no. 5).
   */
  /**
   * The Undo of a snooze's notice (decision E17): each message stands as it
   * stood before, read against the list as it is when Undo is pressed — the
   * notice outlives the render it was made in.
   */
  const undoSnooze = useStableHandler((before: SnoozeEntry[], added: SnoozeEntry[]) => {
    const next = undoSnoozes(snoozed, before, added);
    setSnoozed(next);
    void persistSnoozes(next);
  });

  const snoozeMessages = useCallback(
    async (ids: string[], preset: SnoozePreset) => {
      if (ids.length === 0) return;
      const until = snoozeUntil(preset, new Date(), weekStart);
      const before = snoozed;
      let next: SnoozeEntry[] = snoozed;
      const added: SnoozeEntry[] = [];
      for (const id of ids) {
        const entry = snoozeEntryFor(id, until);
        if (!entry) continue;
        next = addSnooze(next, entry);
        added.push(entry);
      }
      setSnoozeMenu(null);
      // A row without an address names no folder to put it aside in: nothing
      // was put aside, and the notice must not say it was.
      if (added.length === 0) return;
      setSnoozed(next);
      await persistSnoozes(next);
      toast.info(
        t("mail.snoozedUntil", {
          when: new Date(until).toLocaleString(i18n.language, { dateStyle: "short", timeStyle: "short" }),
        }),
        { label: t("common.undo"), run: () => undoSnooze(before, added) }
      );
    },
    [snoozed, persistSnoozes, weekStart, t, i18n.language, undoSnooze]
  );

  const unsnoozeMessages = useCallback(
    async (ids: string[]) => {
      let next: SnoozeEntry[] = snoozed;
      for (const id of ids) {
        const at = parseUnifiedId(id);
        if (at) next = removeSnooze(next, { account: at.accountId, folder: at.mailbox, id: at.uid });
      }
      setSnoozed(next);
      await persistSnoozes(next);
    },
    [snoozed, persistSnoozes]
  );

  // Findings round P8.1: the three columns were fixed at 210/320/rest — a long
  // folder name was simply cut off. Two grips resize them; the pair is remembered
  // per vault, because a vault is what a window shows.
  const gridRef = useRef<HTMLDivElement | null>(null);
  const [cols, setCols] = useState<MailColumns>(() =>
    parseMailColumns(vaultPath ? localStorage.getItem(mailColumnsKey(vaultPath)) : null),
  );
  const [dragging, setDragging] = useState<"folders" | "list" | null>(null);
  /**
   * Whether the filter row above the list spells its toggles out. Derived from
   * the column width we already track, so a narrow list needs no observer of its
   * own — and the row cannot spill over the reader (finding 2026-07-30).
   */
  const listLabels = showListLabels(cols.list);
  useEffect(() => {
    if (vaultPath) setCols(parseMailColumns(localStorage.getItem(mailColumnsKey(vaultPath))));
  }, [vaultPath]);
  useEffect(() => {
    if (vaultPath) localStorage.setItem(mailColumnsKey(vaultPath), JSON.stringify(cols));
  }, [vaultPath, cols]);

  // MOUSEdown, not pointerdown: `preventDefault()` on a pointerdown suppresses
  // the compatibility mouse events that follow it, so the window mousemove
  // listener below never fired — the drag registered and then did nothing. The
  // app's sidebar grips have always used mousedown for the same reason.
  const startColumnResize = (which: "folders" | "list") => (e: ReactMouseEvent) => {
    e.preventDefault();
    const grid = gridRef.current;
    if (!grid) return;
    const left = grid.getBoundingClientRect().left;
    // Available space for the three columns = container minus the two handles.
    const available = grid.clientWidth - 2 * MAIL_HANDLE_WIDTH;
    setDragging(which);
    const onMove = (ev: MouseEvent) => {
      const x = ev.clientX - left;
      setCols((prev) =>
        clampMailColumns(
          which === "folders"
            ? { folders: x, list: prev.list }
            : { folders: prev.folders, list: x - prev.folders - MAIL_HANDLE_WIDTH },
          available,
        ),
      );
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setDragging(null);
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  // Findings round P7.2: the transport keeps ONE idle IMAP session per account so
  // a burst of actions pays a single login. The cleanup below covers both moments
  // when holding it stops making sense — switching to another account and leaving
  // mail — so a logged-in connection never waits out the idle timeout for a
  // mailbox nobody is looking at. Releasing only the account we actually used
  // (never "all") keeps a second view's session untouched.
  useEffect(() => {
    const user = account?.user;
    if (!user) return;
    return () => {
      void releaseMailSessions(user);
    };
  }, [account]);

  // Status-bar info line (#4): the selected mailbox + its message count and, when
  // present, the unread count — instead of the last-opened file's stale word
  // stats. Only the focused pane publishes.
  // In "All inboxes" it names the merged list: the folder behind it is not what
  // is shown, and its counts are not the list's (the phone's mailbox line shows
  // no count there either).
  useEffect(() => {
    if (!isActivePane) return;
    let info: string;
    if (unified) info = t("mail.allInboxes");
    else {
      info = `${mailFolderLabel(mailbox, delimiter)} · ${total} ${t("mail.messagesLabel", { defaultValue: "Nachrichten" })}`;
      if (unseen > 0) info += ` · ${unseen} ${t("mail.unreadLabel", { defaultValue: "ungelesen" })}`;
    }
    activeDocument.set({ path: MAIL_TAB_PATH, content: "", kind: "virtual", meta: { info } });
  }, [isActivePane, unified, mailbox, delimiter, total, unseen, t]);

  // Read again whenever a mailbox is connected, changed or removed, or mail is
  // switched on or off for an account (Sammelplan § 3.47 (d)): the view kept
  // the list it opened with until the tab was opened anew.
  const [accountsRead, setAccountsRead] = useState(0);
  useEffect(() => {
    if (!vaultPath) return;
    const again = () => setAccountsRead((n) => n + 1);
    const stop = onMailAccountsChanged(vaultPath, again);
    window.addEventListener(CLOUD_ACCOUNTS_EVENT, again);
    return () => {
      stop();
      window.removeEventListener(CLOUD_ACCOUNTS_EVENT, again);
    };
  }, [vaultPath]);
  useEffect(() => {
    let alive = true;
    void (async () => {
      if (!vaultPath) return;
      // A mailbox whose account has mail switched off for the vault is not read (E3).
      const [stored, cards, defaultId] = await Promise.all([listMailAccounts(vaultPath), loadCloudAccounts(vaultPath).catch(() => []), loadDefaultMailAccount(vaultPath).catch(() => "")]);
      const list = mailboxesSwitchedOn(stored, cards);
      if (!alive) return;
      // An unchanged mailbox stays the same object: everything that hangs on
      // `account` (the folders, the open message) would read anew otherwise.
      setAccounts((prev) => keepUnchangedAccounts(prev, list));
      // The open mailbox stays; without one Mail opens on the default mailbox
      // (finding 2026-11-06, M1), not on whichever was connected first.
      setAccountId((prev) => pickDefaultMailAccount(list, defaultId, prev)?.id ?? "");
    })();
    return () => {
      alive = false;
    };
  }, [vaultPath, accountsRead]);

  // Folder column (mail-client E1): the account's mailboxes, inbox first. The
  // read-only login command already returns the mailbox list, so this needs no
  // new Rust. The mailbox stays EMPTY until the list arrives — assuming the
  // IMAP name "INBOX" made Graph fail on localized mailboxes ("Posteingang").
  // Until it arrives the folders are nobody's: `boxesAccount` names an account
  // only once that account has answered.
  useEffect(() => {
    let alive = true;
    setBoxes([]);
    setBoxesAccount("");
    setListError(null);
    if (!vaultPath || !account) return;
    const forAccount = account.id;
    void listMailboxesFor(vaultPath, account)
      .then((list) => {
        if (!alive) return;
        const valid = list.filter((b) => b.name);
        const delim = valid.find((b) => b.delimiter)?.delimiter;
        const order = sortMailFolders(valid.map((b) => b.name), delim);
        const sorted = order.map((n) => valid.find((b) => b.name === n)).filter((b): b is MailboxInfo => !!b);
        setBoxes(sorted);
        setBoxesAccount(forAccount);
        setMailboxSel((prev) =>
          prev.accountId === forAccount && order.includes(prev.name)
            ? prev
            : { accountId: forAccount, name: pickInboxFolder(sorted) ?? "INBOX" }
        );
      })
      .catch(() => {
        if (!alive) return;
        // Answered, with nothing. Fall back to the IMAP default so the envelope
        // list still loads — unless a folder of this account is named already:
        // a row of the merged list brings its own.
        setBoxesAccount(forAccount);
        setMailboxSel((prev) => (prev.accountId === forAccount && prev.name ? prev : { accountId: forAccount, name: "INBOX" }));
      });
    return () => {
      alive = false;
    };
  }, [vaultPath, account]);

  /**
   * Local rules over the page that was just fetched (S14).
   *
   * "Local" is the whole caveat: they can only act on mail Plainva has seen, so
   * they run when a folder is loaded and never in the background. Where a
   * mailbox can do better, S15/S16 put the same rule on the server; the
   * settings card says which of the two is true.
   *
   * Each message is handled at most once per session. A refresh that re-filed
   * mail the user had since moved by hand would be worse than a rule that
   * missed something.
   */
  const seenByRules = useRef(new Set<string>());
  const mailFolder = useCallback(async () => {
    const store = await getSettingsStore();
    return (((await store.get<string>(mailFolderKey(vaultPath ?? ""))) ?? "").trim() || DEFAULT_MAIL_FOLDER);
  }, [vaultPath]);

  const applyLocalRules = useCallback(
    async (messages: readonly MailEnvelope[], box: string) => {
      if (!vaultPath || !account) return;
      const rules = await listMailRules(vaultPath).catch(() => []);
      if (rules.length === 0) return;
      // "Handled" is remembered at the message's ADDRESS (open-items plan
      // 3.110 no. 5): the bare number 1 of one mailbox is not number 1 of the
      // next, and a rule left the second one lying after it had moved the first.
      const fresh = messages.filter((m) => inPlace(m.id, { accountId: account.id, mailbox: box }) && !seenByRules.current.has(m.id));
      for (const m of fresh) seenByRules.current.add(m.id);
      if (fresh.length === 0) return;

      const trash = pickTrashFolder(boxes);
      const junkBox = pickJunkFolder(boxes);
      const result = await runRules(rules, fresh.map((m) => ({ id: m.id, from: m.from, subject: m.subject })), {
        moveTo: (id, target) => moveMessage(vaultPath, account, box, uidOf(id), target),
        markRead: (id) => setMessageSeen(vaultPath, account, box, uidOf(id), true),
        flag: (id) => setMessageFlagged(vaultPath, account, box, uidOf(id), true),
        // Without a junk or trash folder there is nowhere to put it — refusing
        // beats moving mail into a folder name Plainva invented.
        junk: (id) => (junkBox ? moveMessage(vaultPath, account, box, uidOf(id), junkBox) : Promise.reject(new Error("no junk folder"))),
        trash: (id) => (trash ? moveMessage(vaultPath, account, box, uidOf(id), trash) : Promise.reject(new Error("no trash folder"))),
        // Filing needs the BODY, which an envelope does not carry — so the
        // message is fetched, and only for the ones a rule actually matched.
        capture: vaultAdapter
          ? async (id) => {
              const msg = await fetchMessage(vaultPath, account, box, uidOf(id));
              await captureMailAsNote({ adapter: vaultAdapter, message: msg, accountId: account.id, mailbox: box, folder: await mailFolder(), generatedBy: await plainvaProducer("mail-capture"), accountAliases: await loadMailAccountAliases(vaultPath).catch(() => ({})) });
            }
          : undefined,
      });
      if (result.removed.length > 0) {
        // Out of every list it stands in — the merged one too, where a moved
        // message stood on (open-items plan 3.110 no. 8). Addresses, so no
        // other message goes with it.
        const gone = new Set(result.removed);
        const keep = (list: MailEnvelope[]) => list.filter((m) => !gone.has(m.id));
        setEnvelopes(keep);
        setUnifiedEnvelopes(keep);
        setSentEnvelopes(keep);
        setSearchResults((r) => (r ? keep(r) : r));
        setFlaggedResults((r) => (r ? keep(r) : r));
      }
      if (result.acted.length > 0) {
        toast.info(t("rules.appliedN", { n: result.acted.length, defaultValue: "{{n}} Nachricht(en) durch Regeln bearbeitet" }));
      }
    },
    [vaultPath, account, boxes, vaultAdapter, mailFolder, t]
  );

  /**
   * Reads the list of the folder that is shown.
   *
   * One handle on the newest version of itself, on purpose: what it closes
   * over changes for reasons that are not a new folder — the folder list the
   * rules act with, the language of a notice — and none of those may be what
   * starts it. WHEN it runs is said below, by what is shown.
   */
  const loadList = useStableHandler(
    async (offset: number) => {
      // No mailbox yet = the folder list is still loading; opening a guessed
      // name would fail on backends that localize their folders (Graph). And
      // a mailbox that IS named waits for that list too (`foldersAnswered`).
      if (!vaultPath || !account || !mailbox || !foldersAnswered) return;
      const seq = ++listSeq.current;
      const current = (): boolean => seq === listSeq.current;
      const forShown = shown;
      // Every row is named by its address (plan P1): what an action reads off
      // a row is where it lies, never the folder that happens to be shown.
      const place = { accountId: account.id, mailbox };
      setLoadingList(true);
      setListError(null);
      // Cache FIRST, network second (report 2026-07-29 F4a). The last page of a
      // folder you have opened before is on this device; waiting for the full
      // roundtrip before showing anything was the single biggest part of "mail
      // feels slow". The banner keeps saying it is not confirmed until the
      // refresh lands, so this shows the copy without CLAIMING freshness.
      if (offset === 0) {
        // Guarded: reading the offline copy must never be able to stop the
        // fetch below. It could, before the finding of 2026-08-23 -- this call
        // sat outside the try, and in a window without write rights it threw,
        // leaving the list empty and silent.
        const warm = await cachedEnvelopes(dbAdapter, account.id, mailbox, PAGE_SIZE).catch(() => []);
        if (!current()) return;
        if (warm.length > 0) {
          setEnvelopes(addressRows(warm, place));
          setTotal(warm.length);
          setStale(true);
          // The list is on screen; the refresh below is no longer a wait.
          setLoadingList(false);
          setRefreshing(true);
        }
      }
      try {
        const last = offset > 0 ? envelopesRef.current[envelopesRef.current.length - 1]?.id : undefined;
        const beforeId = last === undefined ? undefined : uidOf(last);
        const page = await listEnvelopes(vaultPath, account, mailbox, offset, PAGE_SIZE, beforeId);
        if (!current()) return; // a newer account/mailbox took over
        setTotal(page.total);
        setUnseen(page.unseen);
        const listed = addressRows(page.messages, place);
        setEnvelopes((prev) => (offset === 0 ? listed : [...prev, ...listed]));
        setStale(false);
        setListAnsweredFor(forShown);
        // The first page IS the newest window of this folder, so it may also
        // drop what the server no longer lists. A "load more" says nothing
        // about the top of the folder and stays purely additive.
        void cacheEnvelopes(dbAdapter, account.id, mailbox, page.messages, { newestPage: offset === 0 });
        // Local rules run over what was just fetched (S14). Only over messages
        // this device has not seen before, so a refresh does not re-file mail
        // the user has since moved by hand.
        void applyLocalRules(listed, mailbox);
      } catch (e) {
        // A late failure of a superseded request must not surface as the
        // current mailbox's error.
        if (!current()) return;
        // Offline or throttled: show the last copy from this device rather than
        // an empty pane. The banner still says it is not current — the cache is
        // a fallback, never a claim of freshness. Only the first page: a failed
        // "load more" must not replace what is already on screen.
        // The warm read above already put the cached page on screen; only an
        // EMPTY cache still needs the error, or the pane would sit blank.
        const cached = offset === 0 ? await cachedEnvelopes(dbAdapter, account.id, mailbox, PAGE_SIZE).catch(() => []) : [];
        if (!current()) return;
        setListAnsweredFor(forShown);
        if (cached.length > 0) {
          setEnvelopes(addressRows(cached, place));
          setTotal(cached.length);
          setStale(true);
        } else {
          setListError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (current()) {
          setLoadingList(false);
          setRefreshing(false);
        }
      }
    }
  );

  /**
   * What the view holds about ONE folder of ONE account — its list and the
   * list still on its way for it, the search in it, the rows picked in it, the
   * message in the reader — goes when another one is shown (finding
   * 2026-10-11).
   *
   * Keyed on WHAT is shown, as a value. It hung on the identity of the loader,
   * and the loader was a new function for reasons that are not a new folder:
   * the folder list of the account that was left being emptied, the folder
   * list of the new one arriving, a junk folder Plainva had just created, the
   * app language. Each of those emptied the list, dropped the search and the
   * selection, closed the reader and read the folder again.
   *
   * What is still on its way for the folder that was left — its list, a
   * search in it, its flagged list — is turned away here, not by the next
   * request. The next list waits for the folders of its account, and in that
   * time the answer for the folder that was left came in under the new name:
   * its rows, or its error in place of the merged list. A search or a flagged
   * list came in under the next folder, below an empty search field — the
   * hits of the inbox under Sent, with folder-local numbers that name other
   * messages there. What those answers would have cleared up is cleared with
   * them.
   *
   * One message outlives the change: the one whose opening caused it. A row of
   * the merged list that lies in another mailbox takes the open mailbox along
   * (`openMessage`), and its message belongs to what is shown afterwards — it
   * and its row stay. Every other change closes the reader and turns away a
   * message that is still on its way: such a message arrived after the reader
   * had been emptied and stood there with no row of its own, under a bar that
   * acts on the open row.
   */
  // Before the frame is painted: the rows of the folder that was left are not
  // shown under the new one, and nothing opened in between meets a reset that
  // was still pending for the change before it.
  useLayoutEffect(() => {
    listSeq.current++;
    searchSeq.current++;
    flaggedSeq.current++;
    setEnvelopes([]);
    setListAnsweredFor(null);
    setTotal(0);
    setUnseen(0);
    setLoadingList(false);
    setRefreshing(false);
    setStale(false);
    setSearchBusy(false);
    setFlaggedBusy(false);
    // Drop the search AND the selection when the account/mailbox changes: IMAP
    // UIDs are folder-local, so a stale id set would highlight unrelated mails
    // in the new folder (and a Graph id set would just come up empty).
    setSearchResults(null);
    setFlaggedResults(null);
    setFilterFlagged(false);
    setSearchQuery("");
    setSelectedIds(new Set());
    setCtxMenu(null);
    if (openedInto.current === shown) return;
    msgSeq.current++;
    setSelectedId(null);
    setMessage(null);
    setOpenOrigin(null);
    setLoadingMessage(false);
  }, [shown]);

  /**
   * The list of the folder that is shown is read when THAT changes — and once
   * the folders of its account are known, which for a row of the merged list
   * is later than the folder itself. Not when the loader is a new function.
   */
  useEffect(() => {
    if (foldersAnswered) void loadList(0);
  }, [shown, foldersAnswered, dbAdapter, loadList]);

  /**
   * Reads the Sent folder alongside the open one while conversations are on
   * (P9.3). Deliberately best-effort and silent: this is context, not the list
   * the user asked for, so an account without a Sent folder — or a Sent folder
   * that fails to load — leaves the threads showing what the open folder holds
   * rather than putting an error where the mail should be.
   */
  useEffect(() => {
    let alive = true;
    if (!threadMode || !vaultPath || !account || !sentBox || sentBox === mailbox) {
      setSentEnvelopes([]);
      return;
    }
    void listEnvelopes(vaultPath, account, sentBox, 0, PAGE_SIZE)
      .then((page) => {
        if (alive) setSentEnvelopes(addressRows(page.messages, { accountId: account.id, mailbox: sentBox }));
      })
      .catch(() => {
        if (alive) setSentEnvelopes([]);
      });
    return () => {
      alive = false;
    };
  }, [threadMode, vaultPath, account, sentBox, mailbox]);

  const openMessage = useCallback(
    /**
     * `rowId` is the row's ADDRESS — account, folder, number (plan P1): every
     * list names its rows so. In conversation mode a thread mixes folders (a
     * reply of yours is in Sent), and an IMAP uid is folder-LOCAL: fetching it
     * against the wrong mailbox would open a different message, or none.
     */
    async (rowId: string, follow: boolean = unified) => {
      if (!vaultPath) return;
      /**
       * `follow`: the view moves into the message's mailbox. In the merged list
       * (P9.3b) a row of another account switches the active account and folder
       * to it, so replying, moving, trashing and capturing afterwards all act
       * on the right mailbox. Outside it, the row menu's Open follows a reply of
       * yours into Sent; a click reads it where it stands and leaves the folder
       * as it is. Either way the reader's bar acts at the message's address —
       * it does not depend on the folder on screen any more.
       */
      const address = rowAddress({ id: rowId }, { accountId, mailbox });
      const acct = accounts.find((a) => a.id === address.accountId) ?? null;
      if (!acct) return;
      const box = address.mailbox;
      const uid = address.uid;
      const openId = unifiedId({ accountId: acct.id, mailbox: box, uid });
      const follows = follow && (acct.id !== accountId || box !== mailbox);
      if (follows) {
        if (acct.id !== accountId) setAccountId(acct.id);
        setMailboxSel({ accountId: acct.id, name: box });
      }
      // What is shown once the lines above have taken effect: the change of
      // mailbox this opening causes must not close the message again.
      openedInto.current = shownMailbox(vaultPath, follows ? acct.id : accountId, follows ? box : mailbox);
      const seq = ++msgSeq.current;
      const current = (): boolean => seq === msgSeq.current;
      setSelectedId(openId);
      setLoadingMessage(true);
      setMessage(null);
      setOpenOrigin({ accountId: acct.id, mailbox: box });
      setPointedLink(null);
      setLinkMenu(null);
      setShowRemoteOnce(false);
      // Same as the list: a message read once shows INSTANTLY from the cache
      // while the fetch runs (F4a). Remote images stay blocked either way.
      const warm = await cachedMessage(dbAdapter, acct.id, box, uid);
      if (!current()) return;
      if (warm) {
        setMessage(warm);
        setLoadingMessage(false);
      }
      try {
        const msg = await fetchMessage(vaultPath, acct, box, uid);
        if (!current()) return;
        setMessage(msg);
        void cacheMessage(dbAdapter, acct.id, box, msg);
      } catch (e) {
        if (!current()) return;
        // A message read once stays readable without the network.
        const cached = await cachedMessage(dbAdapter, acct.id, box, uid);
        if (!current()) return;
        if (cached) setMessage(cached);
        else toast.error(mailErrorText(e, t));
      } finally {
        if (current()) setLoadingMessage(false);
      }
    },
    // `accounts`/`accountId` are read above (code review B1): without them
    // here, a unified-inbox row opened after an account switch resolved
    // against the account list of the previous render.
    [vaultPath, accounts, accountId, mailbox, unified, dbAdapter, t]
  );

  // ONE rule for both shells (M2): "always" does not reach into the junk
  // folder, and a folder that is not known yet counts as junk.
  const remoteImages = useMemo(
    () =>
      remoteImagesDecision({
        always: remoteOptIn,
        once: showRemoteOnce,
        folder: messageJunkState(openOrigin, { accountId: boxesAccount, boxes }),
      }),
    [remoteOptIn, showRemoteOnce, openOrigin, boxesAccount, boxes]
  );
  const allowRemote = remoteImages.allow;
  // The theme's canvas for a mail that sets no colours of its own (finding X3).
  const mailCanvas = useMailCanvas();
  const sanitized = useMemo(
    () => (message?.html ? sanitizeEmailHtml(message.html, { allowRemoteImages: allowRemote }) : null),
    [message, allowRemote]
  );

  /**
   * Loads every account's inbox and merges them. Per account, and tolerant per
   * account: the maintainer has one working mailbox and one whose sign-in is
   * gone, and a merged list that shows nothing because of the second one would
   * be worse than no feature (report 2026-07-30). Failures are collected and
   * named instead.
   *
   * Which folder is "the inbox" is asked per account, because it is not always
   * called INBOX (Graph answers with the localised display name).
   */
  /**
   * Counts the reads of the merged list: only the newest may answer (open-items
   * plan 3.137 no. 4). Two at once — "Refresh now" while one is on its way —
   * and the first one back ended the wait of the newer one, and an older one
   * coming back last replaced its answer.
   */
  const unifiedSeq = useRef(0);
  /** How many mailboxes the last merged read reached. None, and "No messages."
   *  under the error lines would be a word about a list nobody could read
   *  (open-items plan 3.137 no. 3). */
  const [unifiedReached, setUnifiedReached] = useState(0);
  /**
   * One handle on its newest version, run when what it reads changes — the
   * merged list being turned on, the accounts — and not when the app language
   * hands out a new `t` (open-items plan 3.110 no. 8: every language change
   * read all inboxes again).
   */
  const loadUnified = useStableHandler(async () => {
    if (!vaultPath || accounts.length === 0) return;
    const seq = ++unifiedSeq.current;
    setUnifiedBusy(true);
    const pages: MailEnvelope[][] = [];
    const failures: Array<{ label: string; message: string }> = [];
    for (const acct of accounts) {
      try {
        const box = pickInboxFolder(await listMailboxesFor(vaultPath, acct));
        if (!box) {
          failures.push({ label: acct.label, message: t("mail.noInbox", { defaultValue: "Kein Posteingang gefunden." }) });
          continue;
        }
        const page = await listEnvelopes(vaultPath, acct, box, 0, PAGE_SIZE);
        // The row id becomes the message's ADDRESS, so an action can never send
        // a uid to the wrong mailbox.
        pages.push(addressRows(page.messages, { accountId: acct.id, mailbox: box }));
      } catch (e) {
        failures.push({ label: acct.label, message: mailErrorText(e, t) });
      }
    }
    if (seq !== unifiedSeq.current) return;
    setUnifiedEnvelopes(mergeInboxes(pages, PAGE_SIZE));
    setUnifiedErrors(failures);
    setUnifiedReached(pages.length);
    setUnifiedBusy(false);
  });

  /** Which accounts there are, as a value: a new one is a reason to read again. */
  const accountsKey = useMemo(() => accounts.map((a) => a.id).join(","), [accounts]);
  useEffect(() => {
    if (unified) void loadUnified();
  }, [unified, accountsKey, vaultPath, loadUnified]);

  /** The account a merged row belongs to, for the label on it. */
  const accountLabel = useCallback(
    (rowId: string): string => {
      const origin = parseUnifiedId(rowId);
      if (!origin) return "";
      return accounts.find((a) => a.id === origin.accountId)?.label ?? "";
    },
    [accounts]
  );

  /** Row ids by the mailbox they live in — read off each address, never off the screen. */
  const originGroups = useCallback(
    (ids: string[]) => groupByOrigin(ids, (id) => accounts.find((a) => a.id === id) ?? null),
    [accounts]
  );

  // ---- Mailbox actions (E4) ----
  const displayedEnvelopes = unified ? unifiedEnvelopes : (searchResults ?? flaggedResults ?? envelopes);
  // Quick filter (client-side over the loaded list; the server search runs
  // independently). "Ungelesen" keeps only unread envelopes.
  const visibleEnvelopes = useMemo(
    () => {
      const kept = displayedEnvelopes.filter((e) => (!filterUnread || !e.seen) && (!filterFlagged || e.flagged) && (!filterAttachments || e.hasAttachments === true));
      // Snoozed messages (S22) leave the list until their time. A search and
      // the flagged list are NOT filtered: a snooze says "not in my way", and
      // someone searching for a mail by name wants to find it. The merged list
      // is: a row is put aside where it lies, and each row names that place
      // (plan P1) — in "All inboxes" as in its folder.
      // The Snoozed list shows exactly the messages put aside (both shells).
      if (showSnoozed) return onlySnoozedRows(kept, snoozed, snoozeNow);
      if (searchResults || flaggedResults) return kept;
      return filterSnoozedRows(kept, snoozed, snoozeNow);
    },
    [displayedEnvelopes, filterUnread, filterFlagged, filterAttachments, searchResults, flaggedResults, showSnoozed, snoozed, snoozeNow]
  );
  /** Sent, read along for conversations — a reply put aside there leaves them too. */
  const visibleSent = useMemo(
    () => (showSnoozed ? onlySnoozedRows(sentEnvelopes, snoozed, snoozeNow) : filterSnoozedRows(sentEnvelopes, snoozed, snoozeNow)),
    [sentEnvelopes, showSnoozed, snoozed, snoozeNow]
  );
  /**
   * Conversation rows (P9.3). Built from the open folder PLUS the Sent folder,
   * so your own replies are part of the thread; every message carries the folder
   * it came from, which is what makes opening it work (an IMAP uid is
   * folder-local). Search and the flagged filter stay flat: both answer a
   * question about single messages, and grouping their hits would hide the very
   * mail that matched.
   */
  const threadable = useMemo(
    () => {
      if (!threadMode || searchResults || flaggedResults) return [];
      // Merged list: every row already carries its origin, and Sent is NOT read
      // along (five accounts would mean five extra pages for a browse surface).
      // Grouping stays per account either way — the anchor in groupThreads makes
      // a cross-account merge structurally impossible.
      if (unified) {
        return visibleEnvelopes.map((e) => {
          const origin = parseUnifiedId(e.id);
          return { ...e, mailbox: origin?.mailbox ?? "", account: origin?.accountId };
        });
      }
      return [
        ...visibleEnvelopes.map((e) => ({ ...e, mailbox, account: account?.id })),
        ...visibleSent.map((e) => ({ ...e, mailbox: sentBox ?? "", account: account?.id })),
      ];
    },
    [threadMode, searchResults, flaggedResults, visibleEnvelopes, visibleSent, mailbox, sentBox, account, unified]
  );
  // Anchored to the open folder: Sent completes threads, it never adds rows.
  const rows = useMemo(
    // No anchor in the merged list: there is no single "open folder" to anchor
    // to, and nothing foreign is read along there either.
    () => (threadable.length > 0 ? threadRows(threadable, unified ? {} : { anchorMailbox: mailbox }) : []),
    [threadable, mailbox, unified],
  );
  /** Conversations are only shown where they exist: a flat list stays flat. */
  const showThreads = !filterAttachments && threadMode && !searchResults && !flaggedResults && rows.length > 0;
  /** The rows the arrow keys walk, in screen order (pure, see listNavigation). */
  const navRows = useMemo(
    () => (showThreads ? threadedMailRows(rows, openThreads) : flatMailRows(visibleEnvelopes)),
    [showThreads, rows, openThreads, visibleEnvelopes],
  );
  const firstNavId = navRows[0]?.id ?? null;
  /** Roving tabindex: exactly one row is in the Tab order — the current one, else the first. */
  const tabFor = (id: string) => ((navId ?? firstNavId) === id ? 0 : -1);
  useEffect(() => {
    if (selectedId) setNavId(selectedId);
  }, [selectedId]);
  useEffect(() => {
    if (!navFocusRef.current || !navId || !listRef.current) return;
    navFocusRef.current = false;
    for (const el of listRef.current.querySelectorAll<HTMLElement>("[data-nav-id]")) {
      if (el.dataset.navId !== navId) continue;
      el.focus({ preventScroll: true });
      el.scrollIntoView({ block: "nearest" });
      break;
    }
  }, [navId, navRows]);

  /** What the open message declares as a way out, if anything (S23). */
  const unsubRoute = useMemo(
    () => (message ? preferredRoute(parseUnsubscribe({ listUnsubscribe: message.listUnsubscribe, listUnsubscribePost: message.listUnsubscribePost })) : null),
    [message]
  );

  const unsubscribeNow = useCallback(async () => {
    if (!unsubRoute || !message) return;
    if (unsubRoute.kind === "mailto") {
      // A mailto route is a message the reader SENDS — it opens the composer
      // rather than going out behind their back. From the mailbox the list
      // wrote to: a list takes the address a request comes from off its roll.
      composeMail({
        accountId: messageAccountId,
        to: unsubRoute.target,
        subject: unsubRoute.subject || "unsubscribe",
        markdown: "",
      });
      return;
    }
    const ok = await appConfirm({
      title: t("mail.unsubscribe"),
      message: t("mail.unsubscribeConfirm", { host: (() => { try { return new URL(unsubRoute.target).host; } catch { return unsubRoute.target; } })() }),
    });
    if (!ok) return;
    try {
      await openUrl(unsubRoute.target);
    } catch {
      toast.error(t("mail.unsubscribeFailed"));
    }
  }, [unsubRoute, message, messageAccountId, t]);

  /**
   * The open message's row: in the list on screen, or — in a conversation — in
   * Sent, read along. Found by its ADDRESS (plan P1), so a row with the same
   * number in another folder is never taken for it: the read button, the star
   * and the reading time read their state off this row, and nothing else.
   */
  const openRow = useMemo(
    () =>
      selectedId == null
        ? undefined
        : displayedEnvelopes.find((e) => e.id === selectedId) ?? (showThreads ? visibleSent.find((e) => e.id === selectedId) : undefined),
    [selectedId, displayedEnvelopes, showThreads, visibleSent]
  );
  const currentSeen = openRow?.seen ?? false;
  const currentFlagged = openRow?.flagged ?? false;
  /** Whether a list on screen holds the open message — the one its read state is read off. */
  const openRowListed = openRow !== undefined;
  /**
   * Whether these rows lie in the trash of their account — the folder each
   * MESSAGE lies in, never the folder on screen (open-items plan 3.137 no. 1):
   * in a conversation in the trash, your reply from Sent is not in the trash,
   * and Delete moves it there rather than removing it for good. One rule with
   * the phone (`isTrashMailbox`).
   */
  const inTrash = useCallback(
    (ids: readonly string[]) =>
      ids.length > 0 &&
      ids.every((id) => {
        const at = parseUnifiedId(id);
        return !!at && at.accountId === account?.id && boxesAccount === account.id && isTrashMailbox(at.mailbox, boxes);
      }),
    [account, boxesAccount, boxes]
  );
  /** The open message lies in the trash of its account. */
  const openInTrash = selectedId != null && inTrash([selectedId]);
  const isGmail = /(^|\.)gmail\.com$/i.test(account?.host ?? "") || /googlemail/i.test(account?.host ?? "");
  // The ids the list context menu acts on: the whole selection when the
  // right-clicked row is part of it, otherwise that single row.
  const ctxIds = useMemo(
    () => (ctxMenu ? (selectedIds.has(ctxMenu.id) && selectedIds.size > 0 ? [...selectedIds] : [ctxMenu.id]) : []),
    [ctxMenu, selectedIds]
  );

  const runSearch = useCallback(async () => {
    if (!vaultPath || !account || !mailbox) return;
    const q = searchQuery.trim();
    if (!q) {
      // An empty field ends the search — and the one still on its way.
      searchSeq.current++;
      setSearchBusy(false);
      setSearchResults(null);
      return;
    }
    const seq = ++searchSeq.current;
    const current = (): boolean => seq === searchSeq.current;
    setSearchBusy(true);
    try {
      const hits = await searchEnvelopes(vaultPath, account, mailbox, q);
      // Named by their address like every row (plan P1).
      if (current()) setSearchResults(addressRows(hits, { accountId: account.id, mailbox }));
    } catch (e) {
      if (current()) toast.error(mailErrorText(e, t));
    } finally {
      if (current()) setSearchBusy(false);
    }
  }, [vaultPath, account, mailbox, searchQuery, t]);

  const clearSearch = useCallback(() => {
    // A search still on its way would bring its hits back.
    searchSeq.current++;
    setSearchBusy(false);
    setSearchQuery("");
    setSearchResults(null);
  }, []);

  const toggleFlaggedFilter = useCallback(async () => {
    const next = !filterFlagged;
    setFilterFlagged(next);
    // An answer belongs to the switch that asked for it: switched off, or on
    // again, the one still on its way is turned away.
    const seq = ++flaggedSeq.current;
    const current = (): boolean => seq === flaggedSeq.current;
    if (!next) {
      setFlaggedResults(null);
      setFlaggedBusy(false);
      return;
    }
    if (!vaultPath || !account || !mailbox) return;
    setFlaggedBusy(true);
    try {
      const starred = await listFlaggedEnvelopes(vaultPath, account, mailbox);
      if (current()) setFlaggedResults(addressRows(starred, { accountId: account.id, mailbox }));
    } catch (e) {
      if (!current()) return;
      setFilterFlagged(false);
      toast.error(mailErrorText(e, t));
    } finally {
      if (current()) setFlaggedBusy(false);
    }
  }, [filterFlagged, vaultPath, account, mailbox, t]);

  // ---- list selection (multi-select) ----
  const toggleSel = useCallback((id: string) => {
    setSelectedIds((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }, []);
  const clearSel = useCallback(() => setSelectedIds(new Set()), []);
  /**
   * Every thread row in view, as the ids it stands for — the order Shift ranges
   * over. A message's id is its address (plan P1), in a thread as anywhere: the
   * selection id built here put the OPEN account in front of a row of "All
   * inboxes", an address inside an address that named no message (open-items
   * plan 3.110 no. 1).
   */
  const threadRowIds = useMemo(
    () => rows.map((r) => ({ key: r.thread.key, ids: r.thread.messages.map((m) => m.id) })),
    [rows]
  );
  const selectThreadRange = useCallback(
    (key: string) => {
      const a = threadAnchorRef.current;
      const ia = a ? threadRowIds.findIndex((r) => r.key === a) : -1;
      const ib = threadRowIds.findIndex((r) => r.key === key);
      if (ia < 0 || ib < 0) return;
      const [lo, hi] = ia < ib ? [ia, ib] : [ib, ia];
      setSelectedIds((prev) => {
        const n = new Set(prev);
        for (let i = lo; i <= hi; i++) for (const id of threadRowIds[i].ids) n.add(id);
        return n;
      });
    },
    [threadRowIds]
  );
  /** Whole conversation on or off in one go — what "select this thread" means. */
  const toggleThreadSel = useCallback((ids: string[]) => {
    setSelectedIds((prev) => {
      const n = new Set(prev);
      const allOn = ids.every((id) => n.has(id));
      for (const id of ids) { if (allOn) n.delete(id); else n.add(id); }
      return n;
    });
  }, []);
  const selectRange = useCallback(
    (id: string, list: MailEnvelope[]) => {
      const a = anchorRef.current;
      const ia = a ? list.findIndex((e) => e.id === a) : -1;
      const ib = list.findIndex((e) => e.id === id);
      if (ia < 0 || ib < 0) { toggleSel(id); return; }
      const [lo, hi] = ia < ib ? [ia, ib] : [ib, ia];
      setSelectedIds((prev) => { const n = new Set(prev); for (let i = lo; i <= hi; i++) n.add(list[i].id); return n; });
    },
    [toggleSel]
  );

  // ---- id-aware bulk actions (reader single message, list selection, context
  // menu). IMAP changes use bounded UID sets; results retain their origin. ----
  /**
   * Every row the view holds, in every list it can stand in. A row's id is its
   * address, so a change found by id reaches that message and no other — the
   * same number in another folder or another mailbox is another id.
   */
  const patchEverywhere = useCallback((change: (list: MailEnvelope[]) => MailEnvelope[]) => {
    setUnifiedEnvelopes(change);
    setEnvelopes(change);
    setSentEnvelopes(change);
    setSearchResults((r) => (r ? change(r) : r));
    setFlaggedResults((r) => (r ? change(r) : r));
  }, []);

  const runBulkAction = useCallback(async (ids: string[], action: MailBulkAction) => {
    if (!vaultPath) return [];
    const controller = new AbortController(); bulkAbort.current = controller;
    const context = bulkContext.current;
    setBulkReport([]);
    const report: MailBulkReportItem[] = [];
    setBulkRunning(true);
    try {
    for (const group of originGroups(ids)) {
      // The row is found by its address: its folder's epoch (`uidValidity`)
      // must be that folder's, not the one of a row with the same number in
      // the folder on screen — or, in the merged list, in another mailbox's
      // folder of the same name.
      const held = [...unifiedEnvelopes, ...envelopes, ...sentEnvelopes, ...(searchResults ?? []), ...(flaggedResults ?? [])];
      const entries = group.uids.map(uid => {
        const addressed = unifiedId({ accountId: group.account.id, mailbox: group.mailbox, uid });
        const row = held.find(e => e.id === addressed);
        return { id: uid, uidValidity: row?.uidValidity, selectionId: addressed, label: (row?.subject || uid) + " · " + group.account.label + " / " + group.mailbox };
      });
      const result = await applyMailBulk(vaultPath, group.account, group.mailbox, entries, action, controller.signal);
      if (context !== bulkContext.current) return [];
      for (const item of result) {
        const entry = entries.find(e => e.id === item.id)!;
        report.push({ ...item, id: entry.selectionId, label: entry.label });
      }
      if (action.kind === "move" || action.kind === "delete") await forgetCachedMessages(dbAdapter, group.account.id, group.mailbox, result.filter(r => r.status === "done").map(r => r.id)).catch(() => toast.error(t("mail.cacheUpdateFailed")));
      setBulkReport([...report]);
      if (result.some(r => r.status === "uncertain")) controller.abort();
    }
    const done = report.filter(r => r.status === "done").map(r => r.id);
    setSelectedIds(prev => new Set([...prev].filter(id => !done.includes(id))));
    return done;
    } finally { setBulkRunning(false); }
  }, [vaultPath, originGroups, envelopes, sentEnvelopes, searchResults, flaggedResults, unifiedEnvelopes, dbAdapter, t]);

  const bulkSetSeen = useCallback(
    async (ids: string[], seen: boolean) => {
      if (!vaultPath || !account || ids.length === 0 || actionBusy) return;

      setActionBusy(true);
      try {
        const done = new Set(await runBulkAction(ids, { kind: "seen", value: seen }));
        // The count is the folder's on screen: only its own rows change it.
        const delta = (searchResults ?? envelopes).filter(e => done.has(e.id) && e.seen !== seen).length * (seen ? -1 : 1);
        patchEverywhere((list) => list.map((e) => (done.has(e.id) ? { ...e, seen } : e)));
        setUnseen((u) => Math.max(0, u + delta));
      } catch (e) {
        toast.error(mailErrorText(e, t));
      } finally {
        setActionBusy(false);
      }
    },
    [vaultPath, account, actionBusy, envelopes, searchResults, runBulkAction, patchEverywhere, t]
  );
  /**
   * A read-state change the USER asked for, as opposed to the auto-read timer.
   * The hold is updated synchronously here, before the (async) write: by the
   * time `seen` flips and re-runs the effect below, the hold must already be in
   * place — otherwise the effect sees "unread and not held" for one render and
   * starts the very timer this exists to prevent.
   */
  const setSeenManually = useCallback(
    (ids: string[], seen: boolean) => {
      setHeldUnread((held) => applyManualSeen(held, ids, seen));
      void bulkSetSeen(ids, seen);
    },
    [bulkSetSeen]
  );
  const markSeen = useCallback((seen: boolean) => { if (selectedId != null) setSeenManually([selectedId], seen); }, [selectedId, setSeenManually]);

  const bulkSetFlagged = useCallback(
    async (ids: string[], flagged: boolean) => {
      if (!vaultPath || !account || ids.length === 0 || actionBusy) return;
      setActionBusy(true);
      try {
        const done = new Set(await runBulkAction(ids, { kind: "flagged", value: flagged }));
        patchEverywhere((list) => list.map((e) => (done.has(e.id) ? { ...e, flagged } : e)));
        // Unstarred, a message leaves the list of starred ones.
        if (!flagged) setFlaggedResults((r) => (r ? r.filter((e) => !done.has(e.id)) : r));
      } catch (e) {
        toast.error(mailErrorText(e, t));
      } finally {
        setActionBusy(false);
      }
    },
    [vaultPath, account, actionBusy, runBulkAction, patchEverywhere, t]
  );

  // Leaving a message releases its hold, so opening it again behaves normally.
  useEffect(() => {
    setHeldUnread((held) => retainOnlyOpen(held, selectedId));
  }, [selectedId]);

  /**
   * Turns the merged list on or off. The open message stays, and so does the id
   * of its row: the merged list and a folder name a row by the same address
   * (plan P1), so the open message keeps its row in the list beside it — marked,
   * with the read button telling the truth (finding 2026-10-11, where the two
   * lists named a row differently).
   */
  const showUnified = useCallback(
    (on: boolean) => {
      setUnified(on);
      // The merged list is read when it is turned on; until then it is on its
      // way, and "No messages." would be said of a list nobody has read.
      if (on) setUnifiedBusy(true);
      // Rows picked in one list are not rows of the other. Left by a click on
      // the folder that stood behind it — a click that shows no other folder,
      // so nothing else lets the pick go — the merged list's pick stood on
      // over the folder: "2 selected", no row marked, and the bar acted on the
      // other mailbox's message by its address.
      if (on !== unified) setSelectedIds(new Set());
    },
    [unified]
  );

  // Auto-mark-read: a message left open for a few seconds switches to "read" on
  // its own (like every mail client). Switching messages cancels the timer, and
  // a message the user turned unread BY HAND is left alone — see autoRead.ts.
  // The write goes through `bulkSetSeen` rather than `setSeenManually`: this is
  // not a manual change and must not touch the hold.
  // Only for a message the list on screen holds: a message it does not hold — a
  // reply read along from Sent in a conversation, an open message the merged
  // list does not show — counted as unread forever. The timer ran out again
  // after every write, and the write went to the open folder under that
  // message's number. (The phone's reader is a screen of its own, opened on
  // the message itself; it has no such state.)
  useEffect(() => {
    if (!openRowListed) return;
    if (!shouldScheduleAutoRead({ openId: selectedId, hasBody: !!message, seen: currentSeen, heldUnread })) return;
    const id = selectedId as string;
    const timer = setTimeout(() => void bulkSetSeen([id], true), AUTO_READ_DELAY_MS);
    return () => clearTimeout(timer);
  }, [message, selectedId, currentSeen, heldUnread, bulkSetSeen, openRowListed]);

  // Make links in the sandboxed viewer clickable: the frame is allow-same-origin
  // but has NO allow-scripts (so the mail HTML still can't run any code), which
  // lets us reach its document from the parent and route anchor clicks to the
  // SYSTEM browser via the opener plugin — a bare target=_blank never opens
  // inside a Tauri WebView. Only safe schemes survive the sanitizer.
  // The message pane is narrower than the column mail is written for, and a
  // table that declares its own cell widths ignores max-width. Same helper the
  // phone uses (P5) — without growHeight, because this frame fills its column
  // and brings its own scroller.
  const fitObserver = useRef<ResizeObserver | null>(null);
  useEffect(() => () => fitObserver.current?.disconnect(), []);

  /**
   * What a link in a message does (M1) — the same answers for the HTML frame
   * and for a plain-text body: a click goes to the system browser, and the
   * link under the pointer or holding the keyboard focus is shown in the bar
   * at the foot of the reading area.
   */
  const openLink = useStableHandler((link: LinkTarget) => {
    // A mail address opens Plainva's composer, from the mailbox the message
    // lies in, as on the phone (open-items plan 3.82). It went to the
    // system's mail program, under that program's sender — or nowhere.
    const draft = mailtoDraft(link.href);
    if (draft) {
      composeMail({ accountId: messageAccountId, to: draft.to, subject: draft.subject, markdown: draft.body });
      return;
    }
    void openUrl(link.href).catch(() => {});
  });
  const linkEvents = useMemo(
    () => ({
      onOpen: openLink,
      onPoint: setPointedLink,
      // A right click on a link: what the phone offers behind a hold.
      onHold: (link: LinkTarget, at: { x: number; y: number }) => setLinkMenu({ link, ...at }),
    }),
    [openLink]
  );
  const detachFrameLinks = useRef<(() => void) | null>(null);
  useEffect(() => () => detachFrameLinks.current?.(), []);

  const handleFrameLoad = useCallback((ev: SyntheticEvent<HTMLIFrameElement>) => {
    const frame = ev.currentTarget;
    const doc = frame.contentDocument;
    if (!doc) return;

    applyFrameFit(frame);
    // Dragging the pane divider changes the width the message has to fit into.
    fitObserver.current?.disconnect();
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(() => applyFrameFit(frame));
      observer.observe(frame);
      fitObserver.current = observer;
    }

    // A new document per message (and per image release): the listeners of
    // the previous one go with it.
    detachFrameLinks.current?.();
    detachFrameLinks.current = attachMailLinks(doc, linkEvents);
  }, [linkEvents]);

  /** The open message's address, for a removal that comes back after a wait. */
  const openIdRef = useRef<string | null>(null);
  useEffect(() => {
    openIdRef.current = selectedId;
  }, [selectedId]);
  const removeFromList = useCallback(
    (id: string) => {
      // Every list it can appear in: the open folder, the merged view, the Sent
      // side of a conversation, and the two result sets — by its address, so a
      // message with the same number elsewhere stays (plan P1).
      patchEverywhere((list) => list.filter((e) => e.id !== id));
      // The reader closes only on THIS message. It closed on any message whose
      // bare number matched — the open reply in Sent went with a moved inbox
      // message of the same number.
      if (openIdRef.current === id) {
        openIdRef.current = null;
        setSelectedId(null);
        setMessage(null);
      }
    },
    [patchEverywhere]
  );

  const bulkMove = useCallback(
    async (ids: string[], target: string) => {
      setMoveMenu(null);
      // What already lies in the target stays where it is: asked of each
      // message's own folder, not of the folder on screen (plan P1).
      const moving = ids.filter((id) => parseUnifiedId(id)?.mailbox !== target);
      if (!vaultPath || !account || moving.length === 0 || actionBusy) return;
      setActionBusy(true);
      try {
        const done = await runBulkAction(moving, { kind: "move", target });
        const moved = done.length;
        for (const id of done) removeFromList(id);
        if (moved) toast.info(
          isGmail
            ? t("mail.gmailLabelsChanged", { n: moved, folder: mailFolderLabel(target, delimiter), defaultValue: "Gmail-Label für {{n}} Nachricht(en) auf {{folder}} geändert" })
            : moved > 1
            ? t("mail.movedN", { n: moved, folder: mailFolderLabel(target, delimiter), defaultValue: "{{n}} nach {{folder}} verschoben" })
            : t("mail.moved", { folder: mailFolderLabel(target, delimiter), defaultValue: "Verschoben nach {{folder}}" })
        );
      } catch (e) {
        toast.error(mailErrorText(e, t));
      } finally {
        setActionBusy(false);
      }
    },
    [vaultPath, account, actionBusy, removeFromList, delimiter, isGmail, t, runBulkAction]
  );

  /**
   * Spam / not spam (S12).
   *
   * Two things happen and only one of them is guaranteed to mean anything: the
   * message moves, and — where the server takes custom keywords — it is marked
   * `$Junk`. The confirmation says which of the two actually happened instead of
   * claiming a filter was trained.
   *
   * With no junk folder at all, Plainva offers to create one rather than moving
   * mail into a name it invented.
   */
  /**
   * Which way Spam goes for these rows: back out of the junk folder when every
   * one of them lies in it, else into it. Asked of the folder each MESSAGE lies
   * in (plan P1): in a conversation, a reply from Sent is reported, not
   * "restored", whatever folder the conversation stands in.
   */
  const junkDirectionOf = useCallback(
    (ids: readonly string[]): "report" | "restore" =>
      ids.length > 0 && ids.every((id) => {
        const at = parseUnifiedId(id);
        return !!at && isJunkFolder(at.mailbox, boxes);
      })
        ? "restore"
        : "report",
    [boxes]
  );

  const bulkJunk = useCallback(
    async (ids: string[]) => {
      // Not before the folders of this account are known: "no junk folder"
      // would be a guess, and the offer to create one a wrong one.
      if (!vaultPath || !account || ids.length === 0 || actionBusy || !foldersAnswered) return;
      const groups = originGroups(ids);
      if (groups.length === 0) return;
      // Same reason as delete: the target folder belongs to ONE account.
      if (groups.some((g) => g.account.id !== account.id)) {
        toast.error(t("mail.junkOneAccount", { defaultValue: "Bitte je Konto getrennt melden." }));
        return;
      }
      // Each folder its own plan: the messages are moved FROM where they lie
      // (open-items plan 3.109 case 1 — Spam on a reply from Sent moved the
      // inbox message with its number into the junk folder, unchecked).
      const plans = groups.map((g) => ({ g, plan: planJunkAction(g.mailbox, boxes) }));
      let created: string | null = null;
      if (plans.some((p) => p.plan.direction === "report" && !p.plan.target)) {
        const ok = await appConfirm({
          title: t("mail.junkNoFolderTitle", { defaultValue: "Kein Spam-Ordner vorhanden" }),
          message: t("mail.junkNoFolderMsg", { defaultValue: "Dieses Konto hat keinen Spam-Ordner. Soll Plainva einen Ordner „Junk“ anlegen?" }),
        });
        if (!ok) return;
        try {
          if (!(await createMailbox(vaultPath, account, "Junk"))) {
            toast.error(t("mail.junkNoFolder", { defaultValue: "Kein Spam-Ordner gefunden." }));
            return;
          }
          created = "Junk";
          // The folder exists now, so the column shows it without a reload —
          // and the next plan finds it by name like any other junk folder.
          setBoxes((prev) => (prev.some((b) => b.name === "Junk") ? prev : [...prev, { name: "Junk", delimiter }]));
        } catch (e) {
          toast.error(mailErrorText(e, t));
          return;
        }
      }
      const runs = plans
        .map(({ g, plan }) => ({ g, report: plan.direction === "report", target: plan.target ?? (plan.direction === "report" ? created : null) }))
        .filter((r): r is { g: typeof r.g; report: boolean; target: string } => !!r.target && r.target !== r.g.mailbox);
      if (runs.length === 0) {
        toast.error(t("mail.junkNoFolder", { defaultValue: "Kein Spam-Ordner gefunden." }));
        return;
      }
      setActionBusy(true);
      try {
        for (const { g, report, target } of runs) {
          const result = await applyJunk(g.uids.map((uid) => ({ mailbox: g.mailbox, uid })), target, report, {
            setJunk: (item, junk) => setMessageJunk(vaultPath, account, item.mailbox, item.uid, junk),
            move: (item, to) => moveMessage(vaultPath, account, item.mailbox, item.uid, to),
          });
          void forgetCachedMessages(dbAdapter, g.account.id, g.mailbox, g.uids);
          for (const uid of g.uids) removeFromList(unifiedId({ accountId: g.account.id, mailbox: g.mailbox, uid }));
          const folder = mailFolderLabel(target, delimiter);
          toast.info(
            report
              ? result.flagged > 0
                ? t("mail.junkReported", { n: result.moved, folder, defaultValue: "{{n}} als Spam markiert und nach {{folder}} verschoben" })
                : t("mail.junkMovedOnly", { n: result.moved, folder, defaultValue: "{{n}} nach {{folder}} verschoben — der Server kennt keine Spam-Markierung" })
              : t("mail.junkCleared", { n: result.moved, folder, defaultValue: "{{n}} nach {{folder}} zurückgeholt" })
          );
        }
      } catch (e) {
        toast.error(mailErrorText(e, t));
      } finally {
        setActionBusy(false);
        clearSel();
      }
    },
    [vaultPath, account, boxes, actionBusy, foldersAnswered, originGroups, removeFromList, delimiter, clearSel, t, dbAdapter]
  );

  const bulkDeleteToTrash = useCallback(
    async (ids: string[]) => {
      // Not before the folders of this account are known — see `bulkJunk`.
      if (!vaultPath || !account || ids.length === 0 || actionBusy || !foldersAnswered) return;
      // The trash folder belongs to ONE account: `boxes` holds the open
      // account's mailboxes, and providers name it differently ("Trash",
      // "Papierkorb", "Deleted Items"). A selection reaching into another
      // account therefore has no resolvable target here — refuse rather than
      // move those messages into a folder name guessed from this account.
      // (Unified mode hides the bulk buttons for the same reason; the reader
      // switches the account before it deletes, so it stays within one.)
      const groups = originGroups(ids);
      const foreign = groups.some((g) => g.account.id !== account.id);
      const trash = pickTrashFolder(boxes);
      // What lies in the trash already is not moved there again; asked of each
      // message's folder, not the one on screen (plan P1).
      const moving = ids.filter((id) => parseUnifiedId(id)?.mailbox !== trash);
      if (foreign || !trash || groups.length === 0 || moving.length === 0) {
        toast.error(t("mail.noTrash", { defaultValue: "Kein Papierkorb-Ordner gefunden." }));
        return;
      }
      const gmailAllMail = isGmail && groups.some((g) => GMAIL_ALL_MAIL.test(g.mailbox));
      const ok = await appConfirm({
        title: t("mail.deleteTitle", { defaultValue: "In den Papierkorb verschieben?" }),
        message: gmailAllMail
          ? t("mail.gmailAllMailDeleteWarning", { defaultValue: "Diese Aktion entfernt die Nachricht in Gmail global aus allen Labels und verschiebt sie in den Papierkorb." })
          : moving.length > 1
            ? t("mail.deleteMsgN", { n: moving.length, defaultValue: "{{n}} Nachrichten werden in den Papierkorb verschoben." })
            : t("mail.deleteMsg", { defaultValue: "Die Nachricht wird in den Papierkorb verschoben." }),
      });
      if (ok) await bulkMove(moving, trash);
    },
    [vaultPath, account, actionBusy, foldersAnswered, boxes, bulkMove, originGroups, isGmail, t]
  );

  const bulkDeleteForever = useCallback(
    async (ids: string[]) => {
      // Only what lies in the trash is removed for good — each message's own
      // folder decides, not the folder on screen (open-items plan 3.137 no. 1).
      if (!inTrash(ids) || !vaultPath || !account || ids.length === 0 || actionBusy) return;
      const ok = await appConfirm({
        title: t("mail.deleteForeverTitle", { defaultValue: "Endgültig löschen?" }),
        message: ids.length > 1
          ? t("mail.deleteForeverMsgN", { n: ids.length, defaultValue: "{{n}} Nachrichten werden unwiderruflich gelöscht." })
          : t("mail.deleteForeverMsg", { defaultValue: "Die Nachricht wird unwiderruflich gelöscht." }),
        kind: "danger",
      });
      if (!ok) return;
      setActionBusy(true);
      try {
        const done = await runBulkAction(ids, { kind: "delete" });
        for (const id of done) removeFromList(id);
        setTotal(n => Math.max(0, n - done.length));
      } catch (e) {
        toast.error(mailErrorText(e, t));
      } finally {
        setActionBusy(false);
      }
    },
    [inTrash, vaultPath, account, actionBusy, removeFromList, t, runBulkAction]
  );
  /**
   * Delete, the one way for the bar, the row menu, the selection and the key:
   * rows that all lie in the trash are removed for good (after asking), any
   * other is moved to the trash.
   */
  const deleteRows = useCallback(
    (ids: string[]) => void (inTrash(ids) ? bulkDeleteForever(ids) : bulkDeleteToTrash(ids)),
    [inTrash, bulkDeleteForever, bulkDeleteToTrash]
  );

  /**
   * The keyboard on the list (2026-09-04): arrows walk the rows and open what
   * they land on, Shift extends the selection the way Shift-click does, Home
   * and End jump, Left/Right fold a conversation, Enter hands the focus to the
   * reader, Delete takes the same path as the toolbar button (with its
   * confirmation). Text fields inside the pane keep their keys.
   */
  const onListKeyDown = useCallback(
    (ev: ReactKeyboardEvent<HTMLDivElement>) => {
      const target = ev.target as HTMLElement;
      if (target.closest("input, textarea, [contenteditable=\"true\"]")) return;
      const action = mailListKeyAction(ev.key, ev.shiftKey);
      if (!action) return;
      const currentId = navId ?? selectedId;
      const current = navRows.find((r) => r.id === currentId) ?? null;
      if (action.type === "move") {
        // Through conversations, not onto them (finding 2026-09-07): a folded
        // one opens and the step lands on its first/last message; the header
        // of an open one is walked over. The flat list has nothing to unfold.
        const step: MailNavStep | null = showThreads ? stepMailRowInto(navRows, currentId, action.move) : (() => {
          const row = stepMailRow(navRows, currentId, action.move);
          return row ? { row } : null;
        })();
        if (!step) return;
        const next = step.row;
        ev.preventDefault();
        if (step.unfold) {
          const key = step.unfold;
          setOpenThreads((prev) => {
            const n = new Set(prev);
            n.add(key);
            return n;
          });
        }
        navFocusRef.current = true;
        setNavId(next.id);
        if (action.extend) {
          // Same anchor semantics as Shift-click; a keyboard-only session
          // anchors at the row it started from.
          if (showThreads) {
            if (!threadAnchorRef.current && current?.threadKey) threadAnchorRef.current = current.threadKey;
            if (next.threadKey) selectThreadRange(next.threadKey);
          } else {
            if (!anchorRef.current && currentId) anchorRef.current = currentId;
            selectRange(next.id, visibleEnvelopes);
          }
          return;
        }
        clearSel();
        if (next.kind === "message") {
          if (showThreads && next.threadKey) threadAnchorRef.current = next.threadKey;
          else anchorRef.current = next.id;
          void openMessage(next.id);
        }
        return;
      }
      if (action.type === "thread") {
        if (!current || !showThreads || !current.threadKey) return;
        const key = current.threadKey;
        ev.preventDefault();
        setOpenThreads((prev) => {
          const n = new Set(prev);
          if (action.open) n.add(key); else n.delete(key);
          return n;
        });
        // Folding from inside a conversation lands on its header.
        if (!action.open && current.kind === "message") {
          navFocusRef.current = true;
          setNavId(threadNavId(key));
        }
        return;
      }
      if (action.type === "open") {
        if (!current) return;
        ev.preventDefault();
        if (current.kind === "thread") {
          setOpenThreads((prev) => {
            const n = new Set(prev);
            if (n.has(current.threadKey)) n.delete(current.threadKey); else n.add(current.threadKey);
            return n;
          });
          return;
        }
        void openMessage(current.id);
        readerRef.current?.focus();
        return;
      }
      ev.preventDefault();
      if (selectedIds.size > 0) deleteRows([...selectedIds]);
      else if (selectedId != null) deleteRows([selectedId]);
    },
    [navId, selectedId, navRows, showThreads, selectThreadRange, selectRange, visibleEnvelopes, clearSel, openMessage, selectedIds, deleteRows],
  );

  const captureNote = useCallback(
    async (withEml: boolean) => {
      // Filed from, and fetched in, the mailbox the MESSAGE lies in — not the
      // one on screen (open-items plan 3.109 case 4): "+ .eml" fetched a reply
      // from Sent under its number in the inbox, another message's source.
      const origin = openOrigin ?? { accountId, mailbox };
      const from = accounts.find((a) => a.id === origin.accountId);
      if (!vaultPath || !vaultAdapter || !from || !message) return;
      try {
        const folder = await mailFolder();
        // OKF 0.2 provenance (plan P3b): a captured mail is a machine-written
        // note and names its producer; the Message-ID becomes its source.
        // Asked for by hand, a note of this message that holds none of its
        // text gets it now (finding 2026-10-09, decision b) - a rule never.
        const res = await captureMailAsNote({ adapter: vaultAdapter, message, accountId: from.id, mailbox: origin.mailbox, folder, generatedBy: await plainvaProducer("mail-capture"), fillEmpty: true, accountAliases: await loadMailAccountAliases(vaultPath).catch(() => ({})) });
        const touched = [res.path];
        // "+ .eml" adds the raw copy to a note filed before as well, where it
        // links none — the phone's rule, one function for both (open-items
        // plan 3.77). It was asked of a NEW note only here.
        const eml = withEml
          ? await addEmlToMailNote({ adapter: vaultAdapter, message, note: res, folder, fetchRaw: () => fetchRawMessage(vaultPath, from, origin.mailbox, message.id) })
          : { emlPath: null, added: false };
        if (eml.emlPath) touched.push(eml.emlPath);
        if (res.created || res.filled || eml.added) {
          if (indexer) await applyIndexChanges(indexer, { added: touched }).catch(() => undefined);
          triggerFileTreeUpdate(touched);
          // An editor that holds the note takes what was written into it: the chain does not report its own writes.
          if (!res.created) window.dispatchEvent(new CustomEvent("plainva-external-update", { detail: { path: res.path } }));
        }
        toast.info(t(mailCaptureNotice(res, eml.added), { name: res.path.split("/").pop() }));
        onOpenPath(res.path, true);
      } catch (e) {
        toast.error(mailErrorText(e, t));
      }
    },
    [vaultPath, vaultAdapter, accounts, accountId, openOrigin, message, mailbox, mailFolder, indexer, triggerFileTreeUpdate, onOpenPath, t]
  );

  /**
   * Saves a received file into the vault — next to where captured mail lands,
   * under the name and by the rule the phone uses (`saveMailAttachment`), so
   * the same file ends up in the same place from either shell. The vault is
   * the storage that syncs; a file saved here is on the other devices too.
   *
   * Asked of the mailbox the MESSAGE lies in: in the merged inbox that is not
   * necessarily the one the folder list shows.
   */
  const [savingFile, setSavingFile] = useState<number | null>(null);
  const saveAttachment = useCallback(
    async (file: MailAttachmentInfo) => {
      const origin = openOrigin ?? { accountId, mailbox };
      const from = accounts.find((a) => a.id === origin.accountId);
      if (!vaultPath || !vaultAdapter || !from || !message || savingFile !== null) return;
      setSavingFile(file.index);
      try {
        const content = await fetchAttachment(vaultPath, from, origin.mailbox, message.id, file.index);
        const path = await saveMailAttachment(vaultAdapter, await mailFolder(), file.name, content);
        if (indexer) await applyIndexChanges(indexer, { added: [path] }).catch(() => undefined);
        triggerFileTreeUpdate([path]);
        toast.success(t("mail.attachmentSaved", { name: path }));
      } catch (e) {
        toast.error(mailErrorText(e, t));
      } finally {
        setSavingFile(null);
      }
    },
    [vaultPath, vaultAdapter, accounts, accountId, mailbox, openOrigin, message, savingFile, mailFolder, indexer, triggerFileTreeUpdate, t]
  );

  const captureTask = useCallback(async () => {
    if (!vaultPath || !vaultAdapter || !account || !message) return;
    try {
      const store = await getSettingsStore();
      const dbPath = (((await store.get<string>(taskDatabaseKey(vaultPath))) ?? "").trim());
      if (!dbPath) {
        toast.info(t("tasks.promoteNoDb", { defaultValue: "Keine Standard-Aufgabendatenbank festgelegt." }));
        return;
      }
      const title = message.subject.trim() || "E-Mail";
      // Shared with the phone and with every other way a task is created
      // (S30). This path used to resolve the target by hand and therefore
      // skipped two things the others do: the database's TEMPLATE, and the
      // checkbox pre-fill the completion model reads. A task born from a mail
      // looked subtly unlike a task born from a checkbox. Its type is the
      // vault's, as there; it was a fixed `Task` (finding 2026-10-21).
      const res = await createTaskInDatabase({
        adapter: vaultAdapter,
        dbPath,
        title,
        noteType: await getConfiguredNoteType(vaultPath),
        templateVault: await templateVaultOf(vaultPath),
        dueDate: mailDayKey(message),
        trailer: message.from ? `\n${t("mail.fromLabel", { defaultValue: "Von" })}: ${message.from}\n` : undefined,
      });
      if (!res.ok) {
        toast.error(
          res.reason === "noFolder"
            ? t("tasks.promoteNoFolder", { defaultValue: "Die Datenbank hat keinen Ablage-Ordner." })
            : t("tasks.promoteNoDb", { defaultValue: "Keine Standard-Aufgabendatenbank festgelegt." }),
        );
        return;
      }
      if (indexer) await applyIndexChanges(indexer, { added: [res.notePath] }).catch(() => undefined);
      triggerFileTreeUpdate([res.notePath]);
      toast.info(t("tasks.promoted", { defaultValue: "Verschoben: {{name}}", name: title }));
      // A task captured from a mail is a task in that database like any other
      // (C4, S16) — it reaches the provider list the same way, or it would
      // depend on WHERE a task was created whether it gets there at all.
      const sent = await sendTaskToProviderList({
        adapter: vaultAdapter,
        dbPath,
        notePath: res.notePath,
        title,
        dueDate: mailDayKey(message),
        pimRuntime,
      });
      if (sent === "createFailed") toast.error(t("tasks.providerCreateFailed"));
      else if (sent === "notAnchored") toast.error(t("tasks.providerAnchorFailed"));
      onOpenPath(res.notePath, true);
    } catch (e) {
      toast.error(mailErrorText(e, t));
    }
  }, [vaultPath, vaultAdapter, account, message, indexer, triggerFileTreeUpdate, onOpenPath, pimRuntime, t]);

  const replyAsNote = useCallback(async () => {
    if (!vaultAdapter || !message) return;
    try {
      // The note names the mailbox the MESSAGE lies in (E6) — in "All
      // inboxes" the row's, not the one on screen.
      const originId = openOrigin?.accountId ?? accountId;
      const path = await writeReplyNote({ files: vaultAdapter, message, folder: await mailFolder(), account: accounts.find((a) => a.id === originId) });
      if (indexer) await applyIndexChanges(indexer, { added: [path] }).catch(() => undefined);
      triggerFileTreeUpdate([path]);
      onOpenPath(path, true);
    } catch (e) {
      toast.error(mailErrorText(e, t));
    }
  }, [vaultAdapter, message, openOrigin, accountId, accounts, mailFolder, indexer, triggerFileTreeUpdate, onOpenPath, t]);

  // Real reply / reply-all: open the compose window (SMTP send), NOT a vault
  // note. Subject "Re: …", recipients from the sender (reply) or sender + the
  // original recipients minus self (reply-all), body = the quoted original.
  const replySubject = useCallback(
    (m: MailMessage) => `Re: ${m.subject.trim().replace(/^(re|aw|antw):\s*/i, "")}`.trim(),
    []
  );
  // The attribution line is built HERE, not in the mail core: the shell is the
  // layer that knows the app language and the reader's date format. It also
  // marks where the quote begins, so the signature lands above it.
  const replyAttribution = useCallback(
    (m: MailMessage) => {
      if (!m.from) return "";
      const date = m.dateTs > 0 ? new Date(m.dateTs).toLocaleString(i18n.language) : "";
      return t("mail.replyAttribution", { date, sender: m.from, defaultValue: "Am {{date}} schrieb {{sender}}:" });
    },
    [t, i18n.language]
  );
  const handleReply = useCallback(() => {
    if (!message) return;
    composeMail({ accountId: messageAccountId, subject: replySubject(message), markdown: buildReplyBody(message, replyAttribution(message)), to: fromAddr(message.from) });
  }, [message, messageAccountId, replySubject, replyAttribution]);
  const handleReplyAll = useCallback(() => {
    if (!message) return;
    composeMail({
      accountId: messageAccountId,
      subject: replySubject(message),
      markdown: buildReplyBody(message, replyAttribution(message)),
      // "Everyone but me" is asked of the same mailbox the reply leaves from.
      to: replyAllRecipients(message, accounts.find((a) => a.id === messageAccountId)?.user ?? ""),
    });
  }, [message, messageAccountId, accounts, replySubject, replyAttribution]);

  const dateFmt = useMemo(() => new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "short" }), [i18n.language]);
  // Compact list time (mockup: "14:32" today, "Di" this week, "9. Jul" older).
  const envTime = useMemo(() => {
    const timeFmt = new Intl.DateTimeFormat(i18n.language, { hour: "2-digit", minute: "2-digit" });
    const dowFmt = new Intl.DateTimeFormat(i18n.language, { weekday: "short" });
    const shortFmt = new Intl.DateTimeFormat(i18n.language, { day: "numeric", month: "short" });
    return (ts: number): string => {
      if (ts <= 0) return "";
      const d = new Date(ts);
      const now = new Date();
      if (d.toDateString() === now.toDateString()) return timeFmt.format(d);
      const days = Math.floor((now.getTime() - d.getTime()) / 86400000);
      return days >= 0 && days < 6 ? dowFmt.format(d) : shortFmt.format(d);
    };
  }, [i18n.language]);

  if (accounts.length === 0) {
    return (
      <div data-testid="mail-view" style={{ flex: 1, minHeight: 0, overflow: "auto", background: "var(--bg-primary)" }}>
        <EmptyState
          title={t("cloudAccounts.noServiceMailTitle")}
          icon={<Mail size={ICON.empty} />}
          action={
            <Button
              variant="primary"
              onClick={() => window.dispatchEvent(new CustomEvent("plainva-open-sync-settings", { detail: { area: "cloudAccounts", connect: "mail" } }))}
              data-testid="mail-open-settings"
            >
              {t("cloudAccounts.openArea")}
            </Button>
          }
        >
          {t("cloudAccounts.noServiceMailBody")}
        </EmptyState>
      </div>
    );
  }

  /**
   * What these rows can do — the ONE list the context menu, the selection bar
   * and the phone's sheet and swipe all read (Design-Runde E2, 2026-09-04).
   *
   * Moving, junk and deleting need a TARGET folder, and every account has its
   * own — a selection spanning accounts ("all inboxes") has no single answer,
   * and guessing one deletes a message in the wrong mailbox. Read/unread and
   * flagged are properties of the message itself, so they work across accounts
   * (P9.3b). Opening is for one row; the menu that opened at a point passes it
   * on to the folder and snooze pickers. Only the CAPABILITIES are built here;
   * the list itself is built inside `RowActionList` (see there for why).
   */
  const capsFor = (ids: string[], opts: { at?: { x: number; y: number }; bar?: boolean }): MailRowCaps => {
    const at = opts.at ?? { x: 0, y: 0 };
    return {
      // Open from the menu follows the message into its folder (P9.3b).
      open: ids.length === 1 && !opts.bar ? () => void openMessage(ids[0], true) : undefined,
      markRead: () => setSeenManually(ids, true),
      markUnread: () => setSeenManually(ids, false),
      flag: () => void bulkSetFlagged(ids, true),
      move: unified ? undefined : (ev?: unknown) => {
        const e = ev as { clientX?: number; clientY?: number } | undefined;
        setMoveMenu({ x: e?.clientX ?? at.x, y: e?.clientY ?? at.y, ids });
      },
      snoozed: showSnoozed,
      snooze: (ev?: unknown) => {
        const e = ev as { clientX?: number; clientY?: number } | undefined;
        setSnoozeMenu({ x: e?.clientX ?? at.x, y: e?.clientY ?? at.y, ids });
      },
      unsnooze: () => void unsnoozeMessages(ids),
      junkDirection: junkDirectionOf(ids),
      junk: unified ? undefined : () => void bulkJunk(ids),
      inTrash: inTrash(ids),
      delete: unified ? undefined : () => deleteRows(ids),
    };
  };

  return (
    <>
    <div
      data-testid="mail-view"
      className="pv-mail"
      ref={gridRef}
      style={{ "--pv-mail-cols": mailGridTemplate(cols) } as CSSProperties}
    >
      {/* Column 1 — accounts + mailboxes */}
      <div className="pv-mail-folders">
        {/* Above the accounts, because it is not a folder OF one (P9.3b, M2). */}
        {accounts.length > 1 && (
          <button
            type="button"
            className={unified ? "pv-mail-folder pv-mail-allinbox on" : "pv-mail-folder pv-mail-allinbox"}
            data-testid="mail-all-inboxes"
            aria-pressed={unified}
            onClick={() => {
              showUnified(!unified);
              // The search and the flagged list ask ONE folder, and their answers
              // still on the way would land in whatever is shown next.
              searchSeq.current++;
              flaggedSeq.current++;
              setSearchBusy(false);
              setFlaggedBusy(false);
              setSearchResults(null);
              setFlaggedResults(null);
              setFilterFlagged(false);
            }}
          >
            <Inbox size={ICON.ui} />
            <span className="pv-mail-folder-label">{t("mail.allInboxes")}</span>
          </button>
        )}
        <div className="pv-mail-acct">
          <span className="pv-mail-av" style={{ "--pv-mail-av": avatarVar(account?.user ?? account?.label ?? "") } as CSSProperties}>
            {avatarInitial(account?.label ?? account?.user ?? "?")}
          </span>
          {accounts.length > 1 ? (
            <div style={{ flex: 1, minWidth: 0 }}>
              <Select
                ariaLabel={t("mail.account", { defaultValue: "Konto" })}
                value={accountId}
                onChange={setAccountId}
                options={accounts.map((a) => ({ value: a.id, label: a.label }))}
              />
            </div>
          ) : (
            <span className="pv-mail-acct-name">{account?.label}</span>
          )}
        </div>
        <button type="button" className="pv-mail-compose" data-testid="mail-compose" onClick={() => composeMail({ accountId, subject: "", markdown: "" })}>
          <Pencil size={ICON.ui} /> {t("mail.newMessage", { defaultValue: "Neue Nachricht" })}
        </button>
        <div className="pv-mail-flist" data-testid="mail-folders">
          {/* Until the folder list is in, no folder is named: "INBOX" stood
              there for a mailbox that need not have one (open-items plan
              3.110 no. 8). Answered with none, the folder that is read is shown. */}
          {(folders.length ? folders : foldersAnswered && mailbox ? [mailbox] : []).map((name) => {
            // A folder of ONE account cannot be "on" while the merged list is.
            const on = !unified && name === mailbox;
            return (
              <button key={name} type="button" data-testid="mail-folder" className={on ? "pv-mail-folder on" : "pv-mail-folder"} onClick={() => { showUnified(false); selectMailbox(name); }} data-tip={name}>
                <FolderGlyph name={name} delimiter={delimiter} />
                <span className="pv-mail-folder-label">{mailFolderLabel(name, delimiter)}</span>
                {on && unseen > 0 && <span className="pv-mail-folder-ct">{unseen}</span>}
              </button>
            );
          })}
        </div>
      </div>

      <div
        aria-hidden
        data-testid="mail-grip-folders"
        className={dragging === "folders" ? "pv-mail-grip on" : "pv-mail-grip"}
        onMouseDown={startColumnResize("folders")}
      />

      {/* Column 2 — message list */}
      <div className="pv-mail-list">
        <div className="pv-mail-listhead">
          {/* The search asks ONE folder on the server; in the merged list it
              would answer a question nobody asked (P9.3b). */}
          {unified ? (
            <span className="pv-mail-search-note">{t("mail.allInboxesNote")}</span>
          ) : (
          <span className="pv-mail-search">
            <Search size={ICON.ui} />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void runSearch(); }}
              placeholder={t("mail.searchPlaceholder", { defaultValue: "In diesem Ordner suchen…" })}
              aria-label={t("mail.searchPlaceholder", { defaultValue: "In diesem Ordner suchen…" })}
              data-testid="mail-search"
            />
            {(searchResults || searchQuery) && (
              <button type="button" className="pv-mail-search-clear" onClick={clearSearch} aria-label={t("mail.clearSearch", { defaultValue: "Suche leeren" })} data-testid="mail-search-clear">
                <X size={ICON.ui} />
              </button>
            )}
          </span>
          )}
          <IconButton label={t("pim.refreshNow", { defaultValue: "Jetzt aktualisieren" })} onClick={() => void (unified ? loadUnified() : loadList(0))} data-testid="mail-refresh">
            <RefreshCw size={ICON.ui} />
          </IconButton>
        </div>
        {selectedIds.size > 0 ? (
          <SelectionBar
            count={selectedIds.size}
            label={t("mail.selectedCount", { n: selectedIds.size, defaultValue: "{{n}} ausgewählt" })}
            clearLabel={t("mail.clearSelection", { defaultValue: "Auswahl aufheben" })}
            onClear={clearSel}
            testId="mail-bulkbar"
            clearTestId="mail-bulk-clear"
          >
            {/* The bar is the row list's bulk subset (Design-Runde E2): the
                same entries the context menu shows, minus the ones that only
                make sense on one row. `rowActionsFor` says which entries a
                cross-account selection loses, and why. */}
            <RowActionList build={(tt) => mailRowActions(tt, capsFor([...selectedIds], { bar: true }))}>
              {(a) => a.bulk ? (
                <Button key={a.id} size="sm" variant="ghost" onClick={a.run} data-testid={`mail-bulk-${a.id}`} icon={<a.icon size={ICON.ui} />}>{a.label}</Button>
              ) : null}
            </RowActionList>
          </SelectionBar>
        ) : (
          <div style={{ display: "flex", gap: 6, padding: "0 var(--space-2) var(--space-2)", alignItems: "center", flexWrap: "wrap" }} data-testid="mail-filters">
            <Button
              size="sm"
              variant={filterUnread ? "primary" : "ghost"}
              aria-pressed={filterUnread}
              aria-label={t("mail.filterUnread", { defaultValue: "Ungelesen" })}
              data-tip={t("mail.filterUnread", { defaultValue: "Ungelesen" })}
              onClick={() => setFilterUnread((v) => !v)}
              data-testid="mail-filter-unread"
              icon={<Mail size={ICON.ui} />}
            >
              {listLabels ? t("mail.filterUnread", { defaultValue: "Ungelesen" }) : null}
            </Button>
            <Button size="sm" variant={filterAttachments ? "primary" : "ghost"} aria-pressed={filterAttachments} aria-label={t("mail.filterAttachments")} data-testid="mail-filter-attachments" icon={<Paperclip size={ICON.ui} />} onClick={() => setFilterAttachments(v => !v)}>{listLabels ? t("mail.filterAttachments") : null}</Button>
            {/* A server query over ONE folder — it has no answer for five (P9.3b). */}
            {!unified && (
              <Button
                size="sm"
                variant={filterFlagged ? "primary" : "ghost"}
                aria-pressed={filterFlagged}
                aria-label={t("mail.filterFlagged", { defaultValue: "Markiert" })}
                data-tip={t("mail.filterFlagged", { defaultValue: "Markiert" })}
                onClick={() => void toggleFlaggedFilter()}
                data-testid="mail-filter-flagged"
                icon={<Star size={ICON.ui} />}
              >
                {listLabels ? t("mail.filterFlagged", { defaultValue: "Markiert" }) : null}
              </Button>
            )}
            {/* Snoozed messages are hidden, not gone — this is how one looks at
                them, and the only place they can be brought back early. */}
            {snoozed.length > 0 && (
              <Button
                size="sm"
                variant={showSnoozed ? "secondary" : "ghost"}
                aria-pressed={showSnoozed}
                aria-label={t("mail.showSnoozed")}
                data-tip={t("mail.showSnoozed")}
                onClick={() => setShowSnoozed((v) => !v)}
                data-testid="mail-filter-snoozed"
                icon={<Clock size={ICON.ui} />}
              >
                {listLabels ? t("mail.showSnoozed") : null}
              </Button>
            )}
            {/* Off is today's behaviour; the choice is remembered per vault. */}
            <Button
              size="sm"
              variant={threadMode ? "primary" : "ghost"}
              aria-pressed={threadMode}
              onClick={() => {
                const next = !threadMode;
                setThreadMode(next);
                setOpenThreads(new Set());
                if (vaultPath) localStorage.setItem(mailThreadsKey(vaultPath), next ? "1" : "0");
              }}
              data-testid="mail-filter-threads"
              aria-label={t("mail.conversations")}
              data-tip={t("mail.conversations")}
              icon={<MessagesSquare size={ICON.ui} />}
            >
              {listLabels ? t("mail.conversations", { defaultValue: "Konversationen" }) : null}
            </Button>
          </div>
        )}
        <MailBulkReport items={bulkReport} busy={bulkRunning} onCancel={() => bulkAbort.current?.abort()} onDismiss={() => setBulkReport([])} />
        {filterAttachments && <Banner kind="info">{t("mail.attachmentsLoaded", { known: displayedEnvelopes.filter(e => e.hasAttachments !== undefined).length, loaded: displayedEnvelopes.length })}</Banner>}
        <div className="pv-mail-scroll" data-testid="mail-list" ref={listRef} role="listbox" aria-multiselectable onKeyDown={onListKeyDown}>
          {(searchBusy || flaggedBusy) && <p className="pv-mail-hint">{t("pim.syncing", { defaultValue: "Aktualisiere…" })}</p>}
          {/* Only in the merged list, as the line below: left while it is still
              being read, the folder shown next is not. */}
          {unified && unifiedBusy && <p className="pv-mail-hint">{t("pim.syncing", { defaultValue: "Aktualisiere…" })}</p>}
          {/* One unreachable account must not empty the list of the others — it
              says which one, and why (P9.3b). */}
          {/* Only in the merged list: which mailbox it could not reach is not a
              word about the folder shown after it. */}
          {unified && unifiedErrors.map((f) => (
            <p key={f.label} className="pv-mail-hint pv-mail-hint--error" data-testid="mail-unified-error">
              {f.label}: {f.message}
            </p>
          ))}
          {/* This banner and the error below belong to the folder behind the
              merged list, not to it: a folder the view followed into does not
              stand in for the list its row was opened from. */}
          {stale && !unified && (
            <p className="pv-mail-hint pv-mail-hint--warn" data-testid="mail-offline">
              {refreshing ? t("mail.cachedRefreshing") : t("mail.offlineCopy")}
            </p>
          )}
          {listError && !unified ? (
            signInState !== "active" ? (
              /* The offer where the absence hurts. The provider's own words stay
                 BELOW the advice: `missing mail credentials` as a headline is
                 what sent the user looking in the wrong place to begin with. */
              <EmptyState
                icon={<Mail size={ICON.empty} />}
                title={
                  signInState === "expired"
                    ? t("deviceSignIn.cardTitleExpired", { account: account?.label ?? "", provider: mailProviderName })
                    : t("deviceSignIn.cardTitle", { account: account?.label ?? "", provider: mailProviderName })
                }
                action={
                  <Button
                    variant="primary"
                    data-testid="mail-signin-offer"
                    onClick={() =>
                      window.dispatchEvent(
                        new CustomEvent("plainva-open-sync-settings", {
                          // The OAuth mailbox lands on ITS cloud account (D2); the IMAP
                          // one on the mail page, whose row holds the password field.
                          detail: { area: mailIsOauth ? "cloudAccounts" : "mail", accountId: mailIsOauth ? account?.id : undefined },
                        })
                      )
                    }
                  >
                    {signInState === "expired"
                      ? t("cloudAccounts.reconnect")
                      : t("deviceSignIn.submit")}
                  </Button>
                }
              >
                <p>{mailIsOauth ? t("deviceSignIn.cardBodyOauth") : t("deviceSignIn.cardBodyStatic")}</p>
                <p className="pv-mail-hint pv-mail-hint--error" data-testid="mail-signin-reason">
                  {listError}
                </p>
              </EmptyState>
            ) : (
              <p className="pv-mail-hint pv-mail-hint--error">{listError}</p>
            )
          ) : unified && unifiedReached === 0 && unifiedErrors.length > 0 ? null : visibleEnvelopes.length === 0 && !listPending && !searchBusy && !flaggedBusy ? (
            <p className="pv-mail-hint">
              {filterUnread && displayedEnvelopes.length > 0
                ? t("mail.noUnread", { defaultValue: "Keine ungelesenen Nachrichten." })
                : searchResults
                  ? t("mail.noSearchResults", { defaultValue: "Keine Treffer in diesem Ordner." })
                  : t("mail.noMessages", { defaultValue: "Keine Nachrichten." })}
            </p>
          ) : showThreads ? (
            rows.map((row) => {
              const single = row.count === 1;
              const open = openThreads.has(row.thread.key);
              const latest = row.latest;
              // A one-message thread IS a message: same row, no affordance that
              // promises something to unfold.
              if (single) {
                const on = latest.id === selectedId;
                const sid = latest.id;
                const sel = selectedIds.has(sid);
                return (
                  <button
                    key={row.thread.key}
                    type="button"
                    role="option"
                    data-testid="mail-envelope"
                    data-nav-id={latest.id}
                    tabIndex={tabFor(latest.id)}
                    aria-selected={sel}
                    className={`pv-mail-env${on ? " on" : ""}${latest.seen ? " read" : ""}`}
                    style={sel ? { background: "var(--accent-container)", color: "var(--on-accent-container)" } : undefined}
                    onClick={(ev) => {
                      if (ev.metaKey || ev.ctrlKey) { ev.preventDefault(); toggleThreadSel([sid]); threadAnchorRef.current = row.thread.key; return; }
                      if (ev.shiftKey) { ev.preventDefault(); selectThreadRange(row.thread.key); return; }
                      clearSel(); threadAnchorRef.current = row.thread.key; void openMessage(latest.id);
                    }}
                    onContextMenu={(ev) => { ev.preventDefault(); setCtxMenu({ id: sid, x: ev.clientX, y: ev.clientY }); }}
                  >
                    <span className="pv-mail-unread" />
                    <span className="pv-mail-ebody">
                      <span className="pv-mail-erow">
                        <span className="pv-mail-from">{fromName(latest.from)}</span>
                        {row.flagged && <Star size={ICON.meta} fill="currentColor" aria-label={t("mail.flagged", { defaultValue: "Markiert" })} />}
                        <span className="pv-mail-when">{envTime(latest.dateTs)}</span>
                      </span>
                      <span className="pv-mail-subj">{latest.subject || t("mail.noSubject", { defaultValue: "(kein Betreff)" })}</span>
                      <span className="pv-mail-prev">{fromAddr(latest.from)}</span>
                    </span>
                  </button>
                );
              }
              const threadIds = row.thread.messages.map((m) => m.id);
              const threadSel = threadIds.length > 0 && threadIds.every((id) => selectedIds.has(id));
              return (
                <div key={row.thread.key} data-testid="mail-thread">
                  <button
                    type="button"
                    role="option"
                    data-testid="mail-thread-row"
                    data-nav-id={threadNavId(row.thread.key)}
                    tabIndex={tabFor(threadNavId(row.thread.key))}
                    aria-expanded={open}
                    aria-selected={threadSel}
                    className={`pv-mail-env${row.unseen ? "" : " read"}`}
                    style={threadSel ? { background: "var(--accent-container)", color: "var(--on-accent-container)" } : undefined}
                    onClick={(ev) => {
                      // Modifier-click acts on the WHOLE conversation — that is
                      // what picking a thread means; plain click still unfolds.
                      if (ev.metaKey || ev.ctrlKey) { ev.preventDefault(); toggleThreadSel(threadIds); threadAnchorRef.current = row.thread.key; return; }
                      if (ev.shiftKey) { ev.preventDefault(); selectThreadRange(row.thread.key); return; }
                      // A plain click is navigation, and navigation clears the
                      // selection everywhere else in this list.
                      clearSel();
                      setNavId(threadNavId(row.thread.key));
                      setOpenThreads((prev) => {
                        const next = new Set(prev);
                        if (next.has(row.thread.key)) next.delete(row.thread.key);
                        else next.add(row.thread.key);
                        return next;
                      });
                    }}
                    onContextMenu={(ev) => { ev.preventDefault(); if (!threadSel) toggleThreadSel(threadIds); setCtxMenu({ id: threadIds[0], x: ev.clientX, y: ev.clientY }); }}
                  >
                    <span className="pv-mail-unread" />
                    <span className="pv-mail-ebody">
                      <span className="pv-mail-erow">
                        <span className="pv-mail-from">{row.participants.join(", ")}</span>
                        <span className="pv-mail-tcount" data-testid="mail-thread-count">{row.count}</span>
                        {row.flagged && <Star size={ICON.meta} fill="currentColor" aria-label={t("mail.flagged", { defaultValue: "Markiert" })} />}
                        <span className="pv-mail-when">{envTime(row.thread.latestTs)}</span>
                      </span>
                      <span className="pv-mail-subj">{row.thread.subject || t("mail.noSubject", { defaultValue: "(kein Betreff)" })}</span>
                      <span className="pv-mail-prev">
                        {open
                          ? t("mail.threadCollapse", { defaultValue: "Konversation zuklappen" })
                          : t("mail.threadExpand", { defaultValue: "Konversation aufklappen" })}
                      </span>
                    </span>
                  </button>
                  {open &&
                    row.thread.messages.map((m) => {
                      const mid = m.id;
                      const msel = selectedIds.has(mid);
                      return (
                      <button
                        key={`${m.mailbox}|${m.id}`}
                        type="button"
                        role="option"
                        data-testid="mail-thread-message"
                        data-nav-id={m.id}
                        tabIndex={tabFor(m.id)}
                        aria-selected={msel}
                        className={`pv-mail-env pv-mail-env--in-thread${m.id === selectedId ? " on" : ""}${m.seen ? " read" : ""}`}
                        style={msel ? { background: "var(--accent-container)", color: "var(--on-accent-container)" } : undefined}
                        onClick={(ev) => {
                          if (ev.metaKey || ev.ctrlKey) { ev.preventDefault(); toggleThreadSel([mid]); return; }
                          clearSel(); void openMessage(m.id);
                        }}
                        onContextMenu={(ev) => { ev.preventDefault(); setCtxMenu({ id: mid, x: ev.clientX, y: ev.clientY }); }}
                      >
                        <span className="pv-mail-unread" />
                        <span className="pv-mail-ebody">
                          <span className="pv-mail-erow">
                            <span className="pv-mail-from">{fromName(m.from)}</span>
                            {/* Where this message lives — only worth saying when
                                it is not the folder on screen. */}
                            {m.mailbox && m.mailbox !== mailbox && (
                              <span className="pv-mail-tbox" data-testid="mail-thread-folder">
                                {mailFolderLabel(m.mailbox, delimiter)}
                              </span>
                            )}
                            <span className="pv-mail-when">{envTime(m.dateTs)}</span>
                          </span>
                          <span className="pv-mail-prev">{m.preview || fromAddr(m.from)}</span>
                        </span>
                      </button>
                      );
                    })}
                </div>
              );
            })
          ) : (
            visibleEnvelopes.map((e) => {
              const on = e.id === selectedId;
              const sel = selectedIds.has(e.id);
              return (
                <button
                  key={e.id}
                  type="button"
                  role="option"
                  data-testid="mail-envelope"
                  data-nav-id={e.id}
                  tabIndex={tabFor(e.id)}
                  className={`pv-mail-env${on ? " on" : ""}${e.seen ? " read" : ""}`}
                  aria-selected={sel}
                  style={sel ? { background: "var(--accent-container)", color: "var(--on-accent-container)" } : undefined}
                  onClick={(ev) => {
                    if (ev.metaKey || ev.ctrlKey) { ev.preventDefault(); toggleSel(e.id); anchorRef.current = e.id; return; }
                    if (ev.shiftKey) { ev.preventDefault(); selectRange(e.id, visibleEnvelopes); return; }
                    clearSel(); anchorRef.current = e.id; void openMessage(e.id);
                  }}
                  onContextMenu={(ev) => { ev.preventDefault(); setCtxMenu({ id: e.id, x: ev.clientX, y: ev.clientY }); }}
                >
                  <span className="pv-mail-unread" />
                  <span className="pv-mail-ebody">
                    <span className="pv-mail-erow">
                      <span className="pv-mail-from">{fromName(e.from)}</span>
                      {e.flagged && <Star size={ICON.meta} fill="currentColor" aria-label={t("mail.flagged", { defaultValue: "Markiert" })} />}
                      <span className="pv-mail-when">{envTime(e.dateTs)}</span>
                    </span>
                    <span className="pv-mail-subj">{e.subject || t("mail.noSubject", { defaultValue: "(kein Betreff)" })}</span>
                    <span className="pv-mail-prev">
                      {/* In the merged list the row must say whose mailbox it is
                          in — otherwise five inboxes read as one (P9.3b). */}
                      {unified && <span className="pv-mail-tbox">{accountLabel(e.id)}</span>}
                      {fromAddr(e.from)}
                    </span>
                  </span>
                </button>
              );
            })
          )}
          {!unified && !searchResults && envelopes.length < total && (
            <div style={{ padding: "var(--space-2)" }}>
              <Button variant="ghost" disabled={loadingList} onClick={() => void loadList(envelopes.length)}>
                {t("mail.loadMore", { defaultValue: "Mehr laden" })}
              </Button>
            </div>
          )}
        </div>
      </div>

      <div
        aria-hidden
        data-testid="mail-grip-list"
        className={dragging === "list" ? "pv-mail-grip on" : "pv-mail-grip"}
        onMouseDown={startColumnResize("list")}
      />

      {/* Column 3 — reader */}
      <div className="pv-mail-read pv-focus-frame" ref={readerRef} tabIndex={-1}>
        {!message ? (
          <div className="pv-mail-empty">
            {loadingMessage ? t("pim.syncing", { defaultValue: "Aktualisiere…" }) : t("mail.pickMessage", { defaultValue: "Nachricht auswählen." })}
          </div>
        ) : (
          <>
            <div className="pv-mail-rhead">
              <h3 className="pv-mail-rsubj" data-testid="mail-subject">
                {message.subject || t("mail.noSubject", { defaultValue: "(kein Betreff)" })}
              </h3>
              <div className="pv-mail-rfrom">
                <span className="pv-mail-av pv-mail-av--round" style={{ "--pv-mail-av": avatarVar(fromName(message.from)) } as CSSProperties}>
                  {avatarInitial(fromName(message.from))}
                </span>
                <div className="pv-mail-who">
                  <div className="pv-mail-who-name">{fromName(message.from)}</div>
                  <div className="pv-mail-who-addr">
                    {fromAddr(message.from)}
                    {message.to ? ` → ${fromAddr(message.to)}` : ""}
                  </div>
                </div>
                {message.dateTs > 0 && <div className="pv-mail-rdate">{dateFmt.format(new Date(message.dateTs))}</div>}
              </div>
            </div>

            {/* Mail-action toolbar: real reply / reply-all / forward + mailbox actions */}
            <div className="pv-mail-toolbar">
              <Button variant="primary" size="sm" onClick={handleReply} data-testid="mail-reply" icon={<Reply size={ICON.ui} />}>
                {t("mail.reply", { defaultValue: "Antworten" })}
              </Button>
              <Button variant="secondary" size="sm" onClick={handleReplyAll} data-testid="mail-reply-all" icon={<ReplyAll size={ICON.ui} />}>
                {t("mail.replyAll", { defaultValue: "Allen antworten" })}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() =>
                  composeMail({
                    accountId: messageAccountId,
                    subject: `Fwd: ${message.subject.trim().replace(/^(fwd|wg):\s*/i, "")}`.trim(),
                    markdown: buildForwardBody(message),
                    // The files of the original come along by reference: the
                    // composer loads them from the mailbox the message lies in.
                    forward: forwardSource(messageAccountId, openOrigin?.mailbox ?? mailbox, message),
                  })
                }
                data-testid="mail-forward"
                icon={<Forward size={ICON.ui} />}
              >
                {t("mail.forward", { defaultValue: "Weiterleiten" })}
              </Button>
              {/* Unsubscribing (S23): offered only when the SENDER declared a
                  route in `List-Unsubscribe`. Plainva never guesses one from
                  the body, and it never performs it silently — what follows is
                  a page in the browser or a message the reader sees first. */}
              {unsubRoute && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void unsubscribeNow()}
                  data-testid="mail-unsubscribe"
                  icon={<BellOff size={ICON.ui} />}
                >
                  {t("mail.unsubscribe")}
                </Button>
              )}
              <span className="pv-mail-toolbar-spacer" />
              <IconButton
                label={currentSeen ? t("mail.markUnread", { defaultValue: "Als ungelesen markieren" }) : t("mail.markRead", { defaultValue: "Als gelesen markieren" })}
                onClick={() => void markSeen(!currentSeen)}
                disabled={actionBusy}
                data-testid="mail-mark-seen"
              >
                {currentSeen ? <Mail size={ICON.ui} /> : <MailOpen size={ICON.ui} />}
              </IconButton>
              <IconButton
                label={currentFlagged ? t("mail.unflag", { defaultValue: "Markierung entfernen" }) : t("mail.flag", { defaultValue: "Markieren" })}
                onClick={() => selectedId != null && void bulkSetFlagged([selectedId], !currentFlagged)}
                disabled={actionBusy}
                data-testid="mail-flag"
              >
                <Star size={ICON.ui} fill={currentFlagged ? "currentColor" : "none"} />
              </IconButton>
              {/* These three go to a folder of the account, so they wait for its
                  folder list (`foldersAnswered`). */}
              <IconButton
                label={t("mail.moveTo", { defaultValue: "Verschieben nach…" })}
                onClick={(ev) => selectedId != null && setMoveMenu({ x: ev.clientX, y: ev.clientY, ids: [selectedId] })}
                disabled={actionBusy || !foldersAnswered}
                data-testid="mail-move"
              >
                <FolderInput size={ICON.ui} />
              </IconButton>
              <IconButton
                label={selectedId != null && junkDirectionOf([selectedId]) === "restore" ? t("mail.notJunk", { defaultValue: "Kein Spam" }) : t("mail.reportJunk", { defaultValue: "Spam" })}
                onClick={() => selectedId != null && void bulkJunk([selectedId])}
                disabled={actionBusy || !foldersAnswered}
                data-testid="mail-junk"
              >
                <Ban size={ICON.ui} />
              </IconButton>
              <IconButton label={openInTrash ? t("mail.deleteForever", { defaultValue: "Endgültig löschen" }) : t("mail.delete", { defaultValue: "Löschen" })} onClick={() => selectedId != null && deleteRows([selectedId])} disabled={actionBusy || !foldersAnswered} data-testid="mail-delete">
                <Trash2 size={ICON.ui} />
              </IconButton>
            </div>

            {/* A received file is saved into the vault, as the phone does it
                (finding 2026-10-09: until then the desktop listed attachments
                as text and could do nothing with them). */}
            {message.attachments.length > 0 && (
              <div className="pv-mail-attach">
                {message.attachments.map((a) => (
                  <Button
                    key={a.index}
                    variant="secondary"
                    size="sm"
                    icon={<Paperclip size={ICON.ui} />}
                    disabled={savingFile !== null}
                    onClick={() => void saveAttachment(a)}
                    data-tip={t("mail.attachmentSave")}
                    data-testid="mail-attachment"
                  >
                    {a.name} ({formatAttachmentSize(a.size, i18n.language)})
                  </Button>
                ))}
              </div>
            )}
            {sanitized && sanitized.blockedRemote > 0 && (
              <div className="pv-mail-blocked" data-testid="mail-blocked-hint" data-junk={remoteImages.blockedAsJunk ? "" : undefined}>
                <ShieldOff size={ICON.meta} />
                {/* In the junk folder the hint names the REASON (M2): "always
                    load" is on, and still nothing loaded — without the reason
                    that reads as a setting that does not work. */}
                <span>
                  {remoteImages.blockedAsJunk
                    ? t("mail.remoteBlockedJunk", { n: sanitized.blockedRemote })
                    : t("mail.remoteBlocked", { defaultValue: "Externe Inhalte blockiert ({{n}})", n: sanitized.blockedRemote })}
                </span>
                {!allowRemote && (
                  <button type="button" onClick={() => setShowRemoteOnce(true)} data-testid="mail-show-images">
                    {remoteImages.blockedAsJunk ? t("mail.showImagesOnce") : t("mail.showImages", { defaultValue: "Bilder anzeigen" })}
                  </button>
                )}
              </div>
            )}

            <div className="pv-mail-bodywrap">
            <div className={`pv-mail-body${sanitized ? " pv-mail-body--frame" : ""}`}>
              {sanitized ? (
                <iframe
                  title={t("mail.viewer", { defaultValue: "E-Mail-Inhalt" })}
                  // allow-same-origin WITHOUT allow-scripts: the mail HTML still
                  // cannot run any code (no scripts, no forms, no remote content),
                  // but the parent can reach the document to route link clicks to
                  // the system browser (handleFrameLoad).
                  sandbox="allow-same-origin"
                  onLoad={handleFrameLoad}
                  srcDoc={buildMailFrameDoc(sanitized.html, { allowRemoteImages: allowRemote, canvas: mailCanvas })}
                  data-testid="mail-frame"
                  className="pv-mail-frame"
                />
              ) : (
                <MailPlainText text={message.text ?? ""} events={linkEvents} data-testid="mail-text" />
              )}
            </div>
            {/* Where the link leads — bottom-left of the message, where every
                browser shows it; not the app's status bar (decision E5). */}
            {pointedLink && (
              <div
                className="pv-mail-linkbar"
                data-testid="mail-link-target"
                data-warn={pointedLink.textHost ? "" : undefined}
                role="status"
              >
                {pointedLink.textHost ? <TriangleAlert size={ICON.meta} aria-hidden /> : <Link2 size={ICON.meta} aria-hidden />}
                <LinkTargetText link={pointedLink} />
              </div>
            )}
            </div>

            {/* Vault-capture bar — Plainva's differentiator over any mail client */}
            <div className="pv-mail-capbar">
              <span className="pv-mail-capbar-label">{t("mail.intoVault", { defaultValue: "In den Vault" })}</span>
              <button type="button" className="pv-mail-capchip" onClick={() => void captureNote(false)} data-testid="mail-capture-note">
                <FilePlus2 size={ICON.ui} /> {t("mail.captureNote", { defaultValue: "Als Notiz ablegen" })}
              </button>
              <button type="button" className="pv-mail-capchip" onClick={() => void captureTask()} data-testid="mail-capture-task">
                <ListChecks size={ICON.ui} /> {t("mail.captureTask", { defaultValue: "→ Aufgabe" })}
              </button>
              <button type="button" className="pv-mail-capchip" onClick={() => void captureNote(true)} data-testid="mail-capture-eml">
                <FileText size={ICON.ui} /> {t("mail.captureWithEml", { defaultValue: "+ .eml" })}
              </button>
              <button type="button" className="pv-mail-capchip" onClick={() => void replyAsNote()} data-testid="mail-reply-note">
                <Reply size={ICON.ui} /> {t("mail.replyNote", { defaultValue: "Antwort als Notiz" })}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
    {moveMenu && (
      <MenuSurface open at={{ x: moveMenu.x, y: moveMenu.y }} onClose={() => setMoveMenu(null)} ariaLabel={t("mail.moveTo", { defaultValue: "Verschieben nach…" })}>
        {/* Every folder but the one ALL these messages already lie in — theirs,
            not the one on screen (plan P1). */}
        {folders.filter((f) => !moveMenu.ids.every((id) => parseUnifiedId(id)?.mailbox === f)).map((f) => (
          <MenuItem key={f} onClick={() => void bulkMove(moveMenu.ids, f)}>
            {mailFolderLabel(f, delimiter)}
          </MenuItem>
        ))}
      </MenuSurface>
    )}
    {linkMenu && (
      <MenuSurface open at={{ x: linkMenu.x, y: linkMenu.y }} onClose={() => setLinkMenu(null)} ariaLabel={`${linkMenu.link.before}${linkMenu.link.host}${linkMenu.link.after}`}>
        <MenuItem
          icon={linkMenu.link.kind === "mailto" ? <PenLine size={ICON.ui} /> : <ExternalLink size={ICON.ui} />}
          data-testid="mail-link-open"
          onSelect={() => openLink(linkMenu.link)}
        >
          {linkMenu.link.kind === "web" ? t("mail.linkOpenBrowser") : linkMenu.link.kind === "mailto" ? t("mail.newMessage") : t("mail.linkOpen")}
        </MenuItem>
        <MenuItem
          icon={<Copy size={ICON.ui} />}
          data-testid="mail-link-copy"
          onSelect={() => void navigator.clipboard.writeText(linkMenu.link.href).then(() => toast.success(t("mail.linkCopied")))}
        >
          {t("mail.linkCopy")}
        </MenuItem>
      </MenuSurface>
    )}
    {snoozeMenu && (
      <MenuSurface open at={{ x: snoozeMenu.x, y: snoozeMenu.y }} onClose={() => setSnoozeMenu(null)} ariaLabel={t("mail.snooze")}>
        <MenuLabel>{t("mail.snooze")}</MenuLabel>
        {SNOOZE_PRESETS.map((p) => (
          <MenuItem key={p} data-testid={`mail-snooze-${p}`} onSelect={() => void snoozeMessages(snoozeMenu.ids, p)}>
            {t(`mail.snooze_${p}`)}
          </MenuItem>
        ))}
      </MenuSurface>
    )}
    {ctxMenu && (
      <MenuSurface open at={{ x: ctxMenu.x, y: ctxMenu.y }} onClose={() => setCtxMenu(null)} ariaLabel={t("mail.listActions", { defaultValue: "Nachrichtenaktionen" })}>
        {ctxIds.length > 1 && <MenuLabel>{t("mail.selectedCount", { n: ctxIds.length, defaultValue: "{{n}} ausgewählt" })}</MenuLabel>}
        {/* One list for the menu, the bar and the phone's sheet (Design-Runde
            E2); the separator before the destructive tail is the list's own
            `danger` flag, not a second opinion about the order. */}
        <RowActionList build={(tt) => mailRowActions(tt, capsFor(ctxIds, { at: { x: ctxMenu.x, y: ctxMenu.y } }))}>
          {(a, i, all) => (
            <Fragment key={a.id}>
              {a.danger && !all[i - 1]?.danger && <MenuSeparator />}
              <MenuItem icon={<a.icon size={ICON.ui} />} danger={a.danger} data-testid={`mail-ctx-${a.id}`} onSelect={a.run}>
                {a.label}
              </MenuItem>
            </Fragment>
          )}
        </RowActionList>
      </MenuSurface>
    )}
    </>
  );
}
