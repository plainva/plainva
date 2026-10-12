import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { fixtureStorage, installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { FIXTURE_SIGN_IN, fixtureAccessToken, installMailFixture } from "../scripts/screenshot-services.mjs";
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
 * And it holds which sign-in the second mailbox travels with (finding
 * 2026-10-12): when this was written every request of the second mailbox and
 * its `POST /me/sendMail` carried the access token of the first — the phone
 * asked for "the mail token of this vault", and the fixture's account card
 * answered for both. The composer said the second address; the message left
 * from the first account. `mail-sign-in.spec.ts` holds that on its own, with
 * an inbox per account.
 *
 * No request leaves localhost.
 */

type MailboxSeed = Record<string, unknown> & { id: string };

const SECOND = "mail-fixture-2";
/** The second mailbox's own sign-in, and the access token the fixture answers it with. */
const SECOND_SIGN_IN = "second-sign-in";
const FIRST_BEARER = `Bearer ${fixtureAccessToken(FIXTURE_SIGN_IN)}`;
const SECOND_BEARER = `Bearer ${fixtureAccessToken(SECOND_SIGN_IN)}`;

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
  }
  // The slot the mail module reads a mailbox's own sign-in from is
  // `mail_<mailbox>_<vault>`; the second mailbox gets one of that shape, with a
  // sign-in of its own. (It used to be seeded under `mail_<vault>_<mailbox>`,
  // which nothing reads: the second mailbox had no sign-in at all and worked
  // only because the first one's was handed to it.)
  const firstSlot = Object.keys(storage).find((key) => key.startsWith("secret_mail_mail-fixture-1_"));
  if (!firstSlot) throw new Error("the fixture no longer seeds the mailbox's sign-in under secret_mail_<mailbox>_<vault>");
  storage[firstSlot.replace("mail-fixture-1", SECOND)] = { refreshToken: SECOND_SIGN_IN };
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

type GraphRequest = { method: string; path: string; authorization: string | null };

/**
 * Every mailbox request made so far, once no new one has started for a moment.
 * A request does not say which mailbox it is for, so the test tells them apart
 * by WHEN they were made.
 */
async function settled(page: Page, mail: Awaited<ReturnType<typeof installMailFixture>>): Promise<GraphRequest[]> {
  let seen = -1;
  for (;;) {
    const requests = mail.requests as GraphRequest[];
    if (requests.length === seen) return [...requests];
    seen = requests.length;
    await page.waitForTimeout(400);
  }
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
    // Everything so far was the first mailbox's, with its own sign-in.
    const first = await settled(page, mail);
    expect(first.length).toBeGreaterThan(0);
    for (const request of first) expect(request.authorization, `${request.method} ${request.path}`).toBe(FIRST_BEARER);

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
    // And it leaves from the second mailbox's ACCOUNT: the request carries the
    // access token of that mailbox's own sign-in, like everything the mailbox
    // asked for since it was opened — its folders, its list, the message, the
    // file a forward brings along.
    expect(mail.sentWith).toEqual([SECOND_BEARER]);
    const second = (await settled(page, mail)).slice(first.length);
    expect(second.some((request) => request.method === "GET" && request.path === "/me/mailFolders")).toBe(true);
    expect(second.some((request) => request.method === "GET" && /^\/me\/messages\/[^/]+$/.test(request.path))).toBe(true);
    for (const request of second) expect(request.authorization, `${request.method} ${request.path}`).toBe(SECOND_BEARER);
  } finally {
    await sql.close();
  }
});
