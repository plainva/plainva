import { useTranslation } from "react-i18next";
import type { PimSyncProblem } from "@plainva/core";
import { Banner } from "./ui/Banner";
import { Button } from "./ui/Button";
import { describeSyncProblems } from "../pim/syncProblems";

/**
 * The line above the calendar (plan Befunde 2026-10-06, K1): which account or
 * calendar is not being synced, since when and why — with the events it still
 * holds left on screen below it. One component for both shells, so the
 * sentence and the action cannot drift apart; nothing is rendered while
 * everything is fresh.
 *
 * "Try again" is a manual refresh, and that is the whole point of it: the
 * worker asks every account on one, the parked and the waiting included.
 */
export function CalendarSyncNotice({
  problems,
  onRetry,
  busy,
}: {
  problems: readonly PimSyncProblem[];
  onRetry: () => void;
  /** A cycle is running: the action waits for its answer. */
  busy?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const notice = describeSyncProblems(problems, t, i18n.language);
  if (!notice) return null;
  return (
    <div data-testid="calendar-sync-notice">
      <Banner
        kind="warning"
        actions={
          <Button size="sm" disabled={busy} onClick={onRetry} data-testid="calendar-sync-retry">
            {t("pim.tryAgain")}
          </Button>
        }
      >
        {notice.lines.map((line) => (
          <span className="pv-syncnote-line" data-testid="calendar-sync-line" key={line.key}>
            {line.text}
          </span>
        ))}
        {notice.more > 0 ? <span className="pv-syncnote-line">{t("pim.notSyncedMore", { n: notice.more })}</span> : null}
      </Banner>
    </div>
  );
}
