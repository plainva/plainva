import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { resolveDefaultCalendarKey, toast } from "@plainva/ui";
import type { PimEventRow } from "@plainva/core";
import { isoOf } from "../lib/dates";
import { getMobileSettings } from "../services/mobileSettings";
import { mConfirm, mSelect } from "../services/mobileDialogs";
import {
  createPimEvent,
  deletePimEvent,
  openMeetingNoteFor,
  pimSeriesMaster,
  respondToPimEvent,
  updatePimEvent,
  writablePimCalendarOptions,
} from "../services/pim/pimService";
import { EventEditSheet, type EventEditValues } from "./EventEditSheet";

/**
 * What opening an appointment means — decided once (N1.3).
 *
 * It used to be decided only inside the calendar screen: the action menu, the
 * series scope question, the delete confirmation, the meeting note and the
 * RSVP replies were ~150 lines local to that file. So "Today" could not open
 * an appointment at all — its event row was a plain `<div>` with no `onClick`,
 * no `role` and no keyboard handling, and there was no way from Today to an
 * appointment (Gesamtplan § 3.6).
 *
 * Copying those lines into Today would have produced the second version of a
 * decision that must be one — which is the mechanism this whole rework exists
 * to undo. So the calendar gave the logic up rather than Today borrowing it,
 * and both screens now call the same thing.
 *
 * Writes announce themselves on `m-pim-changed`, so a screen refreshes on its
 * own after an edit; the editor deliberately takes no reload callback.
 */
export function useEventEditor({
  bump = 0,
  onOpenNote,
}: {
  /** Re-reads the default-calendar setting when the host refreshes. */
  bump?: number;
  /** Where a meeting note opens. Without it that action still writes the note. */
  onOpenNote?: (path: string) => void;
} = {}) {
  const { t, i18n } = useTranslation();
  const [calendars, setCalendars] = useState<Array<{ value: string; label: string }>>([]);
  const [sheet, setSheet] = useState<{ event: PimEventRow | null; startTs: number; endTs: number } | null>(null);

  useEffect(() => {
    void writablePimCalendarOptions().then(setCalendars);
  }, [bump]);

  /**
   * Which calendar a new event starts in (S27). Configured per vault, so the
   * choice travels with the settings profile; a calendar that has since gone
   * away falls back to the first writable one rather than to nothing.
   */
  // Depends on the SETTING, not on a refresh counter: the module-cached read
  // is cheap enough to run every render, and this way the pre-selection also
  // follows a change made while the screen is open.
  const configured = getMobileSettings().defaultCalendar.trim();
  const defaultCalendarKey = useMemo(
    () => resolveDefaultCalendarKey(calendars, configured),
    [calendars, configured],
  );

  const timeLabel = (e: PimEventRow) => {
    if (e.allDay) return t("pim.allDay", { defaultValue: "Ganztägig" });
    const fmt = new Intl.DateTimeFormat(i18n.language, { hour: "2-digit", minute: "2-digit" });
    return `${fmt.format(new Date(e.start.ts))}–${fmt.format(new Date(e.end.ts))}`;
  };

  const openCreate = (startTs: number) => {
    if (calendars.length === 0) {
      toast.warning(t("pim.noWritableCalendar"));
      return;
    }
    setSheet({ event: null, startTs, endTs: startTs + 60 * 60_000 });
  };

  const confirmDelete = async (target: PimEventRow) => {
    const ok = await mConfirm({
      title: t("pim.deleteEvent"),
      message: target.title,
      danger: true,
      confirmLabel: t("common.delete"),
    });
    if (!ok) return false;
    try {
      await deletePimEvent(target);
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
      return false;
    }
  };

  const openEvent = async (e: PimEventRow) => {
    const options: Array<{ value: string; label: string }> = [
      { value: "edit", label: t("pim.editEvent") },
      { value: "delete", label: t("pim.deleteEvent") },
      { value: "meeting", label: t("pim.meetingNote") },
    ];
    if (e.selfResponse) {
      options.push({ value: "accepted", label: t("pim.rsvpAccept", { defaultValue: "Zusagen" }) });
      options.push({ value: "tentative", label: t("pim.rsvpTentative", { defaultValue: "Vorläufig" }) });
      options.push({ value: "declined", label: t("pim.rsvpDecline", { defaultValue: "Absagen" }) });
    }
    const pick = await mSelect({
      title: e.title,
      message: `${timeLabel(e)}${e.location ? ` · ${e.location}` : ""}`,
      options,
    });

    if (pick === "edit" || pick === "delete") {
      // A series instance asks WHICH occurrences first (S25): editing one and
      // silently changing all of them is the worst possible outcome here.
      let subject = e;
      if (e.seriesMaster) {
        const scope = await mSelect({
          title: t("pim.seriesTitle"),
          message: t(pick === "edit" ? "pim.seriesEditMsg" : "pim.seriesDeleteMsg", { title: e.title }),
          options: [
            { value: "this", label: t("pim.seriesThis") },
            { value: "all", label: t("pim.seriesAll") },
          ],
        });
        if (scope === null) return;
        if (scope === "all") {
          const master = await pimSeriesMaster(e);
          if (!master) {
            toast.error(t("pim.eventWriteFailed"));
            return;
          }
          subject = master;
        }
      }
      if (pick === "edit") setSheet({ event: subject, startTs: subject.start.ts, endTs: subject.end.ts });
      else await confirmDelete(subject);
      return;
    }

    if (pick === "meeting") {
      try {
        const res = await openMeetingNoteFor(e, isoOf(new Date(e.start.ts)));
        if (res.created) toast.success(t("pim.meetingNoteCreated", { name: res.path.split("/").pop() ?? res.path }));
        onOpenNote?.(res.path);
      } catch {
        toast.error(t("pim.meetingNoteFailed"));
      }
      return;
    }

    if (pick === "accepted" || pick === "declined" || pick === "tentative") {
      try {
        await respondToPimEvent(e, pick);
        toast.success(t("pim.rsvpSent", { defaultValue: "Antwort gesendet" }));
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
      }
    }
  };

  const save = async (values: EventEditValues) => {
    const target = sheet?.event ?? null;
    try {
      if (target) {
        const out = await updatePimEvent(target, values.draft, values.calendarKey);
        if (out.kind === "conflict") {
          setSheet(null);
          toast.info(t("pim.eventConflict"));
          return;
        }
        if (out.kind === "duplicate") toast.error(out.error instanceof Error ? out.error.message : String(out.error));
      } else {
        await createPimEvent(values.calendarKey, values.draft);
      }
      setSheet(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  const remove = async () => {
    const target = sheet?.event;
    if (!target) return;
    if (await confirmDelete(target)) setSheet(null);
  };

  /** Render this wherever the host wants the sheet to appear. */
  const element = sheet ? (
    <EventEditSheet
      calendars={calendars}
      event={sheet.event}
      initial={{ startTs: sheet.startTs, endTs: sheet.endTs, calendarKey: defaultCalendarKey }}
      onClose={() => setSheet(null)}
      onDelete={sheet.event ? () => void remove() : undefined}
      onSave={save}
    />
  ) : null;

  return { openEvent, openCreate, element, writableCount: calendars.length };
}
