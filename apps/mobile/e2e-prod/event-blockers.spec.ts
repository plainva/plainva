import { test, expect } from "@playwright/test";
import { installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { waitForVaultDirectory } from "./exampleVault";

/**
 * Blockers on the phone (plan Befunde 2026-10-06, K3).
 *
 * The phone had the action "Block in other calendars" and no sign of its
 * result: no chain mark, no way to tell a blocker from an appointment, and a
 * changed blocker was simply written — the event behind it never heard of it.
 *
 * The fixture account has a sign-in slot and no reachable provider, so every
 * write is refused. That is the half a browser run can hold: the marks, the
 * two questions, and that the answer leads to a write of the RIGHT event. What
 * a blocker takes over and what is written where is held by the shared unit
 * test (`apps/desktop/src/blockFollow.test.ts`), against a stood-in provider.
 */
test("a blocker carries the chain mark, asks what a change was meant for, and a deletion asks about the blockers", async ({ page, context }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addLocatorHandler(page.getByTestId("whats-new-sheet"), async () => page.getByTestId("whats-new-close").click());
  await context.route(/googleapis\.com|accounts\.google\.com/, (route) => route.abort());
  const sql = await installSqlBridge(context);
  await context.addInitScript(() => {
    if (!localStorage.getItem("CapacitorStorage.mobile-settings")) localStorage.setItem("CapacitorStorage.mobile-settings", JSON.stringify({ onboarded: true, language: "en", motion: "off" }));
    localStorage.setItem("CapacitorStorage.secret_pim_local_pim-fixture-1", JSON.stringify({ kind: "google", clientId: "fixture-client", refreshToken: "fixture" }));
    localStorage.setItem("plainva-calendar-view", "day");
  });
  try {
    await page.goto("/");
    await waitForVaultDirectory(page);
    await expect.poll(() => sql.count("plainva-index", "sqlite_master WHERE name = 'pim_calendars'"), { timeout: 20_000 }).toBe(1);
    sql.seedPim("plainva-index");

    // A second calendar, an event in the first and its blocker in the second —
    // plus an ordinary appointment that must stay unmarked.
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    sql.run("plainva-index", "INSERT OR REPLACE INTO pim_calendars (account_id, cal_id, name, color, selected, read_only) VALUES (?, ?, ?, ?, 1, 0)", ["pim-fixture-1", "family", "Family", "#b5651d"]);
    const insert = "INSERT OR REPLACE INTO pim_events (account_id, cal_id, uid, title, start_ts, end_ts, all_day, block_of) VALUES (?, ?, ?, ?, ?, ?, 0, ?)";
    sql.run("plainva-index", insert, ["pim-fixture-1", "primary", "k3-source", "Board meeting", midnight + 9 * 3600_000, midnight + 10 * 3600_000, null]);
    sql.run("plainva-index", insert, ["pim-fixture-1", "family", "k3-blocker", "Busy", midnight + 9 * 3600_000, midnight + 10 * 3600_000, "k3-source"]);
    sql.run("plainva-index", insert, ["pim-fixture-1", "primary", "k3-plain", "Lunch", midnight + 12 * 3600_000, midnight + 13 * 3600_000, null]);
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

    // The mark: on the blocker and on the event that has one, not on the rest.
    const event = (title: string) => grid.getByTestId("pim-event").filter({ hasText: title });
    await expect(event("Busy").getByTestId("pim-event-linked")).toHaveCount(1);
    await expect(event("Board meeting").getByTestId("pim-event-linked")).toHaveCount(1);
    await expect(event("Lunch")).toBeVisible();
    await expect(event("Lunch").getByTestId("pim-event-linked")).toHaveCount(0);

    // The preview says what the mark means.
    await event("Busy").click();
    const peek = page.getByTestId("event-peek-sheet");
    await expect(peek.getByTestId("event-peek-linked")).toHaveText("Linked calendar block");
    await page.screenshot({ path: test.info().outputPath("blocker-peek.png") });

    // A changed blocker asks once what was meant. The edit sheet stays open
    // under the question, so backing out of it does not cost the edit.
    await peek.getByTestId("event-peek-edit").click();
    const sheet = page.locator(".m-sheet").filter({ has: page.locator(".m-sheet-title", { hasText: "Edit event" }) });
    await expect(sheet).toBeVisible();
    await sheet.getByPlaceholder("Title").fill("Busy (dentist)");
    await sheet.getByRole("button", { name: "Save" }).click();
    const ask = page.locator(".m-sheet").filter({ has: page.locator(".m-sheet-title", { hasText: "This entry is a blocker" }) });
    await expect(ask).toBeVisible();
    await expect(ask).toContainText("It keeps the time of “Board meeting” free in “Family” (calendar “Anna”).");
    // Nothing about the time changed, so the question speaks of changing.
    const only = ask.getByRole("button", { name: /Change only this blocker/ });
    const whole = ask.getByRole("button", { name: /Change the event/ });
    await expect(only).toContainText("It becomes an entry of its own; the event stays as it is.");
    await expect(whole).toContainText("The event and all its blockers take over the change.");
    await expect(ask.getByRole("button", { name: /Change/ })).toHaveCount(2);
    await expect(ask).not.toContainText("{{");
    await expect(sheet).toBeVisible();
    await page.screenshot({ path: test.info().outputPath("blocker-question.png") });

    // "The event": the write goes to the EVENT, and — refused here — says so.
    await whole.click();
    await expect(ask).toHaveCount(0);
    await expect(sheet).toHaveCount(0);
    const refused = page.locator(".pv-toast--error").filter({ hasText: "The event was not saved" });
    await expect(refused).toBeVisible({ timeout: 20_000 });
    // Taken back: both stand where the cache says they are, under their names.
    await expect(event("Board meeting")).toBeVisible();
    await expect(event("Busy")).toBeVisible();
    await expect(grid.getByText("Busy (dentist)")).toHaveCount(0);

    // Deleting an event that has a blocker asks about the blocker as well.
    await event("Board meeting").click();
    await page.getByTestId("event-peek-sheet").getByTestId("event-peek-delete").click();
    const del = page.locator(".m-sheet").filter({ has: page.locator(".m-sheet-title", { hasText: "Delete event" }) });
    await expect(del).toBeVisible();
    const both = del.getByRole("button", { name: /Delete event and blockers \(1\)/ });
    await expect(both).toContainText("in Family");
    await expect(del.getByRole("button", { name: /Delete only the event/ })).toHaveCount(1);
    await expect(del.getByRole("button", { name: /Delete/ }).first()).toContainText("Delete event and blockers (1)");
    await page.screenshot({ path: test.info().outputPath("blocker-delete-question.png") });
    // Backing out deletes nothing.
    await page.keyboard.press("Escape");
    if (await del.count()) await page.locator(".m-sheet-backdrop--dialog").click({ position: { x: 10, y: 10 } });
    await expect(del).toHaveCount(0);
    await expect(event("Board meeting")).toBeVisible();
    await expect(event("Busy")).toBeVisible();

    // An ordinary appointment is deleted with the plain confirmation, as before.
    await event("Lunch").click();
    await page.getByTestId("event-peek-sheet").getByTestId("event-peek-delete").click();
    await expect(page.getByRole("button", { name: /Delete only the event/ })).toHaveCount(0);
    await expect(page.locator(".m-sheet-title", { hasText: "Delete event" })).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    sql.close();
  }
});
