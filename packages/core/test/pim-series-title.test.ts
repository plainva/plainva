import { describe, expect, it } from "vitest";
import { inheritSeriesTitles, normalizeTitle } from "../src/pim/seriesTitle.ts";
import type { PimEvent } from "../src/pim/types.ts";

/**
 * The load-bearing hardening of S8. S7 measured that of the three adapters only
 * CalDAV even attempted a fallback — Google and Graph wrote `?? ""` and nothing
 * downstream ever looked at the series again. This is the one rule that covers
 * all three, and it costs no request: the master row travels in the same pull.
 */

function ev(over: Partial<PimEvent> & { uid: string }): PimEvent {
  return {
    calendarId: "cal",
    title: "",
    start: { ts: 0 },
    end: { ts: 0 },
    allDay: false,
    ...over,
  } as PimEvent;
}

describe("normalizeTitle", () => {
  it("treats missing, empty and whitespace-only alike", () => {
    // Which of the three a provider hands back is an accident of that provider,
    // never a decision by the person who wrote the appointment.
    for (const raw of [null, undefined, "", "   ", "\t\n"]) expect(normalizeTitle(raw)).toBe("");
  });

  it("trims but keeps a real title", () => {
    expect(normalizeTitle("  Jour fixe  ")).toBe("Jour fixe");
  });
});

describe("inheritSeriesTitles", () => {
  it("gives an untitled occurrence the title of its series", () => {
    const out = inheritSeriesTitles([
      ev({ uid: "s1", title: "Jour fixe Produkt", recurrence: "RRULE:FREQ=WEEKLY" }),
      ev({ uid: "s1#1", title: "", seriesMaster: "s1" }),
      ev({ uid: "s1#2", title: "   ", seriesMaster: "s1" }),
    ]);
    expect(out.map((e) => e.title)).toEqual(["Jour fixe Produkt", "Jour fixe Produkt", "Jour fixe Produkt"]);
  });

  it("never overwrites an occurrence that named itself", () => {
    // Moving or renaming a single occurrence is exactly what an exception is
    // for — inheriting over it would erase the one thing it says.
    const out = inheritSeriesTitles([
      ev({ uid: "s1", title: "Jour fixe Produkt" }),
      ev({ uid: "s1#1", title: "Jour fixe (verschoben)", seriesMaster: "s1" }),
    ]);
    expect(out[1].title).toBe("Jour fixe (verschoben)");
  });

  it("leaves an occurrence empty when the master is missing", () => {
    // Unreadable master, or a series that starts outside the window. The name is
    // genuinely unknown here; the view shows its placeholder, which is honest.
    const out = inheritSeriesTitles([ev({ uid: "s9#1", title: "", seriesMaster: "s9" })]);
    expect(out[0].title).toBe("");
  });

  it("does not inherit from a master that has no title either", () => {
    const out = inheritSeriesTitles([
      ev({ uid: "s1", title: "  " }),
      ev({ uid: "s1#1", title: "", seriesMaster: "s1" }),
    ]);
    expect(out[1].title).toBe("");
  });

  it("leaves a standalone event with an empty title alone", () => {
    // No series, so there is nothing to inherit from — and an empty title on a
    // one-off event is a real (if odd) statement about that event.
    const out = inheritSeriesTitles([ev({ uid: "one", title: "" })]);
    expect(out[0].title).toBe("");
  });

  it("returns the very same array when nothing needed filling in", () => {
    const events = [ev({ uid: "s1", title: "Jour fixe" }), ev({ uid: "s1#1", title: "Jour fixe", seriesMaster: "s1" })];
    expect(inheritSeriesTitles(events)).toBe(events);
  });

  it("keeps everything else about the occurrence untouched", () => {
    const out = inheritSeriesTitles([
      ev({ uid: "s1", title: "Jour fixe" }),
      ev({ uid: "s1#1", title: "", seriesMaster: "s1", start: { ts: 42 }, location: "Raum 3" }),
    ]);
    expect(out[1]).toMatchObject({ uid: "s1#1", seriesMaster: "s1", start: { ts: 42 }, location: "Raum 3" });
  });
});
