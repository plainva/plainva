import { emptyEventForm, type EventFormValues } from "./calendarForm";

/**
 * An appointment somebody else wrote down that the user opens in the event
 * editor (plan KI-Harness P5-6): a draft of the assistant's, handed to the
 * calendar. Nothing is saved by handing it over — the editor opens with the
 * fields filled, and "Save" there is the user's own.
 *
 * It travels like a "New …" request (`pendingNew`): the shell opens the
 * calendar and parks the seed here, because the view may be mounting at that
 * moment and a window event alone would fire before its listener exists. Both
 * shells use the same store.
 */
export interface EventSeed {
  title: string;
  allDay: boolean;
  /** Civil start day, YYYY-MM-DD. */
  day: string;
  /** All-day only: the last day, inclusive. */
  endDay: string;
  /** Timed only: local wall-clock HH:MM. */
  start: string;
  end: string;
  location: string;
  /** Markdown. */
  description: string;
  /** E-mail addresses of the people to invite. */
  attendees: string[];
}

export const EVENT_SEED_EVENT = "plainva-event-seed";

/** A seed as it is parked: with what its sender wants to hear once the user SAVED the appointment — and only then. */
export interface ParkedEventSeed {
  seed: EventSeed;
  /** Called once, after the event editor saved the appointment. A cancelled editor calls nothing. */
  onSaved?: () => void;
}

let pending: ParkedEventSeed | null = null;

/** Parks the seed and tells any mounted calendar at once. A second one replaces the first: one editor, one appointment. */
export function requestEventSeed(seed: EventSeed, onSaved?: () => void): void {
  pending = { seed, ...(onSaved ? { onSaved } : {}) };
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(EVENT_SEED_EVENT));
}

/** The parked seed, once; null when nothing waits. */
export function takeEventSeed(): ParkedEventSeed | null {
  const parked = pending;
  pending = null;
  return parked;
}

/**
 * Subscribes a mounted calendar: runs `handle` now if a seed waits, and again
 * whenever one arrives. `ready` says whether the surface can open its editor
 * yet — it needs its writable calendars for that, and an editor that is open
 * reads its fields once; until then the seed stays parked (the rule of
 * `consumePendingNew`).
 */
export function consumeEventSeed(handle: (parked: ParkedEventSeed) => void, ready = true): () => void {
  if (!ready) return () => {};
  const run = () => {
    const parked = takeEventSeed();
    if (parked) handle(parked);
  };
  run();
  if (typeof window === "undefined") return () => {};
  window.addEventListener(EVENT_SEED_EVENT, run);
  return () => window.removeEventListener(EVENT_SEED_EVENT, run);
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const minutes = (clock: string) => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5));
const clock = (total: number) => `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;

/**
 * The form the event editor opens with for a seed, in the calendar given.
 * What the seed names counts as typed — a description and a list of invitees
 * are only written when their "touched" guard is set, and here somebody did
 * write them. A timed seed without an end gets an hour, as a tapped slot does.
 */
export function eventFormFromSeed(seed: EventSeed, calendarKey: string): EventFormValues {
  const base = emptyEventForm(seed.day, calendarKey);
  const start = TIME.test(seed.start) ? seed.start : base.startTime;
  const end = TIME.test(seed.end) ? seed.end : clock(Math.min(23 * 60 + 59, minutes(start) + 60));
  const attendees = seed.attendees.map((address) => address.trim()).filter(Boolean);
  return {
    ...base,
    title: seed.title,
    allDay: seed.allDay,
    endDayKey: seed.allDay && seed.endDay >= seed.day ? seed.endDay : seed.day,
    startTime: start,
    endTime: end,
    location: seed.location,
    description: seed.description,
    descriptionTouched: seed.description.trim().length > 0,
    attendees: attendees.join("\n"),
    attendeesTouched: attendees.length > 0,
  };
}
