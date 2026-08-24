import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The PIM cycle is asked for wherever the app can be out of date (plan
 * Mobile-PIM-Auffrischung, P1–P3).
 *
 * This reads the sources rather than mocking, because the defect it guards IS
 * a missing line, not a wrong one. The file sync learned on 2026-08-10 that a
 * phone runs no timers in the background and got `foregroundSync()` on resume;
 * the PIM cycle was simply never brought along, and nothing failed — the app
 * just quietly showed data from whenever it was last in front. That is how a
 * task from Google Tasks took very long to appear and its reminder never came
 * at all (finding D1, 2026-08-24).
 *
 * A runtime test cannot hold this: the trigger is one call inside a handler
 * that also does four other things, and removing it breaks no assertion
 * anywhere. So the wiring is pinned where it lives.
 */
const here = dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(join(here, p), "utf8");

/** Screens that render PIM data and are therefore stale on arrival. */
const PIM_SCREENS = [
  ["screens/PimCalendarScreen.tsx", "the calendar"],
  ["screens/PimAccountsScreen.tsx", "the accounts and their calendars"],
  ["screens/TasksScreen.tsx", "the mirrored provider tasks"],
] as const;

describe("PIM refresh wiring", () => {
  it("returning to the app triggers a PIM cycle", () => {
    const src = read("services/appLifecycle.ts");
    const fn = src.slice(src.indexOf("export function onAppForeground"));
    const body = fn.slice(0, fn.indexOf("\n}\n"));
    expect(body).toContain("pimForegroundSync()");
    // Next to the file sync, not instead of it — the two cycles are separate.
    expect(body).toContain("foregroundSync()");
  });

  it("the shell still hands the resume to it", () => {
    const src = read("App.tsx");
    // `isActive` is what a WebView gets instead of a background timer, so this
    // is the ONE reliable moment — and an extracted module is only as good as
    // the line that calls it.
    const handler = src.slice(src.indexOf("isActive"));
    expect(handler).toContain("onAppForeground()");
  });

  for (const [file, what] of PIM_SCREENS) {
    it(`opening ${what} triggers a PIM cycle`, () => {
      expect(read(file)).toContain("pimForegroundSync()");
    });
  }

  it("the foreground trigger also replans the reminders", () => {
    const src = read("services/pim/pimService.ts");
    const fn = src.slice(src.indexOf("export function pimForegroundSync"));
    const body = fn.slice(0, fn.indexOf("\n}\n"));
    // A cycle that finds nothing new fires no `onDataChanged`, so the
    // replanning cannot wait for one — and the clock moved on regardless:
    // the rolling reminder window slid and the OS may have dropped what was
    // scheduled.
    expect(body).toContain("rescheduleReminders");
    expect(body).toContain("triggerImmediate");
  });

  it("the throttle is its own, not shared with the file sync", () => {
    const src = read("services/pim/pimService.ts");
    // A shared counter would let either cycle suppress the other; they cost
    // different things and answer to different triggers.
    expect(src).toContain("PIM_FOREGROUND_THROTTLE_MS");
    expect(src).not.toContain("lastForegroundSyncAt");
  });
});
