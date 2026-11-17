import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { PimSyncProblem } from "@plainva/core";
import { Banner } from "./ui/Banner";
import { Button } from "./ui/Button";
import { needsTaskDatabase } from "../pim/syncProblems";
import { hideTaskDbHint, isTaskDbHintHidden } from "../lib/taskDbHintStore";

/**
 * The quiet hint for task lists without a standard task database (issue 172,
 * maintainer 2026-11-16): ONE neutral line however many lists wait — not a
 * warning per list, since a calendar-only account with its task lists left on
 * is no fault. It names what is missing, offers to create the database, and
 * can be put away for this vault on this device (`taskDbHintStore`). Real
 * faults stay in the yellow notice (`CalendarSyncNotice`), which gets the
 * problems without these lines (`withoutTaskDatabaseLines`).
 */
export function TaskDatabaseHint({
  vault,
  problems,
  taskDatabase,
  onCreate,
  testId = "task-db-hint",
}: {
  /** The key the hidden mark is kept under (the vault path or id). */
  vault: string | null;
  problems: readonly PimSyncProblem[];
  /**
   * The vault's standard task database as this shell knows it right now. Set,
   * the hint is gone at once, whatever line an earlier run left: offering to
   * create one then makes a second database (review of issue 172).
   */
  taskDatabase: string | null;
  /** The text names this button, so the hint exists only where it can be offered. */
  onCreate: () => void;
  testId?: string;
}) {
  const { t } = useTranslation();
  const [hiddenNow, setHiddenNow] = useState<string | null>(null);
  if (taskDatabase?.trim()) return null;
  if (!needsTaskDatabase(problems)) return null;
  if (hiddenNow === vault || isTaskDbHintHidden(vault)) return null;
  return (
    <Banner
      kind="info"
      testId={testId}
      actions={
        <>
          <Button size="sm" variant="primary" onClick={onCreate} data-testid={`${testId}-create`}>
            {t("settings.taskDatabaseCreate")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              hideTaskDbHint(vault);
              setHiddenNow(vault);
            }}
            data-testid={`${testId}-hide`}
          >
            {t("tasks.taskDbHintHide")}
          </Button>
        </>
      }
    >
      {t("tasks.taskDbHint")}
    </Banner>
  );
}
