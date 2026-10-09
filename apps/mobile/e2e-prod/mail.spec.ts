import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { fixtureStorage, installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { installMailFixture } from "../scripts/screenshot-services.mjs";
import { leaveApp, returnToApp, waitForVaultDirectory } from "./exampleVault";

/**
 * Mail on the phone, against the locally routed Graph fixture (plan Befunde
 * 06.10., Teil M). No request leaves localhost.
 *
 *  - M1: a link in a message. The phone had no handling at all — what a tap
 *    did was up to the WebView. Now a tap opens through the app's opener and a
 *    hold shows where the link leads first.
 *  - M2/M3: remote images. "Always load" has a switch on the phone now, and it
 *    does not reach into the junk folder.
 *  - M4: the search (TestFlight 02.10., "the search field in the mails does
 *    not seem to work").
 *  - Sending: the notice that keeps "Undo" ready while a message waits. It
 *    stayed after every sent mail, over the tab bar, until it was closed by
 *    hand.
 */

const SAFE_TARGET = "https://nordlicht.example/kunden/rechnungen/2026-10";
const SAFE_LINK = "https://nam12.safelinks.protection.outlook.com/?url=" + encodeURIComponent(SAFE_TARGET) + "&data=05%7C02&reserved=0";
const PLAIN_LINK = "https://nordlicht.example/kunden/rechnungen/2026-10?ref=mail";

const EXTRA = {
  archive: [
    {
      id: "fixture-links",
      subject: "Ihre Rechnung für Oktober",
      conversationId: "invoice",
      bodyPreview: "Ihre Rechnung liegt bereit.",
      body: {
        contentType: "html",
        content:
          "<p>Ihre Rechnung liegt bereit.</p>" +
          `<p><a id="plain" href="${PLAIN_LINK}">Rechnung ansehen</a></p>` +
          `<p><a id="safe" href="${SAFE_LINK}">Rechnung im Portal</a></p>` +
          '<p><a id="odd" href="https://nordlicht-rechnung.example/login">https://nordlicht.example/rechnung</a></p>' +
          '<p><a id="mail" href="mailto:buchhaltung@nordlicht.example?subject=Frage">Buchhaltung</a></p>' +
          '<img src="https://bilder.nordlicht.example/logo.png" width="40" height="40">',
      },
    },
    {
      id: "fixture-text-links",
      subject: "Nur Text",
      conversationId: "text",
      bodyPreview: "Die Rechnung: https://nordlicht.example/r?id=1.",
      body: { contentType: "text", content: "Hallo,\n\ndie Rechnung: https://nordlicht.example/r?id=1.\n<b>kein Markup</b>\n" },
    },
  ],
  junkemail: [
    {
      id: "fixture-spam",
      subject: "Sie haben gewonnen",
      conversationId: "spam",
      bodyPreview: "Klicken Sie hier.",
      isRead: false,
      body: {
        contentType: "html",
        content:
          "<p>Klicken Sie hier, um Ihren Gewinn abzuholen.</p>" +
          '<img src="https://spam-tracker.example/a.gif"><img src="https://spam-tracker.example/b.gif"><img src="https://spam-tracker.example/c.gif">',
      },
    },
  ],
};

type TestWindow = Window & { __opened?: string[] };

type MailboxSeed = Record<string, unknown> & { id: string };

/**
 * The app with one Microsoft mailbox, signed in on this device, in English.
 * `mailboxes` lets a test change the list that mailbox is stored in — its own
 * shape, or a second mailbox beside it.
 */
async function bootMail(context: BrowserContext, page: Page, mailboxes?: (list: MailboxSeed[]) => MailboxSeed[]) {
  const origin = new URL(test.info().project.use.baseURL ?? "http://localhost:4174").origin;
  await context.route((url) => url.origin !== origin, (route) => route.abort("blockedbyclient"));
  const mail = await installMailFixture(context, { extra: EXTRA });
  const sql = await installSqlBridge(context);
  // The mailbox, its account record and its sign-in — the fixture's own
  // shapes, so this spec cannot drift from what the screenshot tool boots.
  const storage: Record<string, unknown> = Object.fromEntries(
    Object.entries(fixtureStorage()).filter(([key]) => key.startsWith("mailAccounts_") || key.startsWith("secret_mail_") || key === "cloudAccounts_local"),
  );
  if (mailboxes) {
    for (const [key, value] of Object.entries(storage)) {
      const list = value as MailboxSeed[];
      if (key.startsWith("mailAccounts_") && list.some((m) => m.id === "mail-fixture-1")) storage[key] = mailboxes(list);
    }
  }
  await context.addInitScript((seed) => {
    // What the app's opener ends in for a web address (`Browser.open` in the
    // web shell): recorded instead of followed.
    const w = window as Window & { __opened?: string[] };
    w.__opened = [];
    window.open = ((url?: string | URL) => {
      w.__opened!.push(String(url));
      return null;
    }) as typeof window.open;
    // Seeded ONCE: a reload has to find what the test changed.
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
  await openMailArea(page);
  await expect(page.locator("button.m-mailrow")).toHaveCount(3, { timeout: 15000 });
  return { mail, sql };
}

/** Mail is an area outside the bar here: it opens on top of the notes tab. */
async function openMailArea(page: Page) {
  await page.getByTestId("tab-areas").click();
  await page.getByTestId("areas-mail").click();
  await expect(page.locator(".m-mboxline")).toBeVisible();
}

async function openFolder(page: Page, label: string) {
  await page.locator(".m-mboxline").click();
  await page.locator(".m-sheet button.m-row", { hasText: label }).click();
  await expect(page.locator(".m-mboxline-name")).toHaveText(label);
}

const back = (page: Page) => page.getByRole("button", { name: /^Back$/ }).first().click();
const srcdoc = (page: Page) => page.locator("iframe.m-mailframe").getAttribute("srcdoc");
const opened = (page: Page) => page.evaluate(() => (window as TestWindow).__opened ?? []);

/** Where an element of the message frame is on screen. The parent may read the
 *  frame's document: same origin, and the frame runs no scripts. */
async function pointInFrame(page: Page, selector: string) {
  const frame = page.locator("iframe.m-mailframe");
  await expect.poll(() => frame.evaluate((el: HTMLIFrameElement, sel) => !!el.contentDocument?.querySelector(sel), selector)).toBe(true);
  const box = (await frame.boundingBox())!;
  const rect = await frame.evaluate((el: HTMLIFrameElement, sel) => {
    const r = el.contentDocument!.querySelector(sel)!.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, selector);
  return { x: box.x + rect.x, y: box.y + rect.y };
}

/** A finger held on a point for longer than the app's hold, then lifted. */
async function hold(page: Page, at: { x: number; y: number }) {
  const cdp = await page.context().newCDPSession(page);
  const point = { x: Math.round(at.x), y: Math.round(at.y), id: 1 };
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
  await page.waitForTimeout(750);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}

test("a link in a mail: a tap opens it through the app, a hold shows where it leads", async ({ page, context }, testInfo) => {
  const { sql } = await bootMail(context, page);
  try {
    await openFolder(page, "Archiv");
    await page.locator("button.m-mailrow", { hasText: "Ihre Rechnung" }).click();
    await expect(page.locator("iframe.m-mailframe")).toBeVisible();

    // A tap opens the link — through the app's opener, not by navigating the
    // frame or the WebView.
    const plain = await pointInFrame(page, "#plain");
    await page.touchscreen.tap(plain.x, plain.y);
    await expect.poll(() => opened(page)).toEqual([PLAIN_LINK]);
    await expect(page.locator("iframe.m-mailframe")).toBeVisible();
    await expect(page.getByTestId("mail-link-sheet")).toHaveCount(0);

    // A hold shows the target first: the full address, its host singled out,
    // and the two things one may want from it.
    await hold(page, plain);
    const sheet = page.getByTestId("mail-link-sheet");
    await expect(sheet).toBeVisible();
    await expect(sheet.getByTestId("link-target-url")).toHaveText(PLAIN_LINK);
    await expect(sheet.getByTestId("link-target-host")).toHaveText("nordlicht.example");
    await expect(page.getByTestId("mail-link-open")).toHaveText("Open in browser");
    await expect(page.getByTestId("mail-link-copy")).toHaveText("Copy address");
    await page.screenshot({ path: testInfo.outputPath("mail-link-sheet.png") });
    // The hold did NOT open the link.
    expect(await opened(page)).toEqual([PLAIN_LINK]);

    // "Open in browser" goes the same way as the tap.
    await page.getByTestId("mail-link-open").click();
    await expect(sheet).toHaveCount(0);
    await expect.poll(() => opened(page)).toEqual([PLAIN_LINK, PLAIN_LINK]);

    // A Safe Link shows its real target and says so; what opens is the Safe Link.
    await hold(page, await pointInFrame(page, "#safe"));
    await expect(sheet.getByTestId("link-target-url")).toHaveText(SAFE_TARGET);
    await expect(sheet.getByTestId("link-target-safelinks")).toHaveText("via Microsoft Safe Links");
    await expect(sheet).not.toHaveAttribute("data-warn", "");
    await page.getByTestId("mail-link-open").click();
    await expect.poll(() => opened(page)).toEqual([PLAIN_LINK, PLAIN_LINK, SAFE_LINK]);

    // The visible text names another host than the link leads to.
    await hold(page, await pointInFrame(page, "#odd"));
    await expect(sheet).toHaveAttribute("data-warn", "");
    await expect(sheet.getByTestId("link-target-host")).toHaveText("nordlicht-rechnung.example");
    await expect(sheet.getByTestId("link-target-mismatch")).toHaveText("the text names a different address");
    await page.screenshot({ path: testInfo.outputPath("mail-link-sheet-warning.png") });
    // Closing the sheet opens nothing.
    await page.locator(".m-sheet-backdrop").click({ position: { x: 5, y: 5 } });
    await expect(sheet).toHaveCount(0);
    expect(await opened(page)).toHaveLength(3);

    // A mail address opens the composer, addressed — not the browser.
    const mailto = await pointInFrame(page, "#mail");
    await page.touchscreen.tap(mailto.x, mailto.y);
    await expect(page.getByRole("textbox", { name: "To" })).toHaveValue("buchhaltung@nordlicht.example");
    await expect(page.getByRole("textbox", { name: "Subject" })).toHaveValue("Frage");
    expect(await opened(page)).toHaveLength(3);
  } finally {
    await sql.close();
  }
});

/**
 * Whether Send is offered follows the account (finding 2026-10-08).
 *
 * The composer asked nothing. That was right for a Microsoft mailbox, which
 * sends through Graph and carries no SMTP host — and wrong for a mailbox that
 * was connected for reading only: Send was offered, the screen closed, and the
 * refusal came seconds later with the text gone. Both shells read the one
 * shared decision now; here it is shown by switching the sender in one draft.
 */
test("the composer offers Send by the sender: a Microsoft mailbox sends, one that only reads says what is missing", async ({ page, context }, testInfo) => {
  const { sql } = await bootMail(context, page, ([microsoft]) => [
    // As connecting stores it: a kind and an address, no IMAP or SMTP host.
    { ...microsoft, host: "", port: 0, smtpHost: undefined, smtpPort: undefined },
    // Connected for reading only — a valid setup that cannot send.
    { id: "mail-fixture-readonly", label: "lesen@example.org", host: "imap.example.org", port: 993, user: "lesen@example.org" },
  ]);
  try {
    await page.getByRole("button", { name: "New message" }).click();
    await expect(page.getByRole("textbox", { name: "To" })).toBeVisible();
    // The bar's icon and the button under the body: two ways to send.
    const send = page.getByRole("button", { name: "Send", exact: true });
    const hint = page.getByTestId("compose-send-hint");
    await expect(send).toHaveCount(2);
    await expect(send.first()).toBeEnabled();
    await expect(send.last()).toBeEnabled();
    await expect(hint).toHaveCount(0);

    // The other sender: nothing to send through, and the screen says so.
    await page.getByRole("button", { name: /^From / }).click();
    await page.getByRole("button", { name: /^lesen@example\.org/ }).click();
    await expect(send.first()).toBeDisabled();
    await expect(send.last()).toBeDisabled();
    await expect(hint).toHaveText("Add an SMTP host to the account to send directly.");
    // Filing the draft needs no way to send.
    await expect(page.getByRole("button", { name: "Save draft" })).toBeEnabled();
    await send.last().scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath("compose-cannot-send.png") });

    // And back: the decision follows the sender, not the screen.
    await page.getByRole("button", { name: /^From / }).click();
    await page.getByRole("button", { name: /^anna@example\.org/ }).click();
    await expect(send.first()).toBeEnabled();
    await expect(send.last()).toBeEnabled();
    await expect(hint).toHaveCount(0);
  } finally {
    await sql.close();
  }
});

test("a plain-text mail has links, and they behave like the others", async ({ page, context }) => {
  const { sql } = await bootMail(context, page);
  try {
    await openFolder(page, "Archiv");
    await page.locator("button.m-mailrow", { hasText: "Nur Text" }).click();
    const text = page.getByTestId("mail-text");
    await expect(text).toBeVisible();
    // The text is unchanged, character for character, and never read as HTML.
    expect(await text.evaluate((el) => el.textContent)).toBe("Hallo,\n\ndie Rechnung: https://nordlicht.example/r?id=1.\n<b>kein Markup</b>\n");
    await expect(text.locator("b")).toHaveCount(0);
    const link = text.locator("a.pv-maillink");
    await expect(link).toHaveText("https://nordlicht.example/r?id=1");

    await link.tap();
    await expect.poll(() => opened(page)).toEqual(["https://nordlicht.example/r?id=1"]);
    // The app is still on the message.
    await expect(text).toBeVisible();

    const box = (await link.boundingBox())!;
    await hold(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
    await expect(page.getByTestId("mail-link-sheet").getByTestId("link-target-host")).toHaveText("nordlicht.example");
    expect(await opened(page)).toHaveLength(1);
  } finally {
    await sql.close();
  }
});

test("remote images: the phone has the switch, and it does not reach into the junk folder", async ({ page, context }, testInfo) => {
  const { sql } = await bootMail(context, page);
  try {
    // Off by default: the ordinary message offers its pictures once.
    await openFolder(page, "Archiv");
    await page.locator("button.m-mailrow", { hasText: "Ihre Rechnung" }).click();
    await expect.poll(() => srcdoc(page)).toContain("Ihre Rechnung liegt bereit");
    expect(await srcdoc(page)).not.toContain("bilder.nordlicht.example");
    await expect(page.getByTestId("mail-show-images")).toHaveText("Show images");
    await expect(page.getByTestId("mail-blocked-junk")).toHaveCount(0);
    await back(page);
    await back(page);

    // The switch — it was missing on the phone; the value could only arrive
    // through the settings sync.
    await page.getByTestId("nav-settings").click();
    await page.getByTestId("settings-area-mail").click();
    const row = page.getByTestId("mail-remote-images");
    await expect(row).toContainText("Always load remote images");
    const toggle = row.getByRole("switch", { name: "Always load remote images" });
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await expect(page.getByTestId("mail-remote-images-note")).toContainText("This does not apply to the spam folder");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await page.screenshot({ path: testInfo.outputPath("mail-remote-images-switch.png") });
    // It is the per-vault setting the desktop writes too.
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("CapacitorStorage.mobile-vault-local") ?? "{}").mailRemoteImages)).toBe(true);
    await back(page);
    await back(page);

    // Now the ordinary message loads its pictures on its own ...
    await openMailArea(page);
    await expect(page.locator(".m-mboxline-name")).toHaveText("Archiv");
    await page.locator("button.m-mailrow", { hasText: "Ihre Rechnung" }).click();
    await expect.poll(() => srcdoc(page)).toContain("bilder.nordlicht.example");
    await expect(page.getByTestId("mail-show-images")).toHaveCount(0);
    await back(page);

    // ... and the junk folder does not: the same setting, nothing loaded, and
    // the hint says why.
    await openFolder(page, "Junk-E-Mail");
    await page.locator("button.m-mailrow", { hasText: "Sie haben gewonnen" }).click();
    await expect.poll(() => srcdoc(page)).toContain("Klicken Sie hier");
    expect(await srcdoc(page)).not.toContain("spam-tracker.example");
    await expect(page.getByTestId("mail-blocked-junk")).toHaveText(
      "In the spam folder Plainva loads no remote images, even if they are otherwise always loaded. 3 blocked.",
    );
    await expect(page.getByTestId("mail-show-images")).toHaveText("Show for this message");
    await page.screenshot({ path: testInfo.outputPath("mail-junk-images.png") });

    // The release holds for this view ...
    await page.getByTestId("mail-show-images").click();
    await expect.poll(() => srcdoc(page)).toContain("spam-tracker.example");
    await expect(page.getByTestId("mail-show-images")).toHaveCount(0);
    // ... and only for this one: opened again, the pictures are blocked again.
    await back(page);
    await page.locator("button.m-mailrow", { hasText: "Sie haben gewonnen" }).click();
    await expect.poll(() => srcdoc(page)).toContain("Klicken Sie hier");
    expect(await srcdoc(page)).not.toContain("spam-tracker.example");
    await expect(page.getByTestId("mail-blocked-junk")).toBeVisible();
  } finally {
    await sql.close();
  }
});

test("a sent mail: the notice with Undo ends with its window, and nothing stays over the bar", async ({ page, context }, testInfo) => {
  test.setTimeout(90_000);
  const { mail, sql } = await bootMail(context, page);
  try {
    const toasts = page.locator(".pv-toast");
    const notice = toasts.filter({ hasText: /Sending in \d+ s/ });
    const confirmation = toasts.filter({ hasText: "Message sent." });
    const recipients = (index: number) => mail.sent[index].message.toRecipients.map((r: { emailAddress: { address: string } }) => r.emailAddress.address);
    /** From the folder: open the message, answer it, send. Ends on the message, the composer closed. */
    const replyAndSend = async () => {
      await page.locator("button.m-mailrow", { hasText: "Newsletter September" }).click();
      await page.getByRole("button", { name: /^Reply$/ }).click();
      await expect(page.getByRole("textbox", { name: "To" })).toHaveValue("Ben Beispiel <ben@example.org>");
      await page.getByRole("button", { name: /^Send$/ }).first().click();
      await expect(page.getByRole("textbox", { name: "To" })).toHaveCount(0);
    };

    // 1. The window runs out. While the message waits, the notice is the way
    //    back; nothing has been asked of the mailbox yet.
    await replyAndSend();
    await expect(notice).toBeVisible();
    await expect(notice.locator(".pv-toast-action")).toHaveText("Undo");
    expect(mail.sent).toEqual([]);
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: testInfo.outputPath("mail-send-waiting.png") });

    await expect.poll(() => mail.sent.length, { timeout: 20_000 }).toBe(1);
    expect(mail.sent[0].message.subject).toBe("Re: Newsletter September");
    expect(recipients(0)).toEqual(["ben@example.org"]);
    // THE DEFECT: the notice is persistent, and the queue that raised it never
    // took it down — "Sending in 8 s · Undo" stayed after the message was out.
    await expect(notice).toHaveCount(0);
    await expect(confirmation).toBeVisible();
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: testInfo.outputPath("mail-send-sent.png") });
    // What is said in passing fades on its own: nothing is left over the bar.
    await expect(toasts).toHaveCount(0, { timeout: 15_000 });
    await back(page);
    await expect(page.locator("button.m-mailrow")).toHaveCount(3);

    // 2. Leaving the app ends the window too. The message is sent at once
    //    rather than dropped — and the notice is not waiting for whoever comes
    //    back, counting down to something that has already happened.
    await replyAndSend();
    await expect(notice).toBeVisible();
    await leaveApp(page);
    await expect.poll(() => mail.sent.length, { timeout: 5_000 }).toBe(2);
    expect(recipients(1)).toEqual(["ben@example.org"]);
    await expect(notice).toHaveCount(0);
    await returnToApp(page);
    await expect(notice).toHaveCount(0);
  } finally {
    await sql.close();
  }
});

test("mail search: the hits stay through a background reload and through opening one", async ({ page, context }) => {
  const { mail, sql } = await bootMail(context, page);
  try {
    const rows = page.locator("button.m-mailrow");
    await page.getByTestId("mail-search-toggle").click();
    const field = page.getByTestId("mail-search");
    await field.fill("Newsletter");
    await field.press("Enter");

    // The server was asked about the open folder, and its answer is on screen.
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("Newsletter September");
    expect(mail.searches).toEqual([{ folder: "inbox", term: "newsletter" }]);

    // THE DEFECT (TestFlight 02.10.): a sync run, an index update, a reminder
    // sync — anything that bumps the screen — reloads the folder. The hits
    // lived in the folder's own list, so the folder came back over them while
    // the field still showed the question.
    const lists = mail.lists;
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("m-vault-changed")));
    await expect.poll(() => mail.lists).toBeGreaterThan(lists);
    await page.waitForTimeout(500);
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("Newsletter September");

    // Opening a hit and coming back keeps the search — the list is rebuilt
    // after the reader closes, and used to come back as the plain folder.
    await rows.first().click();
    await expect(page.locator(".m-mailtext")).toContainText("Unsere Nachrichten aus dem September");
    await back(page);
    await expect(page.getByTestId("mail-search")).toHaveValue("Newsletter");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("Newsletter September");
    // ...and it was asked again, because the message just read may have changed.
    await expect.poll(() => mail.searches.length).toBe(2);
    await expect(rows).toHaveCount(1);

    // A search without a hit says so — it is not an empty folder.
    await page.getByTestId("mail-search").fill("gibtesnicht");
    await page.getByTestId("mail-search").press("Enter");
    await expect(page.getByText("No matches in this folder.")).toBeVisible();
    await expect(rows).toHaveCount(0);

    // Emptying the field ends the search: the folder is back, without a request.
    const before = mail.lists;
    await page.getByTestId("mail-search").fill("");
    await expect(rows).toHaveCount(3);
    expect(mail.lists).toBe(before);
  } finally {
    await sql.close();
  }
});
