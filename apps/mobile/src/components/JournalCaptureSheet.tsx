import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Camera as CameraIcon } from "lucide-react";
import { Camera } from "@capacitor/camera";
import { Filesystem } from "@capacitor/filesystem";
import { Button, Chip, ICON, JournalCaptureField, Segmented, buildDailyNotePath, toast, useTodayKey } from "@plainva/ui";
import { SheetGrip } from "./SheetGrip";
import { captureJournalEntry } from "../services/journalService";
import { getMobileSettings } from "../services/mobileSettings";
import { availablePhotoPath, cameraErrorMessage, isCameraCancellation, mediaResultBytes } from "../services/photoCapture";
import { syncSoon } from "../services/syncService";
import type { MobileVault } from "../services/vaultService";

/**
 * Journal capture on the phone (plan Journal, J4): the other kind of the capture
 * sheet. The task kind lives in the tasks screen, which holds the task database
 * and the provider list; choosing "Task" here hands over what was typed and
 * opens that sheet. The FAB, the launcher shortcut, the "Today" section and the
 * journal screen all open this one.
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
  const [year, month, dayOfMonth] = useTodayKey().split("-").map(Number);
  const target = buildDailyNotePath(date ?? new Date(year, month - 1, dayOfMonth), ms.dailyFormat || "YYYY-MM-DD", ms.dailyFolder).dateStr;

  const submit = () => {
    if (busy || !value.trim()) return;
    setBusy(true);
    void captureJournalEntry(vault, { text: value, task: asTask, date })
      .then((saved) => { if (saved) onClose(); })
      .finally(() => setBusy(false));
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
        <Segmented
          ariaLabel={t("journal.kindLabel")}
          size="sm"
          value="journal"
          onChange={(kind) => { if (kind === "task") onSwitchToTask(value); }}
          options={[
            { value: "task", label: t("journal.kindTask"), testId: "capture-kind-task" },
            { value: "journal", label: t("journal.kindJournal"), testId: "capture-kind-journal" },
          ]}
        />
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
          disabled={busy}
          hint={`${t("journal.target", { name: target })} · ${t("journal.captureHintTouch")}`}
          extras={
            <Chip icon={<CameraIcon size={ICON.meta} />} onClick={() => void addPhoto()} testId="journal-capture-photo">
              {t("journal.attachPhoto")}
            </Chip>
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
