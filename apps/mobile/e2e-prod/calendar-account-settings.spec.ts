import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { waitForVaultDirectory } from "./exampleVault";

const LOCALES = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "packages", "ui", "src", "locales");
const de = JSON.parse(readFileSync(join(LOCALES, "de.json"), "utf8"));

/**
 * A calendar account in the phone's settings (finding 2026-10-30, TestFlight
 * screenshots): the account line stood above its card with the "aktiv" pill
 * touching "GOOGLE", the card was glued under it, and a failure was two loose
 * lines — "Die Sammlungen dieses Kontos konnten nicht geladen werden." and a
 * raw "HTTP_NETWORK_ERROR". Now the account is one card — its own row (address,
 * provider by name, the state at the end) and the row to its calendars — and
 * a failure is a note under it: who failed, the sentence, the words small.
 */
test("a calendar account is one card, and its failure a note that says who failed", async ({ page, context }, testInfo) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addLocatorHandler(page.getByTestId("whats-new-sheet"), async () => page.getByTestId("whats-new-close").click());
  // No provider answers in this run — and none is asked for real.
  await context.route(/googleapis\.com|accounts\.google\.com/, (route) => route.abort());
  const sql = await installSqlBridge(context);
  await context.addInitScript(() => {
    if (!localStorage.getItem("CapacitorStorage.mobile-settings")) localStorage.setItem("CapacitorStorage.mobile-settings", JSON.stringify({ onboarded: true, language: "de", motion: "off" }));
    // The account's sign-in slot for THIS device: it reads "aktiv".
    localStorage.setItem("CapacitorStorage.secret_pim_local_pim-fixture-1", JSON.stringify({ kind: "google", clientId: "fixture-client", refreshToken: "fixture" }));
  });
  const shoot = async (name: string) => {
    if (!process.env.PLAINVA_EVIDENCE) return;
    for (const mode of ["light", "dark"]) {
      await page.evaluate((m) => document.documentElement.setAttribute("data-theme", m), mode);
      await page.screenshot({ path: testInfo.outputPath(`${name}-${mode}.png`) });
    }
    await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
  };
  const openAccounts = async () => {
    await page.locator('[data-testid="nav-settings"]').first().click();
    await page.getByTestId("settings-area-pim").click();
    await expect(page.getByTestId("pim-account-pim-fixture-1")).toBeVisible({ timeout: 20_000 });
  };
  try {
    await page.goto("/");
    await waitForVaultDirectory(page);
    await expect.poll(() => sql.count("plainva-index", "sqlite_master WHERE name = 'pim_calendars'"), { timeout: 20_000 }).toBe(1);
    sql.seedPim("plainva-index");
    // The phone's native HTTP layer found no network on the last cycle.
    sql.run(
      "plainva-index",
      "INSERT OR REPLACE INTO pim_state (account_id, scope, cursor, last_sync_ts, last_error, last_error_kind, auth_revision) VALUES (?, 'account', NULL, NULL, ?, 'transient', NULL)",
      ["pim-fixture-1", "HTTP_NETWORK_ERROR"],
    );
    await page.reload();
    await expect(page.locator(".m-tabbar")).toBeVisible({ timeout: 20_000 });
    await openAccounts();

    // One card: the account's own row and the row to its calendars.
    const head = page.getByTestId("pim-account-pim-fixture-1");
    const card = page.locator(".m-pimacct .pv-card").filter({ has: head });
    await expect(card).toHaveCount(1);
    await expect(card.getByTestId("pim-account-calendars-pim-fixture-1")).toBeVisible();
    await expect(head.locator(".pv-grouprow-title")).toHaveText("anna@gmail.com");
    await expect(head.locator(".pv-grouprow-sub")).toHaveText("Google");
    await expect(head.locator(".m-state")).toHaveText(de.deviceSignIn.active);
    // The pill keeps its distance from everything beside it.
    const pill = await head.locator(".m-state").boundingBox();
    const title = await head.locator(".pv-grouprow-text").boundingBox();
    expect(pill!.x - (title!.x + title!.width)).toBeGreaterThanOrEqual(8);

    // The failure: in the account's group, under its card — sender, sentence, the words small.
    const note = page.locator(".m-pimacct").filter({ has: head }).getByTestId("pim-account-error-pim-fixture-1");
    await expect(note).toBeVisible();
    await expect(note.locator("strong")).toHaveText(de.connectRun.noConnection);
    await expect(note).toContainText(de.pim.authNetwork);
    // The seeded words, or those of the cycle that ran since (the provider is
    // blocked in this run): both are a missing network, said the same way.
    await expect(note.locator("code")).toHaveText(/^(HTTP_NETWORK_ERROR|Failed to fetch)$/);
    const noteBox = await note.boundingBox();
    const cardBox = await card.boundingBox();
    expect(noteBox!.y).toBeGreaterThan(cardBox!.y + cardBox!.height);
    await shoot("calendar-account-error");

    expect(errors).toEqual([]);
  } finally {
    sql.close();
  }
});
