import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { applyEventChanges, buildBlockDraft, describeEventChanges, eventChangeLabel, eventFormFromEvent, eventFormToDraft, isAuthorizationFailure, resolveDefaultCalendarKey, runCalendarBlocks, toast } from "@plainva/ui";
import { parseRRule, type PimEventRow } from "@plainva/core";
import { isoOf } from "../lib/dates";
import { getMobileSettings } from "../services/mobileSettings";
import { mConfirm, mMultiSelect, mSelect } from "../services/mobileDialogs";
import {
  createPimEvent,
  deletePimEvent,
  openMeetingNoteFor,
  pimSeriesMaster,
  pimSyncNow,
  pimTargetForAccount,
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

  /** The OTHER writable calendars — never the event's own (same rule as the desktop dialog). */
  const blockTargetsFor = (e: PimEventRow) => calendars.filter((c) => c.value !== `${e.accountId} ${e.calendarId}`);

  /**
   * "Block in other calendars" from the preview (C33, catalog gap until
   * 2026-09-04). Two sheets — which calendars, then busy or a copy — and the
   * shared runner does the writing: a series is mirrored from its master so
   * the block recurs too, and every failure keeps the provider's reason.
   */
  const blockFromPeek = async (e: PimEventRow) => {
    setPeek(null);
    const options = blockTargetsFor(e);
    if (options.length === 0) {
      toast.info(t("pim.blockNoOther", { defaultValue: "Kein weiterer beschreibbarer Kalender vorhanden." }));
      return;
    }
    const picked = await mMultiSelect({
      title: t("pim.blockInCalendars", { defaultValue: "In anderen Kalendern blockieren" }),
      message: t("pim.blockHint", { title: e.title, defaultValue: "„{{title}}“ in weitere Kalender als Blocker übernehmen." }),
      options,
      values: [],
    });
    if (!picked || picked.length === 0) return;
    const mode = await mSelect({
      title: t("pim.blockMode", { defaultValue: "Als" }),
      message: e.seriesMaster ? t("pim.blockSeriesHint", { defaultValue: "Die Wiederholung wird mitübernommen." }) : undefined,
      options: [
        { value: "busy", label: t("pim.blockBusy", { defaultValue: "Beschäftigt" }) },
        { value: "details", label: t("pim.blockDetails", { defaultValue: "Mit Details" }) },
      ],
      value: "busy",
    });
    if (mode !== "busy" && mode !== "details") return;
    const master = e.seriesMaster ? await pimSeriesMaster(e) : null;
    const source = master ?? e;
    const recurrence = master ? parseRRule(master.recurrence) : null;
    const draft = buildBlockDraft(source, mode, t("pim.busyTitle", { defaultValue: "Beschäftigt" }), recurrence);
    const { ok, failed } = await runCalendarBlocks({
      keys: picked,
      labelFor: (key) => options.find((o) => o.value === key)?.label ?? key,
      targetFor: async (accountId) => {
        try {
          const target = await pimTargetForAccount(accountId);
          return target ? { target } : { target: null, reason: t("pim.blockNoTarget", { defaultValue: "Konto nicht angemeldet" }) };
        } catch (error) {
          return { target: null, reason: error instanceof Error ? error.message : String(error) };
        }
      },
      draft,
    });
    if (ok > 0) {
      toast.info(t("pim.blocked", { n: ok, defaultValue: "In {{n}} Kalender(n) blockiert" }));
      pimSyncNow();
    }
    if (failed.length > 0) {
      const cals = failed.map((f) => `${f.label} (${f.reason})`).join(", ");
      const message = t("pim.blockFailedFor", { cals, defaultValue: "Konnte in {{cals}} nicht blockieren." });
      // A 401/403 is a right the token does not carry — the sign-in is the fix,
      // and the accounts screen is where it lives on the phone.
      if (failed.some(isAuthorizationFailure)) toast.error(`${message} ${t("pim.blockReauth", { defaultValue: "Neu anmelden" })}`);
      else toast.error(message);
    } else if (ok === 0) {
      toast.error(t("pim.eventWriteFailed"));
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
          onBlock={blockTargetsFor(peek).length > 0 ? () => void blockFromPeek(peek) : undefined}
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
