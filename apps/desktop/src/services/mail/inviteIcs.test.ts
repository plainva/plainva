import { describe, expect, it } from "vitest";
import { buildInviteIcs, icsUtcStamp } from "./inviteIcs";

describe("iCal invitation builder (mail-client E6)", () => {
  it("formats a UTC timestamp", () => {
    expect(icsUtcStamp(Date.UTC(2026, 6, 1, 9, 5, 0))).toBe("20260701T090500Z");
  });

  it("builds a METHOD:REQUEST VEVENT for a timed event", () => {
    const ics = buildInviteIcs(
      {
        uid: "evt-1",
        title: "Team sync; notes",
        start: { ts: Date.UTC(2026, 6, 1, 9, 0, 0) },
        end: { ts: Date.UTC(2026, 6, 1, 10, 0, 0) },
        allDay: false,
        location: "Room 3, HQ",
        description: "Line1\nLine2",
        attendees: ["a@example.org", " b@example.org "],
      },
      { organizer: "me@example.org", stampMs: Date.UTC(2026, 5, 30, 8, 0, 0) }
    );
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("METHOD:REQUEST");
    expect(ics).toContain("UID:evt-1");
    expect(ics).toContain("SEQUENCE:0");
    expect(ics).toContain("DTSTART:20260701T090000Z");
    expect(ics).toContain("DTEND:20260701T100000Z");
    // TEXT escaping: the semicolon and comma are backslash-escaped.
    expect(ics).toContain("SUMMARY:Team sync\\; notes");
    expect(ics).toContain("LOCATION:Room 3\\, HQ");
    expect(ics).toContain("DESCRIPTION:Line1\\nLine2");
    expect(ics).toContain("ORGANIZER:mailto:me@example.org");
    expect(ics).toContain("TRANSP:OPAQUE");
    // Attendee lines fold past 75 octets (RFC 5545) — unfold before asserting.
    const unfolded = ics.replace(/\r\n /g, "");
    expect(unfolded).toContain("ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:a@example.org");
    expect(unfolded).toContain("mailto:b@example.org");
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    // CRLF line endings throughout.
    expect(ics).toContain("\r\n");
  });

  it("uses DATE values for an all-day event", () => {
    const ics = buildInviteIcs(
      { uid: "d1", title: "Holiday", start: { ts: Date.UTC(2026, 6, 1), date: "2026-07-01" }, end: { ts: Date.UTC(2026, 6, 2), date: "2026-07-02" }, allDay: true },
      { organizer: "me@example.org", stampMs: 0 }
    );
    expect(ics).toContain("DTSTART;VALUE=DATE:20260701");
    expect(ics).toContain("DTEND;VALUE=DATE:20260702");
  });

  it("adds an HTML alternative description (X-ALT-DESC) when provided", () => {
    const ics = buildInviteIcs(
      { uid: "h1", title: "Review", start: { ts: Date.UTC(2026, 6, 1, 9, 0) }, end: { ts: Date.UTC(2026, 6, 1, 10, 0) }, allDay: false, description: "**bold** note" },
      { organizer: "me@example.org", stampMs: 0, descriptionHtml: "<p><strong>bold</strong> note</p>" }
    );
    const unfolded = ics.replace(/\r\n /g, "");
    expect(unfolded).toContain("DESCRIPTION:**bold** note");
    expect(unfolded).toContain("X-ALT-DESC;FMTTYPE=text/html:<p><strong>bold</strong> note</p>");
  });
});
