import { describe, expect, it } from "vitest";
import { isStatusEvent, orderStatusEvents, partitionStatus, statusLabel, statusLabelKey, type StatusEventLike } from "@plainva/ui";

const t = (k: string) => k;
const ev = (over: Partial<StatusEventLike> = {}): StatusEventLike => ({ title: "Sprint review", ...over });

describe("telling a status entry from an appointment", () => {
  it("treats an event without a kind as an appointment — undefined is not 'unknown'", () => {
    expect(isStatusEvent(ev())).toBe(false);
  });

  it("recognises the three kinds", () => {
    for (const k of ["workingLocation", "focusTime", "outOfOffice"] as const) {
      expect(isStatusEvent(ev({ statusKind: k })), k).toBe(true);
    }
  });
});

describe("what a status entry says", () => {
  it("names Google's two fixed working locations rather than showing the raw token", () => {
    expect(statusLabelKey(ev({ statusKind: "workingLocation", workingLocation: "homeOffice" }))).toBe("pim.statusHome");
    expect(statusLabelKey(ev({ statusKind: "workingLocation" }))).toBe("pim.statusOffice");
  });

  it("shows a custom label verbatim — it is the user's own words, not a token", () => {
    const e = ev({ statusKind: "workingLocation", workingLocation: "Kunde, Halle 3" });
    expect(statusLabelKey(e)).toBeNull();
    expect(statusLabel(e, t)).toBe("Kunde, Halle 3");
  });

  it("labels focus time and being away", () => {
    expect(statusLabel(ev({ statusKind: "focusTime" }), t)).toBe("pim.statusFocusTime");
    expect(statusLabel(ev({ statusKind: "outOfOffice" }), t)).toBe("pim.statusOutOfOffice");
  });
});

describe("ordering and deduplicating", () => {
  it("puts being away first, then focus, then where one sits", () => {
    const out = orderStatusEvents([
      ev({ statusKind: "workingLocation", workingLocation: "homeOffice" }),
      ev({ statusKind: "focusTime" }),
      ev({ statusKind: "outOfOffice" }),
    ]);
    expect(out.map((e) => e.statusKind)).toEqual(["outOfOffice", "focusTime", "workingLocation"]);
  });

  it("collapses the same working location arriving once per calendar", () => {
    const out = orderStatusEvents([
      ev({ statusKind: "workingLocation", workingLocation: "homeOffice" }),
      ev({ statusKind: "workingLocation", workingLocation: "homeOffice" }),
      ev({ statusKind: "workingLocation", workingLocation: "homeOffice" }),
    ]);
    expect(out).toHaveLength(1);
  });

  it("keeps two DIFFERENT locations apart", () => {
    const out = orderStatusEvents([
      ev({ statusKind: "workingLocation", workingLocation: "homeOffice" }),
      ev({ statusKind: "workingLocation", workingLocation: "Halle 3" }),
    ]);
    expect(out).toHaveLength(2);
  });

  it("drops anything that is not a status entry", () => {
    expect(orderStatusEvents([ev(), ev({ statusKind: "focusTime" })])).toHaveLength(1);
  });
});

describe("partitionStatus", () => {
  it("separates the two so a day with three states and one meeting is not four meetings", () => {
    const day = [
      ev({ title: "Sprint review" }),
      ev({ statusKind: "workingLocation", workingLocation: "homeOffice" }),
      ev({ statusKind: "focusTime" }),
      ev({ statusKind: "workingLocation", workingLocation: "homeOffice" }),
    ];
    const { appointments, status } = partitionStatus(day);
    expect(appointments).toHaveLength(1);
    expect(status.map((e) => e.statusKind)).toEqual(["focusTime", "workingLocation"]);
  });
});
