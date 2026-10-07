import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { applyEventChanges, buildBlockDraft, describeEventChanges, describeNewStart, eventChangeLabel, eventFormFromEvent, eventFormFromSeed, eventFormToDraft, eventStartDayKey, getPlatformServices, isAuthorizationFailure, isPendingEventUid, movedInTime, resolveDefaultCalendarKey, runCalendarBlocks, sourceDraftFromBlockerEdit, toast, undoDraftFor, type BlockFollowReport, type EventFormValues, type ParkedEventSeed, type ResolvedBlocker } from "@plainva/ui";
import { parseRRule, type PimBlockRef, type PimEventDraft, type PimEventRow } from "@plainva/core";
import { getMobileSettings } from "../services/mobileSettings";
import { mActions, mConfirm, mMultiSelect, mSelect } from "../services/mobileDialogs";
import {
  createPimEvent,
  deletePimEvent,
  detachPimBlocker,
  listPimCalendars,
  openMeetingNoteFor,
  pimBlockersOf,
  pimSeriesMaster,
  pimSourceOfBlocker,
  recordPimBlockers,
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
  const { t, i18n } = useTranslation();
  const [calendars, setCalendars] = useState<Array<{ value: string; label: string }>>([]);
  /**
   * Whether that list has been read yet (plan Befunde 2026-09-24, E28). A
   * "New event" that opened the host screen waits for it: judged against the
   * empty first value it answered "no writable calendar" although there was
   * one. A read that fails counts as read — with nothing in it.
   */
  const [calendarsRead, setCalendarsRead] = useState(false);
  /**
   * The open sheet. `form` and `onSaved` come with an appointment somebody
   * else wrote down (AI harness P5-6: a draft of the assistant's the user
   * opened): the sheet opens with every field filled in, and that somebody
   * hears of it once the calendar took the appointment — never on a close.
   */
  const [sheet, setSheet] = useState<{ event: PimEventRow | null; startTs: number; endTs: number; form?: EventFormValues; onSaved?: () => void } | null>(null);
  /** The event whose PREVIEW is open (S4) — a tap opens this, not the form. */
  const [peek, setPeek] = useState<PimEventRow | null>(null);

  useEffect(() => {
    void writablePimCalendarOptions()
      .catch(() => [])
      .then((list) => {
        setCalendars(list);
        setCalendarsRead(true);
      });
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

  /** Opens the sheet for a NEW appointment with a seed's fields filled in. Nothing is saved before the user saves. */
  const openCreateWith = (parked: ParkedEventSeed) => {
    if (calendars.length === 0) {
      toast.warning(t("pim.noWritableCalendar"));
      return;
    }
    const startTs = Date.now();
    setSheet({ event: null, startTs, endTs: startTs + 60 * 60_000, form: eventFormFromSeed(parked.seed, defaultCalendarKey), ...(parked.onSaved ? { onSaved: parked.onSaved } : {}) });
  };

  /** A write the provider refused: said once, with the way to try it again. */
  const reportRefused = (err: unknown, retry: () => void) => {
    const reason = err instanceof Error ? err.message : String(err);
    toast.error(t("pim.eventWriteRefused", { reason }), { label: t("pim.eventWriteRetry"), run: retry });
  };

  /** The names of the calendars some blockers lie in, for a sentence that names them. */
  const calendarNames = async (refs: readonly Pick<PimBlockRef, "accountId" | "calendarId">[]): Promise<string[]> => {
    const all = await listPimCalendars().catch(() => []);
    const name = new Map(all.map((c) => [`${c.accountId} ${c.id}`, c.name]));
    // One name per ref, in order: a caller that lists them drops the repeats itself.
    return refs.map((ref) => name.get(`${ref.accountId} ${ref.calendarId}`) || ref.calendarId);
  };

  /**
   * What the blockers did, said once (K3): how many went along — with the way
   * back — and, by calendar, which did not. Never passed over in silence.
   */
  const reportBlockers = async (report: BlockFollowReport, message: string | null, undo?: () => void) => {
    if (message && report.followed.length > 0) toast.info(message, undo ? { label: t("common.undo"), run: undo } : undefined);
    if (report.failed.length === 0) return;
    const names = await calendarNames(report.failed.map((failure) => failure.ref));
    const cals = report.failed
      .map((failure, index) => `${names[index] ?? failure.ref.calendarId} (${failure.hidden ? t("pim.blockCalendarHidden") : failure.reason})`)
      .join(", ");
    toast.error(t("pim.blocksNotFollowed", { cals }));
  };

  const confirmDelete = async (target: PimEventRow) => {
    // An event with blockers asks about them in the same breath (K3). The
    // desktop ticks a box; the phone's shape for one decision with two
    // outcomes is two rows, the usual one first.
    const blockers = await pimBlockersOf(target, rows);
    let also: ResolvedBlocker[] = [];
    if (blockers.length > 0) {
      const names = await calendarNames(blockers.map((blocker) => blocker.ref));
      const choice = await mActions({
        title: t("pim.deleteEvent"),
        message: target.title,
        options: [
          { value: "all", label: t("pim.deleteWithBlockers", { n: blockers.length }), desc: t("pim.deleteBlockersIn", { cals: [...new Set(names)].join(", ") }), danger: true },
          { value: "event", label: t("pim.deleteOnlyEvent"), danger: true },
        ],
      });
      if (choice === null) return false;
      if (choice === "all") also = blockers;
    } else {
      const ok = await mConfirm({
        title: t("pim.deleteEvent"),
        message: target.title,
        danger: true,
        confirmLabel: t("common.delete"),
      });
      if (!ok) return false;
    }
    // Gone from the screen with the confirmation (issue 119); a refusal
    // brings the event back and says why.
    const run = () => {
      void deletePimEvent(target, also).then(
        (report) => void reportBlockers(report, null),
        (err) => reportRefused(err, run),
      );
    };
    run();
    return true;
  };

  /**
   * A tap on an event opens the PREVIEW (S4) — the phone's shape for the
   * desktop's floating window. It used to open a bare list of verbs that said
   * nothing about the event beyond its title and time.
   */
  const openEvent = (e: PimEventRow) => {
    // No provider id yet (issue 119): the preview's actions would write
    // against an event that does not exist there. It has one in a moment.
    if (isPendingEventUid(e.uid)) return;
    setPeek(e);
  };

  const deleteFromPeek = async (e: PimEventRow) => {
    setPeek(null);
    // Deleting an occurrence still asks first — there the tap IS the change.
    let subject = e;
    if (e.seriesMaster) {
      // Two things one can do with a series (E20): no ring, nothing preselected.
      const scope = await mActions({
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
      // The event's first day as the desktop names it: an all-day event's
      // civil date, not the local day its UTC midnight falls on — otherwise
      // the phone and the desktop wrote two notes for one meeting west of UTC.
      const res = await openMeetingNoteFor(e, eventStartDayKey(e));
      if (!res) return; // the template's questions were cancelled
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
    const { ok, failed, created } = await runCalendarBlocks({
      keys: picked,
      mode,
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
      // The event learns of its blockers (K3): its own list at the provider.
      await recordPimBlockers(source, created);
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

  /**
   * ONE update of one event, with its blockers (K3): the event and the
   * blockers on screen are at their new place before the provider is asked,
   * and the message afterwards says how many went along, with the way back.
   */
  const applyWrite = async (e: PimEventRow, draft: PimEventDraft, calendarKey: string | null, announce: boolean) => {
    try {
      const out = await updatePimEvent(e, draft, calendarKey, rows);
      if (out.kind === "conflict") {
        toast.info(t("pim.eventConflict"));
        return;
      }
      if (out.kind === "duplicate") toast.error(out.error instanceof Error ? out.error.message : String(out.error));
      const followed = out.blockers.followed;
      const n = followed.length;
      const message = !announce
        ? null
        : movedInTime(e, draft)
          ? t("pim.blocksMoved", { time: describeNewStart(e, draft, i18n.language), n })
          : t("pim.blocksUpdated", { n });
      // The way back is the same write in reverse, offered only where that
      // is the whole truth (see `undoDraftFor`).
      const back = announce && n > 0 ? undoDraftFor(e, draft) : null;
      const row = out.rows[0];
      const moved = !!row && (row.accountId !== e.accountId || row.calendarId !== e.calendarId);
      const after: PimEventRow | null = row ? { ...(moved ? row : { ...e, ...row }), etag: undefined, blocks: followed } : null;
      await reportBlockers(
        out.blockers,
        message,
        back && after ? () => void applyWrite(after, back, moved ? `${e.accountId} ${e.calendarId}` : null, false) : undefined,
      );
    } catch (err) {
      reportRefused(err, () => void applyWrite(e, draft, calendarKey, announce));
    }
  };

  /** Writes an edited form against ONE event — the occurrence or the master. */
  const writeTo = async (target: PimEventRow, values: EventEditValues) => {
    // A BLOCKER that was changed asks once what was meant (K3) — the phone's
    // shape for the desktop's dialog. The sheet stays open under the
    // question: backing out of it must not cost the edit.
    const mirrored = target.blockOf ? await pimSourceOfBlocker(target) : null;
    if (mirrored) {
      const moved = movedInTime(target, values.draft);
      const [blockerCalendar, sourceCalendar] = [await calendarNames([target]), await calendarNames([mirrored.source])];
      const choice = await mActions({
        title: t("pim.blockerAskTitle"),
        message: t("pim.blockerAskBody", { calendar: blockerCalendar[0] ?? "", title: mirrored.source.title, sourceCalendar: sourceCalendar[0] ?? "" }),
        options: [
          { value: "blocker", label: t(moved ? "pim.blockerOnlyMove" : "pim.blockerOnlyEdit"), desc: t("pim.blockerOnlyHint") },
          // Not for an invitation of somebody else: that event is not the user's to move.
          ...(mirrored.canChange ? [{ value: "source", label: t(moved ? "pim.blockerSourceMove" : "pim.blockerSourceEdit"), desc: t("pim.blockerSourceHint") }] : []),
        ],
      });
      if (choice === null) return;
      setSheet(null);
      if (choice === "source") {
        await applyWrite(mirrored.source, sourceDraftFromBlockerEdit(mirrored.source, target, values.draft), null, true);
        return;
      }
      try {
        const out = await detachPimBlocker(target, values.draft, values.calendarKey, mirrored.source);
        if (out.kind === "conflict") toast.info(t("pim.eventConflict"));
        else if (out.kind === "duplicate") toast.error(out.error instanceof Error ? out.error.message : String(out.error));
      } catch (err) {
        reportRefused(err, () => void writeTo(target, values));
      }
      return;
    }
    // The sheet closes with the save; the change is on screen already and the
    // provider's answer arrives on the event itself.
    setSheet(null);
    await applyWrite(target, values.draft, values.calendarKey, true);
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
      const scope = await mActions({
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
    if (target) {
      await writeTo(target, values);
      return;
    }
    // Whoever handed this appointment over hears of it once the calendar took it — not before, and not on a refusal.
    const seeded = sheet?.onSaved;
    setSheet(null);
    const create = () => {
      void createPimEvent(values.calendarKey, values.draft).then(
        () => seeded?.(),
        (err) => reportRefused(err, create),
      );
    };
    create();
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
          onOpenUrl={(url) => void getPlatformServices().openExternal(url)}
        />
      ) : null}
      {sheet ? (
        <EventEditSheet
          calendars={calendars}
          event={sheet.event}
          initial={{ startTs: sheet.startTs, endTs: sheet.endTs, calendarKey: defaultCalendarKey, ...(sheet.form ? { form: sheet.form } : {}) }}
          onClose={() => setSheet(null)}
          onDelete={sheet.event ? () => void remove() : undefined}
          onSave={save}
        />
      ) : null}
    </>
  );

  // `idle`: no sheet and no preview is open — an open sheet reads its fields once, so a seed must not be laid over it.
  return { openEvent, openCreate, openCreateWith, element, writableCount: calendars.length, ready: calendarsRead, idle: sheet === null && peek === null };
}
