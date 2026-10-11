import { test, expect } from "@playwright/test";
import { fixtureStorage, installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { installMailFixture } from "../scripts/screenshot-services.mjs";
import { returnToApp, waitForVaultDirectory, type MobileTestGlobals } from "./exampleVault";
import { installShareInbox } from "./shareInbox";

/**
 * What is drawn OVER the composer asks before it takes the message off the
 * screen (finding 2026-10-09).
 *
 * Only the screen on top is rendered. The share inbox lies over whatever is
 * open, and its ways on — "Choose vault", the note it just filed — put another
 * screen on top: a message being written was gone in that moment, and with
 * "Choose vault" the vault after it. The bar, the back arrow and Android back
 * asked first; this did not. It asks now, with the composer's own question, and
 * "Cancel" leaves the message standing.
 *
 * In the built app, because the wiring lives in the shell and the shell cannot
 * be rendered in a unit test. Against the locally routed Graph fixture; no
 * request leaves localhost.
 */

const NOTE = "---\ntype: Note\n---\n# Angebot\n\nEin Satz, den nur diese Notiz trägt: verlassprobe.\n";

test("the share inbox over a message being written: choosing a vault and opening the filed note ask first", async ({ page, context }, testInfo) => {
  test.setTimeout(90_000);
  const origin = new URL(test.info().project.use.baseURL ?? "http://localhost:4174").origin;
  await context.route((url) => url.origin !== origin, (route) => route.abort("blockedbyclient"));
  await installMailFixture(context);
  const sql = await installSqlBridge(context);
  const inbox = await installShareInbox(context);
  // One Microsoft mailbox, signed in on this device — the fixture's own shapes.
  const storage = Object.fromEntries(
    Object.entries(fixtureStorage()).filter(([key]) => key.startsWith("mailAccounts_") || key.startsWith("secret_mail_") || key === "cloudAccounts_local"),
  );
  await context.addInitScript((seed) => {
    if (localStorage.getItem("CapacitorStorage.mobile-settings")) return;
    localStorage.setItem("CapacitorStorage.mobile-settings", JSON.stringify({ onboarded: true, language: "en", motion: "off" }));
    for (const [key, value] of Object.entries(seed)) localStorage.setItem(`CapacitorStorage.${key}`, JSON.stringify(value));
  }, storage);
  try {
    await page.goto("/");
    await waitForVaultDirectory(page);
    await page.evaluate(async (data) => {
      await (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem.writeFile({ path: "vault/Angebot.md", data, directory: "DATA", encoding: "utf8", recursive: true });
    }, NOTE);
    await page.reload();
    await expect(page.locator("#root > *").first()).toBeVisible();
    const close = page.getByTestId("whats-new-close");
    await expect(close).toBeVisible({ timeout: 15000 });
    await close.click();

    // A message being written: the note as an attachment, and a recipient typed.
    await page.getByTestId("appbar-search").first().click();
    await page.getByTestId("appbar-searchpage").locator("input").fill("verlassprobe");
    await page.locator("[data-search-occurrence]").first().click();
    await expect(page.locator(".cm-content")).toContainText("verlassprobe", { timeout: 15000 });
    await page.getByTestId("note-menu").click();
    await page.getByRole("button", { name: "Send as email attachment" }).click();
    await expect(page.getByRole("textbox", { name: "Subject", exact: true })).toHaveValue("Angebot");
    const recipient = page.getByRole("textbox", { name: "To", exact: true });
    const file = page.getByTestId("compose-attachment");
    await recipient.fill("ben@example.org");

    const sheet = page.getByTestId("share-inbox");
    const question = page.getByTestId("confirm-act");
    const stay = page.getByTestId("confirm-safe");
    /** The message is still there, with everything in it. */
    const messageStands = async () => {
      await expect(question).toHaveCount(0);
      await expect(recipient).toHaveValue("ben@example.org");
      await expect(file).toHaveCount(1);
    };

    // Something is shared to Plainva from another app; back in the app, its
    // inbox lies over the composer.
    inbox.share({ id: "5a4e0002-7a5c-4b6e-8d9f-5ba7ed000001", text: "Buy stamps\nThe post office closes at six." });
    await returnToApp(page);
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText("Buy stamps");

    // THE DEFECT: "Choose vault" put the vault list on top, and the message was gone.
    await sheet.getByRole("button", { name: "Choose vault" }).click();
    await expect(question).toBeVisible();
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: testInfo.outputPath("compose-leave-share-inbox.png") });
    await stay.click();
    await messageStands();
    // "Cancel" means nothing happened: the inbox is still open, too.
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText("Buy stamps");

    // A second share arrives; the inbox counts it and goes on showing the
    // first. Filing that one works with the composer open — and the note it
    // made does not open over the message unasked.
    inbox.share({ id: "5a4e0002-7a5c-4b6e-8d9f-5ba7ed000002", text: "Call the tax office" });
    await returnToApp(page);
    await expect(sheet).toContainText("Waiting transfers: 2");
    await sheet.getByRole("button", { name: "Import", exact: true }).click();
    await expect.poll(() => inbox.acknowledged().length, { timeout: 20_000 }).toBe(1);
    await expect(question).toBeVisible();
    await stay.click();
    await messageStands();

    // The inbox is on to what still waits. "Discard" is the answer that lets
    // the message go: the vault list is on top.
    await expect(sheet).toContainText("Call the tax office");
    await sheet.getByRole("button", { name: "Choose vault" }).click();
    await expect(question).toBeVisible();
    await question.click();
    await expect(page.getByTestId("vault-row").first()).toBeVisible();
    await expect(recipient).toHaveCount(0);
    await expect(question).toHaveCount(0);
  } finally {
    await sql.close();
  }
});
