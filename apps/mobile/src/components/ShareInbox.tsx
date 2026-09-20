import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Banner, Button, Chip, ICON, noteDisplayName, notifyFileOps, prepareTaskNote, toast, useStableHandler } from "@plainva/ui";
import { CheckSquare, FileText, Folder, NotebookPen, Paperclip } from "lucide-react";
import { getActiveVaultEntry, getVaultEntry } from "../services/vaultRegistry";
import { getMobileSettings } from "../services/mobileSettings";
import { getMobileWorkspaceStatus, loadMobileWorkspaceRuntime } from "../services/mobileWorkspaceSecurity";
import { listPendingShares, shareTarget, validateShare, type PendingShare, type ShareTargetPort } from "../services/shareTarget";
import { importSharedContent } from "../services/shareImport";
import { appendPlannedJournalEntry, planSharedJournalEntry } from "../services/journalService";
import { vaultOps, type MobileVault } from "../services/vaultService";
import { providerListLabel, sendTaskToProviderList } from "../services/pim/taskToProvider";
import { mConfirm } from "../services/mobileDialogs";
import { FolderPickerSheet } from "./FolderPickerSheet";
import { SheetGrip } from "./SheetGrip";

/** The native inbox owns waiting content; closing this surface only dismisses it. */
export function ShareInbox({ vault, vaultName, onChooseVault, onUnlock, onImported, port = shareTarget }: {
  vault: MobileVault; vaultName: string; onChooseVault(): void; onUnlock(): void; onImported(path: string): void; port?: ShareTargetPort;
}) {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<PendingShare[]>([]), [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null), [folder, setFolder] = useState(getMobileSettings().inboxFolder);
  const [pickFolder, setPickFolder] = useState(false), [locked, setLocked] = useState(false);
  const [error, setError] = useState<string | null>(null), [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false), [progress, setProgress] = useState("");
  const [plannedVaultName, setPlannedVaultName] = useState("");
  // "As a task" (plan Aufgaben-Oberflaeche, B6): offered when a task database is
  // set. The provider chip follows the capture sheet's rule — it appears only
  // when the database names a list, and it starts on.
  const taskDb = getMobileSettings().taskDatabase.trim();
  const [asTask, setAsTask] = useState(false), [providerList, setProviderList] = useState<string | null>(null), [atProvider, setAtProvider] = useState(true);
  // "Into the journal" (plan Journal, J4): the share becomes one entry of today's
  // daily note instead of a note of its own. It and "as a task" exclude each other.
  const [toJournal, setToJournal] = useState(false);
  useEffect(() => {
    if (!taskDb || !asTask) return;
    let stale = false;
    const adapter = { readTextFile: (p: string) => vaultOps.read(vault, p), writeTextFile: (p: string, c: string) => vaultOps.save(vault, p, c), exists: (p: string) => vault.files.exists(p) };
    void providerListLabel(adapter, taskDb).then(name => { if (!stale) setProviderList(name ?? null); }).catch(() => { if (!stale) setProviderList(null); });
    return () => { stale = true; };
  }, [taskDb, asTask, vault]);
  const dismissed = useRef(new Set<string>()), abort = useRef<AbortController | null>(null);
  const entry = entries.find(e => e.id === selected) ?? entries[0];
  useEffect(() => {
    let stale = false;
    if (entry?.plan) void getVaultEntry(entry.plan.vaultId).then(value => { if (!stale) setPlannedVaultName(value?.name ?? ""); }).catch(() => { if (!stale) setPlannedVaultName(""); });
    return () => { stale = true; };
  }, [entry?.plan]);
  const refresh = useStableHandler(async () => {
    try {
      const pending = port === shareTarget ? await listPendingShares() : (await port.listPendingShares()).entries.map(validateShare);
      setEntries(pending); setLoadError(false);
      if (pending.some(e => !dismissed.current.has(e.id))) setOpen(true);
    } catch { setLoadError(true); }
  });
  useEffect(() => {
    const poll = () => { void refresh(); };
    poll(); window.addEventListener("m-poll-share", poll);
    return () => { window.removeEventListener("m-poll-share", poll); abort.current?.abort(); };
  }, [refresh]);
  useEffect(() => {
    let disposed = false;
    const read = () => { void getMobileWorkspaceStatus(vault.vaultId).then(status => { if (!disposed) setLocked(!!status && status.phase !== "active"); }).catch(() => { if (!disposed) setLocked(true); }); };
    read(); window.addEventListener("m-workspace-security-changed", read);
    return () => { disposed = true; window.removeEventListener("m-workspace-security-changed", read); };
  }, [vault.vaultId]);
  useEffect(() => {
    if (!entries.some(e => e.status === "receiving")) return;
    const timer = setTimeout(() => void refresh(), 1500);
    return () => clearTimeout(timer);
  }, [entries, refresh]);
  const close = () => { abort.current?.abort(); entries.forEach(e => dismissed.current.add(e.id)); setOpen(false); };
  const importEntry = async () => {
    if (!entry || busy) return;
    const controller = new AbortController(); abort.current = controller; setBusy(true); setError(null);
    const taskAdapter = { readTextFile: (p: string) => vaultOps.read(vault, p), writeTextFile: (p: string, c: string) => vaultOps.save(vault, p, c), exists: (p: string) => vault.files.exists(p) };
    const makesTask = asTask && !toJournal && !!taskDb && !entry.plan;
    const intoJournal = toJournal && !entry.plan;
    let taskTitle = "";
    try {
      const path = await importSharedContent(port, entry, {
        vaultId: vault.vaultId, files: vault.files, folder, signal: controller.signal,
        // A journal plan may have to be RESUMED after a restart, whatever the chips say now.
        appendJournal: (planned) => appendPlannedJournalEntry(vault, planned),
        ...(intoJournal ? { toJournal: async () => planSharedJournalEntry() } : {}),
        ...(makesTask ? {
          asTask: async ({ title, body }) => {
            const prepared = await prepareTaskNote({ adapter: taskAdapter, dbPath: taskDb, title, noteType: getMobileSettings().defaultNoteType, trailer: body ? "\n" + body + "\n" : undefined });
            if (!prepared.ok) throw new Error("SHARE_TASK_UNAVAILABLE");
            taskTitle = title;
            return { folder: prepared.folder, text: prepared.content };
          },
        } : {}),
        ensureOpen: async () => {
          if ((await getActiveVaultEntry()).id !== vault.vaultId) throw new Error("SHARE_OTHER_VAULT");
          const status = await getMobileWorkspaceStatus(vault.vaultId);
          if (status && (status.phase !== "active" || !(await loadMobileWorkspaceRuntime(vault.vaultId)))) throw new Error("SHARE_LOCKED");
        },
        onProgress: (done, total) => setProgress(t("shareInbox.progress", { done, total })),
      });
      await vault.reindexPaths([path]).catch(() => toast.error(t("shareInbox.indexIssue")));
      // A journal entry lands in a note that usually exists already; only a new note is announced as created.
      if (!intoJournal && !entry.plan?.journal) notifyFileOps([{ type: "create", path }]);
      // The note is the deliverable and exists; the provider copy is the
      // addition — same order and same reporting as every other way of creating a task.
      if (makesTask && taskTitle && providerList && atProvider) await sendTaskToProviderList(taskAdapter, taskDb, path, taskTitle).catch(() => toast.error(t("tasks.providerCreateFailed")));
      toast.info(t("shareInbox.saved")); if (!controller.signal.aborted) onImported(path); await refresh();
    } catch (failure) {
      if (controller.signal.aborted) return;
      const code = failure instanceof Error ? failure.message : "";
      setError(code === "SHARE_TASK_UNAVAILABLE" ? t("tasks.promoteNoFolder") : code === "SHARE_LOCKED" ? t("shareInbox.locked") : code === "SHARE_OTHER_VAULT" ? t("shareInbox.otherVault") : code === "SHARE_TARGET_CHANGED" ? t("shareInbox.targetChanged") : t("shareInbox.writeFailed"));
      await refresh();
    } finally { setBusy(false); setProgress(""); }
  };
  const discard = async () => {
    if (!entry || busy || !(await mConfirm({ title: t("shareInbox.discard"), message: t("shareInbox.discardHint"), danger: true, confirmLabel: t("shareInbox.discard") }))) return;
    try { await port.finishShare({ id: entry.id, discard: true }); setError(null); await refresh(); }
    catch { setError(t("shareInbox.writeFailed")); }
  };
  if (!entry && !loadError) return null;
  return <>
    {loadError && <Banner className="m-share-notice" kind="error">{t("shareInbox.readFailed")} <Button variant="ghost" onClick={() => void refresh()}>{t("shareInbox.retry")}</Button></Banner>}
    {!open && entry && !loadError && <Banner className="m-share-notice" kind="info">{t("shareInbox.waiting", { count: entries.length })} <Button variant="ghost" onClick={() => setOpen(true)}>{t("shareInbox.review")}</Button></Banner>}
    {open && entry && <div className="m-sheet-backdrop m-sheet-backdrop--dialog" onClick={close}>
      <div className="pv-sheet m-sheet" role="dialog" aria-modal="true" aria-label={t("shareInbox.title")} data-testid="share-inbox" onClick={e => e.stopPropagation()}>
        <SheetGrip onClose={close} />
        <h2 className="m-sheet-title">{t("shareInbox.title")}</h2>
        <p className="m-hint">{t("shareInbox.waiting", { count: entries.length })}</p>
        {entries.length > 1 && entries.map(e => <Button key={e.id} disabled={busy} variant={entry.id === e.id ? "tonal" : "ghost"} aria-pressed={entry.id === e.id} onClick={() => { setSelected(e.id); setError(null); }}>{e.subject || e.text.slice(0, 60) || e.files[0]?.name || t("shareInbox.title")}</Button>)}
        <div className="m-row"><FileText size={ICON.head} /><span className="m-share-preview">{entry.subject || t("shareInbox.title")}</span></div>
        {entry.text && <p className="m-hint m-share-preview">{entry.text.slice(0, 1000)}{entry.text.length > 1000 ? "…" : ""}</p>}
        {entry.files.map(file => <div className="m-row" key={file.id}><Paperclip size={ICON.head} /><span className="m-share-preview">{file.name} · {Math.ceil(file.size / 1024)} KB</span></div>)}
        <p className="m-sectionlabel">{t("shareInbox.destination")}</p>
        <p className="m-hint m-share-preview">{entry.plan ? `${entry.plan.vaultId === vault.vaultId ? vaultName : plannedVaultName || t("shareInbox.chooseVault")} / ${entry.plan.notePath}` : toJournal ? `${vaultName} / ${planSharedJournalEntry().notePath}` : asTask && taskDb ? `${vaultName} / ${noteDisplayName(taskDb.split("/").pop() ?? taskDb)}` : `${vaultName} / ${folder || "/"}`}</p>
        {!entry.plan && (
          <div className="pv-capture-quick">
            <Chip testId="share-to-journal" icon={<NotebookPen size={ICON.meta} />} selected={toJournal} onClick={() => { setToJournal(x => !x); setAsTask(false); }}>{t("journal.shareToJournal")}</Chip>
            {taskDb && <Chip testId="share-as-task" icon={<CheckSquare size={ICON.meta} />} selected={asTask} onClick={() => { setAsTask(x => !x); setToJournal(false); }}>{t("shareInbox.asTask")}</Chip>}
            {asTask && providerList && <Chip testId="share-task-provider" selected={atProvider} onClick={() => setAtProvider(x => !x)}>{t("tasks.alsoCreateAt", { list: providerList })}</Chip>}
          </div>
        )}
        <div className="m-btnrow">
          <Button variant="ghost" disabled={busy} onClick={() => { close(); onChooseVault(); }}>{t("shareInbox.chooseVault")}</Button>
          {!entry.plan && !asTask && !toJournal && <Button variant="ghost" disabled={busy || locked} onClick={() => setPickFolder(true)}><Folder size={ICON.ui} />{t("shareInbox.chooseFolder")}</Button>}
        </div>
        {locked && <Banner kind="warning">{t("shareInbox.locked")} <Button variant="ghost" onClick={() => { close(); onUnlock(); }}>{t("workspaceSecurity.unlock")}</Button></Banner>}
        {entry.status !== "ready" && <Banner kind={entry.status === "failed" ? "error" : "info"}>{t(entry.status === "failed" ? "shareInbox.incomplete" : "shareInbox.receiving")}</Banner>}
        {error && <Banner kind="error">{error}</Banner>}
        {busy && <p className="m-hint" role="status">{progress || t("shareInbox.receiving")}</p>}
        <div className="m-btnrow">
          <Button variant="ghost" onClick={close}>{t(busy ? "common.cancel" : "shareInbox.later")}</Button>
          <Button variant="primary" disabled={busy || locked || entry.status !== "ready" || (!!entry.plan && entry.plan.vaultId !== vault.vaultId)} onClick={() => void importEntry()}>{t("shareInbox.import")}</Button>
        </div>
        <Button variant="ghost" disabled={busy} onClick={() => void discard()}>{t("shareInbox.discard")}</Button>
      </div>
    </div>}
    {pickFolder && <FolderPickerSheet vault={vault} title={t("shareInbox.chooseFolder")} onPick={setFolder} onClose={() => setPickFolder(false)} />}
  </>;
}
