import { describe, expect, it } from "vitest";
import { reminderText, type ReminderTextLabels, type ReminderTextSubject } from "@plainva/ui";

/**
 * What a reminder says. The finding this covers is not a crash: on the phone a
 * task and an appointment arrived indistinguishable — same default icon, same
 * bare time — so the notification told you WHEN without ever telling you WHAT.
 *
 * The words are injected, so these tests pin the composition rather than a
 * translation: kind first, then the moment in the form that moment deserves.
 */

const L: ReminderTextLabels = {
  kindEvent: "Termin",
  kindTask: "Aufgabe",
  allDay: "ganztägig",
  untitled: "Ohne Titel",
  dueToday: "fällig heute",
  dueOn: (d) => `fällig ${d}`,
};

const NOW = new Date(2026, 7, 21, 8, 0).getTime();
const say = (s: ReminderTextSubject) => reminderText(s, L, { locale: "de-DE", now: NOW });

const subject = (over: Partial<ReminderTextSubject>): ReminderTextSubject => ({
  kind: "event",
  title: "Zahnarzt",
  startTs: NOW + 3_600_000,
  allDay: false,
  ...over,
});

describe("reminderText", () => {
  it("names the kind before the moment", () => {
    const out = say(subject({ startTs: new Date(2026, 7, 21, 9, 30).getTime() }));
    expect(out.title).toBe("Zahnarzt");
    expect(out.body).toBe("Termin · 09:30");
  });

  it("says the day in words when a task carries no time", () => {
    const out = say(
      subject({ kind: "task", title: "Steuer einreichen", allDay: true, startDate: "2026-08-21", startTs: NOW })
    );
    expect(out.body).toBe("Aufgabe · fällig heute");
  });

  it("names the day when the task is due later", () => {
    const later = new Date(2026, 7, 24, 0, 0).getTime();
    const out = say(
      subject({ kind: "task", title: "Steuer", allDay: true, startDate: "2026-08-24", startTs: later })
    );
    expect(out.body).toMatch(/^Aufgabe · fällig /);
    expect(out.body).toContain("24.08.");
  });

  it("keeps 'all day' for an appointment, not the task wording", () => {
    const out = say(subject({ title: "Betriebsausflug", allDay: true, startDate: "2026-08-21", startTs: NOW }));
    expect(out.body).toBe("Termin · ganztägig");
  });

  it("falls back to a stand-in rather than announcing an empty line", () => {
    // A calendar entry may legitimately have no title; a notification saying
    // nothing at all is worse than one saying "Ohne Titel".
    const out = say(subject({ title: "   " }));
    expect(out.title).toBe("Ohne Titel");
  });

  it("formats the time in the given locale", () => {
    const at = new Date(2026, 7, 21, 14, 5).getTime();
    const en = reminderText(subject({ startTs: at }), { ...L, kindEvent: "Appointment" }, {
      locale: "en-US",
      now: NOW,
    });
    expect(en.body).toBe("Appointment · 02:05 PM");
  });
});
