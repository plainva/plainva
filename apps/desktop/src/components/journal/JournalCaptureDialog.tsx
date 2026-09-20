import { useEffect, useRef, useState, type ClipboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { NotebookPen } from "lucide-react";
import { Button, ICON, JournalCaptureField, Modal, Segmented, buildDailyNotePath, errorText, importAttachment, toast } from "@plainva/ui";
import { attachmentFolderKey, useVault } from "../../contexts/VaultContext";
import { useJournalCapture } from "../../hooks/useJournal";
import { readDailyNoteConfig } from "../../services/dailyNotes";
import { getSettingsStore } from "../../services/settingsStore";

/**
 * "Journal entry" on the desktop (plan Journal, J4): one field, one Enter. The
 * daily note neither has to be open nor has to exist.
 *
 * The capture has two kinds, as the phone's sheet has. A task needs the task
 * database and the provider list the tasks view already holds, so choosing
 * "Task" does not build a second task form here: it hands what was typed to
 * that view's capture field and closes.
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
      const { fullPath, dateStr } = buildDailyNotePath(day ?? new Date(), config.format || "YYYY-MM-DD", config.folder);
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
        {onHandoverTask && <Segmented
          ariaLabel={t("journal.kindLabel")}
          size="sm"
          value="journal"
          onChange={(kind) => { if (kind === "task") onHandoverTask(value); }}
          options={[
            { value: "journal", label: t("journal.kindJournal"), testId: "capture-kind-journal" },
            { value: "task", label: t("journal.kindTask"), testId: "capture-kind-task" },
          ]}
        />}
        <JournalCaptureField
          inputRef={inputRef}
          value={value}
          onChange={setValue}
          asTask={asTask}
          onAsTask={setAsTask}
          onSubmit={submit}
          disabled={busy}
          rows={3}
          hint={
            <>
              {target && <span data-testid="journal-capture-target">{t(target.exists ? "journal.target" : "journal.targetNew", { name: target.name })} · </span>}
              {t("journal.captureHint")}
            </>
          }
        />
      </div>
    </Modal>
  );
}
