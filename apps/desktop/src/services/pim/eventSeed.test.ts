// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { consumeEventSeed, eventFormFromSeed, requestEventSeed, takeEventSeed, type EventSeed, type ParkedEventSeed } from "@plainva/ui";
import { eventFormToDraft } from "./calendarModel";

/**
 * An appointment handed to the event editor (plan KI-Harness P5-6): it is
 * parked until a calendar can open its editor, it opens with every field the
 * sender named — and nothing is saved by handing it over.
 */

const SEED: EventSeed = {
  title: "Shooting day",
  allDay: false,
  day: "2026-05-14",
  endDay: "2026-05-14",
  start: "09:00",
  end: "17:00",
  location: "Studio 2",
  description: "Bring the **second** camera.",
  attendees: ["tom@example.org", " anna@example.org "],
};

afterEach(() => {
  takeEventSeed();
});

describe("handing an appointment to the calendar", () => {
  it("parks it until a calendar takes it — once", () => {
    expect(takeEventSeed()).toBeNull();
    requestEventSeed(SEED);
    expect(takeEventSeed()).toEqual({ seed: SEED });
    expect(takeEventSeed()).toBeNull();
  });

  it("reaches a calendar that mounts later, and one that is there already", () => {
    const got: ParkedEventSeed[] = [];
    // Requested while the calendar is still mounting: the seed waits.
    requestEventSeed(SEED);
    const stop = consumeEventSeed((parked) => got.push(parked));
    expect(got.map((parked) => parked.seed.title)).toEqual(["Shooting day"]);
    // Requested while it is on screen: it hears of it at once.
    requestEventSeed({ ...SEED, title: "Wrap-up" });
    expect(got.map((parked) => parked.seed.title)).toEqual(["Shooting day", "Wrap-up"]);
    stop();
    requestEventSeed({ ...SEED, title: "Unheard" });
    expect(got).toHaveLength(2);
    expect(takeEventSeed()?.seed.title).toBe("Unheard");
  });

  it("stays parked while the calendar cannot open its editor — no writable calendar loaded yet, or an editor that is open", () => {
    const got: ParkedEventSeed[] = [];
    requestEventSeed(SEED);
    const stop = consumeEventSeed((parked) => got.push(parked), false);
    expect(got).toEqual([]);
    // Nothing listens either: a seed that arrives now waits as well.
    requestEventSeed({ ...SEED, title: "Later" });
    expect(got).toEqual([]);
    stop();
    // One editor, one appointment: the second request replaced the first.
    const ready = consumeEventSeed((parked) => got.push(parked), true);
    expect(got.map((parked) => parked.seed.title)).toEqual(["Later"]);
    ready();
  });

  it("carries what its sender wants to hear once the appointment was saved — and calls nothing by being taken", () => {
    let saved = 0;
    requestEventSeed(SEED, () => saved++);
    const parked = takeEventSeed()!;
    expect(saved).toBe(0);
    parked.onSaved?.();
    expect(saved).toBe(1);
  });
});

describe("the form the event editor opens with", () => {
  it("has every field the seed names, in the calendar given — and what was written counts as typed", () => {
    const form = eventFormFromSeed(SEED, "acc cal");
    expect(form).toMatchObject({
      title: "Shooting day",
      allDay: false,
      dayKey: "2026-05-14",
      endDayKey: "2026-05-14",
      startTime: "09:00",
      endTime: "17:00",
      location: "Studio 2",
      description: "Bring the **second** camera.",
      descriptionTouched: true,
      attendees: "tom@example.org\nanna@example.org",
      attendeesTouched: true,
      calendarKey: "acc cal",
      // Nothing repeats, and nothing the seed cannot say is set.
      repeatFreq: "",
      color: "",
    });
    // Saved from there, the description and the invitees are written: their guards are set.
    const draft = eventFormToDraft(form);
    expect(draft).toMatchObject({ title: "Shooting day", allDay: false, location: "Studio 2", description: "Bring the **second** camera.", attendees: ["tom@example.org", "anna@example.org"] });
    expect(draft.descriptionHtml).toContain("<strong>second</strong>");
  });

  it("leaves the guards alone where the seed says nothing: an empty description and no invitee are not written", () => {
    const form = eventFormFromSeed({ ...SEED, description: "  ", attendees: [" "] }, "acc cal");
    expect(form).toMatchObject({ description: "  ", descriptionTouched: false, attendees: "", attendeesTouched: false });
    const draft = eventFormToDraft(form);
    expect(draft.description).toBeUndefined();
    expect(draft.attendees).toBeUndefined();
    expect(draft.notifyAttendees).toBeUndefined();
  });

  it("gives a timed appointment without an end one hour, never past midnight — and reads a broken time as the editor's own", () => {
    expect(eventFormFromSeed({ ...SEED, end: "" }, "c")).toMatchObject({ startTime: "09:00", endTime: "10:00" });
    expect(eventFormFromSeed({ ...SEED, start: "23:30", end: "" }, "c")).toMatchObject({ startTime: "23:30", endTime: "23:59" });
    expect(eventFormFromSeed({ ...SEED, start: "25:00", end: "nine" }, "c")).toMatchObject({ startTime: "09:00", endTime: "10:00" });
  });

  it("keeps the last day of an all-day appointment, and never one before its first", () => {
    expect(eventFormFromSeed({ ...SEED, allDay: true, endDay: "2026-05-16" }, "c")).toMatchObject({ allDay: true, dayKey: "2026-05-14", endDayKey: "2026-05-16" });
    expect(eventFormFromSeed({ ...SEED, allDay: true, endDay: "2026-05-01" }, "c")).toMatchObject({ endDayKey: "2026-05-14" });
    // A timed appointment has one day; a last day it names is not carried.
    expect(eventFormFromSeed({ ...SEED, endDay: "2026-05-16" }, "c")).toMatchObject({ allDay: false, endDayKey: "2026-05-14" });
  });
});
