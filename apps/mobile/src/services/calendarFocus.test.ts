import { describe, expect, it } from "vitest";
import { calendarFocusPath, parseCalendarFocus, type CalendarFocus } from "./calendarFocus";

/**
 * A tapped reminder names an appointment, and the calendar it opens has to
 * land on that appointment: the focus crosses the nav stack as the JSON in its
 * entry's path.
 *
 * The fixture is typed `Required<…>` on purpose — the same step that was
 * missing when the mail draft learned to carry files and its reader did not
 * (screens/mail/mailNavRefs.test.ts). A field added to `CalendarFocus` does
 * not compile here until the fixture names it, and then the round trip fails
 * until writer and reader both carry it.
 */
const focus: Required<CalendarFocus> = {
  uid: "040000008200E00074C5B7101A82E008@example.org",
  accountId: "pim-1",
  // Calendar ids are provider strings; some are URLs, some carry quotes.
  calendarId: 'https://cal.example.org/anna/"Arbeit" & Privat/',
  startTs: 1791532800000,
};

describe("a calendar focus through the nav path", () => {
  it("comes back as it went in, every field", () => {
    expect(parseCalendarFocus(calendarFocusPath(focus))).toEqual(focus);
  });

  it("is the empty path when there is none — and the empty path is none", () => {
    expect(calendarFocusPath()).toBe("");
    expect(calendarFocusPath(undefined)).toBe("");
    expect(parseCalendarFocus("")).toBeUndefined();
  });

  it("writes the fields of the type and nothing that merely rode along", () => {
    // The path is stored (a pushed calendar comes back after a restart), so
    // what goes into it is decided here, not by whatever object was passed.
    const carried = { ...focus, title: "Quartalsgespräch", attendees: ["ben@example.org"] };
    expect(JSON.parse(calendarFocusPath(carried))).toEqual(focus);
  });

  it("still reads a path an older build stored", () => {
    // Until now the shell wrote the reminder's own object, in its key order.
    const stored = JSON.stringify({ uid: focus.uid, accountId: focus.accountId, calendarId: focus.calendarId, startTs: focus.startTs });
    expect(parseCalendarFocus(stored)).toEqual(focus);
    expect(parseCalendarFocus(JSON.stringify({ startTs: focus.startTs, calendarId: focus.calendarId, uid: focus.uid, accountId: focus.accountId }))).toEqual(focus);
  });

  it("is total: a path that is no focus is no focus", () => {
    const broken = [
      "{not json",
      "null",
      "7",
      '"pim-1"',
      "[]",
      "{}",
      JSON.stringify({ ...focus, uid: undefined }),
      JSON.stringify({ ...focus, accountId: 7 }),
      JSON.stringify({ ...focus, calendarId: null }),
      // A time as text is not a time: the calendar would compute a day from it.
      JSON.stringify({ ...focus, startTs: String(focus.startTs) }),
    ];
    for (const path of broken) expect(parseCalendarFocus(path), path).toBeUndefined();
  });
});
