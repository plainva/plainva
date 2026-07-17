import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { FilePlus2, FileText, ListChecks, Mail, Paperclip, RefreshCw, Reply, ShieldOff } from "lucide-react";
import { Button, EmptyState, IconButton, toast, parseBaseConfig, resolveNewItemTarget } from "@plainva/ui";
import { useVault, mailFolderKey, DEFAULT_MAIL_FOLDER, taskDatabaseKey } from "../../contexts/VaultContext";
import { getSettingsStore } from "../../services/settingsStore";
import { applyIndexChanges } from "../../services/fileActions";
import { Select } from "../Select";
import { listMailAccounts, type MailAccountConfig } from "../../services/mail/mailAccounts";
import { listEnvelopes, fetchMessage, fetchRawMessage, type MailEnvelope, type MailMessage } from "../../services/mail/mailClient";
import { sanitizeEmailHtml, buildMailFrameDoc } from "../../services/mail/mailSanitize";
import { captureMailAsNote, saveEmlFile, mailDayKey, mailNoteStem } from "../../services/mail/mailCapture";
import { buildReplyNoteContent } from "../../services/mail/mailOut";
import { buildNewItemContent } from "../../services/newItemFlow";
import { taskDbFileStem } from "../../services/taskDatabase";
import { findColumnKey } from "../../services/taskPromotion";

/**
 * Mail-capture tab (PIM stage 5, virtual path plainva://mail): a read-only
 * IMAP browser whose one job is getting knowledge OUT of the mailbox and
 * INTO the vault. Left: envelope list of the selected mailbox (newest
 * first). Right: the message in a hard-sandboxed viewer (see mailSanitize —
 * remote content is blocked, links are inert) plus the capture actions
 * ("Als Notiz ablegen", "+ .eml", "→ Aufgabe"). The mailbox itself is never
 * mutated (EXAMINE + BODY.PEEK on the Rust side).
 */

const PAGE_SIZE = 50;

interface MailViewProps {
  onOpenPath: (path: string, newTab?: boolean) => void;
}

export function MailView({ onOpenPath }: MailViewProps) {
  const { t, i18n } = useTranslation();
  const { vaultPath, vaultAdapter, indexer, triggerFileTreeUpdate } = useVault();

  const [accounts, setAccounts] = useState<MailAccountConfig[]>([]);
  const [accountId, setAccountId] = useState<string>("");
  const [mailbox] = useState("INBOX");
  const [envelopes, setEnvelopes] = useState<MailEnvelope[]>([]);
  const [total, setTotal] = useState(0);
  const [loadingList, setLoadingList] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [selectedUid, setSelectedUid] = useState<number | null>(null);
  const [message, setMessage] = useState<MailMessage | null>(null);
  const [loadingMessage, setLoadingMessage] = useState(false);

  const account = useMemo(() => accounts.find((a) => a.id === accountId) ?? null, [accounts, accountId]);

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

  const loadList = useCallback(
    async (offset: number) => {
      if (!vaultPath || !account) return;
      setLoadingList(true);
      setListError(null);
      try {
        const page = await listEnvelopes(vaultPath, account, mailbox, offset, PAGE_SIZE);
        setTotal(page.total);
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
    setSelectedUid(null);
    setMessage(null);
    if (account) void loadList(0);
  }, [account, loadList]);

  const openMessage = useCallback(
    async (uid: number) => {
      if (!vaultPath || !account) return;
      setSelectedUid(uid);
      setLoadingMessage(true);
      setMessage(null);
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

  const sanitized = useMemo(() => (message?.html ? sanitizeEmailHtml(message.html) : null), [message]);

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
          const raw = await fetchRawMessage(vaultPath, account, mailbox, message.uid);
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

  const dateFmt = useMemo(() => new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "short" }), [i18n.language]);

  if (accounts.length === 0) {
    return (
      <div data-testid="mail-view" style={{ flex: 1, minHeight: 0, overflow: "auto", background: "var(--bg-primary)" }}>
        <EmptyState
          icon={<Mail size={28} />}
          title={t("mail.empty", { defaultValue: "Kein E-Mail-Konto verbunden" })}
          action={
            <Button
              variant="primary"
              onClick={() => window.dispatchEvent(new CustomEvent("plainva-open-sync-settings"))}
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
    <div data-testid="mail-view" style={{ flex: 1, minHeight: 0, display: "flex", background: "var(--bg-primary)" }}>
      {/* Envelope list */}
      <div style={{ width: 320, flexShrink: 0, borderRight: "1px solid var(--border-color-light)", display: "flex", flexDirection: "column", minHeight: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", padding: "var(--space-2)", borderBottom: "1px solid var(--border-color-light)" }}>
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
            <strong style={{ flex: 1, minWidth: 0, fontSize: "var(--text-sm)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {account?.label} · {mailbox}
            </strong>
          )}
          <IconButton label={t("pim.refreshNow", { defaultValue: "Jetzt aktualisieren" })} onClick={() => void loadList(0)} data-testid="mail-refresh">
            <RefreshCw size={14} />
          </IconButton>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflow: "auto" }} data-testid="mail-list">
          {listError ? (
            <p style={{ color: "var(--error-text)", fontSize: "var(--text-sm)", padding: "var(--space-2)" }}>{listError}</p>
          ) : envelopes.length === 0 && !loadingList ? (
            <p style={{ color: "var(--text-muted)", fontSize: "var(--text-sm)", padding: "var(--space-2)" }}>
              {t("mail.noMessages", { defaultValue: "Keine Nachrichten." })}
            </p>
          ) : (
            envelopes.map((e) => (
              <button
                key={e.uid}
                data-testid="mail-envelope"
                onClick={() => void openMessage(e.uid)}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "var(--space-2)",
                  border: "none",
                  borderBottom: "1px solid var(--border-color-light)",
                  background: e.uid === selectedUid ? "var(--bg-hover)" : "transparent",
                  cursor: "pointer",
                }}
              >
                <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", display: "flex", justifyContent: "space-between", gap: 6 }}>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.from}</span>
                  <span style={{ flexShrink: 0 }}>{e.dateTs > 0 ? dateFmt.format(new Date(e.dateTs)) : ""}</span>
                </div>
                <div style={{ fontSize: "var(--text-sm)", fontWeight: e.seen ? 400 : 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {e.subject || t("mail.noSubject", { defaultValue: "(kein Betreff)" })}
                </div>
              </button>
            ))
          )}
          {envelopes.length < total && (
            <div style={{ padding: "var(--space-2)" }}>
              <Button variant="ghost" disabled={loadingList} onClick={() => void loadList(envelopes.length)}>
                {t("mail.loadMore", { defaultValue: "Mehr laden" })}
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Reader */}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", minHeight: 0 }}>
        {!message ? (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: "var(--text-sm)" }}>
            {loadingMessage ? t("pim.syncing", { defaultValue: "Aktualisiere…" }) : t("mail.pickMessage", { defaultValue: "Nachricht auswählen." })}
          </div>
        ) : (
          <>
            <div style={{ padding: "var(--space-2) var(--space-3)", borderBottom: "1px solid var(--border-color-light)", flexShrink: 0 }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--space-2)" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <h3 style={{ margin: 0, fontSize: "var(--text-md)", overflowWrap: "anywhere" }} data-testid="mail-subject">
                    {message.subject || t("mail.noSubject", { defaultValue: "(kein Betreff)" })}
                  </h3>
                  <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", overflowWrap: "anywhere" }}>
                    {message.from}
                    {message.dateTs > 0 ? ` · ${dateFmt.format(new Date(message.dateTs))}` : ""}
                  </div>
                </div>
                <Button variant="secondary" size="sm" onClick={() => void captureNote(false)} data-testid="mail-capture-note" icon={<FilePlus2 size={13} />}>
                  {t("mail.captureNote", { defaultValue: "Als Notiz ablegen" })}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => void captureNote(true)} data-testid="mail-capture-eml" icon={<FileText size={13} />}>
                  {t("mail.captureWithEml", { defaultValue: "+ .eml" })}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => void captureTask()} data-testid="mail-capture-task" icon={<ListChecks size={13} />}>
                  {t("mail.captureTask", { defaultValue: "→ Aufgabe" })}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => void replyAsNote()} data-testid="mail-reply-note" icon={<Reply size={13} />}>
                  {t("mail.replyNote", { defaultValue: "Antwort als Notiz" })}
                </Button>
              </div>
              {message.attachments.length > 0 && (
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4, fontSize: "var(--text-xs)", color: "var(--text-muted)", flexWrap: "wrap" }}>
                  <Paperclip size={11} />
                  {message.attachments.map((a) => (
                    <span key={a.index}>
                      {a.name} ({Math.max(1, Math.round(a.size / 1024))} KB)
                    </span>
                  ))}
                </div>
              )}
              {sanitized && sanitized.blockedRemote > 0 && (
                <div data-testid="mail-blocked-hint" style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4, fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
                  <ShieldOff size={11} />
                  {t("mail.remoteBlocked", { defaultValue: "Externe Inhalte blockiert ({{n}})", n: sanitized.blockedRemote })}
                </div>
              )}
            </div>
            <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
              {sanitized ? (
                <iframe
                  title={t("mail.viewer", { defaultValue: "E-Mail-Inhalt" })}
                  sandbox=""
                  srcDoc={buildMailFrameDoc(sanitized.html)}
                  data-testid="mail-frame"
                  style={{ width: "100%", height: "100%", border: "none", background: "var(--bg-primary)" }}
                />
              ) : (
                <pre data-testid="mail-text" style={{ margin: 0, padding: "var(--space-3)", whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontFamily: "inherit", fontSize: "var(--text-sm)" }}>
                  {message.text ?? ""}
                </pre>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
