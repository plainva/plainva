import { test, expect, type Page } from "@playwright/test";

/**
 * The calendar's head on the phone (feedback 2026-10-29): the same app bar as
 * every other area - menu level with the title, search and sync on the right -
 * and below it the period BETWEEN the arrows that move it, "Today" and "New
 * event". No shortcut into the calendar accounts. Measured on a 375pt phone
 * (iPhone 13 mini), the narrowest one the testers use.
 *
 * Production bundle, like the other checks here: the app bar, the toolbar and
 * the shared label helper meet in one place.
 */
async function openCalendar(page: Page, language: string) {
  await page.addInitScript((lang) => {
    globalThis.localStorage.setItem(
      "CapacitorStorage.mobile-settings",
      JSON.stringify({ onboarded: true, language: lang, motion: "off" }),
    );
  }, language);
  await page.setViewportSize({ width: 375, height: 812 });
  // A Thursday in a week that runs into the next month: the longest week label.
  await page.clock.setFixedTime(new Date("2026-10-29T12:00:00"));
  await page.goto("/");
  await expect(page.locator("#root > *").first()).toBeVisible({ timeout: 20000 });
  await page.waitForTimeout(1500);
  const whatsNew = page.getByTestId("whats-new-close");
  if (await whatsNew.isVisible()) await whatsNew.click();
  await expect(page.locator(".m-sheet-backdrop")).toHaveCount(0);
}

async function gotoCalendarTab(page: Page, name: RegExp) {
  const tab = page.locator(".m-tabbar .m-tab", { hasText: name });
  if (await tab.count()) {
    await tab.first().click();
  } else {
    await page.getByTestId("tab-areas").click();
    await page.getByRole("button", { name }).first().click();
  }
  await expect(page.getByTestId("pim-title")).toBeVisible({ timeout: 20000 });
}

/** The period's text fits its button: nothing cut to "…". */
async function periodFits(page: Page) {
  return page.getByTestId("pim-title").evaluate((button) => {
    const span = button.querySelector("span");
    return !!span && span.scrollWidth <= span.clientWidth;
  });
}

test("the period sits between the arrows, sync next to search, and no accounts shortcut", async ({ page }, testInfo) => {
  await openCalendar(page, "de");
  await gotoCalendarTab(page, /^Kalender$/);

  // Toolbar order: back, period, forward.
  const order = await page.locator(".m-pimbar > *").evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute("data-testid") ?? node.getAttribute("aria-label") ?? node.className),
  );
  const at = (label: string) => order.findIndex((entry) => entry === label);
  expect(at("Zurück")).toBeGreaterThanOrEqual(0);
  expect(at("pim-title")).toBe(at("Zurück") + 1);
  expect(at("Weiter")).toBe(at("pim-title") + 1);

  // Sync lives in the app bar, next to search; nothing jumps into the accounts.
  await expect(page.locator(".m-appbar [data-testid=pim-sync]")).toBeVisible();
  await expect(page.locator(".m-pimbar [data-testid=pim-sync]")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Kalenderkonten" })).toHaveCount(0);
  // The period is no longer the app bar's subtitle.
  await expect(page.locator(".m-appbar .m-appbar-sub")).toHaveCount(0);

  // "Today" is faded while today is on screen, and wakes up once it is not.
  await expect(page.getByTestId("pim-today")).toBeDisabled();
  await page.getByRole("button", { name: "Weiter" }).click();
  await expect(page.getByTestId("pim-today")).toBeEnabled();
  await page.getByTestId("pim-today").click();
  await expect(page.getByTestId("pim-today")).toBeDisabled();

  // Every view names its period in full on a 375pt phone.
  const views: Array<[string, RegExp]> = [
    ["Tag", /^Do\., 29\. Okt\.$/],
    ["3 Tage", /^29\.–31\. Okt\.$/],
    ["Woche", /^26\. Okt\.\s–\s1\. Nov\.$/],
    ["Monat", /^Oktober 2026$/],
    ["Agenda", /^29\. Okt\.\s–\s27\. Dez\.$/],
  ];
  for (const [view, label] of views) {
    await page.locator(".m-page--pimcal [role=radiogroup] [role=radio]", { hasText: new RegExp(`^${view}$`) }).click();
    await expect(page.getByTestId("pim-title")).toHaveText(label);
    expect(await periodFits(page), `${view}: the period is cut`).toBe(true);
  }
  await page.locator(".m-page--pimcal [role=radiogroup] [role=radio]", { hasText: /^Woche$/ }).click();
  if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: testInfo.outputPath("calendar-head-375.png") });
});

const TAB_NAME: Record<string, RegExp> = { en: /^Calendar$/, nl: /^Kalender$/, pl: /^Kalendarz$/ };
for (const language of ["en", "nl", "pl"]) {
  test(`the week over a month's end fits between the arrows (${language})`, async ({ page }) => {
    await openCalendar(page, language);
    const name = TAB_NAME[language];
    await gotoCalendarTab(page, name);
    await page.locator(".m-page--pimcal [role=radiogroup] [role=radio]").nth(2).click();
    // Both months are named, and nothing is glued on after the first day.
    await expect(page.getByTestId("pim-title")).not.toHaveText(/^26\.–/);
    expect(await periodFits(page), "the period is cut").toBe(true);
  });
}

test("the menu sits level with the title when a line of context follows", async ({ page }) => {
  await openCalendar(page, "de");
  const tab = page.locator(".m-tabbar .m-tab", { hasText: /^Heute$/ });
  if (await tab.count()) await tab.first().click();
  else {
    await page.getByTestId("tab-areas").click();
    await page.getByRole("button", { name: /^Heute$/ }).first().click();
  }
  const bar = page.locator(".m-appbar.m-appbar--sub").first();
  await expect(bar).toBeVisible({ timeout: 20000 });
  const menu = await bar.getByTestId("nav-settings").boundingBox();
  const title = await bar.locator("h1").boundingBox();
  expect(menu && title).toBeTruthy();
  const centre = (box: { y: number; height: number }) => box.y + box.height / 2;
  expect(Math.abs(centre(menu!) - centre(title!))).toBeLessThanOrEqual(2);
});
