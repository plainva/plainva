import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactElement, type SyntheticEvent } from "react";
import { useTranslation } from "react-i18next";
import { Archive, FilePlus2, FileText, Folder, FolderInput, Forward, Inbox, ListChecks, Mail, MailOpen, Paperclip, Pencil, RefreshCw, Reply, ReplyAll, Search, Send, ShieldOff, Star, Trash2, X } from "lucide-react";
import { Button, EmptyState, ICON, IconButton, MenuItem, MenuSurface, parseBaseConfig, resolveNewItemTarget, toast } from "@plainva/ui";
import { openUrl } from "@tauri-apps/plugin-opener";
import "./mail.css";
import { useVault, mailFolderKey, DEFAULT_MAIL_FOLDER, mailRemoteImagesKey, taskDatabaseKey } from "../../contexts/VaultContext";
import { getSettingsStore } from "../../services/settingsStore";
import { activeDocument } from "../../services/activeDocument";
import { MAIL_TAB_PATH } from "../graph/virtualPaths";
import { applyIndexChanges } from "../../services/fileActions";
import { Select } from "../Select";
import { listMailAccounts, type MailAccountConfig } from "../../services/mail/mailAccounts";
import { listEnvelopes, listMailboxesFor, fetchMessage, fetchRawMessage, setMessageSeen, moveMessage, searchMessages, type MailEnvelope, type MailMessage } from "../../services/mail/mailClient";
import { sanitizeEmailHtml, buildMailFrameDoc } from "../../services/mail/mailSanitize";
import { captureMailAsNote, saveEmlFile, mailDayKey, mailNoteStem } from "../../services/mail/mailCapture";
import { buildReplyNoteContent, buildReplyBody, replyAllRecipients, buildForwardBody, mailFolderLabel, sortMailFolders, guessTrashMailbox } from "../../services/mail/mailOut";
import { appConfirm } from "../../services/appDialogs";
import { buildNewItemContent } from "../../services/newItemFlow";
import { taskDbFileStem } from "../../services/taskDatabase";
import { findColumnKey } from "../../services/taskPromotion";
import { MailDraftModal } from "./MailDraftModal";

/**
 * Mail-capture tab (PIM stage 5, virtual path plainva://mail): a read-only
 * IMAP browser whose one job is getting knowledge OUT of the mailbox and
 * INTO the vault. Left: envelope list of the selected mailbox (newest
 * first). Right: the message in a hard-sandboxed viewer (see mailSanitize —
 * no scripts, remote content blocked; links open in the system browser on an
 * explicit click) plus the capture actions
 * ("Als Notiz ablegen", "+ .eml", "→ Aufgabe"). The mailbox itself is never
 * mutated (EXAMINE + BODY.PEEK on the Rust side).
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
function FolderGlyph({ name }: { name: string }): ReactElement {
  const l = name.toLowerCase();
  if (/inbox|posteingang|entrada|boîte|posta in arrivo|skrzynka|受信/.test(l)) return <Inbox size={ICON.ui} />;
  if (/sent|gesend|gesendet|envoy|enviad|inviat|verzonden|wys[łl]|送信/.test(l)) return <Send size={ICON.ui} />;
  if (/draft|entw[uü]rf|brouillon|borrador|rascunho|bozze|concept|szkic|下書き|草稿/.test(l)) return <FileText size={ICON.ui} />;
  if (/archive|archiv|archiwum|アーカイブ/.test(l)) return <Archive size={ICON.ui} />;
  if (/trash|papierkorb|corbeille|papelera|lixeira|cestino|prullenbac|kosz|已删除|ゴミ箱|deleted|bin/.test(l)) return <Trash2 size={ICON.ui} />;
  if (/junk|spam|pourriel|correo no|posta indes/.test(l)) return <ShieldOff size={ICON.ui} />;
  if (/star|markiert|flagged|wichtig|suivi|destacad|speciali|oznaczone|スター/.test(l)) return <Star size={ICON.ui} />;
  return <Folder size={ICON.ui} />;
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
  const [mailbox, setMailbox] = useState("INBOX");
  const [folders, setFolders] = useState<string[]>([]);
  const [compose, setCompose] = useState<{ subject: string; markdown: string; to?: string } | null>(null);
  const [envelopes, setEnvelopes] = useState<MailEnvelope[]>([]);
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
  const [searchIds, setSearchIds] = useState<Set<string> | null>(null);
  const [searchBusy, setSearchBusy] = useState(false);
  const [moveMenu, setMoveMenu] = useState<{ x: number; y: number } | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

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
    let info = `${mailFolderLabel(mailbox)} · ${total} ${t("mail.messagesLabel", { defaultValue: "Nachrichten" })}`;
    if (unseen > 0) info += ` · ${unseen} ${t("mail.unreadLabel", { defaultValue: "ungelesen" })}`;
    activeDocument.set({ path: MAIL_TAB_PATH, content: "", kind: "virtual", meta: { info } });
  }, [isActivePane, mailbox, total, unseen, t]);

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

  // Folder column (mail-client E1): the account's mailboxes, INBOX first. The
  // read-only login command already returns the mailbox list, so this needs no
  // new Rust. A failure leaves the single INBOX entry (list still works).
  useEffect(() => {
    let alive = true;
    setFolders([]);
    setMailbox("INBOX");
    if (!vaultPath || !account) return;
    void listMailboxesFor(vaultPath, account)
      .then((boxes) => {
        if (!alive) return;
        const names = sortMailFolders(boxes.map((b) => b.name).filter(Boolean));
        setFolders(names);
        setMailbox((m) => (names.includes(m) ? m : names.find((n) => /inbox/i.test(n)) ?? names[0] ?? "INBOX"));
      })
      .catch(() => {
        /* keep the implicit INBOX; the envelope list still loads */
      });
    return () => {
      alive = false;
    };
  }, [vaultPath, account]);

  const loadList = useCallback(
    async (offset: number) => {
      if (!vaultPath || !account) return;
      setLoadingList(true);
      setListError(null);
      try {
        const page = await listEnvelopes(vaultPath, account, mailbox, offset, PAGE_SIZE);
        setTotal(page.total);
        setUnseen(page.unseen);
        setEnvelopes((prev) => (offset === 0 ? page.messages : [...prev, ...page.messages]));
      } catch (e) {
        setListError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoadingList(false);
      }
    },
    [vaultPath, account, mailbox]
  );

  useEffect(() => {
    setEnvelopes([]);
    setSelectedId(null);
    setMessage(null);
    if (account) void loadList(0);
  }, [account, loadList]);

  const openMessage = useCallback(
    async (uid: string) => {
      if (!vaultPath || !account) return;
      setSelectedId(uid);
      setLoadingMessage(true);
      setMessage(null);
      setShowRemoteOnce(false);
      try {
        setMessage(await fetchMessage(vaultPath, account, mailbox, uid));
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e));
      } finally {
        setLoadingMessage(false);
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
  const displayedEnvelopes = searchIds ? envelopes.filter((e) => searchIds.has(e.id)) : envelopes;
  const currentSeen = envelopes.find((e) => e.id === selectedId)?.seen ?? false;

  const runSearch = useCallback(async () => {
    if (!vaultPath || !account) return;
    const q = searchQuery.trim();
    if (!q) {
      setSearchIds(null);
      return;
    }
    setSearchBusy(true);
    try {
      const uids = await searchMessages(vaultPath, account, mailbox, q);
      setSearchIds(new Set(uids));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSearchBusy(false);
    }
  }, [vaultPath, account, mailbox, searchQuery]);

  const clearSearch = useCallback(() => {
    setSearchQuery("");
    setSearchIds(null);
  }, []);

  const markSeen = useCallback(
    async (seen: boolean) => {
      if (!vaultPath || !account || selectedId == null || actionBusy) return;
      setActionBusy(true);
      try {
        await setMessageSeen(vaultPath, account, mailbox, selectedId, seen);
        setEnvelopes((list) => list.map((e) => (e.id === selectedId ? { ...e, seen } : e)));
        // Keep the unread badge in step (auto-read + the manual toggle always flip).
        setUnseen((u) => Math.max(0, seen ? u - 1 : u + 1));
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e));
      } finally {
        setActionBusy(false);
      }
    },
    [vaultPath, account, mailbox, selectedId, actionBusy]
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
    setSearchIds((s) => {
      if (!s) return s;
      const n = new Set(s);
      n.delete(uid);
      return n;
    });
    setSelectedId((cur) => (cur === uid ? null : cur));
    setMessage((m) => (m && m.id === uid ? null : m));
  }, []);

  const moveTo = useCallback(
    async (target: string) => {
      setMoveMenu(null);
      if (!vaultPath || !account || selectedId == null || actionBusy || target === mailbox) return;
      setActionBusy(true);
      const uid = selectedId;
      try {
        await moveMessage(vaultPath, account, mailbox, uid, target);
        removeFromList(uid);
        toast.info(t("mail.moved", { defaultValue: "Verschoben nach {{folder}}", folder: mailFolderLabel(target) }));
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e));
      } finally {
        setActionBusy(false);
      }
    },
    [vaultPath, account, mailbox, selectedId, actionBusy, removeFromList, t]
  );

  const deleteMessage = useCallback(async () => {
    if (!vaultPath || !account || selectedId == null || actionBusy) return;
    const trash = guessTrashMailbox(folders);
    if (!trash || trash === mailbox) {
      toast.error(t("mail.noTrash", { defaultValue: "Kein Papierkorb-Ordner gefunden." }));
      return;
    }
    const ok = await appConfirm({
      title: t("mail.deleteTitle", { defaultValue: "In den Papierkorb verschieben?" }),
      message: t("mail.deleteMsg", { defaultValue: "Die Nachricht wird in den Papierkorb verschoben." }),
    });
    if (ok) await moveTo(trash);
  }, [vaultPath, account, mailbox, selectedId, actionBusy, folders, moveTo, t]);

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
          icon={<Mail size={ICON.empty} />}
          data-tip={t("mail.empty", { defaultValue: "Kein E-Mail-Konto verbunden" })}
          action={
            <Button
              variant="primary"
              onClick={() => window.dispatchEvent(new CustomEvent("plainva-open-sync-settings", { detail: { area: "pim" } }))}
              data-testid="mail-open-settings"
            >
              {t("shortcuts.openSettings", { defaultValue: "Einstellungen öffnen" })}
            </Button>
          }
        >
          {t("mail.emptyHint", { defaultValue: "Verbinde in den Einstellungen unter „Kalender & Konten“ ein IMAP-Konto (nur Lesen)." })}
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
              <button key={name} type="button" data-testid="mail-folder" className={on ? "pv-mail-folder on" : "pv-mail-folder"} onClick={() => setMailbox(name)} aria-label={name} data-tip={name}>
                <FolderGlyph name={name} />
                <span className="pv-mail-folder-label">{mailFolderLabel(name)}</span>
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
            {(searchIds || searchQuery) && (
              <button type="button" className="pv-mail-search-clear" onClick={clearSearch} aria-label={t("mail.clearSearch", { defaultValue: "Suche leeren" })} data-testid="mail-search-clear">
                <X size={ICON.ui} />
              </button>
            )}
          </span>
          <IconButton label={t("pim.refreshNow", { defaultValue: "Jetzt aktualisieren" })} onClick={() => void loadList(0)} data-testid="mail-refresh">
            <RefreshCw size={ICON.ui} />
          </IconButton>
        </div>
        <div className="pv-mail-scroll" data-testid="mail-list">
          {searchBusy && <p className="pv-mail-hint">{t("pim.syncing", { defaultValue: "Aktualisiere…" })}</p>}
          {listError ? (
            <p className="pv-mail-hint pv-mail-hint--error">{listError}</p>
          ) : displayedEnvelopes.length === 0 && !loadingList && !searchBusy ? (
            <p className="pv-mail-hint">
              {searchIds ? t("mail.noSearchResults", { defaultValue: "Keine Treffer in diesem Ordner." }) : t("mail.noMessages", { defaultValue: "Keine Nachrichten." })}
            </p>
          ) : (
            displayedEnvelopes.map((e) => {
              const on = e.id === selectedId;
              return (
                <button
                  key={e.id}
                  type="button"
                  data-testid="mail-envelope"
                  className={`pv-mail-env${on ? " on" : ""}${e.seen ? " read" : ""}`}
                  onClick={() => void openMessage(e.id)}
                >
                  <span className="pv-mail-unread" />
                  <span className="pv-mail-ebody">
                    <span className="pv-mail-erow">
                      <span className="pv-mail-from">{fromName(e.from)}</span>
                      <span className="pv-mail-when">{envTime(e.dateTs)}</span>
                    </span>
                    <span className="pv-mail-subj">{e.subject || t("mail.noSubject", { defaultValue: "(kein Betreff)" })}</span>
                    <span className="pv-mail-prev">{fromAddr(e.from)}</span>
                  </span>
                </button>
              );
            })
          )}
          {!searchIds && envelopes.length < total && (
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
                label={t("mail.moveTo", { defaultValue: "Verschieben nach…" })}
                onClick={(ev) => setMoveMenu({ x: ev.clientX, y: ev.clientY })}
                disabled={actionBusy}
                data-testid="mail-move"
              >
                <FolderInput size={ICON.ui} />
              </IconButton>
              <IconButton label={t("mail.delete", { defaultValue: "Löschen" })} onClick={() => void deleteMessage()} disabled={actionBusy} data-testid="mail-delete">
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
      <MenuSurface open at={moveMenu} onClose={() => setMoveMenu(null)} ariaLabel={t("mail.moveTo", { defaultValue: "Verschieben nach…" })}>
        {folders.filter((f) => f !== mailbox).map((f) => (
          <MenuItem key={f} onClick={() => void moveTo(f)}>
            {mailFolderLabel(f)}
          </MenuItem>
        ))}
      </MenuSurface>
    )}
    </>
  );
}
