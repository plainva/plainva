import { describe, expect, it } from "vitest";
import {
  calendarColor,
  calendarSwitches,
  hasCloudService,
  isServiceOff,
  mailboxesSwitchedOn,
  readCalendarColorOverrides,
  withCalendarColor,
  withServiceOff,
  type CloudAccountRecord,
} from "@plainva/ui";

/**
 * Plan "Verbinden", E3 and V3: a service switched off on the account page
 * stops for the vault on every device - the binding, the calendar cache and
 * the filed mails stay - and a calendar's own colour paints only this vault.
 * One rule in `packages/ui`, read by both shells.
 */

const card = (over: Partial<CloudAccountRecord> = {}): CloudAccountRecord => ({
  id: "card-a",
  family: "google",
  label: "anna@example.com",
  services: { files: { provider: "drive" }, calendar: { pimAccountId: "pim-a" }, mail: { mailAccountId: "mail-a" } },
  ...over,
});

describe("switching a service off for the vault (E3)", () => {
  it("keeps the binding and only marks the service off; switched on again, nothing else changed", () => {
    const off = withServiceOff(card(), "calendar", true);
    expect(off.services).toEqual(card().services);
    expect(isServiceOff(off, "calendar")).toBe(true);
    expect(isServiceOff(off, "files")).toBe(false);
    const on = withServiceOff(off, "calendar", false);
    expect(on).toEqual(card());
    expect("off" in on).toBe(false);
  });

  it("switching the same service off twice lists it once", () => {
    const twice = withServiceOff(withServiceOff(card(), "mail", true), "mail", true);
    expect(twice.off).toEqual(["mail"]);
  });

  it("the calendar rows follow the switch - only the ones that differ", () => {
    const rows = [{ id: "pim-a", enabled: true }, { id: "pim-b", enabled: false }];
    const records = [withServiceOff(card(), "calendar", true), card({ id: "card-b", services: { calendar: { pimAccountId: "pim-b" } } })];
    expect(calendarSwitches(records, rows)).toEqual([
      { row: rows[0], enabled: false },
      { row: rows[1], enabled: true },
    ]);
    expect(calendarSwitches([card()], [{ id: "pim-a", enabled: true }])).toEqual([]);
  });

  it("a mailbox switched off leaves the mail views; unbound mailboxes stay", () => {
    const boxes = [{ id: "mail-a" }, { id: "mail-b" }, { id: "loose" }];
    const records = [withServiceOff(card(), "mail", true), card({ id: "card-b", services: { mail: { mailAccountId: "mail-b" } } })];
    expect(mailboxesSwitchedOn(boxes, records).map((box) => box.id)).toEqual(["mail-b", "loose"]);
  });

  it("an area whose only account has the service off is hidden like one without it", () => {
    expect(hasCloudService([card()], "mail")).toBe(true);
    expect(hasCloudService([withServiceOff(card(), "mail", true)], "mail")).toBe(false);
  });
});

describe("a calendar's own colour (V3)", () => {
  const cal = { accountId: "pim-a", id: "work", color: "#112233" };

  it("paints with the own colour, else the provider's", () => {
    expect(calendarColor(cal, {})).toBe("#112233");
    const own = withCalendarColor({}, "pim-a", "work", "#aabbcc");
    expect(calendarColor(cal, own)).toBe("#aabbcc");
    expect(calendarColor({ ...cal, id: "other" }, own)).toBe("#112233");
  });

  it("removing the own colour goes back to the provider's", () => {
    const own = withCalendarColor({}, "pim-a", "work", "#aabbcc");
    expect(withCalendarColor(own, "pim-a", "work", "")).toEqual({});
  });

  it("reads only colours from a stored map", () => {
    expect(readCalendarColorOverrides({ "pim-a work": "#aabbcc", "x y": "red", z: 3 })).toEqual({ "pim-a work": "#aabbcc" });
    expect(readCalendarColorOverrides(null)).toEqual({});
    expect(readCalendarColorOverrides(["#aabbcc"])).toEqual({});
  });
});
