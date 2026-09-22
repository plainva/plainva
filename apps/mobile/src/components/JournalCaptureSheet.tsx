import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Camera as CameraIcon } from "lucide-react";
import { Camera } from "@capacitor/camera";
import { Filesystem } from "@capacitor/filesystem";
import { Button, Chip, ICON, JournalCaptureField, VoiceMemoButton, buildDailyNotePath, errorText, importAttachment, toast, useJournalDayKey, voiceMemoFileName, type VoiceMemoResult } from "@plainva/ui";
import { SheetGrip } from "./SheetGrip";
import { captureJournalEntry } from "../services/journalService";
import { getMobileSettings } from "../services/mobileSettings";
import { availablePhotoPath, cameraErrorMessage, isCameraCancellation, mediaResultBytes } from "../services/photoCapture";
import { syncSoon } from "../services/syncService";
import type { MobileVault } from "../services/vaultService";

/**
 * Journal capture on the phone (plan Journal, J4). A task lives in the tasks
 * screen, which holds the task database and the provider list; the named exit
 * under the field hands over what was typed and opens that sheet. The FAB, the
 * launcher shortcut, the "Today" section and the journal screen all open this
 * one. The exit replaced a `Segmented` that drew the navigation as a mode
 * switch (finding 2026-09-22).
 *
 * Enter stays a line break — a soft keyboard has no Shift+Enter — and a button
 * saves. The text is only dropped once the entry EXISTS.
 */
export function JournalCaptureSheet({
  vault,
  initialText = "",
  date,
  onClose,
  onSwitchToTask,
}: {
  vault: MobileVault;
  initialText?: string;
  /** The day the entry goes to; today when omitted. */
  date?: Date;
  onClose: () => void;
  onSwitchToTask: (text: string) => void;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState(initialText);
  const [asTask, setAsTask] = useState(false);
  const [busy, setBusy] = useState(false);
  const ms = getMobileSettings();
  // "Today" as state, never a clock read during render: the sheet may stay open over midnight.
  const [year, month, dayOfMonth] = useJournalDayKey().split("-").map(Number);
  const target = buildDailyNotePath(date ?? new Date(year, month - 1, dayOfMonth), ms.dailyFormat || "YYYY-MM-DD", ms.dailyFolder).dateStr;

  const submit = () => {
    if (busy || !value.trim()) return;
    setBusy(true);
    void captureJournalEntry(vault, { text: value, task: asTask, date })
      .then((saved) => { if (saved) onClose(); })
      .finally(() => setBusy(false));
  };

  /** A voice memo, written the way the photo is (plan Journal-Erweiterungen, X4). */
  const onRecorded = async (memo: VoiceMemoResult) => {
    try {
      const { insert } = await importAttachment(
        { name: voiceMemoFileName(new Date(), t("voiceMemo.fileName"), memo.extension), mime: memo.mime, bytes: memo.bytes },
        { configuredFolder: ms.attachmentFolder || "Attachments", noteFolder: ms.dailyFolder || "" },
        {
          exists: (candidate) => vault.adapter.exists(candidate),
          createDir: (dir) => vault.adapter.createDir(dir),
          writeBinaryFile: (p, bytes) => vault.adapter.writeBinaryFile(p, bytes),
        },
      );
      setValue((v) => (v.trim() ? `${v.replace(/\s+$/, "")}\n${insert}` : insert));
    } catch (error) {
      toast.error(errorText(error));
    }
  };

  // A photo goes the way every photo goes: into the attachment folder, embedded by name.
  const addPhoto = async () => {
    try {
      const photo = await Camera.takePhoto({ quality: 85, includeMetadata: true });
      if (!photo) return;
      const bytes = await mediaResultBytes(photo, (uri) => Filesystem.readFile({ path: uri }));
      const name = await availablePhotoPath((candidate) => vault.files.exists(candidate), photo);
      await vault.files.writeBinaryFile(name, bytes);
      syncSoon();
      setValue((v) => `${v}${v && !/\s$/.test(v) ? " " : ""}![[${name}]]`);
      toast.info(t("journal.attachImage"));
    } catch (error) {
      if (!isCameraCancellation(error)) toast.error(cameraErrorMessage(error));
    }
  };

  return (
    <div className="m-sheet-backdrop m-sheet-backdrop--dialog" onClick={onClose}>
      <div className="pv-sheet m-sheet" data-testid="journal-capture-sheet" onClick={(e) => e.stopPropagation()}>
        <SheetGrip onClose={onClose} />
        <p className="m-sheet-title">{t("journal.newEntry")}</p>
        <JournalCaptureField
          autoFocus
          enterSubmits={false}
          rows={3}
          value={value}
          onChange={setValue}
          asTask={asTask}
          onAsTask={setAsTask}
          onSubmit={submit}
          onCancel={onClose}
          onHandover={() => onSwitchToTask(value)}
          disabled={busy}
          target={t("journal.target", { name: target })}
          extras={
            <>
              <Chip icon={<CameraIcon size={ICON.meta} />} onClick={() => void addPhoto()} testId="journal-capture-photo">
                {t("journal.attachPhoto")}
              </Chip>
              <VoiceMemoButton disabled={busy} onRecorded={onRecorded} />
            </>
          }
        />
        <div className="m-btnrow">
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" data-testid="journal-capture-save" disabled={busy || !value.trim()} onClick={submit}>
            {t("journal.save")}
          </Button>
        </div>
      </div>
    </div>
  );
}
