import { test, expect, type BrowserContext, type Page } from "./clockedTest";
import { fixtureStorage, installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { installMailFixture } from "../scripts/screenshot-services.mjs";
import { waitForVaultDirectory, type MobileTestGlobals } from "./exampleVault";

/**
 * What the phone does with input that is not saved yet (finding 2026-10-22,
 * Sammelplan 3.139 Nr. 1 and 3), in the built app — the wiring lives in the
 * shell, which a unit test cannot render.
 *
 * A sheet: the journal entry being typed went with a tap beside the sheet,
 * and a step from outside (a launcher shortcut) took it without a question,
 * because no sheet armed the leave guard.
 *
 * A connect run: its next screen was pushed over whatever was on top when the
 * run's event came, and only the screen on top is rendered — a message being
 * written was gone. Now the step waits behind a notice whose button asks first.
 *
 * Against the locally routed fixtures; no request leaves localhost.
 */

const NOTE = "---\ntype: Note\n---\n# Angebot\n\nEin Satz, den nur diese Notiz trägt: schrittprobe.\n";

async function start(page: Page, context: BrowserContext, files: Array<[string, string]>) {
  const origin = new URL(test.info().project.use.baseURL ?? "http://localhost:4174").origin;
  await context.route((url) => url.origin !== origin, (route) => route.abort("blockedbyclient"));
  await installMailFixture(context);
  const sql = await installSqlBridge(context);
  try {
    const storage = Object.fromEntries(
      Object.entries(fixtureStorage()).filter(([key]) => key.startsWith("mailAccounts_") || key.startsWith("secret_mail_") || key === "cloudAccounts_local"),
    );
    await context.addInitScript((seed) => {
      if (localStorage.getItem("CapacitorStorage.mobile-settings")) return;
      localStorage.setItem("CapacitorStorage.mobile-settings", JSON.stringify({ onboarded: true, language: "en", motion: "off" }));
      for (const [key, value] of Object.entries(seed)) localStorage.setItem(`CapacitorStorage.${key}`, JSON.stringify(value));
    }, storage);
    await page.goto("/");
    await waitForVaultDirectory(page);
    await page.evaluate(async (entries) => {
      const fs = (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem;
      for (const [path, data] of entries) await fs.writeFile({ path: `vault/${path}`, data, directory: "DATA", encoding: "utf8", recursive: true });
    }, files);
    await page.reload();
    await expect(page.locator("#root > *").first()).toBeVisible();
    const close = page.getByTestId("whats-new-close");
    await expect(close).toBeVisible({ timeout: 15000 });
    await close.click();
    return sql;
  } catch (error) {
    await sql.close();
    throw error;
  }
}

const shortcut = (page: Page, which: string) =>
  page.evaluate((name) => {
    window.dispatchEvent(new CustomEvent("m-shortcut", { detail: { which: name } }));
  }, which);

test("a sheet with a journal entry being typed asks before a tap beside it or a step from outside takes it", async ({ page, context }, testInfo) => {
  test.setTimeout(90_000);
  const sql = await start(page, context, [["Angebot.md", NOTE]]);
  try {
    await shortcut(page, "journal");
    const sheet = page.getByTestId("journal-capture-sheet");
    await expect(sheet).toBeVisible({ timeout: 15000 });
    const field = sheet.getByTestId("journal-capture-input");
    await field.fill("The heron was back on the railing");
    const question = page.getByTestId("confirm-act");
    const stay = page.getByTestId("confirm-safe");

    // THE DEFECT: a tap beside the sheet closed it, and the entry was gone.
    await page.locator(".m-sheet-backdrop").first().click({ position: { x: 8, y: 8 } });
    await expect(question).toBeVisible();
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: testInfo.outputPath("sheet-guard-backdrop.png") });
    await stay.click();
    await expect(question).toHaveCount(0);
    await expect(field).toHaveValue("The heron was back on the railing");

    // A step from outside the sheet — a launcher shortcut — asks too.
    await shortcut(page, "today");
    await expect(question).toBeVisible();
    await stay.click();
    await expect(question).toHaveCount(0);
    await expect(sheet).toBeVisible();
    await expect(field).toHaveValue("The heron was back on the railing");

    // "Discard" closes it.
    await page.locator(".m-sheet-backdrop").first().click({ position: { x: 8, y: 8 } });
    await question.click();
    await expect(sheet).toHaveCount(0);

    // An empty sheet closes at once, as always.
    await shortcut(page, "journal");
    await expect(sheet).toBeVisible();
    await page.locator(".m-sheet-backdrop").first().click({ position: { x: 8, y: 8 } });
    await expect(sheet).toHaveCount(0);
    await expect(question).toHaveCount(0);
  } finally {
    await sql.close();
  }
});

test("a connect run does not push its next step over a message being written: it offers it, and the button asks first", async ({ page, context }, testInfo) => {
  test.setTimeout(90_000);
  const sql = await start(page, context, [["Angebot.md", NOTE]]);
  try {
    // A message being written: the note as an attachment, and a recipient typed.
    await page.getByTestId("appbar-search").first().click();
    await page.getByTestId("appbar-searchpage").locator("input").fill("schrittprobe");
    await page.locator("[data-search-occurrence]").first().click();
    await expect(page.locator(".cm-content")).toContainText("schrittprobe", { timeout: 15000 });
    await page.getByTestId("note-menu").click();
    await page.getByRole("button", { name: "Send as email attachment" }).click();
    const recipient = page.getByRole("textbox", { name: "To", exact: true });
    await recipient.fill("ben@example.org");

    // A connect run of this vault comes to its calendar step now — as when a
    // sign-in comes back while the person has gone on to write.
    await page.evaluate(() => {
      const run = {
        id: "run-e2e", family: "fastmail",
        context: { vaultId: "local", runId: "run-e2e", cloudAccountId: "account-e2e" },
        pending: ["calendar"], done: ["files"], outcomes: {}, selectionConfirmed: false, createdAt: Date.now(),
      };
      localStorage.setItem("CapacitorStorage.mobileConnectQueue", JSON.stringify(run));
      window.dispatchEvent(new CustomEvent("m-connect-run-changed"));
    });

    const offer = page.locator(".pv-toast", { hasText: "The connection goes on with its next step when you are ready." });
    // THE DEFECT: the run's calendar step was pushed on top, and the message went with it.
    await expect(offer).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("connectrun-frame")).toHaveCount(0);
    await expect(recipient).toHaveValue("ben@example.org");
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: testInfo.outputPath("connect-run-offer.png") });

    // The button asks first; "Cancel" keeps the message and the offer.
    const question = page.getByTestId("confirm-act");
    await offer.locator(".pv-toast-action").click();
    await expect(question).toBeVisible();
    await page.getByTestId("confirm-safe").click();
    await expect(recipient).toHaveValue("ben@example.org");
    await expect(offer).toBeVisible();

    // "Discard": the run's step goes on top.
    await offer.locator(".pv-toast-action").click();
    await question.click();
    await expect(page.getByTestId("connectrun-frame")).toHaveAttribute("data-step", "calendar", { timeout: 15000 });
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: testInfo.outputPath("connect-run-after-discard.png") });
  } finally {
    await sql.close();
  }
});
