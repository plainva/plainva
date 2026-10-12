import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { fixtureStorage, installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { installMailFixture } from "../scripts/screenshot-services.mjs";
import { waitForVaultDirectory } from "./exampleVault";

/**
 * A message is written from the mailbox it belongs to — on the phone (finding
 * 2026-10-09).
 *
 * The desktop composer started with the first mailbox that is stored, whatever
 * the draft came from: a reply to a message in the second mailbox opened under
 * the first one's address and signature. The phone had it right all along —
 * the account travels with the draft, from the reader and from the list — and
 * nothing held that: the routes are pinned to what they are handed
 * (`mailRoutes.test.ts`), what the two screens hand them was not.
 *
 * This runs the built app with two mailboxes that sign differently and holds,
 * for a reply, a forward and a new message, what the desktop holds in
 * `apps/desktop/e2e/mail.spec.ts`: the sender the composer opens with, the
 * signature that belongs to it, and the message that is handed over.
 *
 * It does not look at which sign-in the request travels with: both mailboxes
 * are Microsoft ones behind the same locally routed fixture.
 *
 * No request leaves localhost.
 */

type MailboxSeed = Record<string, unknown> & { id: string };

const SECOND = "mail-fixture-2";

/** The app with two signing Microsoft mailboxes, signed in on this device, in English, on the first one's inbox. */
async function bootTwoMailboxes(context: BrowserContext, page: Page) {
  const origin = new URL(test.info().project.use.baseURL ?? "http://localhost:4174").origin;
  await context.route((url) => url.origin !== origin, (route) => route.abort("blockedbyclient"));
  const mail = await installMailFixture(context);
  const sql = await installSqlBridge(context);
  // The fixture's own mailbox, account record and sign-in — and beside it a
  // second mailbox of the same shape, with a sign-in in the same kind of slot.
  const storage: Record<string, unknown> = Object.fromEntries(
    Object.entries(fixtureStorage()).filter(([key]) => key.startsWith("mailAccounts_") || key.startsWith("secret_mail_") || key === "cloudAccounts_local"),
  );
  for (const [key, value] of Object.entries(storage)) {
    const list = value as MailboxSeed[];
    if (key.startsWith("mailAccounts_") && Array.isArray(list) && list.some((m) => m.id === "mail-fixture-1")) {
      const first = list.find((m) => m.id === "mail-fixture-1")!;
      storage[key] = [
        { ...first, signature: "Anna\nErstes Postfach" },
        { ...first, id: SECOND, label: "privat@example.net", user: "privat@example.net", signature: "Anna\nZweites Postfach" },
      ];
    }
    if (key.startsWith("secret_mail_") && key.endsWith("_mail-fixture-1")) {
      storage[key.replace(/_mail-fixture-1$/, `_${SECOND}`)] = { refreshToken: "local-fixture-only" };
    }
  }
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

const back = (page: Page) => page.getByRole("button", { name: /^Back$/ }).first().click();
const from = (page: Page) => page.getByRole("button", { name: /^From / });
const body = (page: Page) => page.locator(".cm-content");

/** The composer as it opens for the second mailbox: its address in "From", its signature in the text — not the first one's. */
async function expectSecondMailbox(page: Page) {
  await expect(from(page)).toContainText("privat@example.net");
  await expect(body(page)).toContainText("Zweites Postfach");
  await expect(body(page)).not.toContainText("Erstes Postfach");
}

test("a reply, a forward and a new message start from the mailbox they are written in", async ({ page, context }, testInfo) => {
  test.setTimeout(120_000);
  const { mail, sql } = await bootTwoMailboxes(context, page);
  try {
    // The first mailbox is the open one, and a new message starts there.
    await expect(page.locator(".m-mboxline-acct")).toHaveText("anna@example.org");
    await page.getByRole("button", { name: "New message" }).click();
    await expect(from(page)).toContainText("anna@example.org");
    await expect(body(page)).toContainText("Erstes Postfach");
    await expect(body(page)).not.toContainText("Zweites Postfach");
    await back(page);

    // The second mailbox, chosen by hand in the sheet.
    await page.locator(".m-mboxline").click();
    await page.locator(".m-sheet button.m-row", { hasText: "privat@example.net" }).click();
    await expect(page.locator(".m-mboxline-acct")).toHaveText("privat@example.net");
    await expect(page.locator("button.m-mailrow")).toHaveCount(3, { timeout: 15000 });

    // A reply to a message in it.
    await page.locator("button.m-mailrow", { hasText: "Die neue Übersicht ist fertig." }).click();
    await page.getByRole("button", { name: /^Reply$/ }).click();
    await expect(page.getByRole("textbox", { name: "Subject", exact: true })).toHaveValue("Re: Projektübersicht");
    await expectSecondMailbox(page);
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: testInfo.outputPath("mail-reply-second-mailbox.png") });
    // Nothing was written: the composer closes without a question.
    await back(page);

    // A forward of the same message.
    await page.getByRole("button", { name: /^Forward$/ }).click();
    await expect(page.getByRole("textbox", { name: "Subject", exact: true })).toHaveValue("Fwd: Projektübersicht");
    await expectSecondMailbox(page);
    await back(page);
    await back(page);

    // A new message from the list of that mailbox — and this one is sent.
    await page.getByRole("button", { name: "New message" }).click();
    await expectSecondMailbox(page);
    await page.getByRole("textbox", { name: "To", exact: true }).fill("carla@example.org");
    await page.getByRole("textbox", { name: "Subject", exact: true }).fill("Hallo");
    expect(mail.sent).toEqual([]);
    await page.getByRole("button", { name: /^Send$/ }).first().click();
    // Once the undo window has passed, the message that is handed over is the
    // second mailbox's: its signature, and not the first one's.
    await expect.poll(() => mail.sent.length, { timeout: 20_000 }).toBe(1);
    const { message } = mail.sent[0] as { message: { subject: string; toRecipients: unknown; body: { content: string } } };
    expect(message.subject).toBe("Hallo");
    expect(message.toRecipients).toEqual([{ emailAddress: { address: "carla@example.org" } }]);
    expect(message.body.content).toContain("Zweites Postfach");
    expect(message.body.content).not.toContain("Erstes Postfach");
  } finally {
    await sql.close();
  }
});
