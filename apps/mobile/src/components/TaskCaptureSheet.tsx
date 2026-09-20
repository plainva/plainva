import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  addDaysToKey, Button, Chip, nextPriorityWord, Segmented, setCaptureWord, TaskCaptureField, TextInput,
  type CaptureResult, type TaskCaptureApi,
} from "@plainva/ui";
import { SheetGrip } from "./SheetGrip";

/**
 * Quick capture on the phone (plan Aufgaben-Oberfläche, B2): the desktop's
 * capture field in a sheet, plus buttons for everyone who would rather not
 * type "morgen 14 Uhr".
 *
 * The buttons WRITE into the sentence (`setCaptureWord`) instead of keeping a
 * second state beside it: what the field shows is what will be saved, whether
 * it was typed or tapped, and a brick switched off stays switched off.
 */
export function TaskCaptureSheet({
  todayKey,
  providerList,
  initialValue = "",
  onClose,
  onSubmit,
  onSwitchToJournal,
}: {
  todayKey: string;
  /** Text a request brought along — the journal sheet's kind switch hands over what was typed. */
  initialValue?: string;
  /** The other kind of the capture (plan Journal, J4): takes the typed text to the journal sheet. */
  onSwitchToJournal?: (text: string) => void;
  /** Name of the provider list a new task can also go to; null = none set. */
  providerList: string | null;
  onClose: () => void;
  onSubmit: (result: CaptureResult, alsoAtProvider: boolean) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState(initialValue);
  const [picker, setPicker] = useState<"date" | "time" | null>(null);
  // Starts on, because choosing a list for the database already WAS the decision;
  // the chip is there so a single task can stay in the vault (same as the desktop).
  const [atProvider, setAtProvider] = useState(true);
  const [busy, setBusy] = useState(false);

  const quick = ({ result, vocab, submit }: TaskCaptureApi) => {
    const put = (kind: "date" | "time" | "priority" | "repeat", word: string) => setValue((v) => setCaptureWord(v, result, kind, word));
    const repeatWords = [vocab.daily[0], vocab.weekly[0], vocab.monthly[0]].filter(Boolean);
    const nextRepeat = () => {
      const at = result.repeat ? ["daily", "weekly", "monthly"].indexOf(result.repeat.freq) : -1;
      put("repeat", at + 1 < repeatWords.length ? repeatWords[at + 1] : "");
    };
    return (
      <>
        <div className="pv-capture-quick" data-testid="task-capture-quick">
          <Chip onClick={() => put("date", vocab.today[0] ?? todayKey)} selected={result.due === todayKey}>
            {t("tasks.plannerToday")}
          </Chip>
          <Chip onClick={() => put("date", vocab.tomorrow[0] ?? addDaysToKey(todayKey, 1))} selected={result.due === addDaysToKey(todayKey, 1)}>
            {t("tasks.captureQuickTomorrow")}
          </Chip>
          <Chip onClick={() => setPicker(picker === "date" ? null : "date")} selected={picker === "date"}>
            {t("tasks.capturePickDate")}
          </Chip>
          <Chip onClick={() => setPicker(picker === "time" ? null : "time")} selected={picker === "time"}>
            {t("tasks.capturePickTime")}
          </Chip>
          <Chip onClick={() => put("priority", nextPriorityWord(result.priority))} selected={result.priority > 0}>
            {t("tasks.priority")}
          </Chip>
          <Chip onClick={nextRepeat} selected={result.repeat !== null}>
            {t("tasks.repeat")}
          </Chip>
          {providerList && (
            <Chip testId="task-capture-provider" onClick={() => setAtProvider((x) => !x)} selected={atProvider}>
              {t("tasks.alsoCreateAt", { list: providerList })}
            </Chip>
          )}
        </div>
        {picker === "date" && (
          <TextInput
            aria-label={t("tasks.capturePickDate")}
            data-testid="task-capture-date"
            type="date"
            value={result.due ?? ""}
            onChange={(e) => { if (e.target.value) put("date", e.target.value); }}
          />
        )}
        {picker === "time" && (
          <TextInput
            aria-label={t("tasks.capturePickTime")}
            data-testid="task-capture-time"
            type="time"
            value={result.minutes === null ? "" : `${String(Math.floor(result.minutes / 60)).padStart(2, "0")}:${String(result.minutes % 60).padStart(2, "0")}`}
            onChange={(e) => { if (e.target.value) put("time", e.target.value); }}
          />
        )}
        <div className="m-btnrow">
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" data-testid="task-capture-submit" disabled={busy} onClick={submit}>
            {t("tasks.captureCreate")}
          </Button>
        </div>
      </>
    );
  };

  return (
    <div className="m-sheet-backdrop m-sheet-backdrop--dialog" onClick={onClose}>
      <div className="pv-sheet m-sheet" data-testid="task-capture-sheet" onClick={(e) => e.stopPropagation()}>
        <SheetGrip onClose={onClose} />
        <p className="m-sheet-title">{t("tasks.newTask")}</p>
        {onSwitchToJournal && (
          <Segmented
            ariaLabel={t("journal.kindLabel")}
            size="sm"
            value="task"
            onChange={(kind) => { if (kind === "journal") onSwitchToJournal(value); }}
            options={[
              { value: "task", label: t("journal.kindTask"), testId: "capture-kind-task" },
              { value: "journal", label: t("journal.kindJournal"), testId: "capture-kind-journal" },
            ]}
          />
        )}
        <TaskCaptureField
          autoFocus
          value={value}
          onChange={setValue}
          todayKey={todayKey}
          onCancel={onClose}
          onSubmit={(result) => {
            if (busy) return;
            setBusy(true);
            void onSubmit(result, providerList !== null && atProvider).finally(() => setBusy(false));
          }}
          extras={quick}
        />
      </div>
    </div>
  );
}
