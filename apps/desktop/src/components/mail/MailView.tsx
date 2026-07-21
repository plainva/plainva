import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactElement, type SyntheticEvent } from "react";
import { useTranslation } from "react-i18next";
import { Archive, FilePlus2, FileText, Folder, FolderInput, Forward, Inbox, ListChecks, Mail, MailOpen, Paperclip, Pencil, RefreshCw, Reply, ReplyAll, Search, Send, ShieldOff, Star, Trash2, X } from "lucide-react";
import { Button, EmptyState, ICON, IconButton, MenuItem, MenuLabel, MenuSeparator, MenuSurface, parseBaseConfig, resolveNewItemTarget, toast } from "@plainva/ui";
import { openUrl } from "@tauri-apps/plugin-opener";
import "./mail.css";
import { useVault, mailFolderKey, DEFAULT_MAIL_FOLDER, mailRemoteImagesKey, taskDatabaseKey } from "../../contexts/VaultContext";
import { getSettingsStore } from "../../services/settingsStore";
import { activeDocument } from "../../services/activeDocument";
import { MAIL_TAB_PATH } from "../graph/virtualPaths";
import { applyIndexChanges } from "../../services/fileActions";
import { Select } from "../Select";
import { listMailAccounts, type MailAccountConfig } from "../../services/mail/mailAccounts";
import { listEnvelopes, listMailboxesFor, fetchMessage, fetchRawMessage, setMessageSeen, setMessageFlagged, deleteMessagePermanently, listFlaggedEnvelopes, moveMessage, searchEnvelopes, type MailEnvelope, type MailMessage, type MailboxInfo } from "../../services/mail/mailClient";
import { sanitizeEmailHtml, buildMailFrameDoc } from "../../services/mail/mailSanitize";
import { captureMailAsNote, saveEmlFile, mailDayKey, mailNoteStem } from "../../services/mail/mailCapture";
import { buildReplyNoteContent, buildReplyBody, replyAllRecipients, buildForwardBody, classifyFolderRole, mailFolderLabel, sortMailFolders, pickInboxFolder, pickTrashFolder } from "../../services/mail/mailOut";
import { appConfirm } from "../../services/appDialogs";
import { buildNewItemContent } from "../../services/newItemFlow";
import { taskDbFileStem } from "../../services/taskDatabase";
import { findColumnKey } from "../../services/taskPromotion";
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
  const { vaultPath, vaultAdapter, indexer, triggerFileTreeUpdate } = useVault();

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
  const mailbox = mailboxSel.accountId === accountId ? mailboxSel.name : "";
  const selectMailbox = useCallback((name: string) => setMailboxSel({ accountId, name }), [accountId]);
  /** The account's mailboxes in display order (with their backend role). */
  const [boxes, setBoxes] = useState<MailboxInfo[]>([]);
  const folders = useMemo(() => boxes.map((b) => b.name), [boxes]);
  /** Server-stated hierarchy delimiter, so folder labels split at the real
   * separator instead of guessing "." vs "/". */
  const delimiter = useMemo(() => boxes.find((b) => b.delimiter)?.delimiter, [boxes]);
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
  const anchorRef = useRef<string | null>(null);
  // Quick filter over the loaded list (server search still works alongside).
  const [filterUnread, setFilterUnread] = useState(false);
  const [filterFlagged, setFilterFlagged] = useState(false);
  const [flaggedResults, setFlaggedResults] = useState<MailEnvelope[] | null>(null);
  // Right-click context menu on a list row.
  const [ctxMenu, setCtxMenu] = useState<{ id: string; x: number; y: number } | null>(null);

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

  const loadList = useCallback(
    async (offset: number) => {
      // No mailbox yet = the folder list is still loading; opening a guessed
      // name would fail on backends that localize their folders (Graph).
      if (!vaultPath || !account || !mailbox) return;
      const seq = ++listSeq.current;
      const current = (): boolean => seq === listSeq.current;
      setLoadingList(true);
      setListError(null);
      try {
        const beforeId = offset > 0 ? envelopesRef.current[envelopesRef.current.length - 1]?.id : undefined;
        const page = await listEnvelopes(vaultPath, account, mailbox, offset, PAGE_SIZE, beforeId);
        if (!current()) return; // a newer account/mailbox took over
        setTotal(page.total);
        setUnseen(page.unseen);
        setEnvelopes((prev) => (offset === 0 ? page.messages : [...prev, ...page.messages]));
      } catch (e) {
        // A late failure of a superseded request must not surface as the
        // current mailbox's error.
        if (current()) setListError(e instanceof Error ? e.message : String(e));
      } finally {
        if (current()) setLoadingList(false);
      }
    },
    [vaultPath, account, mailbox]
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

  const openMessage = useCallback(
    async (uid: string) => {
      if (!vaultPath || !account) return;
      const seq = ++msgSeq.current;
      const current = (): boolean => seq === msgSeq.current;
      setSelectedId(uid);
      setLoadingMessage(true);
      setMessage(null);
      setShowRemoteOnce(false);
      try {
        const msg = await fetchMessage(vaultPath, account, mailbox, uid);
        if (current()) setMessage(msg);
      } catch (e) {
        if (current()) toast.error(e instanceof Error ? e.message : String(e));
      } finally {
        if (current()) setLoadingMessage(false);
      }
    },
    [vaultPath, account, mailbox]
  );

  const allowRemote = remoteOptIn || showRemoteOnce;
  const sanitized = useMemo(
    () => (message?.html ? sanitizeEmailHtml(message.html, { allowRemoteImages: allowRemote }) : null),
    [message, allowRemote]
  );

  // ---- Mailbox actions (E4) ----
  const displayedEnvelopes = searchResults ?? flaggedResults ?? envelopes;
  // Quick filter (client-side over the loaded list; the server search runs
  // independently). "Ungelesen" keeps only unread envelopes.
  const visibleEnvelopes = useMemo(
    () => displayedEnvelopes.filter((e) => (!filterUnread || !e.seen) && (!filterFlagged || e.flagged)),
    [displayedEnvelopes, filterUnread, filterFlagged]
  );
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
      if (current()) toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      if (current()) setSearchBusy(false);
    }
  }, [vaultPath, account, mailbox, searchQuery]);

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
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSearchBusy(false);
    }
  }, [filterFlagged, vaultPath, account, mailbox]);

  // ---- list selection (multi-select) ----
  const toggleSel = useCallback((id: string) => {
    setSelectedIds((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }, []);
  const clearSel = useCallback(() => setSelectedIds(new Set()), []);
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
  const bulkSetSeen = useCallback(
    async (ids: string[], seen: boolean) => {
      if (!vaultPath || !account || ids.length === 0 || actionBusy) return;
      const idSet = new Set(ids);
      const src = searchResults ?? envelopes;
      let delta = 0;
      for (const e of src) if (idSet.has(e.id) && e.seen !== seen) delta += seen ? -1 : 1;
      setActionBusy(true);
      try {
        for (const id of ids) await setMessageSeen(vaultPath, account, mailbox, id, seen);
        setEnvelopes((list) => list.map((e) => (idSet.has(e.id) ? { ...e, seen } : e)));
        setSearchResults((r) => (r ? r.map((e) => (idSet.has(e.id) ? { ...e, seen } : e)) : r));
        setUnseen((u) => Math.max(0, u + delta));
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e));
      } finally {
        setActionBusy(false);
      }
    },
    [vaultPath, account, mailbox, actionBusy, envelopes, searchResults]
  );
  const markSeen = useCallback((seen: boolean) => { if (selectedId != null) void bulkSetSeen([selectedId], seen); }, [selectedId, bulkSetSeen]);

  const bulkSetFlagged = useCallback(
    async (ids: string[], flagged: boolean) => {
      if (!vaultPath || !account || ids.length === 0 || actionBusy) return;
      const idSet = new Set(ids);
      setActionBusy(true);
      try {
        for (const id of ids) await setMessageFlagged(vaultPath, account, mailbox, id, flagged);
        const apply = (list: MailEnvelope[]) => list.map((e) => (idSet.has(e.id) ? { ...e, flagged } : e));
        setEnvelopes(apply);
        setSearchResults((r) => (r ? apply(r) : r));
        setFlaggedResults((r) => (r ? (flagged ? apply(r) : r.filter((e) => !idSet.has(e.id))) : r));
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e));
      } finally {
        setActionBusy(false);
      }
    },
    [vaultPath, account, mailbox, actionBusy]
  );

  // Auto-mark-read: a message left open for a few seconds switches to "read" on
  // its own (like every mail client). Switching messages cancels the timer.
  useEffect(() => {
    if (!message || selectedId == null || currentSeen) return;
    const timer = setTimeout(() => void markSeen(true), 3000);
    return () => clearTimeout(timer);
  }, [message, selectedId, currentSeen, markSeen]);

  // Make links in the sandboxed viewer clickable: the frame is allow-same-origin
  // but has NO allow-scripts (so the mail HTML still can't run any code), which
  // lets us reach its document from the parent and route anchor clicks to the
  // SYSTEM browser via the opener plugin — a bare target=_blank never opens
  // inside a Tauri WebView. Only safe schemes survive the sanitizer.
  const handleFrameLoad = useCallback((ev: SyntheticEvent<HTMLIFrameElement>) => {
    const doc = ev.currentTarget.contentDocument;
    if (!doc) return;
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

  const removeFromList = useCallback((uid: string) => {
    setEnvelopes((list) => list.filter((e) => e.id !== uid));
    setSearchResults((r) => (r ? r.filter((e) => e.id !== uid) : r));
    setFlaggedResults((r) => (r ? r.filter((e) => e.id !== uid) : r));
    setSelectedId((cur) => (cur === uid ? null : cur));
    setMessage((m) => (m && m.id === uid ? null : m));
  }, []);

  const bulkMove = useCallback(
    async (ids: string[], target: string) => {
      setMoveMenu(null);
      if (!vaultPath || !account || ids.length === 0 || actionBusy || target === mailbox) return;
      setActionBusy(true);
      let moved = 0;
      try {
        for (const id of ids) {
          await moveMessage(vaultPath, account, mailbox, id, target);
          removeFromList(id);
          moved++;
        }
        toast.info(
          isGmail
            ? t("mail.gmailLabelsChanged", { n: moved, folder: mailFolderLabel(target, delimiter), defaultValue: "Gmail-Label für {{n}} Nachricht(en) auf {{folder}} geändert" })
            : moved > 1
            ? t("mail.movedN", { n: moved, folder: mailFolderLabel(target, delimiter), defaultValue: "{{n}} nach {{folder}} verschoben" })
            : t("mail.moved", { folder: mailFolderLabel(target, delimiter), defaultValue: "Verschoben nach {{folder}}" })
        );
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e));
      } finally {
        setActionBusy(false);
        clearSel();
      }
    },
    [vaultPath, account, mailbox, actionBusy, removeFromList, delimiter, clearSel, isGmail, t]
  );

  const bulkDeleteToTrash = useCallback(
    async (ids: string[]) => {
      if (!vaultPath || !account || ids.length === 0 || actionBusy) return;
      const trash = pickTrashFolder(boxes);
      if (!trash || trash === mailbox) {
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
    [vaultPath, account, mailbox, actionBusy, boxes, bulkMove, isGmailAllMail, t]
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
        for (const id of ids) {
          await deleteMessagePermanently(vaultPath, account, mailbox, id);
          removeFromList(id);
        }
        setTotal((n) => Math.max(0, n - ids.length));
        clearSel();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e));
      } finally {
        setActionBusy(false);
      }
    },
    [isTrash, vaultPath, account, mailbox, actionBusy, removeFromList, clearSel, t]
  );

  const mailFolder = useCallback(async () => {
    const store = await getSettingsStore();
    return (((await store.get<string>(mailFolderKey(vaultPath ?? ""))) ?? "").trim() || DEFAULT_MAIL_FOLDER);
  }, [vaultPath]);

  const captureNote = useCallback(
    async (withEml: boolean) => {
      if (!vaultPath || !vaultAdapter || !account || !message) return;
      try {
        const folder = await mailFolder();
        const res = await captureMailAsNote({ adapter: vaultAdapter, message, accountId: account.id, mailbox, folder });
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
        toast.error(e instanceof Error ? e.message : String(e));
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
      const config = parseBaseConfig(await vaultAdapter.readTextFile(dbPath));
      const target = resolveNewItemTarget(config);
      if (!target.folder) {
        toast.error(t("tasks.promoteNoFolder", { defaultValue: "Die Datenbank hat keinen Ablage-Ordner." }));
        return;
      }
      const title = message.subject.trim() || "E-Mail";
      const stem = taskDbFileStem(title) ?? "Task";
      const dir = target.folder.replace(/\/+$/, "");
      const prefix = dir ? dir + "/" : "";
      let name = stem;
      for (let n = 2; await vaultAdapter.exists(prefix + name + ".md"); n++) name = `${stem} ${n}`;
      const notePath = prefix + name + ".md";
      const prefills: Record<string, unknown> = {};
      const statusKey = findColumnKey(config, (c) => (c.input === "status" || c.input === "select") && Array.isArray(c.options) && c.options.length > 0);
      if (statusKey) {
        const first = config.columns[statusKey].options[0];
        const value = typeof first === "string" ? first : first?.value;
        if (value) prefills[statusKey] = value;
      }
      const dueKey = findColumnKey(config, (c) => c.input === "date" || c.input === "datetime");
      if (dueKey) prefills[dueKey] = mailDayKey(message);
      let content = buildNewItemContent({ templateText: null, noteType: "Task", title, inheritTags: target.inheritTags ?? [], prefills });
      const fromLine = message.from ? `\n${t("mail.fromLabel", { defaultValue: "Von" })}: ${message.from}\n` : "\n";
      content = content.replace(/\s*$/, "\n") + fromLine;
      await vaultAdapter.writeTextFile(notePath, content);
      if (indexer) await applyIndexChanges(indexer, { added: [notePath] }).catch(() => undefined);
      triggerFileTreeUpdate([notePath]);
      toast.info(t("tasks.promoted", { defaultValue: "Verschoben: {{name}}", name: title }));
      onOpenPath(notePath, true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }, [vaultPath, vaultAdapter, account, message, indexer, triggerFileTreeUpdate, onOpenPath, t]);

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
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }, [vaultAdapter, message, mailFolder, indexer, triggerFileTreeUpdate, onOpenPath]);

  // Real reply / reply-all: open the compose window (SMTP send), NOT a vault
  // note. Subject "Re: …", recipients from the sender (reply) or sender + the
  // original recipients minus self (reply-all), body = the quoted original.
  const replySubject = useCallback(
    (m: MailMessage) => `Re: ${m.subject.trim().replace(/^(re|aw|antw):\s*/i, "")}`.trim(),
    []
  );
  const handleReply = useCallback(() => {
    if (!message) return;
    setCompose({ subject: replySubject(message), markdown: buildReplyBody(message), to: fromAddr(message.from) });
  }, [message, replySubject]);
  const handleReplyAll = useCallback(() => {
    if (!message) return;
    setCompose({ subject: replySubject(message), markdown: buildReplyBody(message), to: replyAllRecipients(message, account?.user ?? "") });
  }, [message, account, replySubject]);

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
    <div data-testid="mail-view" className="pv-mail">
      {/* Column 1 — accounts + mailboxes */}
      <div className="pv-mail-folders">
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
            const on = name === mailbox;
            return (
              <button key={name} type="button" data-testid="mail-folder" className={on ? "pv-mail-folder on" : "pv-mail-folder"} onClick={() => selectMailbox(name)} data-tip={name}>
                <FolderGlyph name={name} delimiter={delimiter} />
                <span className="pv-mail-folder-label">{mailFolderLabel(name, delimiter)}</span>
                {on && unseen > 0 && <span className="pv-mail-folder-ct">{unseen}</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* Column 2 — message list */}
      <div className="pv-mail-list">
        <div className="pv-mail-listhead">
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
          <IconButton label={t("pim.refreshNow", { defaultValue: "Jetzt aktualisieren" })} onClick={() => void loadList(0)} data-testid="mail-refresh">
            <RefreshCw size={ICON.ui} />
          </IconButton>
        </div>
        {selectedIds.size > 0 ? (
          <div style={{ display: "flex", gap: 6, padding: "0 var(--space-2) var(--space-2)", alignItems: "center", flexWrap: "wrap" }} data-testid="mail-bulkbar">
            <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>{t("mail.selectedCount", { n: selectedIds.size, defaultValue: "{{n}} ausgewählt" })}</span>
            <Button size="sm" variant="ghost" onClick={() => void bulkSetSeen([...selectedIds], true)} data-testid="mail-bulk-read" icon={<MailOpen size={ICON.ui} />}>{t("mail.markRead", { defaultValue: "Als gelesen markieren" })}</Button>
            <Button size="sm" variant="ghost" onClick={() => void bulkSetSeen([...selectedIds], false)} data-testid="mail-bulk-unread" icon={<Mail size={ICON.ui} />}>{t("mail.markUnread", { defaultValue: "Als ungelesen markieren" })}</Button>
            <Button size="sm" variant="ghost" onClick={() => void bulkSetFlagged([...selectedIds], true)} data-testid="mail-bulk-flag" icon={<Star size={ICON.ui} />}>{t("mail.flag", { defaultValue: "Markieren" })}</Button>
            <Button size="sm" variant="ghost" onClick={(ev) => setMoveMenu({ x: ev.clientX, y: ev.clientY, ids: [...selectedIds] })} data-testid="mail-bulk-move" icon={<FolderInput size={ICON.ui} />}>{t("mail.moveTo", { defaultValue: "Verschieben nach…" })}</Button>
            <Button size="sm" variant="ghost" onClick={() => void (isTrash ? bulkDeleteForever([...selectedIds]) : bulkDeleteToTrash([...selectedIds]))} data-testid="mail-bulk-delete" icon={<Trash2 size={ICON.ui} />}>{isTrash ? t("mail.deleteForever", { defaultValue: "Endgültig löschen" }) : t("mail.delete", { defaultValue: "Löschen" })}</Button>
            <span style={{ flex: 1 }} />
            <Button size="sm" variant="ghost" onClick={clearSel} data-testid="mail-bulk-clear">{t("mail.clearSelection", { defaultValue: "Auswahl aufheben" })}</Button>
          </div>
        ) : (
          <div style={{ display: "flex", gap: 6, padding: "0 var(--space-2) var(--space-2)", alignItems: "center" }} data-testid="mail-filters">
            <Button size="sm" variant={filterUnread ? "primary" : "ghost"} aria-pressed={filterUnread} onClick={() => setFilterUnread((v) => !v)} data-testid="mail-filter-unread" icon={<Mail size={ICON.ui} />}>
              {t("mail.filterUnread", { defaultValue: "Ungelesen" })}
            </Button>
            <Button size="sm" variant={filterFlagged ? "primary" : "ghost"} aria-pressed={filterFlagged} onClick={() => void toggleFlaggedFilter()} data-testid="mail-filter-flagged" icon={<Star size={ICON.ui} />}>
              {t("mail.filterFlagged", { defaultValue: "Markiert" })}
            </Button>
          </div>
        )}
        <div className="pv-mail-scroll" data-testid="mail-list">
          {searchBusy && <p className="pv-mail-hint">{t("pim.syncing", { defaultValue: "Aktualisiere…" })}</p>}
          {listError ? (
            <p className="pv-mail-hint pv-mail-hint--error">{listError}</p>
          ) : visibleEnvelopes.length === 0 && !loadingList && !searchBusy ? (
            <p className="pv-mail-hint">
              {filterUnread && displayedEnvelopes.length > 0
                ? t("mail.noUnread", { defaultValue: "Keine ungelesenen Nachrichten." })
                : searchResults
                  ? t("mail.noSearchResults", { defaultValue: "Keine Treffer in diesem Ordner." })
                  : t("mail.noMessages", { defaultValue: "Keine Nachrichten." })}
            </p>
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
                    <span className="pv-mail-prev">{fromAddr(e.from)}</span>
                  </span>
                </button>
              );
            })
          )}
          {!searchResults && envelopes.length < total && (
            <div style={{ padding: "var(--space-2)" }}>
              <Button variant="ghost" disabled={loadingList} onClick={() => void loadList(envelopes.length)}>
                {t("mail.loadMore", { defaultValue: "Mehr laden" })}
              </Button>
            </div>
          )}
        </div>
      </div>

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
    {ctxMenu && (
      <MenuSurface open at={{ x: ctxMenu.x, y: ctxMenu.y }} onClose={() => setCtxMenu(null)} ariaLabel={t("mail.listActions", { defaultValue: "Nachrichtenaktionen" })}>
        {ctxIds.length > 1 && <MenuLabel>{t("mail.selectedCount", { n: ctxIds.length, defaultValue: "{{n}} ausgewählt" })}</MenuLabel>}
        {ctxIds.length === 1 && (
          <MenuItem icon={<MailOpen size={ICON.ui} />} data-testid="mail-ctx-open" onSelect={() => void openMessage(ctxIds[0])}>
            {t("mail.open", { defaultValue: "Öffnen" })}
          </MenuItem>
        )}
        <MenuItem icon={<MailOpen size={ICON.ui} />} data-testid="mail-ctx-read" onSelect={() => void bulkSetSeen(ctxIds, true)}>
          {t("mail.markRead", { defaultValue: "Als gelesen markieren" })}
        </MenuItem>
        <MenuItem icon={<Mail size={ICON.ui} />} data-testid="mail-ctx-unread" onSelect={() => void bulkSetSeen(ctxIds, false)}>
          {t("mail.markUnread", { defaultValue: "Als ungelesen markieren" })}
        </MenuItem>
        <MenuItem icon={<Star size={ICON.ui} />} data-testid="mail-ctx-flag" onSelect={() => void bulkSetFlagged(ctxIds, true)}>
          {t("mail.flag", { defaultValue: "Markieren" })}
        </MenuItem>
        <MenuItem icon={<FolderInput size={ICON.ui} />} data-testid="mail-ctx-move" onSelect={() => setMoveMenu({ x: ctxMenu.x, y: ctxMenu.y, ids: ctxIds })}>
          {t("mail.moveTo", { defaultValue: "Verschieben nach…" })}
        </MenuItem>
        <MenuSeparator />
        <MenuItem icon={<Trash2 size={ICON.ui} />} danger data-testid="mail-ctx-delete" onSelect={() => void (isTrash ? bulkDeleteForever(ctxIds) : bulkDeleteToTrash(ctxIds))}>
          {isTrash ? t("mail.deleteForever", { defaultValue: "Endgültig löschen" }) : t("mail.delete", { defaultValue: "Löschen" })}
        </MenuItem>
      </MenuSurface>
    )}
    </>
  );
}
