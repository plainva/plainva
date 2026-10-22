import { test, expect, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { fixtureStorage, installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { FIXTURE_SIGN_IN, fixtureAccessToken, installMailFixture } from "../scripts/screenshot-services.mjs";
import { waitForVaultDirectory } from "./exampleVault";

/**
 * "All inboxes" on the phone: a row leads to its own message, in its own
 * mailbox (finding 2026-10-11).
 *
 * On the desktop a row of another mailbox did not open reliably: the reader
 * stands beside the list there, the open mailbox follows the row, and that
 * change took the message away again. The phone has no such step — the reader
 * is a screen of its own and is handed the account, the folder and the
 * message, and the list underneath switches nothing. Nothing held that, and
 * one branch had it wrong: with conversations on, a row of the merged list
 * was opened in the account that is OPEN, with the whole address of the row
 * handed on as the id of the message. The reader asked the first account for
 * a message that does not exist.
 *
 * Held here for the flat list and for conversations, with two Microsoft
 * mailboxes that each have an inbox and a sign-in of their own: the reader
 * shows the message of the row, the request for it travels with the sign-in
 * of the mailbox the ROW is in, and what is written from it starts from that
 * mailbox — the two sign differently.
 *
 * The desktop holds its side in `apps/desktop/e2e/mail.spec.ts`.
 *
 * No request leaves localhost.
 */

type MailboxSeed = Record<string, unknown> & { id: string };
type CardSeed = Record<string, unknown> & { id: string };
type Observed = Awaited<ReturnType<typeof installMailFixture>>;
type GraphRequest = { method: string; path: string; authorization: string | null };

const FIRST = "mail-fixture-1";
const SECOND = "mail-fixture-2";
const SECOND_SIGN_IN = "second-sign-in";

interface Mailbox {
  address: string;
  bearer: string;
  signs: string;
}
const FIRST_BOX: Mailbox = { address: "anna@example.org", bearer: `Bearer ${fixtureAccessToken(FIXTURE_SIGN_IN)}`, signs: "Erstes Postfach" };
const SECOND_BOX: Mailbox = { address: "privat@example.net", bearer: `Bearer ${fixtureAccessToken(SECOND_SIGN_IN)}`, signs: "Zweites Postfach" };

/**
 * What only the second account's inbox holds: a conversation of two and two
 * messages on their own — one for the flat list and one for conversations, so
 * no message is opened twice (the reader shows what it has read before at
 * once). The first account's is the fixture's — a conversation of two
 * ("Projektübersicht") and the newsletter.
 */
const SECOND_INBOX = [
  { id: "second-3", subject: "Wohnung", conversationId: "flat", bodyPreview: "Der Besichtigungstermin steht." },
  { id: "second-2", subject: "Re: Wohnung", conversationId: "flat", bodyPreview: "Danke, der Termin passt mir." },
  { id: "second-1", subject: "Kontoauszug", conversationId: "bank", bodyPreview: "Ihr Kontoauszug für September liegt bereit." },
  { id: "second-0", subject: "Mitgliedsbeitrag", conversationId: "club", bodyPreview: "Der Beitrag für das neue Jahr wird im Januar fällig." },
];

/** The app with two signing Microsoft mailboxes, each with a card and a sign-in of its own, in English, on the first one's inbox. */
async function bootTwoMailboxes(context: BrowserContext, page: Page, fixture: Record<string, unknown> = {}) {
  const origin = new URL(test.info().project.use.baseURL ?? "http://localhost:4174").origin;
  await context.route((url) => url.origin !== origin, (route) => route.abort("blockedbyclient"));
  const mail = await installMailFixture(context, { ...fixture, signIns: { [SECOND_SIGN_IN]: { address: SECOND_BOX.address, messages: SECOND_INBOX } } });
  const sql = await installSqlBridge(context);
  const storage: Record<string, unknown> = Object.fromEntries(
    Object.entries(fixtureStorage()).filter(([key]) => key.startsWith("mailAccounts_") || key.startsWith("secret_mail_") || key === "cloudAccounts_local"),
  );
  // The slot a mailbox's own sign-in is read from: `mail_<mailbox>_<vault>`.
  const firstSlot = Object.keys(storage).find((key) => key.startsWith(`secret_mail_${FIRST}_`));
  if (!firstSlot) throw new Error("the fixture no longer seeds the mailbox's sign-in under secret_mail_<mailbox>_<vault>");
  storage[firstSlot.replace(FIRST, SECOND)] = { refreshToken: SECOND_SIGN_IN };
  for (const [key, value] of Object.entries(storage)) {
    const list = value as MailboxSeed[];
    if (key.startsWith("mailAccounts_") && Array.isArray(list) && list.some((m) => m.id === FIRST)) {
      const first = list.find((m) => m.id === FIRST)!;
      storage[key] = [
        { ...first, signature: `Anna\n${FIRST_BOX.signs}` },
        { ...first, id: SECOND, label: SECOND_BOX.address, user: SECOND_BOX.address, signature: `Anna\n${SECOND_BOX.signs}` },
      ];
    }
  }
  const registry = storage.cloudAccounts_local as CardSeed[];
  const firstCard = registry.find((card) => (card.services as { mail?: { mailAccountId?: string } }).mail?.mailAccountId === FIRST);
  if (!firstCard) throw new Error("the fixture no longer seeds a card that carries the mailbox");
  const secondCard: CardSeed = { id: "acct-fixture-mail-2", family: "microsoft", label: SECOND_BOX.address, services: { mail: { mailAccountId: SECOND } } };
  storage.cloudAccounts_local = [firstCard, secondCard, ...registry.filter((card) => card !== firstCard)];

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
  await expect(page.locator(".m-mboxline-acct")).toHaveText(FIRST_BOX.address);
  await expect(page.locator("button.m-mailrow")).toHaveCount(3, { timeout: 15000 });
  return { mail, sql };
}

const back = (page: Page) => page.getByRole("button", { name: /^Back$/ }).first().click();
const rows = (page: Page) => page.locator("button.m-mailrow");

/**
 * The merged list, with this many rows in it. Chosen again after every
 * message: the list is built anew when the reader closes, and "All inboxes" is
 * a way of looking, not a place the list remembers.
 */
async function showAllInboxes(page: Page, count: number) {
  await page.locator(".m-mboxline").click();
  await page.getByTestId("mail-all-inboxes").click();
  await expect(rows(page)).toHaveCount(count, { timeout: 15000 });
}

/** Pulls the list down from (x, y) by `dy` and lets go, as a finger does (CDP, as in pull-refresh.spec.ts). */
async function pullDown(page: Page, x: number, y: number, dy: number, steps = 10) {
  const cdp = await page.context().newCDPSession(page);
  const point = (py: number) => ({ x, y: py, radiusX: 12, radiusY: 12, force: 1 });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point(y)] });
  for (let i = 1; i <= steps; i++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [point(y + (dy * i) / steps)] });
    await page.waitForTimeout(16);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}

/**
 * Swipes a row open as a finger does (CDP touch, as in swipe-gesture.spec.ts),
 * and hands back the buttons it reveals.
 */
async function swipeOpen(page: Page, row: Locator) {
  const box = (await row.boundingBox())!;
  const y = Math.round(box.y + box.height / 2);
  const from = Math.round(box.x + box.width - 24);
  const cdp = await page.context().newCDPSession(page);
  const point = (x: number) => ({ x, y, radiusX: 12, radiusY: 12, force: 1 });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point(from)] });
  for (let i = 1; i <= 12; i++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [point(from - (240 * i) / 12)] });
    await page.waitForTimeout(16);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
  return row.locator(".m-swipe-btn");
}

/** Taps a row, and says where the requests that follow the tap begin. */
async function tap(mail: Observed, row: Locator) {
  const from = mail.requests.length;
  await row.click();
  return from;
}

/**
 * The reader shows the message with this id and this text, it was asked for
 * — since the tap — with the sign-in of this mailbox and of no other, and a
 * reply to it starts from this mailbox; then back to the list.
 */
async function expectMessageOf(page: Page, mail: Observed, from: number, message: { id: string; text: string }, mailbox: Mailbox, other: Mailbox) {
  await expect(page.getByTestId("mail-text")).toContainText(message.text, { timeout: 15000 });
  const asked = (mail.requests.slice(from) as GraphRequest[]).filter((r) => r.method === "GET" && r.path === `/me/messages/${message.id}`);
  expect(asked.length, `requests for ${message.id}`).toBeGreaterThan(0);
  for (const request of asked) expect(request.authorization, `GET ${request.path}`).toBe(mailbox.bearer);
  await page.getByRole("button", { name: /^Reply$/ }).click();
  await expect(page.getByRole("button", { name: /^From / })).toContainText(mailbox.address);
  await expect(page.locator(".cm-content")).toContainText(mailbox.signs);
  await expect(page.locator(".cm-content")).not.toContainText(other.signs);
  // Nothing was written: the composer closes without a question.
  await back(page);
  await back(page);
  await expect(page.locator(".m-mboxline")).toBeVisible();
}

test("all inboxes: a row leads to its own message in its own mailbox — in the flat list and in conversations", async ({ page, context }) => {
  test.setTimeout(180_000);
  const { mail, sql } = await bootTwoMailboxes(context, page);
  try {
    // The flat list: the messages of either mailbox. The first mailbox is
    // the open one; the row is the second's.
    await showAllInboxes(page, 7);
    let from = await tap(mail, rows(page).filter({ hasText: "Kontoauszug" }));
    await expectMessageOf(page, mail, from, { id: "second-1", text: "Ihr Kontoauszug für September liegt bereit." }, SECOND_BOX, FIRST_BOX);
    // … and a row of the first mailbox leads into the first.
    await showAllInboxes(page, 7);
    from = await tap(mail, rows(page).filter({ hasText: "Newsletter September" }));
    await expectMessageOf(page, mail, from, { id: "fixture-1", text: "Unsere Nachrichten aus dem September." }, FIRST_BOX, SECOND_BOX);

    // Conversations on: either mailbox has a conversation of two, and a
    // message on its own is a row like any other.
    await showAllInboxes(page, 7);
    await page.getByTestId("mail-threads-toggle").click();
    await expect(page.getByTestId("mail-thread-row")).toHaveCount(2);
    await expect(rows(page)).toHaveCount(5);
    from = await tap(mail, rows(page).filter({ hasText: "Mitgliedsbeitrag" }));
    await expectMessageOf(page, mail, from, { id: "second-0", text: "Der Beitrag für das neue Jahr wird im Januar fällig." }, SECOND_BOX, FIRST_BOX);

    // A message inside a conversation of the second mailbox.
    await showAllInboxes(page, 5);
    await page.getByTestId("mail-thread-row").filter({ hasText: "Wohnung" }).click();
    const inThread = page.getByTestId("mail-thread-message");
    await expect(inThread).toHaveCount(2);
    from = await tap(mail, inThread.filter({ hasText: "Der Besichtigungstermin steht." }));
    await expectMessageOf(page, mail, from, { id: "second-3", text: "Der Besichtigungstermin steht." }, SECOND_BOX, FIRST_BOX);

    // … and one inside the first mailbox's.
    await showAllInboxes(page, 5);
    await page.getByTestId("mail-thread-row").filter({ hasText: "Projektübersicht" }).click();
    await expect(inThread).toHaveCount(2);
    from = await tap(mail, inThread.filter({ hasText: "Danke, ich habe die Termine ergänzt." }));
    await expectMessageOf(page, mail, from, { id: "fixture-2", text: "Danke, ich habe die Termine ergänzt." }, FIRST_BOX, SECOND_BOX);
  } finally {
    await sql.close();
  }
});

test("the flagged list still on its way when another mailbox is chosen does not land under it", async ({ page, context }) => {
  // The flagged list asks ONE mailbox. Choosing another one emptied it, but an
  // answer still on its way came in after the switch: the starred mail of the
  // mailbox that was left — here none — stood in place of the next one's inbox.
  test.setTimeout(120_000);
  const { mail, sql } = await bootTwoMailboxes(context, page, { flaggedDelay: 4000 });
  try {
    const flaggedAnswered = page.waitForResponse((r) => r.url().includes("flagStatus"), { timeout: 20000 });
    await page.getByTestId("mail-filter-flagged").click();
    await expect.poll(() => mail.flaggedQueries.length).toBe(1);
    // Another mailbox, from the sheet, while the answer is on its way.
    await page.locator(".m-mboxline").click();
    await page.locator(".m-row", { hasText: SECOND_BOX.address }).click();
    await expect(page.locator(".m-mboxline-acct")).toHaveText(SECOND_BOX.address);
    expect(mail.flaggedAnswered, "the answer was still on its way").toBe(0);
    await expect(rows(page)).toHaveCount(4, { timeout: 15000 });
    // Watched from here on: once the inbox stands, it stays.
    await page.evaluate(() => {
      const w = window as Window & { __leftInbox?: boolean };
      w.__leftInbox = false;
      new MutationObserver(() => {
        if (document.querySelectorAll("button.m-mailrow").length !== 4) w.__leftInbox = true;
      }).observe(document.body, { childList: true, subtree: true });
    });
    // The answer comes …
    await flaggedAnswered;
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done(null)))));
    expect(mail.flaggedAnswered).toBe(1);
    // … and the second mailbox's inbox stood as it was, with the filter free again.
    expect(await page.evaluate(() => (window as Window & { __leftInbox?: boolean }).__leftInbox)).toBe(false);
    await expect(rows(page)).toHaveCount(4);
    await expect(rows(page).filter({ hasText: "Mitgliedsbeitrag" })).toHaveCount(1);
    const flagged = page.getByTestId("mail-filter-flagged");
    await expect(flagged).toBeEnabled();
    await expect(flagged).not.toHaveAttribute("aria-pressed", "true");
  } finally {
    await sql.close();
  }
});

test("all inboxes: the error of the folder behind the merged list does not stand in for it", async ({ page, context }) => {
  // The merged list reads every inbox, and names a mailbox it cannot reach.
  // The folder that is open behind it is something else: its error used to
  // take the merged list's place — the 2026-07-30 report, by another road.
  test.setTimeout(120_000);
  const { sql } = await bootTwoMailboxes(context, page, { failList: { archive: 503 } });
  try {
    await page.locator(".m-mboxline").click();
    await page.locator(".m-sheet button.m-row", { hasText: "Archiv" }).click();
    await expect(page.locator(".m-mboxline-name")).toHaveText("Archiv");
    // The folder's list failed: its error, with the offer to try again.
    await expect(page.getByTestId("mail-error-retry")).toBeVisible({ timeout: 15000 });
    await page.locator(".m-mboxline").click();
    await page.getByTestId("mail-all-inboxes").click();
    await expect(page.getByTestId("mail-error-retry")).toHaveCount(0);
    await expect(rows(page)).toHaveCount(7, { timeout: 15000 });
  } finally {
    await sql.close();
  }
});

test("all inboxes: the line naming a mailbox it could not reach goes with the merged list", async ({ page, context }) => {
  // The merged list names a mailbox it could not reach. Left for a folder, that
  // line stood on over the folder's own state — the offline copy, say.
  test.setTimeout(120_000);
  const { sql } = await bootTwoMailboxes(context, page, { failListFor: { [SECOND_SIGN_IN]: 503 } });
  try {
    const unreachable = page.locator(".pv-banner", { hasText: "unreachable" });
    await showAllInboxes(page, 3);
    await expect(unreachable).toHaveCount(1);
    // Out of the merged list, into the folder that is shown.
    await page.locator(".m-mboxline").click();
    await page.locator(".m-sheet button.m-row", { hasText: "Posteingang" }).click();
    await expect(page.locator(".m-mboxline-name")).toHaveText("Posteingang");
    await expect(rows(page)).toHaveCount(3);
    await expect(unreachable).toHaveCount(0);
  } finally {
    await sql.close();
  }
});

test("all inboxes: chosen again while it is on, the merged list is read again and says what it found", async ({ page, context }) => {
  // Turned on, the merged list waits for its answer. Chosen once more while it
  // was on, it waited for an answer nobody had asked for. Here the first read
  // reaches no mailbox; by the second the second mailbox answers — and its
  // mail is what the list has to show.
  test.setTimeout(120_000);
  const failing: Record<string, number> = {};
  const { sql } = await bootTwoMailboxes(context, page, { failListFor: failing });
  try {
    failing[FIXTURE_SIGN_IN] = 503;
    failing[SECOND_SIGN_IN] = 503;
    const unreachable = page.locator(".pv-banner", { hasText: "unreachable" });
    await page.locator(".m-mboxline").click();
    await page.getByTestId("mail-all-inboxes").click();
    await expect(unreachable).toBeVisible({ timeout: 15000 });
    await expect(rows(page)).toHaveCount(0);
    delete failing[SECOND_SIGN_IN];
    await page.locator(".m-mboxline").click();
    await page.getByTestId("mail-all-inboxes").click();
    await expect(rows(page)).toHaveCount(4, { timeout: 15000 });
    await expect(rows(page).filter({ hasText: "Kontoauszug" })).toHaveCount(1);
  } finally {
    await sql.close();
  }
});

test("all inboxes: the mailbox line carries no unread count of the folder behind it", async ({ page, context }) => {
  // The count beside the mailbox line is the shown folder's. In "All inboxes"
  // it stood on beside the merged list's name — the first inbox's one unread
  // message, as if it were the count of all of them.
  test.setTimeout(120_000);
  const { sql } = await bootTwoMailboxes(context, page);
  try {
    const badge = page.locator(".m-mboxline-badge");
    await expect(badge).toHaveText("1");
    await showAllInboxes(page, 7);
    await expect(page.locator(".m-mboxline-name")).toHaveText("All inboxes");
    await expect(badge).toHaveCount(0);
  } finally {
    await sql.close();
  }
});

test("all inboxes: pulled down, the merged list is read again — every inbox, not the folder behind it", async ({ page, context }) => {
  // A pull reads again what is shown. In "All inboxes" it read the folder
  // behind the merged list — the first mailbox's inbox — and the second
  // mailbox's mail stayed as it was.
  test.setTimeout(120_000);
  const { mail, sql } = await bootTwoMailboxes(context, page);
  try {
    await showAllInboxes(page, 7);
    const from = mail.requests.length;
    const line = (await page.locator(".m-mboxline").boundingBox())!;
    await pullDown(page, Math.round(line.x + line.width / 2), Math.round(line.y + line.height + 30), 200);
    const listedBy = (bearer: string) => (mail.requests.slice(from) as GraphRequest[]).some((r) => r.method === "GET" && /^\/me\/mailFolders\/[^/]+\/messages$/.test(r.path) && r.authorization === bearer);
    await expect.poll(() => listedBy(SECOND_BOX.bearer), { timeout: 15000, message: "the second mailbox's inbox was not read again" }).toBe(true);
    expect(listedBy(FIRST_BOX.bearer), "the first mailbox's inbox was not read again").toBe(true);
    await expect(rows(page)).toHaveCount(7);
  } finally {
    await sql.close();
  }
});

test("all inboxes: a row offers what it offers on the desktop — no move, spam or delete, which would act in the open mailbox", async ({ page, context }) => {
  // Swiped in "All inboxes", a row of the second mailbox offered Spam and
  // Delete, and they acted in the OPEN mailbox: with IMAP on the message with
  // the row's number there, into that mailbox's trash and junk. The desktop
  // offers neither in the merged list, and the handbook says why: each mailbox
  // has its own folders — open the message, then you act in its mailbox.
  test.setTimeout(120_000);
  const { sql } = await bootTwoMailboxes(context, page);
  try {
    await showAllInboxes(page, 7);
    const row = page.locator(".m-swipe").filter({ hasText: "Kontoauszug" });
    const offered = await swipeOpen(page, row);
    await expect(offered).toHaveCount(1);
    await expect(offered).toHaveText([/Snooze/]);
    // A conversation of the merged list, swiped as a whole: nothing to delete.
    await page.getByTestId("mail-threads-toggle").click();
    await expect(page.getByTestId("mail-thread-row")).toHaveCount(2);
    const thread = page.locator(".m-swipe").filter({ has: page.getByTestId("mail-thread-row").filter({ hasText: "Wohnung" }) });
    await expect(await swipeOpen(page, thread)).toHaveCount(0);
    await page.getByTestId("mail-threads-toggle").click();
    // In the mailbox's own folder a row still offers all of it.
    await page.locator(".m-mboxline").click();
    await page.locator(".m-sheet button.m-row", { hasText: "Posteingang" }).click();
    await expect(page.locator(".m-mboxline-name")).toHaveText("Posteingang");
    const own = page.locator(".m-swipe").filter({ hasText: "Newsletter September" });
    await expect(await swipeOpen(page, own)).toHaveText([/Snooze/, /Spam/, /Delete/]);
    // And a conversation there, swiped as a whole the same way, offers to
    // delete it: the empty swipe in the merged list is the list, not the gesture.
    await page.getByTestId("mail-threads-toggle").click();
    const ownThread = page.locator(".m-swipe").filter({ has: page.getByTestId("mail-thread-row").filter({ hasText: "Projektübersicht" }) });
    await expect(await swipeOpen(page, ownThread)).toHaveText([/Delete/]);
  } finally {
    await sql.close();
  }
});
