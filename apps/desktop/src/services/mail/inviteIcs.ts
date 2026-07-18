import type { PimEvent } from "@plainva/core";

/**
 * iCalendar invitation builder (mail-client E6): turns a calendar event into a
 * METHOD:REQUEST VEVENT that rides along as a text/calendar attachment when the
 * user "sends an event by email". Pure + unit-tested — the send itself goes
 * through the normal SMTP path (E3). This is an iMIP invite the recipient's
 * mail/calendar app can accept; Plainva does not track those RSVPs (that
 * happens provider-side for events it owns).
 */

/** RFC 5545 §3.3.11 TEXT escaping: backslash, semicolon, comma, newline. */
function escapeText(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** UTC timestamp form YYYYMMDDTHHMMSSZ. */
export function icsUtcStamp(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`
  );
}

/** All-day DATE form YYYYMMDD from a civil date (or a ms fallback). */
function icsDate(date: string | undefined, ms: number): string {
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) return date.replace(/-/g, "");
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}`;
}

/** Folds a content line to <=75 octets (RFC 5545 §3.1) with CRLF + a space. */
function fold(line: string): string {
  if (line.length <= 75) return line;
  const parts: string[] = [];
  let rest = line;
  parts.push(rest.slice(0, 75));
  rest = rest.slice(75);
  while (rest.length > 74) {
    parts.push(" " + rest.slice(0, 74));
    rest = rest.slice(74);
  }
  if (rest.length) parts.push(" " + rest);
  return parts.join("\r\n");
}

export interface InviteOptions {
  /** Organizer email (the sending account). */
  organizer: string;
  /** DTSTAMP source (pass Date.now() at the call site — keeps this pure). */
  stampMs: number;
}

/** Builds the full VCALENDAR text for a single-event invitation. */
export function buildInviteIcs(
  event: Pick<PimEvent, "uid" | "title" | "start" | "end" | "allDay" | "location" | "description" | "attendees">,
  opts: InviteOptions
): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Plainva//Mail Invite//EN",
    "METHOD:REQUEST",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${event.uid}`,
    `DTSTAMP:${icsUtcStamp(opts.stampMs)}`,
    // SEQUENCE is required for a well-formed REQUEST; a fresh invite is 0.
    "SEQUENCE:0",
  ];
  if (event.allDay) {
    lines.push(`DTSTART;VALUE=DATE:${icsDate(event.start.date, event.start.ts)}`);
    lines.push(`DTEND;VALUE=DATE:${icsDate(event.end.date, event.end.ts)}`);
  } else {
    lines.push(`DTSTART:${icsUtcStamp(event.start.ts)}`);
    lines.push(`DTEND:${icsUtcStamp(event.end.ts)}`);
  }
  lines.push(`SUMMARY:${escapeText(event.title || "")}`);
  if (event.location) lines.push(`LOCATION:${escapeText(event.location)}`);
  if (event.description) lines.push(`DESCRIPTION:${escapeText(event.description)}`);
  lines.push(`ORGANIZER:mailto:${opts.organizer}`);
  for (const a of event.attendees ?? []) {
    const email = a.trim();
    // CUTYPE + PARTSTAT=NEEDS-ACTION make Gmail/Outlook render the RSVP card.
    if (email) lines.push(`ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${email}`);
  }
  lines.push("STATUS:CONFIRMED", "TRANSP:OPAQUE", "END:VEVENT", "END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
