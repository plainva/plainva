import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Trash2 } from "lucide-react";
import { Button, ICON, Switch, TextArea, TextInput } from "@plainva/ui";
import type { PimEventDraft, PimEventRow } from "@plainva/core";
import { SheetGrip } from "./SheetGrip";
import { mSelect } from "../services/mobileDialogs";

/**
 * Creating and editing a calendar event on the phone (S24).
 *
 * The calendar could show events and answer invitations, and that was all —
 * "read-only" in the plan's words. A calendar you cannot write into is a
 * viewer, so this is the missing half: title, when, where, which calendar, and
 * a description.
 *
 * Recurrence and attendees are deliberately NOT here; they come with S25 and
 * carry their own decisions (which occurrences does an edit touch, who gets an
 * invitation). Editing an event that HAS a rule leaves the rule untouched.
 */

function localInput(ts: number, allDay: boolean): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return allDay ? date : `${date}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function parseLocal(value: string, allDay: boolean): number | null {
  if (!value) return null;
  const ts = new Date(allDay ? `${value}T00:00` : value).getTime();
  return Number.isFinite(ts) ? ts : null;
}

export interface EventEditValues {
  draft: PimEventDraft;
  /** "<accountId> <calendarId>" — a change means MOVE for an existing event. */
  calendarKey: string;
}

export function EventEditSheet({
  event,
  initial,
  calendars,
  onSave,
  onDelete,
  onClose,
}: {
  /** The event being edited, or null when creating. */
  event: PimEventRow | null;
  /** Pre-filled start/end (a tapped slot) and the calendar to create in. */
  initial: { startTs: number; endTs: number; calendarKey: string };
  calendars: Array<{ value: string; label: string }>;
  onSave: (values: EventEditValues) => void | Promise<void>;
  onDelete?: () => void | Promise<void>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(event?.title ?? "");
  const [allDay, setAllDay] = useState(!!event?.allDay);
  const [start, setStart] = useState(() => localInput(event?.start.ts ?? initial.startTs, !!event?.allDay));
  const [end, setEnd] = useState(() => localInput(event?.end.ts ?? initial.endTs, !!event?.allDay));
  const [location, setLocation] = useState(event?.location ?? "");
  const [description, setDescription] = useState(event?.description ?? "");
  const [calendarKey, setCalendarKey] = useState(
    event ? `${event.accountId} ${event.calendarId}` : initial.calendarKey,
  );
  const [busy, setBusy] = useState(false);

  const calendarLabel = useMemo(
    () => calendars.find((c) => c.value === calendarKey)?.label ?? calendarKey,
    [calendars, calendarKey],
  );

  const toggleAllDay = (next: boolean) => {
    // Switching the kind rewrites the two fields: a date-time input cannot
    // hold a date and vice versa.
    const s = parseLocal(start, allDay) ?? initial.startTs;
    const e = parseLocal(end, allDay) ?? initial.endTs;
    setAllDay(next);
    setStart(localInput(s, next));
    setEnd(localInput(e, next));
  };

  const save = () => {
    const startTs = parseLocal(start, allDay);
    const endTs = parseLocal(end, allDay);
    if (!title.trim() || startTs === null || endTs === null) return;
    setBusy(true);
    void Promise.resolve(
      onSave({
        calendarKey,
        draft: {
          title: title.trim(),
          start: { ts: startTs },
          // An end before the start is a typo, not an intent — a zero-length
          // event would silently disappear from the grid.
          end: { ts: Math.max(endTs, startTs + (allDay ? 0 : 60_000)) },
          allDay,
          location: location.trim() || undefined,
          description: description.trim() || undefined,
        },
      }),
    ).finally(() => setBusy(false));
  };

  const pickCalendar = () => {
    void (async () => {
      const picked = await mSelect({ title: t("pim.eventCalendar"), options: calendars });
      if (picked !== null) setCalendarKey(picked);
    })();
  };

  return (
    <div className="m-sheet-backdrop" onClick={onClose}>
      <div className="pv-sheet m-sheet" onClick={(e) => e.stopPropagation()}>
        <SheetGrip onClose={onClose} />
        <p className="m-sheet-title">{event ? t("pim.editEvent") : t("pim.newEvent")}</p>

        <TextInput
          autoFocus={!event}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t("pim.eventTitle")}
          aria-label={t("pim.eventTitle")}
          value={title}
        />

        <div className="m-row m-row--split">
          <span className="m-peeklabel">{t("pim.allDay")}</span>
          <Switch checked={allDay} label={t("pim.allDay")} onChange={toggleAllDay} />
        </div>

        <div className="m-row m-row--split">
          <span className="m-peeklabel">{t("pim.eventFrom")}</span>
          <TextInput
            aria-label={t("pim.eventFrom")}
            onChange={(e) => setStart(e.target.value)}
            type={allDay ? "date" : "datetime-local"}
            value={start}
          />
        </div>
        <div className="m-row m-row--split">
          <span className="m-peeklabel">{t("pim.eventTo")}</span>
          <TextInput
            aria-label={t("pim.eventTo")}
            onChange={(e) => setEnd(e.target.value)}
            type={allDay ? "date" : "datetime-local"}
            value={end}
          />
        </div>

        <button className="m-row m-row--split" onClick={pickCalendar}>
          <span className="m-peeklabel">{t("pim.eventCalendar")}</span>
          <span className="m-peekvalue">{calendarLabel}</span>
        </button>

        <TextInput
          onChange={(e) => setLocation(e.target.value)}
          placeholder={t("pim.eventLocation")}
          aria-label={t("pim.eventLocation")}
          value={location}
        />
        <TextArea
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t("pim.eventDescription")}
          aria-label={t("pim.eventDescription")}
          rows={3}
          value={description}
        />

        <div className="m-config-actions">
          <Button disabled={busy || !title.trim()} onClick={save} variant="primary">
            {t("common.save")}
          </Button>
          {event && onDelete && (
            <Button onClick={() => void onDelete()} variant="danger">
              <Trash2 size={ICON.meta} /> {t("common.delete")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
