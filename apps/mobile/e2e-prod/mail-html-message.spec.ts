import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { fixtureStorage, installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { installMailFixture } from "../scripts/screenshot-services.mjs";
import { readVaultFile, waitForVaultDirectory, type MobileTestGlobals } from "./exampleVault";

/**
 * A message whose body is HTML and nothing else, on the phone (finding
 * 2026-10-09).
 *
 * That is every message of a Microsoft mailbox: Graph hands a body over as
 * HTML unless the request asks for text, and Plainva does not ask. The reply's
 * quote and the filed note read the text part alone — so the reply quoted
 * nothing and the note was properties and a heading. The fixture's own three
 * messages come with `contentType: "text"`, which a real mailbox does not send,
 * and that is why no test saw it.
 *
 * This runs the built app against the locally routed Graph fixture with a
 * message as a real mailbox delivers one: reader, composer, vault. The line a
 * sender hides above the message — so that a mail list shows it as the preview
 * — is in the markup and not on the reader's screen; it is not in the quote
 * and not in the note either. The desktop holds the same in
 * `apps/desktop/e2e/mail.spec.ts`.
 *
 * No request leaves localhost.
 */

const PREHEADER = "Nur heute: 50 % Rabatt";
const ONLY_IN_SOURCE = "Nur im Quelltext: bis Freitag bestätigen.";
const HTML_MESSAGE = {
  id: "fixture-html-only",
  subject: "Rechnung Oktober",
  conversationId: "invoice-html",
  bodyPreview: "Hallo Marco, anbei die Rechnung für Oktober.",
  // Noon, so the day in the note's name is the same in every time zone a test runs in.
  receivedDateTime: "2026-09-13T12:00:00Z",
  body: {
    contentType: "html",
    content:
      "<html><head><style>p { margin: 0 }</style></head><body>" +
      `<div style="display:none;max-height:0;overflow:hidden">${PREHEADER}</div>` +
      "<p>Hallo Marco,</p><p>anbei die <b>Rechnung</b> für Oktober.</p>" +
      // A form whose control is named like a property of the DOM (finding
      // 2026-10-12): in a browser `form.nodeName` answers that control, and the
      // reader's sanitizer takes such a form out whole. Read off the raw markup,
      // the text of the message still had the form's words in it.
      `<form action="https://example.org/umfrage"><input type="hidden" name="nodeName" value="1"><p>${ONLY_IN_SOURCE}</p></form>` +
      "</body></html>",
  },
};

/** The app with one Microsoft mailbox, signed in on this device, in English, on the inbox. */
async function bootMail(context: BrowserContext, page: Page) {
  const origin = new URL(test.info().project.use.baseURL ?? "http://localhost:4174").origin;
  await context.route((url) => url.origin !== origin, (route) => route.abort("blockedbyclient"));
  const mail = await installMailFixture(context, { extra: { archive: [HTML_MESSAGE] } });
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

/** The notes the app has filed into the mail folder so far. */
async function filedNotes(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    try {
      const listing = await (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem.readdir({ path: "vault/Mail", directory: "DATA" });
      return listing.files.map((file) => file.name).filter((name) => name.endsWith(".md"));
    } catch {
      return [];
    }
  });
}

test("a message that is HTML only: the reply quotes its text, and the filed note holds it", async ({ page, context }, testInfo) => {
  test.setTimeout(90_000);
  const { mail, sql } = await bootMail(context, page);
  try {
    await page.locator(".m-mboxline").click();
    await page.locator(".m-sheet button.m-row", { hasText: "Archiv" }).click();
    await expect(page.locator(".m-mboxline-name")).toHaveText("Archiv");
    await page.locator("button.m-mailrow", { hasText: "Rechnung Oktober" }).click();

    // The reader: the message is on screen, the hidden line is in the markup only.
    const frame = page.locator("iframe.m-mailframe");
    await expect(frame).toBeVisible();
    const shown = () => frame.evaluate((el: HTMLIFrameElement) => el.contentDocument?.body?.innerText ?? "");
    await expect.poll(shown).toContain("anbei die Rechnung für Oktober.");
    expect(await shown()).not.toContain(ONLY_IN_SOURCE);
    expect(await shown()).not.toContain(PREHEADER);
    expect(await frame.evaluate((el: HTMLIFrameElement) => el.contentDocument?.body?.textContent ?? "")).toContain(PREHEADER);

    // Reply: the draft opens with the original quoted — what the reader showed, and no more.
    await page.getByRole("button", { name: /^Reply$/ }).click();
    await expect(page.getByRole("textbox", { name: "To", exact: true })).toHaveValue("Ben Beispiel <ben@example.org>");
    await expect(page.getByRole("textbox", { name: "Subject", exact: true })).toHaveValue("Re: Rechnung Oktober");
    const draft = page.locator(".cm-content");
    await expect(draft.filter({ hasText: "anbei die Rechnung für Oktober." })).toHaveCount(1);
    await expect(draft.filter({ hasText: "Hallo Marco," })).toHaveCount(1);
    await expect(draft.filter({ hasText: ONLY_IN_SOURCE })).toHaveCount(0);
    await expect(draft.filter({ hasText: PREHEADER })).toHaveCount(0);
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: testInfo.outputPath("mail-html-reply.png") });

    // Nothing was typed: back leaves the draft without a question, onto the message.
    await page.getByRole("button", { name: /^Back$/ }).first().click();
    await expect(page.getByRole("textbox", { name: "To", exact: true })).toHaveCount(0);
    await expect(page.getByTestId("confirm-act")).toHaveCount(0);
    await expect(frame).toBeVisible();

    // Save as note: the note holds the text under the subject.
    expect(await filedNotes(page)).toEqual([]);
    await page.getByRole("button", { name: /^Save as note$/ }).click();
    await expect.poll(() => filedNotes(page), { timeout: 15_000 }).toHaveLength(1);
    const [name] = await filedNotes(page);
    expect(name).toBe("2026-09-13 Rechnung Oktober.md");
    const note = await readVaultFile(page, `Mail/${name}`);
    expect(note.endsWith("# Rechnung Oktober\n\nHallo Marco,\n\nanbei die Rechnung für Oktober.\n")).toBe(true);
    expect(note).not.toContain(ONLY_IN_SOURCE);
    expect(note).not.toContain(PREHEADER);
    // ... and it opens, with its text on screen.
    await expect(page.locator(".cm-content").filter({ hasText: "anbei die Rechnung für Oktober." })).toHaveCount(1, { timeout: 15_000 });
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: testInfo.outputPath("mail-html-note.png") });

    // The draft was left, not sent.
    expect(mail.sent).toEqual([]);
  } finally {
    await sql.close();
  }
});
