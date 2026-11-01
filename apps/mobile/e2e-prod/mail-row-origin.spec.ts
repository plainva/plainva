import { test, expect, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { fixtureStorage, installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { installMailFixture } from "../scripts/screenshot-services.mjs";
import { waitForVaultDirectory } from "./exampleVault";

/**
 * Every row is its address (plan P1) — the phone's half.
 *
 * A mail row named its message by its bare number, and every action read the
 * folder off the screen: in a conversation your reply from Sent was marked,
 * starred, moved and deleted as the message with its number in the folder on
 * screen, in the trash it was offered "Delete permanently" though it never lay
 * there, and an Undo that came back after a folder switch put the row into
 * the next folder's list. Now each row carries its account, folder and
 * number, and every action — and every change to a list after one — goes by
 * that address.
 *
 * The fixture speaks Microsoft Graph, which addresses a message by an id of
 * its own; the phone's IMAP path runs through the same list code. "One number
 * in two folders" is therefore set up as one id in two folders: what the
 * LIST does with it is the same, whatever the transport does.
 *
 * The desktop holds its side in `apps/desktop/e2e/mail.spec.ts`. No request
 * leaves localhost.
 */

type Observed = Awaited<ReturnType<typeof installMailFixture>>;

const ANNA = { emailAddress: { name: "Anna Beispiel", address: "anna@example.org" } };

async function bootMail(context: BrowserContext, page: Page, fixture: Record<string, unknown> = {}) {
  const origin = new URL(test.info().project.use.baseURL ?? "http://localhost:4174").origin;
  await context.route((url) => url.origin !== origin, (route) => route.abort("blockedbyclient"));
  const mail = await installMailFixture(context, fixture);
  const sql = await installSqlBridge(context);
  const storage: Record<string, unknown> = Object.fromEntries(
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
  await expect(page.locator(".m-mboxline")).toBeVisible();
  await expect(page.locator("button.m-mailrow")).toHaveCount(3, { timeout: 15000 });
  return { mail, sql };
}

async function openFolder(page: Page, label: string) {
  await page.locator(".m-mboxline").click();
  await page.locator(".m-sheet button.m-row", { hasText: label }).click();
  await expect(page.locator(".m-mboxline-name")).toHaveText(label);
}

/** Swipes a row open as a finger does, and hands back the buttons it reveals. */
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

/** A finger held on a row for longer than the app's hold: its sheet opens. */
async function hold(page: Page, row: Locator) {
  const box = (await row.boundingBox())!;
  const cdp = await page.context().newCDPSession(page);
  const point = { x: Math.round(box.x + box.width / 3), y: Math.round(box.y + box.height / 2), id: 1 };
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
  await page.waitForTimeout(750);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}

const patches = (mail: Observed, id: string) => (mail.requests as Array<{ method: string; path: string }>).filter((r) => r.method === "PATCH" && r.path === `/me/messages/${id}`).length;

test("one number in two folders: read, star and delete on your reply from Sent change it alone — the inbox message stays as it was", async ({ page, context }) => {
  test.setTimeout(120_000);
  // Your reply in Sent carries the id of the inbox's unread "Projektübersicht".
  const { mail, sql } = await bootMail(context, page, {
    extra: { sentitems: [{ id: "fixture-3", subject: "Re: Projektübersicht", conversationId: "project", from: ANNA, isRead: false, bodyPreview: "Meine Antwort aus Gesendet.", receivedDateTime: "2026-09-14T09:30:00Z" }] },
  });
  try {
    await page.getByTestId("mail-threads-toggle").click();
    await page.getByTestId("mail-thread-row").filter({ hasText: "Projektübersicht" }).click();
    const inThread = page.getByTestId("mail-thread-message");
    await expect(inThread).toHaveCount(3);
    const fromSent = inThread.filter({ has: page.getByTestId("mail-thread-folder") });
    const inbox = inThread.filter({ hasText: "Die neue Übersicht ist fertig." });
    await expect(fromSent).toHaveCount(1);
    await expect(inbox).toHaveClass(/is-unread/);

    // Read: the reply turns read, the inbox message with the same id stays unread.
    await hold(page, fromSent);
    await page.getByTestId("mail-sheet-read").click();
    await expect.poll(() => patches(mail, "fixture-3")).toBe(1);
    await expect(fromSent).not.toHaveClass(/is-unread/);
    await expect(inbox).toHaveClass(/is-unread/);

    // Star: the reply is starred; the inbox message still offers a star of its own.
    await hold(page, fromSent);
    await page.getByTestId("mail-sheet-flag").click();
    await expect.poll(() => patches(mail, "fixture-3")).toBe(2);
    await hold(page, fromSent);
    await expect(page.getByTestId("mail-sheet-unflag")).toBeVisible();
    await page.locator(".m-sheet-backdrop").click({ position: { x: 10, y: 10 } });
    await hold(page, inbox);
    await expect(page.getByTestId("mail-sheet-flag")).toBeVisible();
    await expect(page.getByTestId("mail-sheet-read")).toBeVisible();
    await page.locator(".m-sheet-backdrop").click({ position: { x: 10, y: 10 } });

    // Delete: the reply leaves the conversation; the inbox message stays in it.
    const offered = await swipeOpen(page, page.locator(".m-swipe").filter({ has: fromSent }));
    await offered.filter({ hasText: /^Delete$/ }).click();
    await expect.poll(() => mail.moves.length).toBe(1);
    expect(mail.moves[0]).toMatchObject({ id: "fixture-3", to: "deleteditems" });
    await expect(fromSent).toHaveCount(0);
    await expect(inbox).toHaveCount(1);
    await expect(inbox).toHaveClass(/is-unread/);
  } finally {
    await sql.close();
  }
});

test("a conversation in the trash: Delete on your reply from Sent moves it to the trash — it is not deleted for good", async ({ page, context }) => {
  test.setTimeout(120_000);
  const { mail, sql } = await bootMail(context, page, {
    extra: {
      deleteditems: [{ id: "trash-1", subject: "Angebot", conversationId: "offer", bodyPreview: "Das Angebot im Anhang." }],
      sentitems: [{ id: "sent-1", subject: "Re: Angebot", conversationId: "offer", from: ANNA, bodyPreview: "Danke, ich melde mich.", receivedDateTime: "2026-09-13T10:00:00Z" }],
    },
  });
  try {
    await openFolder(page, "Papierkorb");
    await page.getByTestId("mail-threads-toggle").click();
    await page.getByTestId("mail-thread-row").filter({ hasText: "Angebot" }).click();
    const fromSent = page.getByTestId("mail-thread-message").filter({ has: page.getByTestId("mail-thread-folder") });
    await expect(fromSent).toHaveCount(1);
    // The message that lies in the trash is deleted for good from there …
    const inTrash = page.getByTestId("mail-thread-message").filter({ hasText: "Das Angebot im Anhang." });
    await hold(page, inTrash);
    await expect(page.getByTestId("mail-sheet-delete")).toHaveText(/Delete permanently/);
    await page.locator(".m-sheet-backdrop").click({ position: { x: 10, y: 10 } });
    await expect(page.getByTestId("mail-sheet-delete")).toHaveCount(0);
    // … your reply from Sent, read along, is not.
    const offered = await swipeOpen(page, page.locator(".m-swipe").filter({ has: fromSent }));
    // It does not lie in the trash: "Delete", not "Delete permanently".
    await expect(offered.filter({ hasText: /^Delete$/ })).toHaveCount(1);
    await offered.filter({ hasText: /^Delete$/ }).click();
    await expect.poll(() => mail.moves.length).toBe(1);
    expect(mail.moves[0]).toMatchObject({ id: "sent-1", from: "sentitems", to: "deleteditems" });
    expect(mail.deletes).toEqual([]);
    await expect(fromSent).toHaveCount(0);
  } finally {
    await sql.close();
  }
});

test("a trash named \"Gelöschte Elemente\" is the trash: Delete moves there", async ({ page, context }) => {
  // German Outlook's name for it. The phone knew the trash by its name only,
  // and this one by no name it knew: Delete said there was no trash.
  test.setTimeout(120_000);
  const { mail, sql } = await bootMail(context, page, { folderNames: { deleteditems: "Gelöschte Elemente" } });
  try {
    const offered = await swipeOpen(page, page.locator(".m-swipe").filter({ hasText: "Newsletter September" }));
    await offered.filter({ hasText: /^Delete$/ }).click();
    await expect.poll(() => mail.moves.length).toBe(1);
    expect(mail.moves[0]).toMatchObject({ id: "fixture-1", from: "inbox", to: "deleteditems" });
    await expect(page.locator(".pv-toast").filter({ hasText: "Moved to Trash" })).toBeVisible();
  } finally {
    await sql.close();
  }
});

test("Undo after a folder switch brings the message back to its folder, not into the list on screen", async ({ page, context }) => {
  test.setTimeout(120_000);
  const { mail, sql } = await bootMail(context, page, {
    extra: { archive: [{ id: "archive-1", subject: "Alte Rechnung", conversationId: "old", bodyPreview: "Aus dem Archiv." }] },
  });
  try {
    const offered = await swipeOpen(page, page.locator(".m-swipe").filter({ hasText: "Newsletter September" }));
    await offered.filter({ hasText: /^Delete$/ }).click();
    await expect.poll(() => mail.moves.length).toBe(1);
    const notice = page.locator(".pv-toast").filter({ hasText: "Moved to Trash" });
    await expect(notice).toBeVisible();
    // Another folder, while the notice still offers Undo.
    await openFolder(page, "Archiv");
    await expect(page.locator("button.m-mailrow")).toHaveCount(1, { timeout: 15000 });
    await notice.locator(".pv-toast-action").click();
    await expect.poll(() => mail.moves.length).toBe(2);
    expect(mail.moves[1]).toMatchObject({ from: "deleteditems", to: "inbox" });
    await expect(page.locator(".pv-toast").filter({ hasText: "Undone" })).toBeVisible();
    // The archive shows the archive — the newsletter did not land in it.
    await page.waitForTimeout(500);
    await expect(page.locator("button.m-mailrow")).toHaveCount(1);
    await expect(page.locator("button.m-mailrow").filter({ hasText: "Newsletter September" })).toHaveCount(0);
    // Back in the inbox it is there, under the id it has there now.
    await openFolder(page, "Posteingang");
    await expect(page.locator("button.m-mailrow").filter({ hasText: "Newsletter September" })).toHaveCount(1, { timeout: 15000 });
  } finally {
    await sql.close();
  }
});

test("Undo in the same folder reads the folder again: the message comes back under the id it has now", async ({ page, context }) => {
  test.setTimeout(120_000);
  const { mail, sql } = await bootMail(context, page);
  try {
    const offered = await swipeOpen(page, page.locator(".m-swipe").filter({ hasText: "Newsletter September" }));
    await offered.filter({ hasText: /^Delete$/ }).click();
    await expect(page.locator("button.m-mailrow")).toHaveCount(2);
    await page.locator(".pv-toast").filter({ hasText: "Moved to Trash" }).locator(".pv-toast-action").click();
    await expect.poll(() => mail.moves.length).toBe(2);
    const newsletter = page.locator("button.m-mailrow").filter({ hasText: "Newsletter September" });
    await expect(newsletter).toHaveCount(1, { timeout: 15000 });
    // A tap opens the message it is now — the id the move back gave it.
    const before = mail.requests.length;
    await newsletter.click();
    await expect(page.getByTestId("mail-text")).toContainText("Unsere Nachrichten aus dem September.", { timeout: 15000 });
    const asked = (mail.requests.slice(before) as Array<{ method: string; path: string }>).filter((r) => r.method === "GET" && r.path.startsWith("/me/messages/fixture-1"));
    // fixture-1 went to the trash as fixture-1-moved-1 and came back as fixture-1-moved-1-moved-2.
    expect(asked.map((r) => r.path)).toContain("/me/messages/fixture-1-moved-1-moved-2");
  } finally {
    await sql.close();
  }
});
