import { type ReactElement, type ReactNode, type HTMLAttributes } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight, Pen } from "lucide-react";
import type { JournalEntry } from "@plainva/core";
import type { InlineLinkHandlers } from "../lib/inlineMarkdown";
import type { JournalDay } from "../lib/journalFeed";
import type { JournalActions } from "../hooks/useJournalActions";
import { ICON } from "../lib/iconSizes";
import { Button } from "./ui/Button";
import { IconButton } from "./ui/IconButton";
import { SectionLabel } from "./ui/GroupedRows";
import { JournalCaptureField } from "./JournalCaptureField";
import { JournalDayList } from "./JournalDayList";

/**
 * "Journal" of ONE day (plan Journal, J5) — the section the phone's Today screen
 * shows for the selected day: its entries, the way to all days, and a pen that
 * writes into exactly this day.
 *
 * The rows are the stream's rows (`JournalDayList`, without its day heading), so
 * a box ticks, a menu opens and an edit saves here as they do there.
 *
 * The pen opens the shell's ordinary capture surface with this day as its
 * target. It used to be an inline one-line input, which was a second way to
 * write a journal entry — with its own placeholder, its own Enter rule and no
 * task chip (finding 2026-09-22). One capture surface, opened from wherever.
 */
export interface JournalDaySectionProps {
  day: JournalDay;
  todayKey: string;
  actions: JournalActions;
  /** Opens the shell's capture surface for this day. */
  onCapture: () => void;
  onOpenAll: () => void;
  onOpenEntry: (day: JournalDay, entry: JournalEntry) => void;
  onMenu: (day: JournalDay, entry: JournalEntry, at: { x: number; y: number }) => void;
  links?: InlineLinkHandlers;
  loadImage?: (path: string) => Promise<Blob>;
  wrapRow?: (day: JournalDay, entry: JournalEntry, element: ReactElement) => ReactNode;
  rowProps?: (day: JournalDay, entry: JournalEntry) => Omit<HTMLAttributes<HTMLElement>, "onClick" | "title" | "className">;
  /** Enter saves an edit (desktop); the phone saves with a button. */
  enterSubmits?: boolean;
}

export function JournalDaySection({ day, todayKey, actions, onCapture, onOpenAll, onOpenEntry, onMenu, links, loadImage, wrapRow, rowProps, enterSubmits = true }: JournalDaySectionProps) {
  const { t, i18n } = useTranslation();
  const newLabel = day.key === todayKey
    ? t("journal.fieldToday")
    : t("journal.fieldDay", { date: new Intl.DateTimeFormat(i18n.language, { day: "numeric", month: "short" }).format(day.date) });

  return (
    <section className="pv-journal-section" data-testid="journal-day-section">
      <SectionLabel end={<IconButton label={newLabel} onClick={onCapture} data-testid="journal-section-new"><Pen size={ICON.ui} /></IconButton>}>
        {t("journal.sectionTitle")}{day.entries.length > 0 ? ` · ${day.entries.length}` : ""}
      </SectionLabel>
      {day.entries.length > 0 && (
        <JournalDayList
          headless
          days={[day]}
          todayKey={todayKey}
          links={links}
          loadImage={loadImage}
          onToggleTask={actions.toggle}
          onOpenNote={() => undefined}
          onOpenEntry={onOpenEntry}
          onMenu={onMenu}
          wrapRow={wrapRow}
          rowProps={rowProps}
          editing={actions.editing}
          renderEditor={(d, entry) => (
            <JournalCaptureField
              testId="journal-edit"
              autoFocus
              enterSubmits={enterSubmits}
              time={entry.time}
              value={actions.editing?.text ?? ""}
              onChange={(text) => actions.setEditing((draft) => (draft ? { ...draft, text } : draft))}
              asTask={actions.editing?.asTask ?? false}
              onAsTask={(asTask) => actions.setEditing((draft) => (draft ? { ...draft, asTask } : draft))}
              onCancel={() => actions.setEditing(null)}
              onSubmit={() => actions.saveEdit(d, entry)}
              hint={enterSubmits ? undefined : null}
              extras={
                <>
                  <Button variant="ghost" size="sm" onClick={() => actions.setEditing(null)}>{t("common.cancel")}</Button>
                  {!enterSubmits && <Button variant="primary" size="sm" onClick={() => actions.saveEdit(d, entry)}>{t("journal.editSave")}</Button>}
                </>
              }
            />
          )}
        />
      )}
      <Button variant="ghost" size="sm" className="pv-journal-all" onClick={onOpenAll} data-testid="journal-section-all">
        {t("journal.allDays")}
        <ArrowRight size={ICON.meta} />
      </Button>
    </section>
  );
}
