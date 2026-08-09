import { describe, expect, it } from "vitest";
import { applyEventChanges, describeEventChanges, emptyEventForm, hasEventChanges, type EventFormValues } from "@plainva/ui";

const base = (): EventFormValues => ({
  ...emptyEventForm("2026-08-11", "a1 cal"),
  title: "Jour fixe Produkt",
  startTime: "09:00",
  endTime: "09:30",
  location: "Videolink",
  description: "Agenda",
  attendees: "anke@example.org",
});

describe("what counts as a change", () => {
  it("an untouched form is no change — no dialog, no write", () => {
    expect(describeEventChanges(base(), base())).toEqual([]);
    expect(hasEventChanges(base(), base())).toBe(false);
  });

  it("names a moved time with its before and after", () => {
    const after = { ...base(), startTime: "09:15" };
    expect(describeEventChanges(base(), after)).toEqual([{ field: "time", from: "09:00–09:30", to: "09:15–09:30" }]);
  });

  it("sees the title, the location and the calendar", () => {
    const after = { ...base(), title: "Jour fixe", location: "Raum 2.14", calendarKey: "a1 other" };
    expect(describeEventChanges(base(), after).map((c) => c.field)).toEqual(["title", "location", "calendar"]);
  });

  it("treats a date move as a date change, not a time one", () => {
    expect(describeEventChanges(base(), { ...base(), dayKey: "2026-08-12" })).toEqual([
      { field: "date", from: "2026-08-11", to: "2026-08-12" },
    ]);
  });

  it("ignores the clock of an all-day event, and reports the switch itself", () => {
    const after = { ...base(), allDay: true };
    expect(describeEventChanges(base(), after).map((c) => c.field).sort()).toEqual(["allDay", "date", "time"]);
  });

  it("ignores leading and trailing space in a title", () => {
    expect(hasEventChanges(base(), { ...base(), title: "  Jour fixe Produkt  " })).toBe(false);
  });

  /**
   * The touched guards exist so an untouched control never overwrites what the
   * provider holds. An untouched control is therefore not a change either.
   */
  it("does not call an untouched description a change, even when the text differs", () => {
    expect(hasEventChanges(base(), { ...base(), description: "etwas anderes" })).toBe(false);
  });

  it("reports the description once the user actually edited it", () => {
    const after = { ...base(), description: "Neue Agenda", descriptionTouched: true };
    expect(describeEventChanges(base(), after)).toEqual([{ field: "description", from: "Agenda", to: "Neue Agenda" }]);
  });

  it("does not call an untouched attendee list a change", () => {
    expect(hasEventChanges(base(), { ...base(), attendees: "wer@example.org" })).toBe(false);
  });

  it("does not call an untouched recurrence a change", () => {
    expect(hasEventChanges(base(), { ...base(), repeatFreq: "weekly" })).toBe(false);
  });

  it("reports a touched recurrence", () => {
    expect(describeEventChanges(base(), { ...base(), repeatFreq: "weekly", repeatTouched: true }).map((c) => c.field)).toEqual([
      "repeat",
    ]);
  });
});

describe("applying a change to the whole series", () => {
  const master = (): EventFormValues => ({
    ...base(),
    dayKey: "2026-06-02", // the series' own start, months before the open occurrence
    endDayKey: "2026-06-02",
    description: "Serien-Agenda",
    repeatFreq: "weekly",
  });

  it("moves the time without dragging the series start to the open occurrence", () => {
    const after = { ...base(), startTime: "09:15" };
    const out = applyEventChanges(master(), after, describeEventChanges(base(), after));
    expect(out.startTime).toBe("09:15");
    expect(out.dayKey).toBe("2026-06-02");
  });

  it("keeps the master's own description when the description was not edited", () => {
    const after = { ...base(), startTime: "09:15" };
    const out = applyEventChanges(master(), after, describeEventChanges(base(), after));
    expect(out.description).toBe("Serien-Agenda");
  });

  it("carries an edited description across and marks it touched", () => {
    const after = { ...base(), description: "Neue Agenda", descriptionTouched: true };
    const out = applyEventChanges(master(), after, describeEventChanges(base(), after));
    expect(out.description).toBe("Neue Agenda");
    expect(out.descriptionTouched).toBe(true);
  });

  it("moves the series anchor when the date itself was changed", () => {
    const after = { ...base(), dayKey: "2026-08-12", endDayKey: "2026-08-12" };
    const out = applyEventChanges(master(), after, describeEventChanges(base(), after));
    expect(out.dayKey).toBe("2026-08-12");
  });

  it("changes nothing at all when nothing was edited", () => {
    expect(applyEventChanges(master(), base(), [])).toEqual(master());
  });

  it("leaves the caller's form untouched", () => {
    const m = master();
    applyEventChanges(m, { ...base(), title: "Neu" }, [{ field: "title", from: "a", to: "b" }]);
    expect(m.title).toBe("Jour fixe Produkt");
  });
});
