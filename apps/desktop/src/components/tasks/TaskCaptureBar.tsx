import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Chip, TaskCaptureField, type CaptureResult } from "@plainva/ui";

/**
 * Quick capture above the task lists (plan Aufgaben-Oberfläche, B2): one line,
 * Enter, and the task note exists with its date, time, priority, tags and
 * rhythm — the phone's twin is TaskCaptureSheet. It replaces the title prompt
 * "+ New task" used to open.
 *
 * The text is only cleared once the task EXISTS: a capture that fails (no
 * storage folder, an unreadable database) keeps what was typed.
 */
export function TaskCaptureBar({
  todayKey,
  providerList,
  focusTick,
  initialValue = "",
  onSubmit,
}: {
  todayKey: string;
  /** Name of the provider list a new task can also go to; null = none set. */
  providerList: string | null;
  /** Bumped by "New task" from the ribbon, the palette or the section button. */
  focusTick: number;
  /** Text a request brought along (the capture dialog's kind switch); the bar is keyed by such a request. */
  initialValue?: string;
  /** Resolves true when the task was created. */
  onSubmit: (result: CaptureResult, alsoAtProvider: boolean) => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState(initialValue);
  // Starts on, because choosing a list for the database already WAS the
  // decision; the chip is there so a single task can stay in the vault.
  const [atProvider, setAtProvider] = useState(true);
  const [busy, setBusy] = useState(false);
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (focusTick > 0) hostRef.current?.querySelector("input")?.focus();
  }, [focusTick]);

  return (
    <div ref={hostRef}>
      <TaskCaptureField
        value={value}
        onChange={setValue}
        todayKey={todayKey}
        onCancel={() => setValue("")}
        onSubmit={(result) => {
          if (busy) return;
          setBusy(true);
          void onSubmit(result, providerList !== null && atProvider)
            .then((created) => { if (created) setValue(""); })
            .finally(() => setBusy(false));
        }}
        extras={
          providerList
            ? () => (
                <div className="pv-capture-quick">
                  <Chip testId="task-capture-provider" selected={atProvider} onClick={() => setAtProvider((x) => !x)}>
                    {t("tasks.alsoCreateAt", { list: providerList })}
                  </Chip>
                </div>
              )
            : undefined
        }
      />
    </div>
  );
}
