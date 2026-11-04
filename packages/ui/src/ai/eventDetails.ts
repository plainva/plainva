import { contextStamp, inertLine, type QuarantinedText } from "@plainva/core";
import type { EventAttendee, SituationEventInput } from "./aiSituation";
import { looksLikeHtml, readableBody } from "./quarantineText";

/**
 * An appointment as the calendar tools write it (plan KI-Harness P4-4).
 *
 * Almost everything about an appointment may be a stranger's words: whoever
 * sends an invitation writes its title, its place and its description. The
 * short fields go to the model as capped lines without a live address, like
 * a mail's subject. The description — free text of any length, the place an
 * invitation hides an instruction in — goes to no model that has a tool:
 * `get_event` hands it over as `quarantine`, and a reader without tools
 * reports on it.
 */

const pad = (n: number) => String(n).padStart(2, "0");
const dayOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const clockOf = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

const TITLE_MAX = 160;
const PLACE_MAX = 160;
const NAME_MAX = 80;
const NAMES_IN_LIST = 5;
const NAMES_IN_DETAIL = 30;
/** What a reader takes of one description. */
export const DESCRIPTION_MAX = 12_000;

const ANSWER: Record<NonNullable<EventAttendee["status"]>, string> = { accepted: "accepted", declined: "declined", tentative: "maybe", needsAction: "no answer yet" };

/** When an appointment is, as one phrase. */
export function eventWhen(event: SituationEventInput): string {
  if (event.allDay) return `${dayOf(event.start)}, all day`;
  const end = event.end ? (dayOf(event.end) === dayOf(event.start) ? clockOf(event.end) : `${dayOf(event.end)} ${clockOf(event.end)}`) : "";
  return `${dayOf(event.start)} ${clockOf(event.start)}${end ? `–${end}` : ""}`;
}

/**
 * An appointment's handle: the day it starts on and a short hash of what
 * tells it from every other. Enough to find it again in a later turn without
 * any state, and it says nothing an attendee list would.
 */
export function eventHandle(event: SituationEventInput): string | null {
  return event.details ? `${dayOf(event.start)}/${contextStamp(event.details.key)}` : null;
}

export function parseEventHandle(handle: string): { day: string; id: string } | null {
  const m = /^(\d{4}-\d{2}-\d{2})\/([0-9a-f]{8})$/.exec(handle.trim());
  return m ? { day: m[1]!, id: m[2]! } : null;
}

function names(attendees: readonly EventAttendee[], max: number): string {
  const listed = attendees.slice(0, max).map((a) => inertLine(a.name, NAME_MAX)).filter(Boolean);
  const more = attendees.length - listed.length;
  return `${listed.join(", ")}${more > 0 ? ` (+${more})` : ""}`;
}

/** One line of a calendar listing: when and what — with `details` also where and with whom — and the handle. */
export function eventLine(event: SituationEventInput, details: boolean): string {
  const d = event.details;
  const parts = [`${eventWhen(event)}: ${inertLine(event.title, TITLE_MAX) || "(no title)"}`];
  if (d?.status === "cancelled") parts.push("cancelled");
  if (details && d) {
    const place = inertLine(d.location, PLACE_MAX);
    if (place) parts.push(`at ${place}`);
    const others = (d.attendees ?? []).filter((a) => !a.self);
    if (others.length) parts.push(`with ${names(others, NAMES_IN_LIST)}`);
    if (d.online) parts.push("online");
  }
  const handle = eventHandle(event);
  return `- ${parts.join(" — ")}${handle ? ` (event "${handle}")` : ""}`;
}

/**
 * An appointment's short fields as values (plan KI-Harness P5.5) — what a
 * listing's line says, for a caller that is a program: each of them capped
 * and without a live address, exactly like the line. Its description is not
 * among them, and never is.
 */
export interface EventFields {
  /** The day it starts on, `YYYY-MM-DD`. */
  day: string;
  /** `HH:MM`; null for an appointment that lasts all day. */
  start: string | null;
  /** `HH:MM`, or day and time where it ends on another day; null where it has no end or lasts all day. */
  end: string | null;
  allDay: boolean;
  title: string;
  cancelled: boolean;
  /** With `details`: where, who else (the first few names) and how many others there are in all. */
  place: string | null;
  with: string[];
  others: number;
  online: boolean;
  /** The handle `get_event` takes. */
  event: string | null;
}

export function eventFields(event: SituationEventInput, details: boolean): EventFields {
  const d = event.details;
  const others = details && d ? (d.attendees ?? []).filter((a) => !a.self) : [];
  const sameDay = event.end ? dayOf(event.end) === dayOf(event.start) : true;
  return {
    day: dayOf(event.start),
    start: event.allDay ? null : clockOf(event.start),
    end: event.allDay || !event.end ? null : sameDay ? clockOf(event.end) : `${dayOf(event.end)} ${clockOf(event.end)}`,
    allDay: Boolean(event.allDay),
    title: inertLine(event.title, TITLE_MAX),
    cancelled: d?.status === "cancelled",
    place: details && d ? inertLine(d.location, PLACE_MAX) || null : null,
    with: others.slice(0, NAMES_IN_LIST).map((a) => inertLine(a.name, NAME_MAX)).filter(Boolean),
    others: others.length,
    online: Boolean(details && d?.online),
    event: eventHandle(event),
  };
}

/** One appointment in detail, and its description handed over for a reader. */
export function eventReport(event: SituationEventInput, question: string): { lines: string[]; quarantine?: QuarantinedText } {
  const d = event.details;
  const lines = [`Appointment: ${inertLine(event.title, TITLE_MAX) || "(no title)"}`, `When: ${eventWhen(event)}${d?.recurring ? " (one of a series)" : ""}`];
  if (!d) return { lines };
  if (d.status) lines.push(`Status: ${d.status}`);
  const place = inertLine(d.location, PLACE_MAX);
  if (place) lines.push(`Where: ${place}`);
  if (d.online) lines.push("Online: it has a link to join; the link stays in the calendar.");
  const attendees = d.attendees ?? [];
  const organizer = attendees.find((a) => a.organizer);
  if (organizer) lines.push(`Organiser: ${inertLine(organizer.name, NAME_MAX)}${organizer.self ? " (the user)" : ""}`);
  if (d.response) lines.push(`The user's answer: ${ANSWER[d.response]}`);
  const others = attendees.filter((a) => !a.self);
  if (others.length) {
    lines.push(`Attendees (${others.length}):`);
    for (const a of others.slice(0, NAMES_IN_DETAIL)) lines.push(`- ${inertLine(a.name, NAME_MAX)}${a.status ? ` — ${ANSWER[a.status]}` : ""}`);
    if (others.length > NAMES_IN_DETAIL) lines.push(`- and ${others.length - NAMES_IN_DETAIL} more`);
  }
  const raw = d.description?.trim();
  if (!raw) {
    lines.push("Description: none.");
    return { lines };
  }
  const body = readableBody(looksLikeHtml(raw) ? { html: raw } : { text: raw }, DESCRIPTION_MAX);
  if (!body.text) {
    lines.push("Description: none.");
    return { lines };
  }
  return {
    lines,
    quarantine: {
      title: event.title,
      text: body.text,
      links: body.links,
      question: question.trim() || "What is this appointment about, and what should an attendee know or prepare?",
      origin: { kind: "calendar" },
      ...(body.truncated ? { truncated: true } : {}),
    },
  };
}
