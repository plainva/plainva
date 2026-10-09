import { test, expect } from "@playwright/test";
import { fixtureStorage, installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { installMailFixture } from "../scripts/screenshot-services.mjs";
import { waitForVaultDirectory, type MobileTestGlobals } from "./exampleVault";

/**
 * "Send as email attachment" from a note, the whole way (finding 2026-10-09).
 *
 * The menu entry opened the composer WITHOUT the attachment: the note route
 * wrote the file into the nav path, and the composer's reader left it there.
 * Unit tests hold the two together now. This runs the built app — note menu,
 * composer, mailbox — because that is where it was broken while every source
 * guard stayed green: the menu entry existed, the draft type had the field, the
 * send call passed the list along, and the list was empty.
 *
 * It walks the ways out of the composer as well. Each was wrong in its own way
 * once a file could arrive: an untouched draft leaves without a question, a
 * changed one asks, and sending asks nothing — the shell used to ask whether to
 * DISCARD the message it had just queued.
 *
 * Against the locally routed Graph fixture; no request leaves localhost.
 */

const NOTE = "---\ntype: Note\n---\n# Angebot\n\nEin Satz, den nur diese Notiz trägt: anhangsprobe.\n";

test("a note sent as an attachment arrives in the composer with the file on it, and goes out with it", async ({ page, context }, testInfo) => {
  test.setTimeout(90_000);
  const origin = new URL(test.info().project.use.baseURL ?? "http://localhost:4174").origin;
  await context.route((url) => url.origin !== origin, (route) => route.abort("blockedbyclient"));
  const mail = await installMailFixture(context);
  const sql = await installSqlBridge(context);
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

    // The note, the way a reader opens it.
    await page.getByTestId("appbar-search").first().click();
    await page.getByTestId("appbar-searchpage").locator("input").fill("anhangsprobe");
    await page.locator("[data-search-occurrence]").first().click();
    const note = page.locator(".cm-content");
    await expect(note).toContainText("anhangsprobe", { timeout: 15000 });

    const sendAsAttachment = async () => {
      await page.getByTestId("note-menu").click();
      await page.getByRole("button", { name: "Send as email attachment" }).click();
      await expect(page.getByRole("textbox", { name: "Subject", exact: true })).toHaveValue("Angebot");
    };
    const back = () => page.getByRole("button", { name: /^Back$/ }).first().click();
    // Exact: the note's own editor is a textbox named "Markdown Editor", and a
    // loose "To" finds it.
    const recipient = page.getByRole("textbox", { name: "To", exact: true });
    const file = page.getByTestId("compose-attachment");
    const discard = page.getByTestId("confirm-act");

    // THE DEFECT: the composer opened, titled after the note — and empty-handed.
    await sendAsAttachment();
    await expect(file).toHaveCount(1);
    await expect(file).toContainText("Angebot.md");
    await expect(file).toContainText("text/markdown");
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: testInfo.outputPath("note-as-attachment.png") });

    // Nothing was changed: back leaves without a question, onto the note.
    await back();
    await expect(note).toContainText("anhangsprobe");
    await expect(recipient).toHaveCount(0);
    await expect(discard).toHaveCount(0);

    // A typed recipient is unsaved work: back asks, and declining keeps the draft.
    await sendAsAttachment();
    await recipient.fill("ben@example.org");
    await back();
    await expect(discard).toBeVisible();
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: testInfo.outputPath("note-as-attachment-leave.png") });
    await page.getByTestId("confirm-safe").click();
    await expect(discard).toHaveCount(0);
    await expect(recipient).toHaveValue("ben@example.org");
    await expect(file).toHaveCount(1);

    // Sending is not discarding: the composer closes without the question ...
    expect(mail.sent).toEqual([]);
    await page.getByRole("button", { name: /^Send$/ }).first().click();
    await expect(recipient).toHaveCount(0);
    await expect(note).toContainText("anhangsprobe");
    await expect(discard).toHaveCount(0);
    // ... and once the undo window has passed, the mailbox is handed the note as a file.
    await expect.poll(() => mail.sent.length, { timeout: 20_000 }).toBe(1);
    const { message } = mail.sent[0] as { message: { subject: string; toRecipients: unknown; attachments: { name: string; contentType: string; contentBytes: string }[] } };
    expect(message.subject).toBe("Angebot");
    expect(message.toRecipients).toEqual([{ emailAddress: { address: "ben@example.org" } }]);
    expect(message.attachments.map((a) => [a.name, a.contentType])).toEqual([["Angebot.md", "text/markdown; charset=utf-8"]]);
    // Byte for byte the note as it lies in the vault.
    expect(Buffer.from(message.attachments[0].contentBytes, "base64").toString("utf8")).toBe(NOTE);
    await expect(discard).toHaveCount(0);
  } finally {
    await sql.close();
  }
});
