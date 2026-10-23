import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { fixtureStorage, installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { FIXTURE_SIGN_IN, fixtureAccessToken, installMailFixture } from "../scripts/screenshot-services.mjs";
import { waitForVaultDirectory } from "./exampleVault";

/**
 * Two Microsoft mailboxes, each with the sign-in of its own account — on the
 * phone (finding 2026-10-12).
 *
 * A Microsoft mailbox reads and sends through Graph, and Graph answers `/me`
 * for the account of the access token — whatever mailbox the app believes it
 * is in. The phone asked the account broker for "the mail token of this
 * vault", without the mailbox, and the broker answered with the first card
 * that carried mail. In the built app, with a second mailbox beside the
 * fixture's, every request of the second one — folder list, message list,
 * message — and its `POST /me/sendMail` carried the access token of the
 * first: it listed the first account's mail under its own name and sent from
 * the first account.
 *
 * This runs the built app against the local Graph fixture, which answers each
 * sign-in with an access token of its own and each token with the mailbox of
 * its account. What is on screen and the `Authorization` of every request say
 * whose sign-in travelled. That two real Microsoft accounts behave this way is
 * not something a fake can show; what this holds is the app's side.
 *
 * The desktop holds the same in `apps/desktop/e2e/mail-sign-in.spec.ts`.
 *
 * No request leaves localhost.
 */

type MailboxSeed = Record<string, unknown> & { id: string };
type CardSeed = Record<string, unknown> & { id: string };
type Observed = Awaited<ReturnType<typeof installMailFixture>>;
type GraphRequest = { method: string; path: string; authorization: string | null };

const FIRST = "mail-fixture-1";
const SECOND = "mail-fixture-2";
const SECOND_ADDRESS = "privat@example.net";
const SECOND_SIGN_IN = "second-sign-in";
const FIRST_BEARER = `Bearer ${fixtureAccessToken(FIXTURE_SIGN_IN)}`;
const SECOND_BEARER = `Bearer ${fixtureAccessToken(SECOND_SIGN_IN)}`;

/** The one message the second account's inbox holds. */
const SECOND_MESSAGE = { id: "second-1", subject: "Nur im zweiten Postfach", conversationId: "second", bodyPreview: "Diese Nachricht liegt nur im zweiten Postfach." };

interface Setup {
  /** Which cloud account cards carry mail: for both mailboxes, for the first only, or for none. */
  cards: "both" | "first" | "none";
  /** `false`: the second mailbox arrived over the settings sync and was never signed in on this device. */
  secondSignedIn?: boolean;
}

/**
 * The app with the fixture's mailbox and a second Microsoft mailbox beside it,
 * each signed in on this device with a sign-in in its own slot, in English, on
 * the first one's inbox.
 */
async function bootTwoMailboxes(context: BrowserContext, page: Page, { cards, secondSignedIn = true }: Setup) {
  const origin = new URL(test.info().project.use.baseURL ?? "http://localhost:4174").origin;
  await context.route((url) => url.origin !== origin, (route) => route.abort("blockedbyclient"));
  const mail = await installMailFixture(context, { signIns: { [SECOND_SIGN_IN]: { address: SECOND_ADDRESS, messages: [SECOND_MESSAGE] } } });
  const sql = await installSqlBridge(context);
  const storage: Record<string, unknown> = Object.fromEntries(
    Object.entries(fixtureStorage()).filter(([key]) => key.startsWith("mailAccounts_") || key.startsWith("secret_mail_") || key === "cloudAccounts_local"),
  );
  // The slot the mail module reads a mailbox's own sign-in from:
  // `mail_<mailbox>_<vault>`. The second mailbox gets one of the same shape.
  const firstSlot = Object.keys(storage).find((key) => key.startsWith(`secret_mail_${FIRST}_`));
  if (!firstSlot) throw new Error("the fixture no longer seeds the mailbox's sign-in under secret_mail_<mailbox>_<vault>");
  if (secondSignedIn) storage[firstSlot.replace(FIRST, SECOND)] = { refreshToken: SECOND_SIGN_IN };
  for (const [key, value] of Object.entries(storage)) {
    const list = value as MailboxSeed[];
    if (key.startsWith("mailAccounts_") && Array.isArray(list) && list.some((m) => m.id === FIRST)) {
      const first = list.find((m) => m.id === FIRST)!;
      storage[key] = [first, { ...first, id: SECOND, label: SECOND_ADDRESS, user: SECOND_ADDRESS }];
    }
  }
  const registry = storage.cloudAccounts_local as CardSeed[];
  const firstCard = registry.find((card) => (card.services as { mail?: { mailAccountId?: string } }).mail?.mailAccountId === FIRST);
  if (!firstCard) throw new Error("the fixture no longer seeds a card that carries the mailbox");
  const others = registry.filter((card) => card !== firstCard);
  const secondCard: CardSeed = { id: "acct-fixture-mail-2", family: "microsoft", label: SECOND_ADDRESS, services: { mail: { mailAccountId: SECOND } } };
  storage.cloudAccounts_local = cards === "both" ? [firstCard, secondCard, ...others] : cards === "first" ? [firstCard, ...others] : others;

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
  await expect(page.locator(".m-mboxline-acct")).toHaveText("anna@example.org");
  await expect(page.locator("button.m-mailrow")).toHaveCount(3, { timeout: 15000 });
  return { mail, sql };
}

const back = (page: Page) => page.getByRole("button", { name: /^Back$/ }).first().click();
const rows = (page: Page) => page.locator("button.m-mailrow");

async function chooseMailbox(page: Page, address: string) {
  await page.locator(".m-mboxline").click();
  await page.locator(".m-sheet button.m-row", { hasText: address }).click();
  await expect(page.locator(".m-mboxline-acct")).toHaveText(address);
}

/**
 * Every mailbox request made so far, once no new one has started for a moment.
 *
 * A request does not say which mailbox it is for — `/me` is all Graph is told —
 * so the test tells them apart by WHEN they were made. A request the open
 * mailbox starts a little after its list is on screen must not be counted to
 * the mailbox opened next.
 */
async function settled(page: Page, mail: Observed): Promise<GraphRequest[]> {
  let seen = -1;
  for (;;) {
    const requests = mailboxRequests(mail);
    if (requests.length === seen) return [...requests];
    seen = requests.length;
    await page.waitForTimeout(400);
  }
}

/**
 * A bare `GET /me` is not a mailbox request: it is the identity check with
 * which a mailbox's own sign-in moves onto its account card when the vault
 * opens (account sign-in plan K2) - for each card with the sign-in of that
 * card's account. It runs at start, beside whatever mailbox is open, so it is
 * checked on its own (`identityChecks`) and not counted to a mailbox.
 */
const isIdentityCheck = (request: GraphRequest) => request.method === "GET" && request.path === "/me";
const mailboxRequests = (mail: Observed) => (mail.requests as GraphRequest[]).filter((request) => !isIdentityCheck(request));
const identityChecks = (mail: Observed) => (mail.requests as GraphRequest[]).filter(isIdentityCheck);

function expectAllWith(requests: GraphRequest[], bearer: string) {
  expect(requests.length).toBeGreaterThan(0);
  for (const request of requests) expect(request.authorization, `${request.method} ${request.path}`).toBe(bearer);
}

/**
 * The second mailbox lists, opens and sends as its own account, and the first
 * one is still the first account's afterwards.
 */
async function eachMailboxIsItsOwnAccount(page: Page, mail: Observed, evidence: string | null) {
  // The first mailbox, as it opens: the fixture's three messages, its sign-in.
  const first = await settled(page, mail);
  expectAllWith(first, FIRST_BEARER);

  // The second mailbox. It used to show the FIRST account's three messages
  // here — every request went out with the first one's token.
  await chooseMailbox(page, SECOND_ADDRESS);
  await expect(rows(page)).toHaveText([/Nur im zweiten Postfach/], { timeout: 15000 });
  if (evidence) await page.screenshot({ path: evidence });

  // Reading: folders, the list, the message.
  await rows(page).first().click();
  await expect(page.getByTestId("mail-text")).toContainText("Diese Nachricht liegt nur im zweiten Postfach.");
  await back(page);
  const reading = (await settled(page, mail)).slice(first.length);
  expect(reading.some((r) => r.method === "GET" && r.path === "/me/mailFolders")).toBe(true);
  expect(reading.some((r) => r.method === "GET" && /^\/me\/mailFolders\/[^/]+\/messages$/.test(r.path))).toBe(true);
  expect(reading.some((r) => r.method === "GET" && r.path === `/me/messages/${SECOND_MESSAGE.id}`)).toBe(true);
  expectAllWith(reading, SECOND_BEARER);

  // Sending: a new message from the second mailbox leaves from ITS account.
  await page.getByRole("button", { name: "New message" }).click();
  await expect(page.getByRole("button", { name: /^From / })).toContainText(SECOND_ADDRESS);
  await page.getByRole("textbox", { name: "To", exact: true }).fill("carla@example.org");
  await page.getByRole("textbox", { name: "Subject", exact: true }).fill("Hallo");
  expect(mail.sent).toEqual([]);
  await page.getByRole("button", { name: /^Send$/ }).first().click();
  await expect.poll(() => mail.sent.length, { timeout: 20_000 }).toBe(1);
  expect(mail.sentWith).toEqual([SECOND_BEARER]);

  // And back: the first mailbox is still the first account's.
  const second = await settled(page, mail);
  expectAllWith(second.slice(first.length), SECOND_BEARER);
  await chooseMailbox(page, "anna@example.org");
  await expect(rows(page)).toHaveCount(3, { timeout: 15000 });
  expectAllWith((await settled(page, mail)).slice(second.length), FIRST_BEARER);

  // Each sign-in was renewed, and the second one with its own refresh token.
  expect(new Set(mail.tokenRequests)).toEqual(new Set([FIXTURE_SIGN_IN, SECOND_SIGN_IN]));
}

test("two connected Microsoft accounts: each mailbox lists, opens and sends with the sign-in of its own account", async ({ page, context }, testInfo) => {
  test.setTimeout(120_000);
  // A card for each mailbox — what the cloud accounts hold once both accounts
  // are connected, or after the settings sync brought the desktop's cards.
  const { mail, sql } = await bootTwoMailboxes(context, page, { cards: "both" });
  try {
    await eachMailboxIsItsOwnAccount(page, mail, process.env.PLAINVA_EVIDENCE ? testInfo.outputPath("second-mailbox-own-mail.png") : null);
    // The second mailbox's own sign-in moved to its card, confirmed with that
    // account's own sign-in - never with the first one's.
    expect(identityChecks(mail).map((request) => request.authorization)).toContain(SECOND_BEARER);
  } finally {
    await sql.close();
  }
});

test("a second mailbox connected from the mail settings keeps its own sign-in beside an account card", async ({ page, context }) => {
  test.setTimeout(120_000);
  // The state the finding was seen in: the fixture's card carries mail for the
  // first mailbox, the second has its sign-in in its own slot and no card.
  const { mail, sql } = await bootTwoMailboxes(context, page, { cards: "first" });
  try {
    await eachMailboxIsItsOwnAccount(page, mail, null);
  } finally {
    await sql.close();
  }
});

test("without any account card each mailbox works with the sign-in in its own slot", async ({ page, context }) => {
  test.setTimeout(120_000);
  // Nothing was ever wrong here, and it stays that way: no card, no broker.
  // (A second mailbox that showed an empty list in this state had its sign-in
  // seeded under a slot name the mail module does not read.)
  const { mail, sql } = await bootTwoMailboxes(context, page, { cards: "none" });
  try {
    await eachMailboxIsItsOwnAccount(page, mail, null);
  } finally {
    await sql.close();
  }
});

test("a mailbox whose account was never signed in on this device says so, and does not show the first account's mail", async ({ page, context }, testInfo) => {
  test.setTimeout(120_000);
  // What the settings sync leaves on a second device: the mailbox and its card
  // arrive, the sign-in never does. The second mailbox used to list the first
  // account's three messages under its own name, with nothing on screen to tell.
  const { mail, sql } = await bootTwoMailboxes(context, page, { cards: "both", secondSignedIn: false });
  try {
    await chooseMailbox(page, SECOND_ADDRESS);
    await expect(page.getByTestId("device-signin-card")).toBeVisible({ timeout: 15000 });
    await expect(rows(page)).toHaveCount(0);
    // The reason is about THIS mailbox's account: its card holds no sign-in.
    await expect(page.getByTestId("device-signin-reason")).toContainText("none holds the shared sign-in");
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: testInfo.outputPath("second-mailbox-not-signed-in.png") });
    // Nothing was renewed but the first account's own sign-in, and no request
    // travelled with any other.
    expect(new Set(mail.tokenRequests)).toEqual(new Set([FIXTURE_SIGN_IN]));
    expectAllWith(await settled(page, mail), FIRST_BEARER);
  } finally {
    await sql.close();
  }
});
