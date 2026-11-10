import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { waitForIndexSchema, waitForVaultDirectory, type MobileTestGlobals } from "./exampleVault";

/**
 * "Errors in the picture" of the interface review of 2026-11-10 (package O1),
 * on the phone's production bundle: what the review photographed, checked
 * where it was photographed.
 *
 * X1 the agenda's colour dot grew into a bar and its first row lay under the
 *    day head; X2 the "now" line ran across the pinned all-day strip and the
 *    hour label at the top was cut in half; X4 the calendar wrote its axis in
 *    24 hours and its events in 12; X8 ☰ opened the settings; X10 a folder of
 *    two files said "0 notes", and "What's new" pointed to release notes it did
 *    not link.
 */

/** The calendar's views, by their names (the test ids came with the fix). */
const view = (page: Page, name: string) => page.getByRole("radio", { name }).or(page.getByRole("button", { name, exact: true })).first();

/** The hour labels of the time grid's axis, by what they say: an hour of 24 or of 12. */
const hourLabels = (page: Page) => page.evaluate(() => [...document.querySelectorAll('[data-testid="pim-timegrid"] div')]
  .filter((el) => el.children.length === 0)
  .map((el) => (el.textContent ?? "").trim())
  .filter((text) => /^(\d{1,2}:00|\d{1,2}\s?(AM|PM))$/.test(text)));

const evidence = async (page: Page, name: string) => {
  if (!process.env.PLAINVA_EVIDENCE) return;
  for (const mode of ["light", "dark"]) {
    await page.evaluate((m) => document.documentElement.setAttribute("data-theme", m), mode);
    await page.waitForTimeout(150);
    await page.screenshot({ path: test.info().outputPath(`${name}-${mode}.png`) });
  }
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
};

/**
 * A Thursday morning, in the browser's own clock: the grid opens on the hour
 * before, with the rest of the day still below it - the scroll the review
 * photographed. (In the afternoon the grid hits its end and no hour lands on
 * the head's edge, which hid the cut label.)
 */
const NOW = new Date(2026, 9, 29, 9, 20);

async function bootCalendar(page: Page, context: BrowserContext, language = "en", busyWeeks = false) {
  await page.addLocatorHandler(page.getByTestId("whats-new-sheet"), async () => page.getByTestId("whats-new-close").click());
  await context.route(/googleapis\.com|accounts\.google\.com/, (route) => route.abort());
  await page.clock.setFixedTime(NOW);
  const sql = await installSqlBridge(context);
  await context.addInitScript((lang) => {
    if (!localStorage.getItem("CapacitorStorage.mobile-settings")) localStorage.setItem("CapacitorStorage.mobile-settings", JSON.stringify({ onboarded: true, language: lang, motion: "off" }));
    localStorage.setItem("CapacitorStorage.secret_pim_local_pim-fixture-1", JSON.stringify({ kind: "google", clientId: "fixture-client", refreshToken: "fixture" }));
    localStorage.setItem("plainva-calendar-view", "day");
  }, language);
  await page.goto("/");
  await waitForVaultDirectory(page);
  await waitForIndexSchema(sql, "plainva-index");
  sql.seedPim("plainva-index");
  const midnight = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate()).getTime();
  const pad = (n: number) => String(n).padStart(2, "0");
  const key = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const insert =
    "INSERT OR REPLACE INTO pim_events (account_id, cal_id, uid, title, start_ts, end_ts, start_date, end_date, all_day, status_kind, working_loc) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
  sql.run("plainva-index", insert, ["pim-fixture-1", "primary", "pic-allday", "Container grammar walked through with the maintainer", midnight, midnight + 86_400_000, key(NOW), key(new Date(midnight + 26 * 3_600_000)), 1, null, null]);
  sql.run("plainva-index", insert, ["pim-fixture-1", "primary", "pic-review", "Weekly review", midnight + 9 * 3_600_000, midnight + 10 * 3_600_000, null, null, 0, null, null]);
  sql.run("plainva-index", insert, ["pim-fixture-1", "primary", "pic-plan", "Weekly planning", midnight + 14 * 3_600_000, midnight + 15 * 3_600_000, null, null, 0, null, null]);
  // An agenda longer than the screen: one appointment on each of the next 20 days.
  if (busyWeeks) for (let d = 1; d <= 20; d++) {
    sql.run("plainva-index", insert, ["pim-fixture-1", "primary", `pic-busy-${d}`, `Appointment ${d}`, midnight + d * 86_400_000 + 10 * 3_600_000, midnight + d * 86_400_000 + 11 * 3_600_000, null, null, 0, null, null]);
  }
  await page.reload();
  await expect(page.locator(".m-tabbar")).toBeVisible({ timeout: 20_000 });
  const tab = page.locator(".m-tabbar .m-tab", { hasText: language === "de" ? /^Kalender$/ : /^Calendar$/ });
  if (await tab.count()) await tab.first().click();
  else {
    await page.getByTestId("tab-areas").click();
    await page.getByTestId("areas-calendar").click();
  }
  await expect(page.getByTestId("pim-timegrid")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("pim-timegrid").getByTestId("pim-event").filter({ hasText: "Weekly planning" })).toBeVisible();
  return sql;
}

test("X2: the now line is drawn below the pinned head and all-day strip", async ({ page, context }) => {
  test.setTimeout(120_000);
  const sql = await bootCalendar(page, context);
  try {
    // The "now" line: the absolutely placed 2px rule in today's column.
    const z = await page.evaluate(() => {
      const line = [...document.querySelectorAll<HTMLElement>('[data-testid="pim-timegrid"] div[aria-hidden]')]
        .find((el) => getComputedStyle(el).borderTopWidth === "2px" && getComputedStyle(el).position === "absolute");
      const top = document.querySelector<HTMLElement>('[data-testid="pim-timegrid-head"]')!;
      return { line: line ? Number(getComputedStyle(line).zIndex) || 0 : null, head: Number(getComputedStyle(top).zIndex) || 0 };
    });
    expect(z.line, "today has a now line").not.toBeNull();
    expect(z.line!, "the now line is drawn below the pinned head and all-day strip").toBeLessThan(z.head);
    await evidence(page, "calendar-now-under-head");
  } finally {
    sql.close();
  }
});

test("X2: the hour label at the top of the opened grid is not cut by the head", async ({ page, context }) => {
  test.setTimeout(120_000);
  const sql = await bootCalendar(page, context);
  try {
    // Every hour label lies wholly below the head or wholly behind it.
    const cut = await page.evaluate(() => {
      const headBox = document.querySelector('[data-testid="pim-timegrid-head"]')!.getBoundingClientRect();
      const labels = [...document.querySelectorAll('[data-testid="pim-timegrid"] div')]
        .filter((el) => el.children.length === 0 && /^(\d{1,2}:00|\d{1,2}\s?(AM|PM))$/.test((el.textContent ?? "").trim()));
      return labels.map((l) => l.getBoundingClientRect()).filter((r) => r.height > 0 && r.top < headBox.bottom && r.bottom > headBox.bottom).length;
    });
    expect(cut, "an hour label half under the head").toBe(0);
  } finally {
    sql.close();
  }
});

test("X4: on a 12-hour device the axis and the events speak one clock", async ({ page, context }) => {
  test.setTimeout(120_000);
  const sql = await bootCalendar(page, context);
  try {
    // This browser is en-US, a 12-hour region.
    const axis = await hourLabels(page);
    expect(axis.length).toBeGreaterThan(10);
    expect(axis.every((label) => /AM|PM/.test(label)), `axis ${axis.slice(0, 3).join(", ")}`).toBe(true);
    await view(page, "Agenda").click();
    const row = page.getByTestId("pim-event").filter({ hasText: "Weekly planning" }).first();
    await expect(row).toContainText(/(^|\D)2:00\s?PM/);
  } finally {
    sql.close();
  }
});

test("X1: the agenda opens at its top, its first row below its day head, its dot a dot", async ({ page, context }) => {
  test.setTimeout(120_000);
  const sql = await bootCalendar(page, context, "en", true);
  try {
    // Day view first: its grid is scrolled to the afternoon. The agenda must
    // not inherit that scroll position.
    await view(page, "Agenda").click();
    const firstHead = page.getByText("Thu, October 29", { exact: true });
    await expect(firstHead).toBeVisible();
    const agenda = page.locator(".m-scroll", { has: firstHead });
    const mark = agenda.locator(".m-evt-mark").first();
    const row = agenda.getByTestId("pim-event").filter({ hasText: "Weekly planning" });
    await expect(row).toBeVisible();
    // Measured together, then judged: each of the three is the finding.
    const firstRow = agenda.getByTestId("pim-event").first();
    const headBox = (await firstHead.boundingBox())!;
    const facts = {
      scrollTop: await agenda.evaluate((el) => el.scrollTop),
      rowBelowHead: (await firstRow.boundingBox())!.y >= headBox.y + headBox.height - 1,
      markWidth: Math.round((await mark.boundingBox())!.width),
      titleWidth: Math.round((await row.locator(".m-evt-title").boundingBox())!.width),
    };
    expect(facts, "agenda at its top, first row below its head, dot a dot, title with room").toEqual({
      scrollTop: 0, rowBelowHead: true, markWidth: expect.any(Number), titleWidth: expect.any(Number),
    });
    expect(facts.markWidth, "the colour mark is a dot, not a bar").toBeLessThanOrEqual(8);
    expect(facts.titleWidth).toBeGreaterThan(150);
    await evidence(page, "calendar-agenda");
  } finally {
    sql.close();
  }
});

test.describe("on a 24-hour device", () => {
  test.use({ locale: "de-DE" });
  test("X4: an English interface still writes 24 hours, in the axis and in the events", async ({ page, context }) => {
    test.setTimeout(120_000);
    const sql = await bootCalendar(page, context, "en");
    try {
      const axis = await hourLabels(page);
      expect(axis.some((label) => /^\d{2}:00$/.test(label))).toBe(true);
      expect(axis.some((label) => /AM|PM/.test(label))).toBe(false);
      await view(page, "Agenda").click();
      const row = page.getByTestId("pim-event").filter({ hasText: "Weekly planning" }).first();
      await expect(row).toContainText("14:00");
      await expect(row).not.toContainText(/AM|PM/);
    } finally {
      sql.close();
    }
  });
});

async function bootHome(page: Page, context: BrowserContext, viewport = { width: 390, height: 844 }) {
  await page.setViewportSize(viewport);
  const sql = await installSqlBridge(context);
  await context.addInitScript(() => {
    if (!localStorage.getItem("CapacitorStorage.mobile-settings")) localStorage.setItem("CapacitorStorage.mobile-settings", JSON.stringify({ onboarded: true, language: "en", motion: "off" }));
    const w = window as Window & { __opened?: string[] };
    w.__opened = [];
    window.open = ((url?: string | URL) => { w.__opened!.push(String(url)); return null; }) as typeof window.open;
  });
  await page.goto("/");
  await waitForVaultDirectory(page);
  return sql;
}

test("X10: \"What's new\" links the release notes it points to", async ({ page, context }) => {
  const sql = await bootHome(page, context);
  try {
    const sheet = page.getByTestId("whats-new-sheet");
    await expect(sheet).toBeVisible({ timeout: 15_000 });
    const notes = sheet.getByTestId("whatsnew-release-notes");
    await expect(notes).toBeVisible();
    await evidence(page, "whats-new");
    await notes.click();
    await expect.poll(() => page.evaluate(() => (window as Window & { __opened?: string[] }).__opened ?? [])).toEqual([
      expect.stringMatching(/^https:\/\/github\.com\/plainva\/plainva\/releases\/tag\/v\d+\.\d+\.\d+$/),
    ]);
  } finally {
    sql.close();
  }
});

test("X10: a folder of two files says so, not \"0 notes\"", async ({ page, context }) => {
  test.setTimeout(90_000);
  await page.addLocatorHandler(page.getByTestId("whats-new-sheet"), async () => page.getByTestId("whats-new-close").click());
  const sql = await bootHome(page, context);
  try {
    await page.evaluate(async () => {
      const fs = (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem;
      await fs.writeFile({ path: "vault/Pictures/sketch.png", data: "iVBORw0KGgo=", directory: "DATA" as never, recursive: true });
      await fs.writeFile({ path: "vault/Pictures/scan.pdf", data: "JVBERi0=", directory: "DATA" as never, recursive: true });
    });
    await page.reload();
    await expect(page.locator(".m-tabbar")).toBeVisible({ timeout: 20_000 });
    const row = page.locator(".pv-grouprow", { hasText: "Pictures" }).first();
    await expect(row).toBeVisible({ timeout: 20_000 });
    await expect(row.locator(".pv-grouprow-sub")).toHaveText("2 files", { timeout: 20_000 });
    await evidence(page, "home-folder-files");
  } finally {
    sql.close();
  }
});

test("X8: the settings sit behind the gear, and on a tablet only in the rail", async ({ page, context }) => {
  await page.addLocatorHandler(page.getByTestId("whats-new-sheet"), async () => page.getByTestId("whats-new-close").click());
  const sql = await bootHome(page, context);
  try {
    await expect(page.locator(".m-tabbar")).toBeVisible({ timeout: 20_000 });
    // The app bar's way into the settings is a gear, not ☰.
    const settings = page.getByTestId("nav-settings").first();
    await expect(settings).toBeVisible();
    await expect(settings.locator("svg.lucide-menu")).toHaveCount(0);
    await expect(settings.locator("svg.lucide-settings")).toHaveCount(1);
    // On a tablet the rail carries Settings: no second way beside it in the app bar.
    await page.setViewportSize({ width: 820, height: 1180 });
    await expect(page.getByTestId("rail-settings")).toBeVisible();
    await expect(page.getByTestId("nav-settings")).toBeHidden();
    await evidence(page, "tablet-home");
  } finally {
    sql.close();
  }
});
