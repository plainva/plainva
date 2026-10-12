import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { fixtureStorage, installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { ATTACHMENT_TEXT, installMailFixture } from "../scripts/screenshot-services.mjs";
import { waitForVaultDirectory } from "./exampleVault";

/**
 * What a forward carries, on the phone.
 *
 * Until 2026-10 a forward took the text of the original and none of its files,
 * on either shell, while the handbook said otherwise (finding 2026-10-09). Now
 * it brings them: the message screen hands the composer a REFERENCE to the
 * message, the composer fetches the files once it is open, and every file says
 * what is with it.
 *
 * This runs the built app against the locally routed Graph fixture — reader,
 * composer, mailbox — and holds the ends the handbook sentence is about
 * (`docs/user/<lang>/Email_Capture.md`, "Composing and sending"): what the
 * composer shows, and what the mailbox is handed, byte for byte. The desktop
 * holds the same in `apps/desktop/e2e/mail.spec.ts`.
 *
 * No request leaves localhost.
 */

type FixtureOptions = Parameters<typeof installMailFixture>[1];

/** The app with one Microsoft mailbox, signed in on this device, in English, on the inbox. */
async function bootMail(context: BrowserContext, page: Page, options?: FixtureOptions) {
  const origin = new URL(test.info().project.use.baseURL ?? "http://localhost:4174").origin;
  await context.route((url) => url.origin !== origin, (route) => route.abort("blockedbyclient"));
  const mail = await installMailFixture(context, options);
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

/** Opens the message that carries files — the reader lists `listed` — and forwards it. */
async function forward(page: Page, listed = "Projektübersicht.txt") {
  await page.locator("button.m-mailrow", { hasText: "Die neue Übersicht ist fertig." }).click();
  await expect(page.locator(".m-maillist")).toContainText(listed);
  await page.getByRole("button", { name: /^Forward$/ }).click();
  await expect(page.getByRole("textbox", { name: "Subject", exact: true })).toHaveValue("Fwd: Projektübersicht");
}

type SentMessage = {
  subject: string;
  toRecipients: unknown;
  body: { content: string };
  attachments?: { name: string; contentType: string; contentBytes: string }[];
};
const sentMessage = (entry: unknown) => (entry as { message: SentMessage }).message;
const base64 = (text: string) => Buffer.from(text).toString("base64");

test("a forward carries the text of the original and its files", async ({ page, context }, testInfo) => {
  test.setTimeout(90_000);
  const { mail, sql } = await bootMail(context, page);
  try {
    await forward(page);
    // The reader lists the file by name and size; so does the composer.
    await expect(page.locator(".m-maillist")).toHaveCount(0);
    await expect(page.locator(".cm-content").filter({ hasText: "Die Projektplanung liegt im gemeinsamen Vault." })).toHaveCount(1);
    const carried = page.getByTestId("compose-carried");
    await expect(carried).toHaveCount(1);
    await expect(carried).toContainText("Projektübersicht.txt");
    // It is fetched after the screen is up, and says when it is here.
    await expect(carried).toHaveAttribute("data-state", "ready");
    await expect(carried).toContainText("36 B");
    await expect(page.getByTestId("compose-files-loading")).toHaveCount(0);
    // Nothing was attached by hand.
    await expect(page.getByTestId("compose-attachment")).toHaveCount(0);
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: testInfo.outputPath("mail-forward-composer.png") });

    await page.getByRole("textbox", { name: "To", exact: true }).fill("carla@example.org");
    expect(mail.sent).toEqual([]);
    await page.getByRole("button", { name: /^Send$/ }).first().click();
    // Everything on the draft goes: nothing to ask about.
    await expect(page.getByTestId("confirm-act")).toHaveCount(0);
    // Once the undo window has passed, the mailbox is handed the text AND the file.
    await expect.poll(() => mail.sent.length, { timeout: 20_000 }).toBe(1);
    const message = sentMessage(mail.sent[0]);
    expect(message.subject).toBe("Fwd: Projektübersicht");
    expect(message.toRecipients).toEqual([{ emailAddress: { address: "carla@example.org" } }]);
    expect(message.body.content).toContain("Die Projektplanung liegt im gemeinsamen Vault.");
    // Byte for byte the file the original carried.
    expect(message.attachments?.map((a) => [a.name, a.contentType, a.contentBytes])).toEqual([["Projektübersicht.txt", "text/plain", base64(ATTACHMENT_TEXT)]]);
    // Asked for once, and nothing the fixture does not know was asked.
    expect(mail.attachmentFetches).toEqual(["attachment-1"]);
    expect(mail.unexpected).toEqual([]);
  } finally {
    await sql.close();
  }
});

test("a file that did not come says so, is asked about before sending, and comes when asked again", async ({ page, context }, testInfo) => {
  test.setTimeout(90_000);
  const { mail, sql } = await bootMail(context, page, {
    attachments: [{ id: "attachment-1", name: "Projektübersicht.txt", contentType: "text/plain", content: Buffer.from(ATTACHMENT_TEXT), failTimes: 1 }],
  });
  try {
    await forward(page);
    const carried = page.getByTestId("compose-carried");
    await expect(carried).toHaveAttribute("data-state", "failed");
    await expect(carried).toContainText("not loaded");
    await expect(page.getByTestId("compose-files-failed")).toContainText("An attachment of the original could not be loaded.");
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: testInfo.outputPath("mail-forward-failed.png") });

    // Send asks before the message leaves without the file — and "no" keeps it.
    await page.getByRole("textbox", { name: "To", exact: true }).fill("carla@example.org");
    await page.getByRole("button", { name: /^Send$/ }).first().click();
    await expect(page.getByText("Send without these attachments?")).toBeVisible();
    await expect(page.getByText("Projektübersicht.txt (not loaded)")).toBeVisible();
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: testInfo.outputPath("mail-forward-question.png") });
    await page.getByTestId("confirm-safe").click();
    await expect(page.getByRole("textbox", { name: "To", exact: true })).toHaveValue("carla@example.org");
    expect(mail.sent).toEqual([]);

    // Asked again, it comes.
    await page.getByTestId("compose-carried-retry-all").click();
    await expect(carried).toHaveAttribute("data-state", "ready");
    await expect(page.getByTestId("compose-files-failed")).toHaveCount(0);
    await page.getByRole("button", { name: /^Send$/ }).first().click();
    await expect.poll(() => mail.sent.length, { timeout: 20_000 }).toBe(1);
    expect(sentMessage(mail.sent[0]).attachments?.map((a) => a.contentBytes)).toEqual([base64(ATTACHMENT_TEXT)]);
    expect(mail.attachmentFetches).toEqual(["attachment-1", "attachment-1"]);
  } finally {
    await sql.close();
  }
});

test("a file over the mailbox's bound stays behind by name, and a message that does not fit one request goes file by file", async ({ page, context }, testInfo) => {
  test.setTimeout(120_000);
  const MB = 1024 * 1024;
  const first = Buffer.alloc(2 * MB, 1);
  const second = Buffer.alloc(2 * MB, 2);
  const { mail, sql } = await bootMail(context, page, {
    attachments: [
      { id: "plan", name: "Plan.pdf", contentType: "application/pdf", content: first },
      // Listed at 7 MB and never asked for: a Microsoft mailbox takes no file
      // of that size from Plainva.
      { id: "film", name: "Begehung.mp4", contentType: "video/mp4", size: 7 * MB },
      { id: "fotos", name: "Fotos.zip", contentType: "application/zip", content: second },
      // An Outlook item attached to the message has no bytes of its own.
      { id: "termin", name: "Besprechung", contentType: "", type: "#microsoft.graph.itemAttachment", size: 4096 },
    ],
  });
  try {
    // The reader lists all four, the Outlook item among them.
    await forward(page, "Besprechung");
    const carried = page.getByTestId("compose-carried");
    await expect(carried).toHaveCount(4);
    await expect(carried.nth(0)).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
    await expect(carried.nth(2)).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
    // The two that cannot go keep their rows and their names.
    await expect(carried.nth(1)).toHaveAttribute("data-state", "left");
    await expect(carried.nth(1)).toContainText("Begehung.mp4");
    await expect(carried.nth(1)).toContainText("too large");
    await expect(carried.nth(3)).toHaveAttribute("data-state", "left");
    await expect(carried.nth(3)).toContainText("not a file");
    // The bound is said with its number.
    await expect(page.getByTestId("compose-files-limit")).toContainText("2.8 MB");
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: testInfo.outputPath("mail-forward-left-behind.png"), fullPage: true });

    await page.getByRole("textbox", { name: "To", exact: true }).fill("carla@example.org");
    await page.getByRole("button", { name: /^Send$/ }).first().click();
    await expect(page.getByText("Send without these attachments?")).toBeVisible();
    await expect(page.getByText("Begehung.mp4 (too large for this mailbox); Besprechung (not a file)")).toBeVisible();
    await page.getByTestId("confirm-act").click();

    // Two files of 2 MB do not fit one request of 4 MB: a draft, each file
    // with a request of its own, then send.
    await expect.poll(() => mail.sent.length, { timeout: 40_000 }).toBe(1);
    const sent = mail.sent[0] as { viaDraft?: boolean };
    expect(sent.viaDraft).toBe(true);
    const files = sentMessage(sent).attachments ?? [];
    expect(files.map((a) => a.name)).toEqual(["Plan.pdf", "Fotos.zip"]);
    expect(Buffer.from(files[0].contentBytes, "base64").equals(first)).toBe(true);
    expect(Buffer.from(files[1].contentBytes, "base64").equals(second)).toBe(true);
    // Only the two that go were ever asked for.
    expect([...mail.attachmentFetches].sort()).toEqual(["fotos", "plan"]);
    expect(mail.unexpected).toEqual([]);
  } finally {
    await sql.close();
  }
});

test("a message the mailbox refuses comes back with everything it was sent with", async ({ page, context }, testInfo) => {
  test.setTimeout(90_000);
  const { mail, sql } = await bootMail(context, page, { refuseSends: { times: 1, status: 413 } });
  try {
    await forward(page);
    await expect(page.getByTestId("compose-carried")).toHaveAttribute("data-state", "ready");
    await page.getByRole("textbox", { name: "To", exact: true }).fill("carla@example.org");
    await page.getByRole("button", { name: /^Send$/ }).first().click();

    // The composer is gone when the mailbox answers. The notice says why, in
    // words, and does not go away; it has no close button.
    const notice = page.locator(".pv-toast--error");
    await expect(notice).toContainText("Not sent: The mail server does not accept a message of this size.", { timeout: 20_000 });
    await expect(notice.locator(".pv-toast-x")).toHaveCount(0);
    expect(mail.sent).toEqual([]);
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: testInfo.outputPath("mail-refused-notice.png") });

    // The way back: the composer, with recipient, subject, text and file.
    await notice.getByRole("button", { name: "Open again" }).click();
    await expect(page.getByRole("textbox", { name: "To", exact: true })).toHaveValue("carla@example.org");
    await expect(page.getByRole("textbox", { name: "Subject", exact: true })).toHaveValue("Fwd: Projektübersicht");
    await expect(page.locator(".cm-content").filter({ hasText: "Die Projektplanung liegt im gemeinsamen Vault." })).toHaveCount(1);
    await expect(page.getByTestId("compose-attachment")).toContainText("Projektübersicht.txt");
    await expect(notice).toHaveCount(0);
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: testInfo.outputPath("mail-refused-reopened.png") });

    // Unsent is unsaved: back asks.
    await page.getByRole("button", { name: /^Back$/ }).first().click();
    await expect(page.getByTestId("confirm-act")).toBeVisible();
    await page.getByTestId("confirm-safe").click();

    // And it goes out on the second try, with the file.
    await page.getByRole("button", { name: /^Send$/ }).first().click();
    await expect.poll(() => mail.sent.length, { timeout: 20_000 }).toBe(1);
    const message = sentMessage(mail.sent[0]);
    expect(message.toRecipients).toEqual([{ emailAddress: { address: "carla@example.org" } }]);
    expect(message.attachments?.map((a) => [a.name, a.contentBytes])).toEqual([["Projektübersicht.txt", base64(ATTACHMENT_TEXT)]]);
  } finally {
    await sql.close();
  }
});
