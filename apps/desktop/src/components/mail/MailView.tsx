import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactElement, type SyntheticEvent } from "react";
import { useTranslation } from "react-i18next";
import { Archive, Ban, BellOff, Clock, FilePlus2, FileText, Folder, FolderInput, Forward, Inbox, ListChecks, Mail, MailOpen, MessagesSquare, Paperclip, Pencil, RefreshCw, Reply, ReplyAll, Search, Send, ShieldOff, Star, Trash2, X } from "lucide-react";
import { Button, EmptyState, ICON, IconButton, MenuItem, MenuLabel, MenuSeparator, MenuSurface, SelectionBar, plainvaProducer, toast } from "@plainva/ui";
import { openUrl } from "@tauri-apps/plugin-opener";
import "./mail.css";
import { useVault, mailFolderKey, DEFAULT_MAIL_FOLDER, mailRemoteImagesKey, taskDatabaseKey } from "../../contexts/VaultContext";
import { mailSnoozedKey } from "../../services/settingsProfile";
import {
  parseUnsubscribe,
  preferredRoute,
  addSnooze,
  filterSnoozed,
  parseSnoozeState,
  pruneSnoozes,
  removeSnooze,
  SNOOZE_PRESETS,
  snoozeUntil,
  type SnoozeEntry,
  type SnoozePreset, mailErrorText } from "@plainva/ui/mail";
import { getSettingsStore } from "../../services/settingsStore";
import { activeDocument } from "../../services/activeDocument";
import { MAIL_TAB_PATH } from "../graph/virtualPaths";
import { applyIndexChanges } from "../../services/fileActions";
import { Select } from "../Select";
import { listMailAccounts, mailAccountKind, releaseMailSessions, type MailAccountConfig } from "@plainva/ui/mail";
import { accountRowState, deviceSignInState, type DeviceSignInState } from "../../services/deviceSignIn";
import { cacheEnvelopes, cachedEnvelopes, cacheMessage, cachedMessage, forgetCachedMessages, listEnvelopes, listMailboxesFor, fetchMessage, fetchRawMessage, setMessageSeen, setMessageFlagged, deleteMessagePermanently, listFlaggedEnvelopes, moveMessage, setMessageJunk, createMailbox, searchEnvelopes, type MailEnvelope, type MailMessage, type MailboxInfo } from "@plainva/ui/mail";
import { sanitizeEmailHtml, buildMailFrameDoc, applyFrameFit } from "@plainva/ui/mail";
import { captureMailAsNote, saveEmlFile, mailDayKey, mailNoteStem } from "@plainva/ui/mail";
import { AUTO_READ_DELAY_MS, applyManualSeen, retainOnlyOpen, shouldScheduleAutoRead } from "@plainva/ui/mail";
import { buildReplyNoteContent, buildReplyBody, replyAllRecipients, buildForwardBody, classifyFolderRole, applyJunk, planJunkAction, pickJunkFolder, listMailRules, runRules, mailFolderLabel, sortMailFolders, pickInboxFolder, pickSentFolder, pickTrashFolder, threadRows, groupByOrigin, mergeInboxes, parseUnifiedId, unifiedId } from "@plainva/ui/mail";
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
import { sendTaskToProviderList } from "../../services/pim/taskToProvider";
import { MailDraftModal } from "./MailDraftModal";

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

// ---- Display helpers (mockup section 05: designed list + reader) ----

/** Stable palette color for a sender/account avatar, from --palette-1..10. */
function avatarVar(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return `var(--palette-${(h % 10) + 1})`;
}

/** "Name <addr>" -> the display name (or the whole string when unnamed). */
function fromName(from: string): string {
  const m = from.match(/^\s*"?([^"<]+?)"?\s*<[^>]*>\s*$/);
  return (m ? m[1] : from).trim() || from;
}

/** "Name <addr>" -> just the address (or the whole string when bare). */
function fromAddr(from: string): string {
  const m = from.match(/<([^>]+)>/);
  return (m ? m[1] : from).trim();
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

export function MailView({ onOpenPath, isActivePane = true }: MailViewProps) {
  const { t, i18n } = useTranslation();
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
  const selectMailbox = useCallback((name: string) => setMailboxSel({ accountId, name }), [accountId]);
  /** The account's mailboxes in display order (with their backend role). */
  const [boxes, setBoxes] = useState<MailboxInfo[]>([]);
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
  const [compose, setCompose] = useState<{ subject: string; markdown: string; to?: string } | null>(null);
  const [envelopes, setEnvelopes] = useState<MailEnvelope[]>([]);
  const envelopesRef = useRef<MailEnvelope[]>([]);
  useEffect(() => { envelopesRef.current = envelopes; }, [envelopes]);
  const [total, setTotal] = useState(0);
  const [unseen, setUnseen] = useState(0);
  const [loadingList, setLoadingList] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  // Showing the cached copy because the refresh failed (offline / throttled).
  const [stale, setStale] = useState(false);
  // A network refresh is in flight WHILE a cached page is already on screen —
  // the banner then says "updating", not "offline" (F4a): the cache is shown
  // first now, so "offline" would be a false claim in the normal case.
  const [refreshing, setRefreshing] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [message, setMessage] = useState<MailMessage | null>(null);
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
  /** Messages put aside (S22) — from the profile, so both devices agree. */
  const [snoozed, setSnoozed] = useState<SnoozeEntry[]>([]);
  const [showSnoozed, setShowSnoozed] = useState(false);
  const [snoozeMenu, setSnoozeMenu] = useState<{ x: number; y: number; ids: string[] } | null>(null);
  const [filterFlagged, setFilterFlagged] = useState(false);
  const [flaggedResults, setFlaggedResults] = useState<MailEnvelope[] | null>(null);
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
  const mailIsOauth = account ? mailAccountKind(account) === "microsoft" : false;
  const mailProviderName = account ? (mailIsOauth ? "Microsoft" : account.host) : "";

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
    return () => {
      alive = false;
    };
  }, [vaultPath, persistSnoozes]);

  const snoozeMessages = useCallback(
    async (ids: string[], preset: SnoozePreset) => {
      if (!account || ids.length === 0) return;
      const until = snoozeUntil(preset, new Date());
      let next: SnoozeEntry[] = snoozed;
      for (const id of ids) next = addSnooze(next, { account: account.id, id, folder: mailbox, until });
      setSnoozed(next);
      setSnoozeMenu(null);
      await persistSnoozes(next);
      toast.info(
        t("mail.snoozedUntil", {
          when: new Date(until).toLocaleString(i18n.language, { dateStyle: "short", timeStyle: "short" }),
        })
      );
    },
    [account, mailbox, snoozed, persistSnoozes, t, i18n.language]
  );

  const unsnoozeMessages = useCallback(
    async (ids: string[]) => {
      if (!account) return;
      let next: SnoozeEntry[] = snoozed;
      for (const id of ids) next = removeSnooze(next, account.id, id);
      setSnoozed(next);
      await persistSnoozes(next);
    },
    [account, snoozed, persistSnoozes]
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
  useEffect(() => {
    if (!isActivePane) return;
    let info = `${mailFolderLabel(mailbox, delimiter)} · ${total} ${t("mail.messagesLabel", { defaultValue: "Nachrichten" })}`;
    if (unseen > 0) info += ` · ${unseen} ${t("mail.unreadLabel", { defaultValue: "ungelesen" })}`;
    activeDocument.set({ path: MAIL_TAB_PATH, content: "", kind: "virtual", meta: { info } });
  }, [isActivePane, mailbox, delimiter, total, unseen, t]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      if (!vaultPath) return;
      const list = await listMailAccounts(vaultPath);
      if (!alive) return;
      setAccounts(list);
      setAccountId((prev) => (list.some((a) => a.id === prev) ? prev : list[0]?.id ?? ""));
    })();
    return () => {
      alive = false;
    };
  }, [vaultPath]);

  // Folder column (mail-client E1): the account's mailboxes, inbox first. The
  // read-only login command already returns the mailbox list, so this needs no
  // new Rust. The mailbox stays EMPTY until the list arrives — assuming the
  // IMAP name "INBOX" made Graph fail on localized mailboxes ("Posteingang").
  useEffect(() => {
    let alive = true;
    setBoxes([]);
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
        setMailboxSel((prev) =>
          prev.accountId === forAccount && order.includes(prev.name)
            ? prev
            : { accountId: forAccount, name: pickInboxFolder(sorted) ?? "INBOX" }
        );
      })
      .catch(() => {
        // Fall back to the IMAP default so the envelope list still loads.
        if (alive) setMailboxSel({ accountId: forAccount, name: "INBOX" });
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
      const fresh = messages.filter((m) => !seenByRules.current.has(m.id));
      for (const m of fresh) seenByRules.current.add(m.id);
      if (fresh.length === 0) return;

      const trash = pickTrashFolder(boxes);
      const junkBox = pickJunkFolder(boxes);
      const result = await runRules(rules, fresh.map((m) => ({ id: m.id, from: m.from, subject: m.subject })), {
        moveTo: (id, target) => moveMessage(vaultPath, account, box, id, target),
        markRead: (id) => setMessageSeen(vaultPath, account, box, id, true),
        flag: (id) => setMessageFlagged(vaultPath, account, box, id, true),
        // Without a junk or trash folder there is nowhere to put it — refusing
        // beats moving mail into a folder name Plainva invented.
        junk: (id) => (junkBox ? moveMessage(vaultPath, account, box, id, junkBox) : Promise.reject(new Error("no junk folder"))),
        trash: (id) => (trash ? moveMessage(vaultPath, account, box, id, trash) : Promise.reject(new Error("no trash folder"))),
        // Filing needs the BODY, which an envelope does not carry — so the
        // message is fetched, and only for the ones a rule actually matched.
        capture: vaultAdapter
          ? async (id) => {
              const msg = await fetchMessage(vaultPath, account, box, id);
              await captureMailAsNote({ adapter: vaultAdapter, message: msg, accountId: account.id, mailbox: box, folder: await mailFolder(), generatedBy: await plainvaProducer("mail-capture") });
            }
          : undefined,
      });
      if (result.removed.length > 0) {
        setEnvelopes((prev) => prev.filter((m) => !result.removed.includes(m.id)));
      }
      if (result.acted.length > 0) {
        toast.info(t("rules.appliedN", { n: result.acted.length, defaultValue: "{{n}} Nachricht(en) durch Regeln bearbeitet" }));
      }
    },
    [vaultPath, account, boxes, vaultAdapter, mailFolder, t]
  );

  const loadList = useCallback(
    async (offset: number) => {
      // No mailbox yet = the folder list is still loading; opening a guessed
      // name would fail on backends that localize their folders (Graph).
      if (!vaultPath || !account || !mailbox) return;
      const seq = ++listSeq.current;
      const current = (): boolean => seq === listSeq.current;
      setLoadingList(true);
      setListError(null);
      // Cache FIRST, network second (report 2026-07-29 F4a). The last page of a
      // folder you have opened before is on this device; waiting for the full
      // roundtrip before showing anything was the single biggest part of "mail
      // feels slow". The banner keeps saying it is not confirmed until the
      // refresh lands, so this shows the copy without CLAIMING freshness.
      if (offset === 0) {
        const warm = await cachedEnvelopes(dbAdapter, account.id, mailbox, PAGE_SIZE);
        if (!current()) return;
        if (warm.length > 0) {
          setEnvelopes(warm);
          setTotal(warm.length);
          setStale(true);
          // The list is on screen; the refresh below is no longer a wait.
          setLoadingList(false);
          setRefreshing(true);
        }
      }
      try {
        const beforeId = offset > 0 ? envelopesRef.current[envelopesRef.current.length - 1]?.id : undefined;
        const page = await listEnvelopes(vaultPath, account, mailbox, offset, PAGE_SIZE, beforeId);
        if (!current()) return; // a newer account/mailbox took over
        setTotal(page.total);
        setUnseen(page.unseen);
        setEnvelopes((prev) => (offset === 0 ? page.messages : [...prev, ...page.messages]));
        setStale(false);
        // The first page IS the newest window of this folder, so it may also
        // drop what the server no longer lists. A "load more" says nothing
        // about the top of the folder and stays purely additive.
        void cacheEnvelopes(dbAdapter, account.id, mailbox, page.messages, { newestPage: offset === 0 });
        // Local rules run over what was just fetched (S14). Only over messages
        // this device has not seen before, so a refresh does not re-file mail
        // the user has since moved by hand.
        void applyLocalRules(page.messages, mailbox);
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
        const cached = offset === 0 ? await cachedEnvelopes(dbAdapter, account.id, mailbox, PAGE_SIZE) : [];
        if (!current()) return;
        if (cached.length > 0) {
          setEnvelopes(cached);
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
    },
    [vaultPath, account, mailbox, dbAdapter, applyLocalRules]
  );

  useEffect(() => {
    setEnvelopes([]);
    setSelectedId(null);
    setMessage(null);
    // Drop the search AND the selection when the account/mailbox changes: IMAP
    // UIDs are folder-local, so a stale id set would highlight unrelated mails
    // in the new folder (and a Graph id set would just come up empty).
    setSearchResults(null);
    setFlaggedResults(null);
    setFilterFlagged(false);
    setSearchQuery("");
    setSelectedIds(new Set());
    setCtxMenu(null);
    if (account) void loadList(0);
  }, [account, loadList]);

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
        if (alive) setSentEnvelopes(page.messages);
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
     * `from` names the folder the message actually lives in. In conversation
     * mode a thread mixes folders (a reply of yours is in Sent), and an IMAP uid
     * is folder-LOCAL: fetching it against the wrong mailbox would open a
     * different message, or none. Defaults to the open folder, so every existing
     * caller keeps its behaviour.
     */
    async (uid: string, from?: string) => {
      if (!vaultPath) return;
      /**
       * In the merged list the id IS the address (P9.3b). Opening a row from
       * another account switches the active account and folder to it, so
       * replying, moving, trashing and capturing afterwards all act on the right
       * mailbox — with no second code path for any of them.
       */
      const origin = parseUnifiedId(uid);
      const acct = origin ? accounts.find((a) => a.id === origin.accountId) ?? null : account;
      if (!acct) return;
      const box = origin ? origin.mailbox : from ?? mailbox;
      const rowId = uid;
      if (origin) {
        uid = origin.uid;
        if (acct.id !== accountId) setAccountId(acct.id);
        if (box !== mailbox || acct.id !== accountId) setMailboxSel({ accountId: acct.id, name: box });
      }
      const seq = ++msgSeq.current;
      const current = (): boolean => seq === msgSeq.current;
      setSelectedId(rowId);
      setLoadingMessage(true);
      setMessage(null);
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
    [vaultPath, account, mailbox, dbAdapter, t]
  );

  const allowRemote = remoteOptIn || showRemoteOnce;
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
  const loadUnified = useCallback(async () => {
    if (!vaultPath || accounts.length === 0) return;
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
        pages.push(page.messages.map((e) => ({ ...e, id: unifiedId({ accountId: acct.id, mailbox: box, uid: e.id }) })));
      } catch (e) {
        failures.push({ label: acct.label, message: mailErrorText(e, t) });
      }
    }
    setUnifiedEnvelopes(mergeInboxes(pages, PAGE_SIZE));
    setUnifiedErrors(failures);
    setUnifiedBusy(false);
  }, [vaultPath, accounts, t]);

  useEffect(() => {
    if (unified) void loadUnified();
  }, [unified, loadUnified]);

  /**
   * Resolves selected row ids to the mailboxes they actually live in. Plain ids
   * (a single-folder list) fall back to what is open, so every existing caller
   * keeps behaving exactly as before.
   */
  /** The account a merged row belongs to, for the label on it. */
  const accountLabel = useCallback(
    (rowId: string): string => {
      const origin = parseUnifiedId(rowId);
      if (!origin) return "";
      return accounts.find((a) => a.id === origin.accountId)?.label ?? "";
    },
    [accounts]
  );

  const originGroups = useCallback(
    (ids: string[]) =>
      groupByOrigin(ids, (id) => accounts.find((a) => a.id === id) ?? null, { account, mailbox }),
    [accounts, account, mailbox]
  );

  // ---- Mailbox actions (E4) ----
  const displayedEnvelopes = unified ? unifiedEnvelopes : (searchResults ?? flaggedResults ?? envelopes);
  // Quick filter (client-side over the loaded list; the server search runs
  // independently). "Ungelesen" keeps only unread envelopes.
  const visibleEnvelopes = useMemo(
    () => {
      const kept = displayedEnvelopes.filter((e) => (!filterUnread || !e.seen) && (!filterFlagged || e.flagged));
      // Snoozed messages (S22) leave the list until their time. A search, the
      // flagged list and the merged view are NOT filtered: a snooze says "not in
      // my way", and someone searching for a mail by name wants to find it.
      if (searchResults || flaggedResults || unified || showSnoozed) return kept;
      return filterSnoozed(kept, {
        state: snoozed,
        now: snoozeNow,
        folder: mailbox,
        accountOf: () => account?.id ?? "",
        idOf: (e) => e.id,
      });
    },
    [displayedEnvelopes, filterUnread, filterFlagged, searchResults, flaggedResults, unified, showSnoozed, snoozed, snoozeNow, mailbox, account]
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
        ...sentEnvelopes.map((e) => ({ ...e, mailbox: sentBox ?? "", account: account?.id })),
      ];
    },
    [threadMode, searchResults, flaggedResults, visibleEnvelopes, sentEnvelopes, mailbox, sentBox, account, unified]
  );
  // Anchored to the open folder: Sent completes threads, it never adds rows.
  const rows = useMemo(
    // No anchor in the merged list: there is no single "open folder" to anchor
    // to, and nothing foreign is read along there either.
    () => (threadable.length > 0 ? threadRows(threadable, unified ? {} : { anchorMailbox: mailbox }) : []),
    [threadable, mailbox, unified],
  );
  /** Conversations are only shown where they exist: a flat list stays flat. */
  const showThreads = threadMode && !searchResults && !flaggedResults && rows.length > 0;

  /** What the open message declares as a way out, if anything (S23). */
  const unsubRoute = useMemo(
    () => (message ? preferredRoute(parseUnsubscribe({ listUnsubscribe: message.listUnsubscribe, listUnsubscribePost: message.listUnsubscribePost })) : null),
    [message]
  );

  const unsubscribeNow = useCallback(async () => {
    if (!unsubRoute || !message) return;
    if (unsubRoute.kind === "mailto") {
      // A mailto route is a message the reader SENDS — it opens the composer
      // rather than going out behind their back.
      setCompose({
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
  }, [unsubRoute, message, t]);

  const currentSeen = displayedEnvelopes.find((e) => e.id === selectedId)?.seen ?? false;
  const currentFlagged = displayedEnvelopes.find((e) => e.id === selectedId)?.flagged ?? false;
  const isTrash = useMemo(
    () => boxes.find((b) => b.name === mailbox)?.role === "trash" || classifyFolderRole(mailbox, delimiter) === "trash",
    [boxes, mailbox, delimiter]
  );
  const isGmail = /(^|\.)gmail\.com$/i.test(account?.host ?? "") || /googlemail/i.test(account?.host ?? "");
  const isGmailAllMail = isGmail && /all mail|alle nachrichten|todos|tous les messages|tutta la posta|すべてのメール/i.test(mailbox);
  // The ids the list context menu acts on: the whole selection when the
  // right-clicked row is part of it, otherwise that single row.
  const ctxIds = useMemo(
    () => (ctxMenu ? (selectedIds.has(ctxMenu.id) && selectedIds.size > 0 ? [...selectedIds] : [ctxMenu.id]) : []),
    [ctxMenu, selectedIds]
  );

  const searchSeq = useRef(0);
  const runSearch = useCallback(async () => {
    if (!vaultPath || !account || !mailbox) return;
    const q = searchQuery.trim();
    if (!q) {
      setSearchResults(null);
      return;
    }
    const seq = ++searchSeq.current;
    const current = (): boolean => seq === searchSeq.current;
    setSearchBusy(true);
    try {
      const hits = await searchEnvelopes(vaultPath, account, mailbox, q);
      if (current()) setSearchResults(hits);
    } catch (e) {
      if (current()) toast.error(mailErrorText(e, t));
    } finally {
      if (current()) setSearchBusy(false);
    }
  }, [vaultPath, account, mailbox, searchQuery, t]);

  const clearSearch = useCallback(() => {
    setSearchQuery("");
    setSearchResults(null);
  }, []);

  const toggleFlaggedFilter = useCallback(async () => {
    const next = !filterFlagged;
    setFilterFlagged(next);
    if (!next) {
      setFlaggedResults(null);
      return;
    }
    if (!vaultPath || !account || !mailbox) return;
    setSearchBusy(true);
    try {
      setFlaggedResults(await listFlaggedEnvelopes(vaultPath, account, mailbox));
    } catch (e) {
      setFilterFlagged(false);
      toast.error(mailErrorText(e, t));
    } finally {
      setSearchBusy(false);
    }
  }, [filterFlagged, vaultPath, account, mailbox, t]);

  // ---- list selection (multi-select) ----
  const toggleSel = useCallback((id: string) => {
    setSelectedIds((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }, []);
  const clearSel = useCallback(() => setSelectedIds(new Set()), []);
  /**
   * The selection id of a message shown in a thread. A thread spans folders, so
   * a bare uid would be acted on in whatever folder is open — the same
   * folder-local uid trap as the merged list, and it is addressed the same way.
   */
  const threadSelId = useCallback(
    (m: { id: string; mailbox?: string }) =>
      account ? unifiedId({ accountId: account.id, mailbox: m.mailbox || mailbox || "", uid: m.id }) : m.id,
    [account, mailbox]
  );
  /** Every thread row in view, as the ids it stands for — the order Shift ranges over. */
  const threadRowIds = useMemo(
    () => rows.map((r) => ({ key: r.thread.key, ids: r.thread.messages.map((m) => threadSelId(m)) })),
    [rows, threadSelId]
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
  // menu). Bulk = N single calls (the backend has no multi-uid command). ----
  /**
   * Does this loaded envelope belong to one of the selected ids? The lists hold
   * bare transport ids; a selection can hold addressed ones (conversation view,
   * merged list). `box` is the folder the list was loaded from.
   */
  const hits = useCallback(
    (idSet: Set<string>, box: string | null) => (e: { id: string }) =>
      idSet.has(e.id) || (!!account && idSet.has(unifiedId({ accountId: account.id, mailbox: box || "", uid: e.id }))),
    [account]
  );

  const bulkSetSeen = useCallback(
    async (ids: string[], seen: boolean) => {
      if (!vaultPath || !account || ids.length === 0 || actionBusy) return;
      const idSet = new Set(ids);
      const src = searchResults ?? envelopes;
      const hit = hits(idSet, mailbox);
      let delta = 0;
      for (const e of src) if (hit(e) && e.seen !== seen) delta += seen ? -1 : 1;
      setActionBusy(true);
      try {
        // Per ORIGIN, not per screen state: in the merged list two accounts can
        // both hold a message with uid "1234" (P9.3b).
        for (const g of originGroups(ids)) {
          for (const uid of g.uids) await setMessageSeen(vaultPath, g.account, g.mailbox, uid, seen);
        }
        setUnifiedEnvelopes((list) => list.map((e) => (idSet.has(e.id) ? { ...e, seen } : e)));
        setEnvelopes((list) => list.map((e) => (hit(e) ? { ...e, seen } : e)));
        setSentEnvelopes((list) => list.map((e) => (hits(idSet, sentBox)(e) ? { ...e, seen } : e)));
        setSearchResults((r) => (r ? r.map((e) => (hit(e) ? { ...e, seen } : e)) : r));
        setUnseen((u) => Math.max(0, u + delta));
      } catch (e) {
        toast.error(mailErrorText(e, t));
      } finally {
        setActionBusy(false);
      }
    },
    [vaultPath, account, mailbox, sentBox, actionBusy, envelopes, searchResults, originGroups, hits, t]
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
      const idSet = new Set(ids);
      setActionBusy(true);
      try {
        for (const g of originGroups(ids)) {
          for (const uid of g.uids) await setMessageFlagged(vaultPath, g.account, g.mailbox, uid, flagged);
        }
        const hit = hits(idSet, mailbox);
        const apply = (list: MailEnvelope[]) => list.map((e) => (hit(e) ? { ...e, flagged } : e));
        setUnifiedEnvelopes((list) => list.map((e) => (idSet.has(e.id) ? { ...e, flagged } : e)));
        setEnvelopes(apply);
        setSentEnvelopes((list) => list.map((e) => (hits(idSet, sentBox)(e) ? { ...e, flagged } : e)));
        setSearchResults((r) => (r ? apply(r) : r));
        setFlaggedResults((r) => (r ? (flagged ? apply(r) : r.filter((e) => !hit(e))) : r));
      } catch (e) {
        toast.error(mailErrorText(e, t));
      } finally {
        setActionBusy(false);
      }
    },
    [vaultPath, account, mailbox, sentBox, actionBusy, originGroups, hits, t]
  );

  // Leaving a message releases its hold, so opening it again behaves normally.
  useEffect(() => {
    setHeldUnread((held) => retainOnlyOpen(held, selectedId));
  }, [selectedId]);

  // Auto-mark-read: a message left open for a few seconds switches to "read" on
  // its own (like every mail client). Switching messages cancels the timer, and
  // a message the user turned unread BY HAND is left alone — see autoRead.ts.
  // The write goes through `bulkSetSeen` rather than `setSeenManually`: this is
  // not a manual change and must not touch the hold.
  useEffect(() => {
    if (!shouldScheduleAutoRead({ openId: selectedId, hasBody: !!message, seen: currentSeen, heldUnread })) return;
    const id = selectedId as string;
    const timer = setTimeout(() => void bulkSetSeen([id], true), AUTO_READ_DELAY_MS);
    return () => clearTimeout(timer);
  }, [message, selectedId, currentSeen, heldUnread, bulkSetSeen]);

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

    doc.addEventListener(
      "click",
      (e) => {
        const a = (e.target as Element | null)?.closest?.("a[href]");
        const href = a?.getAttribute("href") ?? "";
        if (a && /^(https?:|mailto:|tel:)/i.test(href)) {
          e.preventDefault();
          void openUrl(href).catch(() => {});
        }
      },
      true
    );
  }, []);

  const removeFromList = useCallback(
    (uid: string) => {
      // Every list it can appear in: the open folder, the merged view, the Sent
      // side of a conversation, and the two result sets.
      const idSet = new Set([uid]);
      const raw = parseUnifiedId(uid)?.uid ?? uid;
      const gone = (e: { id: string }) => e.id === uid || hits(idSet, mailbox)(e) || hits(idSet, sentBox)(e);
      setUnifiedEnvelopes((list) => list.filter((e) => e.id !== uid));
      setEnvelopes((list) => list.filter((e) => !gone(e)));
      setSentEnvelopes((list) => list.filter((e) => !gone(e)));
      setSearchResults((r) => (r ? r.filter((e) => !gone(e)) : r));
      setFlaggedResults((r) => (r ? r.filter((e) => !gone(e)) : r));
      setSelectedId((cur) => (cur === raw || cur === uid ? null : cur));
      setMessage((m) => (m && (m.id === raw || m.id === uid) ? null : m));
    },
    [hits, mailbox, sentBox]
  );

  const bulkMove = useCallback(
    async (ids: string[], target: string) => {
      setMoveMenu(null);
      if (!vaultPath || !account || ids.length === 0 || actionBusy || target === mailbox) return;
      setActionBusy(true);
      let moved = 0;
      try {
        for (const g of originGroups(ids)) {
          for (const uid of g.uids) {
            await moveMessage(vaultPath, g.account, g.mailbox, uid, target);
            moved++;
          }
          // It no longer lives in this folder, so neither does its cached row.
          void forgetCachedMessages(dbAdapter, g.account.id, g.mailbox, g.uids);
        }
        for (const id of ids) removeFromList(id);
        toast.info(
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
        clearSel();
      }
    },
    [vaultPath, account, mailbox, actionBusy, removeFromList, delimiter, clearSel, isGmail, t, originGroups, dbAdapter]
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
  const junkPlan = useMemo(() => planJunkAction(mailbox, boxes), [mailbox, boxes]);

  const bulkJunk = useCallback(
    async (ids: string[]) => {
      if (!vaultPath || !account || ids.length === 0 || actionBusy) return;
      const report = junkPlan.direction === "report";
      // Same reason as delete: the target folder belongs to ONE account.
      if (originGroups(ids).some((g) => g.account.id !== account.id)) {
        toast.error(t("mail.junkOneAccount", { defaultValue: "Bitte je Konto getrennt melden." }));
        return;
      }
      let target = junkPlan.target;
      if (report && !target) {
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
          target = "Junk";
          // The folder exists now, so the column shows it without a reload —
          // and the next plan finds it by name like any other junk folder.
          setBoxes((prev) => (prev.some((b) => b.name === "Junk") ? prev : [...prev, { name: "Junk", delimiter }]));
        } catch (e) {
          toast.error(mailErrorText(e, t));
          return;
        }
      }
      if (!target || target === mailbox) {
        toast.error(t("mail.junkNoFolder", { defaultValue: "Kein Spam-Ordner gefunden." }));
        return;
      }
      setActionBusy(true);
      try {
        const items = originGroups(ids).flatMap((g) => g.uids.map((uid) => ({ mailbox: g.mailbox, uid })));
        const result = await applyJunk(items, target, report, {
          setJunk: (item, junk) => setMessageJunk(vaultPath, account, item.mailbox, item.uid, junk),
          move: (item, to) => moveMessage(vaultPath, account, item.mailbox, item.uid, to),
        });
        for (const g of originGroups(ids)) void forgetCachedMessages(dbAdapter, g.account.id, g.mailbox, g.uids);
        for (const id of ids) removeFromList(id);
        const folder = mailFolderLabel(target, delimiter);
        toast.info(
          report
            ? result.flagged > 0
              ? t("mail.junkReported", { n: result.moved, folder, defaultValue: "{{n}} als Spam markiert und nach {{folder}} verschoben" })
              : t("mail.junkMovedOnly", { n: result.moved, folder, defaultValue: "{{n}} nach {{folder}} verschoben — der Server kennt keine Spam-Markierung" })
            : t("mail.junkCleared", { n: result.moved, folder, defaultValue: "{{n}} nach {{folder}} zurückgeholt" })
        );
      } catch (e) {
        toast.error(mailErrorText(e, t));
      } finally {
        setActionBusy(false);
        clearSel();
      }
    },
    [vaultPath, account, mailbox, actionBusy, junkPlan, originGroups, removeFromList, delimiter, clearSel, t, dbAdapter]
  );

  const bulkDeleteToTrash = useCallback(
    async (ids: string[]) => {
      if (!vaultPath || !account || ids.length === 0 || actionBusy) return;
      // The trash folder belongs to ONE account: `boxes` holds the open
      // account's mailboxes, and providers name it differently ("Trash",
      // "Papierkorb", "Deleted Items"). A selection reaching into another
      // account therefore has no resolvable target here — refuse rather than
      // move those messages into a folder name guessed from this account.
      // (Unified mode hides the bulk buttons for the same reason; the reader
      // switches the account before it deletes, so it stays within one.)
      const foreign = originGroups(ids).some((g) => g.account.id !== account.id);
      const trash = pickTrashFolder(boxes);
      if (foreign || !trash || trash === mailbox) {
        toast.error(t("mail.noTrash", { defaultValue: "Kein Papierkorb-Ordner gefunden." }));
        return;
      }
      const ok = await appConfirm({
        title: t("mail.deleteTitle", { defaultValue: "In den Papierkorb verschieben?" }),
        message: isGmailAllMail
          ? t("mail.gmailAllMailDeleteWarning", { defaultValue: "Diese Aktion entfernt die Nachricht in Gmail global aus allen Labels und verschiebt sie in den Papierkorb." })
          : ids.length > 1
            ? t("mail.deleteMsgN", { n: ids.length, defaultValue: "{{n}} Nachrichten werden in den Papierkorb verschoben." })
            : t("mail.deleteMsg", { defaultValue: "Die Nachricht wird in den Papierkorb verschoben." }),
      });
      if (ok) await bulkMove(ids, trash);
    },
    [vaultPath, account, mailbox, actionBusy, boxes, bulkMove, originGroups, isGmailAllMail, t]
  );
  const deleteMessage = useCallback(() => { if (selectedId != null) void bulkDeleteToTrash([selectedId]); }, [selectedId, bulkDeleteToTrash]);

  const bulkDeleteForever = useCallback(
    async (ids: string[]) => {
      if (!isTrash || !vaultPath || !account || ids.length === 0 || actionBusy) return;
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
        for (const g of originGroups(ids)) {
          for (const uid of g.uids) await deleteMessagePermanently(vaultPath, g.account, g.mailbox, uid);
          // The cached copy goes with it — otherwise the message keeps coming
          // back at the top of the list on every open until the refresh lands
          // (finding 2026-07-30).
          void forgetCachedMessages(dbAdapter, g.account.id, g.mailbox, g.uids);
        }
        for (const id of ids) removeFromList(id);
        setTotal((n) => Math.max(0, n - ids.length));
        clearSel();
      } catch (e) {
        toast.error(mailErrorText(e, t));
      } finally {
        setActionBusy(false);
      }
    },
    [isTrash, vaultPath, account, actionBusy, removeFromList, clearSel, t, originGroups, dbAdapter]
  );

  const captureNote = useCallback(
    async (withEml: boolean) => {
      if (!vaultPath || !vaultAdapter || !account || !message) return;
      try {
        const folder = await mailFolder();
        // OKF 0.2 provenance (plan P3b): a captured mail is a machine-written
        // note and names its producer; the Message-ID becomes its source.
        const res = await captureMailAsNote({ adapter: vaultAdapter, message, accountId: account.id, mailbox, folder, generatedBy: await plainvaProducer("mail-capture") });
        const touched = [res.path];
        if (withEml && res.created) {
          const raw = await fetchRawMessage(vaultPath, account, mailbox, message.id);
          const emlPath = await saveEmlFile(vaultAdapter, message, raw, folder);
          const content = await vaultAdapter.readTextFile(res.path);
          await vaultAdapter.writeTextFile(res.path, content.replace(/\s*$/, "\n\n") + `[[${emlPath}]]\n`);
          touched.push(emlPath);
        }
        if (res.created) {
          if (indexer) await applyIndexChanges(indexer, { added: touched }).catch(() => undefined);
          triggerFileTreeUpdate(touched);
          toast.info(t("mail.captured", { defaultValue: "E-Mail abgelegt: {{name}}", name: res.path.split("/").pop() }));
        }
        onOpenPath(res.path, true);
      } catch (e) {
        toast.error(mailErrorText(e, t));
      }
    },
    [vaultPath, vaultAdapter, account, message, mailbox, mailFolder, indexer, triggerFileTreeUpdate, onOpenPath, t]
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
      // looked subtly unlike a task born from a checkbox.
      const res = await createTaskInDatabase({
        adapter: vaultAdapter,
        dbPath,
        title,
        noteType: "Task",
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
      const folder = await mailFolder();
      const dir = folder.replace(/^\/+|\/+$/g, "");
      const prefix = dir ? dir + "/" : "";
      const dayKey = mailDayKey({ dateTs: Date.now() });
      const stem = mailNoteStem(dayKey, `Re ${message.subject.trim().replace(/^(re|aw|antw):\s*/i, "") || "E-Mail"}`);
      let path = prefix + stem + ".md";
      for (let n = 2; await vaultAdapter.exists(path); n++) path = prefix + `${stem} ${n}.md`;
      if (dir) await vaultAdapter.createDir(dir).catch(() => undefined);
      await vaultAdapter.writeTextFile(path, buildReplyNoteContent(message, dayKey));
      if (indexer) await applyIndexChanges(indexer, { added: [path] }).catch(() => undefined);
      triggerFileTreeUpdate([path]);
      onOpenPath(path, true);
    } catch (e) {
      toast.error(mailErrorText(e, t));
    }
  }, [vaultAdapter, message, mailFolder, indexer, triggerFileTreeUpdate, onOpenPath, t]);

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
    setCompose({ subject: replySubject(message), markdown: buildReplyBody(message, replyAttribution(message)), to: fromAddr(message.from) });
  }, [message, replySubject, replyAttribution]);
  const handleReplyAll = useCallback(() => {
    if (!message) return;
    setCompose({
      subject: replySubject(message),
      markdown: buildReplyBody(message, replyAttribution(message)),
      to: replyAllRecipients(message, account?.user ?? ""),
    });
  }, [message, account, replySubject, replyAttribution]);

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
              onClick={() => window.dispatchEvent(new CustomEvent("plainva-open-sync-settings", { detail: { area: "cloudAccounts" } }))}
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
              setUnified((v) => !v);
              setSelectedIds(new Set());
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
        <button type="button" className="pv-mail-compose" data-testid="mail-compose" onClick={() => setCompose({ subject: "", markdown: "" })}>
          <Pencil size={ICON.ui} /> {t("mail.newMessage", { defaultValue: "Neue Nachricht" })}
        </button>
        <div className="pv-mail-flist" data-testid="mail-folders">
          {(folders.length ? folders : ["INBOX"]).map((name) => {
            // A folder of ONE account cannot be "on" while the merged list is.
            const on = !unified && name === mailbox;
            return (
              <button key={name} type="button" data-testid="mail-folder" className={on ? "pv-mail-folder on" : "pv-mail-folder"} onClick={() => { setUnified(false); selectMailbox(name); }} data-tip={name}>
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
            <Button size="sm" variant="ghost" onClick={() => setSeenManually([...selectedIds], true)} data-testid="mail-bulk-read" icon={<MailOpen size={ICON.ui} />}>{t("mail.markRead", { defaultValue: "Als gelesen markieren" })}</Button>
            <Button size="sm" variant="ghost" onClick={() => setSeenManually([...selectedIds], false)} data-testid="mail-bulk-unread" icon={<Mail size={ICON.ui} />}>{t("mail.markUnread", { defaultValue: "Als ungelesen markieren" })}</Button>
            <Button size="sm" variant="ghost" onClick={() => void bulkSetFlagged([...selectedIds], true)} data-testid="mail-bulk-flag" icon={<Star size={ICON.ui} />}>{t("mail.flag", { defaultValue: "Markieren" })}</Button>
            {/* Moving and deleting need a TARGET folder, and every account has
                its own — a selection spanning accounts has no single answer, and
                guessing one deletes a message in the wrong mailbox. Read/unread
                and flagged are properties of the message itself, so they work
                across accounts (P9.3b). Open a message to act on it in full. */}
            {!unified && (
              <>
                <Button size="sm" variant="ghost" onClick={(ev) => setMoveMenu({ x: ev.clientX, y: ev.clientY, ids: [...selectedIds] })} data-testid="mail-bulk-move" icon={<FolderInput size={ICON.ui} />}>{t("mail.moveTo", { defaultValue: "Verschieben nach…" })}</Button>
                <Button size="sm" variant="ghost" onClick={() => void bulkJunk([...selectedIds])} data-testid="mail-bulk-junk" icon={<Ban size={ICON.ui} />}>{junkPlan.direction === "report" ? t("mail.reportJunk", { defaultValue: "Spam" }) : t("mail.notJunk", { defaultValue: "Kein Spam" })}</Button>
                <Button size="sm" variant="ghost" onClick={() => void (isTrash ? bulkDeleteForever([...selectedIds]) : bulkDeleteToTrash([...selectedIds]))} data-testid="mail-bulk-delete" icon={<Trash2 size={ICON.ui} />}>{isTrash ? t("mail.deleteForever", { defaultValue: "Endgültig löschen" }) : t("mail.delete", { defaultValue: "Löschen" })}</Button>
              </>
            )}
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
            {!unified && snoozed.length > 0 && (
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
        <div className="pv-mail-scroll" data-testid="mail-list">
          {searchBusy && <p className="pv-mail-hint">{t("pim.syncing", { defaultValue: "Aktualisiere…" })}</p>}
          {unifiedBusy && <p className="pv-mail-hint">{t("pim.syncing", { defaultValue: "Aktualisiere…" })}</p>}
          {/* One unreachable account must not empty the list of the others — it
              says which one, and why (P9.3b). */}
          {unifiedErrors.map((f) => (
            <p key={f.label} className="pv-mail-hint pv-mail-hint--error" data-testid="mail-unified-error">
              {f.label}: {f.message}
            </p>
          ))}
          {stale && (
            <p className="pv-mail-hint pv-mail-hint--warn" data-testid="mail-offline">
              {refreshing ? t("mail.cachedRefreshing") : t("mail.offlineCopy")}
            </p>
          )}
          {listError ? (
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
                          detail: { area: mailIsOauth ? "cloudAccounts" : "mail" },
                        })
                      )
                    }
                  >
                    {signInState === "expired"
                      ? t("pim.signInAgain", { defaultValue: "Neu anmelden" })
                      : t("deviceSignIn.action", { defaultValue: "Auf diesem Gerät anmelden" })}
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
          ) : visibleEnvelopes.length === 0 && !loadingList && !searchBusy ? (
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
                const sid = threadSelId(latest);
                const sel = selectedIds.has(sid);
                return (
                  <button
                    key={row.thread.key}
                    type="button"
                    data-testid="mail-envelope"
                    aria-selected={sel}
                    className={`pv-mail-env${on ? " on" : ""}${latest.seen ? " read" : ""}`}
                    style={sel ? { background: "var(--accent-container)", color: "var(--on-accent-container)" } : undefined}
                    onClick={(ev) => {
                      if (ev.metaKey || ev.ctrlKey) { ev.preventDefault(); toggleThreadSel([sid]); threadAnchorRef.current = row.thread.key; return; }
                      if (ev.shiftKey) { ev.preventDefault(); selectThreadRange(row.thread.key); return; }
                      clearSel(); threadAnchorRef.current = row.thread.key; void openMessage(latest.id, latest.mailbox);
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
              const threadIds = row.thread.messages.map((m) => threadSelId(m));
              const threadSel = threadIds.length > 0 && threadIds.every((id) => selectedIds.has(id));
              return (
                <div key={row.thread.key} data-testid="mail-thread">
                  <button
                    type="button"
                    data-testid="mail-thread-row"
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
                      const mid = threadSelId(m);
                      const msel = selectedIds.has(mid);
                      return (
                      <button
                        key={`${m.mailbox}|${m.id}`}
                        type="button"
                        data-testid="mail-thread-message"
                        aria-selected={msel}
                        className={`pv-mail-env pv-mail-env--in-thread${m.id === selectedId ? " on" : ""}${m.seen ? " read" : ""}`}
                        style={msel ? { background: "var(--accent-container)", color: "var(--on-accent-container)" } : undefined}
                        onClick={(ev) => {
                          if (ev.metaKey || ev.ctrlKey) { ev.preventDefault(); toggleThreadSel([mid]); return; }
                          clearSel(); void openMessage(m.id, m.mailbox);
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
                  data-testid="mail-envelope"
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
      <div className="pv-mail-read">
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
                onClick={() => setCompose({ subject: `Fwd: ${message.subject.trim().replace(/^(fwd|wg):\s*/i, "")}`.trim(), markdown: buildForwardBody(message) })}
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
              <IconButton
                label={t("mail.moveTo", { defaultValue: "Verschieben nach…" })}
                onClick={(ev) => selectedId != null && setMoveMenu({ x: ev.clientX, y: ev.clientY, ids: [selectedId] })}
                disabled={actionBusy}
                data-testid="mail-move"
              >
                <FolderInput size={ICON.ui} />
              </IconButton>
              <IconButton
                label={junkPlan.direction === "report" ? t("mail.reportJunk", { defaultValue: "Spam" }) : t("mail.notJunk", { defaultValue: "Kein Spam" })}
                onClick={() => selectedId != null && void bulkJunk([selectedId])}
                disabled={actionBusy}
                data-testid="mail-junk"
              >
                <Ban size={ICON.ui} />
              </IconButton>
              <IconButton label={isTrash ? t("mail.deleteForever", { defaultValue: "Endgültig löschen" }) : t("mail.delete", { defaultValue: "Löschen" })} onClick={() => selectedId != null && void (isTrash ? bulkDeleteForever([selectedId]) : deleteMessage())} disabled={actionBusy} data-testid="mail-delete">
                <Trash2 size={ICON.ui} />
              </IconButton>
            </div>

            {message.attachments.length > 0 && (
              <div className="pv-mail-attach">
                {message.attachments.map((a) => (
                  <span key={a.index} className="pv-mail-attach-chip">
                    <Paperclip size={ICON.ui} />
                    {a.name} ({Math.max(1, Math.round(a.size / 1024))} KB)
                  </span>
                ))}
              </div>
            )}
            {sanitized && sanitized.blockedRemote > 0 && (
              <div className="pv-mail-blocked" data-testid="mail-blocked-hint">
                <ShieldOff size={ICON.meta} />
                {t("mail.remoteBlocked", { defaultValue: "Externe Inhalte blockiert ({{n}})", n: sanitized.blockedRemote })}
                {!allowRemote && (
                  <button type="button" onClick={() => setShowRemoteOnce(true)} data-testid="mail-show-images">
                    {t("mail.showImages", { defaultValue: "Bilder anzeigen" })}
                  </button>
                )}
              </div>
            )}

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
                  srcDoc={buildMailFrameDoc(sanitized.html, { allowRemoteImages: allowRemote })}
                  data-testid="mail-frame"
                  className="pv-mail-frame"
                />
              ) : (
                <pre data-testid="mail-text" className="pv-mail-text">
                  {message.text ?? ""}
                </pre>
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
    {compose && (
      <MailDraftModal subject={compose.subject} markdown={compose.markdown} initialTo={compose.to} onClose={() => setCompose(null)} />
    )}
    {moveMenu && (
      <MenuSurface open at={{ x: moveMenu.x, y: moveMenu.y }} onClose={() => setMoveMenu(null)} ariaLabel={t("mail.moveTo", { defaultValue: "Verschieben nach…" })}>
        {folders.filter((f) => f !== mailbox).map((f) => (
          <MenuItem key={f} onClick={() => void bulkMove(moveMenu.ids, f)}>
            {mailFolderLabel(f, delimiter)}
          </MenuItem>
        ))}
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
        {ctxIds.length === 1 && (
          <MenuItem icon={<MailOpen size={ICON.ui} />} data-testid="mail-ctx-open" onSelect={() => void openMessage(ctxIds[0])}>
            {t("mail.open", { defaultValue: "Öffnen" })}
          </MenuItem>
        )}
        <MenuItem icon={<MailOpen size={ICON.ui} />} data-testid="mail-ctx-read" onSelect={() => setSeenManually(ctxIds, true)}>
          {t("mail.markRead", { defaultValue: "Als gelesen markieren" })}
        </MenuItem>
        <MenuItem icon={<Mail size={ICON.ui} />} data-testid="mail-ctx-unread" onSelect={() => setSeenManually(ctxIds, false)}>
          {t("mail.markUnread", { defaultValue: "Als ungelesen markieren" })}
        </MenuItem>
        <MenuItem icon={<Star size={ICON.ui} />} data-testid="mail-ctx-flag" onSelect={() => void bulkSetFlagged(ctxIds, true)}>
          {t("mail.flag", { defaultValue: "Markieren" })}
        </MenuItem>
        <MenuItem icon={<FolderInput size={ICON.ui} />} data-testid="mail-ctx-move" onSelect={() => setMoveMenu({ x: ctxMenu.x, y: ctxMenu.y, ids: ctxIds })}>
          {t("mail.moveTo", { defaultValue: "Verschieben nach…" })}
        </MenuItem>
        {showSnoozed ? (
          <MenuItem icon={<Clock size={ICON.ui} />} data-testid="mail-ctx-unsnooze" onSelect={() => void unsnoozeMessages(ctxIds)}>
            {t("mail.unsnooze")}
          </MenuItem>
        ) : (
          <MenuItem icon={<Clock size={ICON.ui} />} data-testid="mail-ctx-snooze" onSelect={() => setSnoozeMenu({ x: ctxMenu.x, y: ctxMenu.y, ids: ctxIds })}>
            {t("mail.snooze")}
          </MenuItem>
        )}
        <MenuSeparator />
        <MenuItem icon={<Trash2 size={ICON.ui} />} danger data-testid="mail-ctx-delete" onSelect={() => void (isTrash ? bulkDeleteForever(ctxIds) : bulkDeleteToTrash(ctxIds))}>
          {isTrash ? t("mail.deleteForever", { defaultValue: "Endgültig löschen" }) : t("mail.delete", { defaultValue: "Löschen" })}
        </MenuItem>
      </MenuSurface>
    )}
    </>
  );
}
