import { useEffect, useRef, useState, type ClipboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { NotebookPen } from "lucide-react";
import { Button, ICON, JournalCaptureField, Modal, VoiceMemoButton, buildDailyNotePath, errorText, importAttachment, journalToday, toast, voiceMemoFileName, type VoiceMemoResult } from "@plainva/ui";
import { attachmentFolderKey, useVault } from "../../contexts/VaultContext";
import { useJournalCapture } from "../../hooks/useJournal";
import { readDailyNoteConfig } from "../../services/dailyNotes";
import { getSettingsStore } from "../../services/settingsStore";

/**
 * "Journal entry" on the desktop (plan Journal, J4): one field, one Enter. The
 * daily note neither has to be open nor has to exist.
 *
 * A task needs the task database and the provider list the tasks view already
 * holds, so this dialog builds no second task form: the named exit under the
 * field hands what was typed to that view and closes. It used to be a
 * `Segmented` labelled "Journal | Task", which drew a navigation as a mode
 * switch and collided with the "As a task" chip below it (finding 2026-09-22).
 *
 * The text is only dropped once the entry EXISTS — a capture that fails keeps
 * what was typed.
 */
export function JournalCaptureDialog({
  initialText = "",
  date,
  onClose,
  onHandoverTask,
}: {
  initialText?: string;
  /** The day the entry goes to; today when omitted. */
  date?: Date;
  onClose: () => void;
  /** Switches the kind: the tasks view takes over with the typed text. A window without that view offers no kinds. */
  onHandoverTask?: (text: string) => void;
}) {
  const { t } = useTranslation();
  const { vaultPath, vaultAdapter, indexer, triggerFileTreeUpdate } = useVault();
  const capture = useJournalCapture();
  const [value, setValue] = useState(initialText);
  const [asTask, setAsTask] = useState(false);
  const [busy, setBusy] = useState(false);
  const [target, setTarget] = useState<{ name: string; exists: boolean; folder: string } | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const day = date ?? null;

  // Which daily note this goes to, and whether it has to be created first.
  useEffect(() => {
    if (!vaultPath || !vaultAdapter) return;
    let alive = true;
    void (async () => {
      const config = await readDailyNoteConfig(vaultPath);
      const { fullPath, dateStr } = buildDailyNotePath(day ?? journalToday(), config.format || "YYYY-MM-DD", config.folder);
      const exists = await vaultAdapter.exists(fullPath);
      if (alive) setTarget({ name: dateStr, exists, folder: config.folder });
    })().catch(() => undefined);
    return () => { alive = false; };
  }, [vaultPath, vaultAdapter, day]);

  const submit = () => {
    if (busy || !value.trim()) return;
    setBusy(true);
    void capture({ text: value, task: asTask, date: day ?? undefined })
      .then((saved) => { if (saved) onClose(); })
      .finally(() => setBusy(false));
  };


  /**
   * A voice memo goes the way every attachment goes: into the attachment
   * folder, embedded by name (plan Journal-Erweiterungen, X4). The name
   * carries the date and the minute, so a day of memos reads as a list of
   * moments rather than of hashes.
   */
  const onRecorded = async (memo: VoiceMemoResult) => {
    if (!vaultAdapter || !vaultPath) return;
    try {
      const configured = (await getSettingsStore().then((st) => st.get<string>(attachmentFolderKey(vaultPath)))) ?? "Attachments";
      const { insert } = await importAttachment(
        { name: voiceMemoFileName(new Date(), t("voiceMemo.fileName"), memo.extension), mime: memo.mime, bytes: memo.bytes },
        { configuredFolder: configured, noteFolder: target?.folder ?? "" },
        {
          exists: (candidate) => vaultAdapter.exists(candidate),
          createDir: (dir) => vaultAdapter.createDir(dir),
          writeBinaryFile: (p, bytes) => vaultAdapter.writeBinaryFile(p, bytes),
        },
      );
      setValue((v) => (v.trim() ? `${v.replace(/\s+$/, "")}\n${insert}` : insert));
    } catch (error) {
      toast.error(errorText(error));
    }
  };

  // A bitmap from the clipboard goes the way every attachment goes: into the
  // attachment folder, embedded by name.
  const onPaste = (e: ClipboardEvent<HTMLDivElement>) => {
    const file = [...e.clipboardData.files].find((f) => f.type.startsWith("image/"));
    if (!file || !vaultAdapter || !vaultPath) return;
    e.preventDefault();
    void (async () => {
      try {
        const configured = (await getSettingsStore().then((st) => st.get<string>(attachmentFolderKey(vaultPath)))) ?? "Attachments";
        const { path, insert } = await importAttachment(
          { name: file.name || "", mime: file.type, bytes: new Uint8Array(await file.arrayBuffer()) },
          { configuredFolder: configured, noteFolder: target?.folder ?? "" },
          {
            exists: (candidate) => vaultAdapter.exists(candidate),
            createDir: (dir) => vaultAdapter.createDir(dir),
            writeBinaryFile: (p, bytes) => vaultAdapter.writeBinaryFile(p, bytes),
          },
        );
        if (indexer) { await indexer.indexPath(path); triggerFileTreeUpdate([path]); }
        const field = inputRef.current;
        const at = field ? field.selectionStart ?? value.length : value.length;
        setValue((v) => `${v.slice(0, at)}${v && at > 0 && !/\s$/.test(v.slice(0, at)) ? " " : ""}${insert}${v.slice(at)}`);
        toast.info(t("journal.attachImage"));
      } catch (error) {
        toast.error(errorText(error));
      }
    })();
  };

  return (
    <Modal
      onClose={onClose}
      title={t("journal.newEntry")}
      icon={<NotebookPen size={ICON.head} />}
      size="md"
      testId="journal-capture-dialog"
      initialFocusRef={inputRef}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>{t("common.cancel")}</Button>
          <Button variant="primary" onClick={submit} disabled={busy || !value.trim()} data-testid="journal-capture-save">{t("journal.save")}</Button>
        </>
      }
    >
      <div className="pv-journal-dialog" onPaste={onPaste}>
        <JournalCaptureField
          inputRef={inputRef}
          value={value}
          onChange={setValue}
          asTask={asTask}
          onAsTask={setAsTask}
          onSubmit={submit}
          onHandover={onHandoverTask && (() => onHandoverTask(value))}
          disabled={busy}
          rows={3}
          target={target && t(target.exists ? "journal.target" : "journal.targetNew", { name: target.name })}
          extras={<VoiceMemoButton disabled={busy} onRecorded={onRecorded} />}
        />
      </div>
    </Modal>
  );
}
