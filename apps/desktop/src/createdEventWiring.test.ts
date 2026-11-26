import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Where the desktop settles the events it still draws from the overlay (issue
 * 119): with the vault, in every window - not in the calendar view, which is
 * not always open and whose range is not the cache. The overlay is emptied
 * when the vault is left.
 */
describe("the desktop settles created events with the vault", () => {
  const appShell = readFileSync(join(__dirname, "AppShell.tsx"), "utf8");
  const calendarView = readFileSync(join(__dirname, "components/pimcal/CalendarView.tsx"), "utf8");

  it("AppShell runs the shared watch on the vault's runtime, and empties the overlay when the vault is left", () => {
    expect.hasAssertions();
    expect(appShell).toMatch(/return watchCreatedEvents\(pendingEventWrites, \{\s*cache: runtime\.cache,/);
    expect(appShell).toContain("}, [pimRuntime]);");
    expect(appShell).toContain("useEffect(() => () => pendingEventWrites.clear(), [vaultPath]);");
  });

  it("the calendar view draws the overlay only for calendars it shows", () => {
    expect.hasAssertions();
    expect(calendarView).toMatch(/const shownCalendar = useCallback\(\s*\(accountId: string, calendarId: string\) =>\s*accounts\.some\(\(a\) => a\.id === accountId && a\.enabled\) && calendars\.some\(\(c\) => c\.accountId === accountId && c\.id === calendarId && c\.selected\)/);
    expect(calendarView).toContain("useShownEvents(cachedEvents, pendingEventWrites, { startTs: rangeStartTs, endTs: rangeEndTs }, shownCalendar)");
  });

  it("the calendar view keeps no clock of its own for it", () => {
    expect.hasAssertions();
    expect(calendarView).not.toMatch(/watchCreatedEvents|settleCreatedEvents|setInterval\(check/);
  });
});
