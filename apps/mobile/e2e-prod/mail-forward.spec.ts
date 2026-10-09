import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { fixtureStorage, installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { installMailFixture } from "../scripts/screenshot-services.mjs";
import { waitForVaultDirectory } from "./exampleVault";

/**
 * What a forward carries, on the phone (finding 2026-10-09).
 *
 * The handbook said a forward takes the attachments along. No build ever did,
 * on either shell: the draft a forward opens is the original's text under a
 * header block (`buildForwardBody`), the message screen hands the composer no
 * file, and nothing on the way to the mailbox asks for one. The reader lists
 * the file, the composer opens without it, and the message goes out without it.
 *
 * This runs the built app against the locally routed Graph fixture — reader,
 * composer, mailbox — and holds the two ends the handbook sentence is about:
 * what the composer shows and what the mailbox is handed. Whoever teaches a
 * forward to bring the files changes this test and the sentence in
 * `docs/user/<lang>/Email_Capture.md` ("Composing and sending") in the same
 * commit; the desktop holds the same in `apps/desktop/e2e/mail.spec.ts`.
 *
 * No request leaves localhost.
 */

/** The app with one Microsoft mailbox, signed in on this device, in English, on the inbox. */
async function bootMail(context: BrowserContext, page: Page) {
  const origin = new URL(test.info().project.use.baseURL ?? "http://localhost:4174").origin;
  await context.route((url) => url.origin !== origin, (route) => route.abort("blockedbyclient"));
  const mail = await installMailFixture(context);
  const sql = await installSqlBridge(context);
  // The mailbox, its account record and its sign-in — the fixture's own shapes.
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
  await expect(page.locator("#root > *").first()).toBeVisible();
  const close = page.getByTestId("whats-new-close");
  await expect(close).toBeVisible({ timeout: 15000 });
  await close.click();
  await page.getByTestId("tab-areas").click();
  await page.getByTestId("areas-mail").click();
  await expect(page.locator("button.m-mailrow")).toHaveCount(3, { timeout: 15000 });
  return { mail, sql };
}

test("a forward carries the text of the original, and none of its files", async ({ page, context }, testInfo) => {
  test.setTimeout(90_000);
  const { mail, sql } = await bootMail(context, page);
  try {
    // The message with a file on it: the reader lists it by name and size.
    await page.locator("button.m-mailrow", { hasText: "Die neue Übersicht ist fertig." }).click();
    const listed = page.locator(".m-maillist");
    await expect(listed).toContainText("Projektübersicht.txt");
    await expect(listed).toContainText("36 B");

    await page.getByRole("button", { name: /^Forward$/ }).click();
    await expect(page.getByRole("textbox", { name: "Subject", exact: true })).toHaveValue("Fwd: Projektübersicht");
    // The text of the original is in the draft; its file is not.
    await expect(page.locator(".cm-content").filter({ hasText: "Die Projektplanung liegt im gemeinsamen Vault." })).toHaveCount(1);
    await expect(page.getByTestId("compose-attachment")).toHaveCount(0);
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: testInfo.outputPath("mail-forward-composer.png") });

    await page.getByRole("textbox", { name: "To", exact: true }).fill("carla@example.org");
    expect(mail.sent).toEqual([]);
    await page.getByRole("button", { name: /^Send$/ }).first().click();
    // Once the undo window has passed, the mailbox is handed the text and no file.
    await expect.poll(() => mail.sent.length, { timeout: 20_000 }).toBe(1);
    const { message } = mail.sent[0] as {
      message: { subject: string; toRecipients: unknown; body: { content: string }; attachments?: unknown };
    };
    expect(message.subject).toBe("Fwd: Projektübersicht");
    expect(message.toRecipients).toEqual([{ emailAddress: { address: "carla@example.org" } }]);
    expect(message.body.content).toContain("Die Projektplanung liegt im gemeinsamen Vault.");
    expect(message.attachments).toBeUndefined();
    // The file's bytes were never asked for: the fixture answers the reader's
    // list of names, and a request for one attachment's content would be one
    // it does not know.
    expect(mail.unexpected.filter((request: string) => request.includes("/attachments"))).toEqual([]);
  } finally {
    await sql.close();
  }
});
