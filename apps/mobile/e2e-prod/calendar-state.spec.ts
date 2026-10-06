import { test, expect } from "@playwright/test";
import { installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { waitForVaultDirectory } from "./exampleVault";

/**
 * What the phone's calendar says about itself (plan Befunde 2026-10-06, K1/K2).
 *
 * K1 — an account that is not being synced says so above the calendar, and the
 * events the cache holds stay on screen. The fixture account has a sign-in slot
 * and no reachable provider (the requests are refused at the network), so its
 * cycle fails the way a server that is down fails: temporarily. Before this
 * plan nothing on the surface said so.
 *
 * K2 — the month grid draws at most three dots per day and used to stop
 * there; a working location stood in the time grid as an appointment.
 */
test("an account that is not synced says so above the calendar, the events stay; the month counts beyond its dots", async ({ page, context }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addLocatorHandler(page.getByTestId("whats-new-sheet"), async () => page.getByTestId("whats-new-close").click());
  // No provider answers in this run — and none is asked for real.
  await context.route(/googleapis\.com|accounts\.google\.com/, (route) => route.abort());
  const sql = await installSqlBridge(context);
  await context.addInitScript(() => {
    if (!localStorage.getItem("CapacitorStorage.mobile-settings")) localStorage.setItem("CapacitorStorage.mobile-settings", JSON.stringify({ onboarded: true, language: "en", motion: "off" }));
    // The account's sign-in slot for THIS device: without it the calendar
    // shows "Not signed in" instead of the grid.
    localStorage.setItem("CapacitorStorage.secret_pim_local_pim-fixture-1", JSON.stringify({ kind: "google", clientId: "fixture-client", refreshToken: "fixture" }));
    localStorage.setItem("plainva-calendar-view", "day");
  });
  try {
    await page.goto("/");
    await waitForVaultDirectory(page);
    await expect.poll(() => sql.count("plainva-index", "sqlite_master WHERE name = 'pim_calendars'"), { timeout: 20_000 }).toBe(1);
    sql.seedPim("plainva-index");

    // Today, in the phone's own clock: four appointments and a working
    // location — five entries, two more than a month cell has dots for.
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const pad = (n: number) => String(n).padStart(2, "0");
    const key = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const tomorrow = new Date(midnight + 26 * 3600_000);
    const insert =
      "INSERT OR REPLACE INTO pim_events (account_id, cal_id, uid, title, start_ts, end_ts, start_date, end_date, all_day, status_kind, working_loc) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
    ["Jour fixe", "Monthly figures", "Review", "Handover"].forEach((title, i) => {
      sql.run("plainva-index", insert, ["pim-fixture-1", "primary", `state-ev-${i}`, title, midnight + (9 + i * 2) * 3600_000, midnight + (10 + i * 2) * 3600_000, null, null, 0, null, null]);
    });
    sql.run("plainva-index", insert, ["pim-fixture-1", "primary", "state-ev-home", "Home", midnight, midnight + 24 * 3600_000, key(now), key(tomorrow), 1, "workingLocation", "homeOffice"]);
    // The account last got through at 10:42 today and has been failing since.
    sql.run(
      "plainva-index",
      "INSERT OR REPLACE INTO pim_state (account_id, scope, cursor, last_sync_ts, last_error, last_error_kind, auth_revision) VALUES (?, 'account', NULL, ?, ?, 'transient', NULL)",
      ["pim-fixture-1", midnight + (10 * 60 + 42) * 60_000, "google api 503 backendError"],
    );
    await page.reload();
    await expect(page.locator(".m-tabbar")).toBeVisible({ timeout: 20_000 });

    const tab = page.locator(".m-tabbar .m-tab", { hasText: /^Calendar$/ });
    if (await tab.count()) await tab.first().click();
    else {
      await page.getByTestId("tab-areas").click();
      await page.getByRole("button", { name: /^Calendar$/ }).first().click();
    }
    const grid = page.getByTestId("pim-timegrid");
    await expect(grid).toBeVisible({ timeout: 20_000 });

    // K1: the line names the account and since when; the events are still there.
    const notice = page.getByTestId("calendar-sync-notice");
    await expect(notice).toBeVisible();
    const line = notice.getByTestId("calendar-sync-line");
    await expect(line).toHaveCount(1);
    await expect(line).toContainText("anna@gmail.com");
    await expect(line).toContainText("10:42");
    await expect(line).toContainText("The events below are the last known state.");
    await expect(line).not.toContainText("{{");
    await expect(grid.getByTestId("pim-event").filter({ hasText: "Jour fixe" })).toBeVisible();

    // "Try again" asks at once. The provider still does not answer — the line
    // stays, keeps its time, and so do the events.
    await notice.getByTestId("calendar-sync-retry").click();
    await expect(page.locator(".m-spin")).toHaveCount(0, { timeout: 30_000 });
    await expect(line).toContainText("anna@gmail.com");
    await expect(line).toContainText("10:42");
    await expect(grid.getByTestId("pim-event").filter({ hasText: "Jour fixe" })).toBeVisible();
    // Nothing on record claims the failed attempts were a sync.
    await expect
      .poll(() => sql.count("plainva-index", `pim_state WHERE account_id = 'pim-fixture-1' AND scope = 'account' AND last_sync_ts = ${midnight + (10 * 60 + 42) * 60_000} AND last_error IS NOT NULL`))
      .toBe(1);

    // K2: the working location is a band in the all-day row, not an appointment.
    const band = page.getByTestId("pim-allday-strip").getByTestId("pim-status-band");
    await expect(band).toHaveText("Working from home");
    await expect(page.getByTestId("pim-allday-strip").getByTestId("pim-event")).toHaveCount(0);
    await page.screenshot({ path: test.info().outputPath("calendar-day-not-synced.png") });

    // K2: the month cell shows three dots and says how many entries lie beyond.
    await page.getByTestId("pim-view-month").click();
    const today = page.locator(".m-cal-day.is-today");
    await expect(today).toBeVisible();
    await expect(today.locator(".m-cal-dot:not(.m-cal-dot--daily)")).toHaveCount(3);
    await expect(today.getByTestId("pim-month-more")).toHaveText("+2");
    // A day with nothing beyond its dots carries no count.
    await expect(page.getByTestId("pim-month-more")).toHaveCount(1);
    // The line is above the month as well.
    await expect(notice).toBeVisible();
    await page.screenshot({ path: test.info().outputPath("calendar-month-count.png") });
    expect(errors).toEqual([]);
  } finally {
    sql.close();
  }
});
