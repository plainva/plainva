import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { applyEventChanges, describeEventChanges, eventChangeLabel, eventFormFromEvent, eventFormToDraft, resolveDefaultCalendarKey, toast } from "@plainva/ui";
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
import { EventPeekSheet } from "./EventPeekSheet";

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
  rows = [],
}: {
  /** Re-reads the default-calendar setting when the host refreshes. */
  bump?: number;
  /** Where a meeting note opens. Without it that action still writes the note. */
  onOpenNote?: (path: string) => void;
  /** The rows the host has loaded — the preview reads the next occurrence of a
   *  series from them. Omitted, the preview simply says nothing about it, which
   *  is the honest answer when the window is not known. */
  rows?: readonly PimEventRow[];
} = {}) {
  const { t } = useTranslation();
  const [calendars, setCalendars] = useState<Array<{ value: string; label: string }>>([]);
  const [sheet, setSheet] = useState<{ event: PimEventRow | null; startTs: number; endTs: number } | null>(null);
  /** The event whose PREVIEW is open (S4) — a tap opens this, not the form. */
  const [peek, setPeek] = useState<PimEventRow | null>(null);

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

  /**
   * A tap on an event opens the PREVIEW (S4) — the phone's shape for the
   * desktop's floating window. It used to open a bare list of verbs that said
   * nothing about the event beyond its title and time.
   */
  const openEvent = (e: PimEventRow) => setPeek(e);

  const deleteFromPeek = async (e: PimEventRow) => {
    setPeek(null);
    // Deleting an occurrence still asks first — there the tap IS the change.
    let subject = e;
    if (e.seriesMaster) {
      const scope = await mSelect({
        title: t("pim.seriesTitle"),
        message: t("pim.seriesDeleteMsg", { title: e.title }),
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
    await confirmDelete(subject);
  };

  const meetingNoteFromPeek = async (e: PimEventRow) => {
    setPeek(null);
    try {
      const res = await openMeetingNoteFor(e, isoOf(new Date(e.start.ts)));
      if (res.created) toast.success(t("pim.meetingNoteCreated", { name: res.path.split("/").pop() ?? res.path }));
      onOpenNote?.(res.path);
    } catch {
      toast.error(t("pim.meetingNoteFailed"));
    }
  };

  const respondFromPeek = async (e: PimEventRow, response: "accepted" | "declined" | "tentative") => {
    setPeek(null);
    try {
      await respondToPimEvent(e, response);
      toast.success(t("pim.rsvpSent", { defaultValue: "Antwort gesendet" }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  /** Writes an edited form against ONE event — the occurrence or the master. */
  const writeTo = async (target: PimEventRow, values: EventEditValues) => {
    try {
      const out = await updatePimEvent(target, values.draft, values.calendarKey);
      if (out.kind === "conflict") {
        setSheet(null);
        toast.info(t("pim.eventConflict"));
        return;
      }
      if (out.kind === "duplicate") toast.error(out.error instanceof Error ? out.error.message : String(out.error));
      setSheet(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  const save = async (values: EventEditValues) => {
    const target = sheet?.event ?? null;
    // A series occurrence asks what the change applies to — but only when
    // something changed. Closing the sheet unchanged writes nothing.
    if (target?.seriesMaster && values.form) {
      const before = eventFormFromEvent(target);
      const changes = describeEventChanges(before, values.form);
      if (changes.length === 0) {
        setSheet(null);
        return;
      }
      const scope = await mSelect({
        title: t("pim.seriesTitle"),
        message: `${t("pim.seriesSaveMsg", { title: target.title })}\n${changes.map((c) => eventChangeLabel(c, t)).join("\n")}`,
        options: [
          { value: "this", label: t("pim.seriesThis") },
          { value: "all", label: t("pim.seriesAll") },
        ],
      });
      if (scope === null) return;
      if (scope === "this") {
        await writeTo(target, values);
        return;
      }
      const master = await pimSeriesMaster(target);
      if (!master) {
        toast.error(t("pim.eventWriteFailed"));
        return;
      }
      const merged = applyEventChanges(eventFormFromEvent(master), values.form, changes);
      await writeTo(master, { calendarKey: merged.calendarKey, draft: eventFormToDraft(merged), form: merged });
      return;
    }
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

  /** Render this wherever the host wants the sheets to appear. */
  const element = (
    <>
      {peek ? (
        <EventPeekSheet
          event={peek}
          rows={rows}
          color={peek.color}
          resolveSeriesMaster={pimSeriesMaster}
          onClose={() => setPeek(null)}
          onEdit={() => {
            const e = peek;
            setPeek(null);
            setSheet({ event: e, startTs: e.start.ts, endTs: e.end.ts });
          }}
          onDelete={() => void deleteFromPeek(peek)}
          onMeetingNote={() => void meetingNoteFromPeek(peek)}
          onRespond={peek.selfResponse ? (r) => void respondFromPeek(peek, r) : undefined}
        />
      ) : null}
      {sheet ? (
        <EventEditSheet
          calendars={calendars}
          event={sheet.event}
          initial={{ startTs: sheet.startTs, endTs: sheet.endTs, calendarKey: defaultCalendarKey }}
          onClose={() => setSheet(null)}
          onDelete={sheet.event ? () => void remove() : undefined}
          onSave={save}
        />
      ) : null}
    </>
  );

  return { openEvent, openCreate, element, writableCount: calendars.length };
}
