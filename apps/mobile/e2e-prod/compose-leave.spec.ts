import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { fixtureStorage, installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { installMailFixture } from "../scripts/screenshot-services.mjs";
import { returnToApp, waitForVaultDirectory, type MobileTestGlobals } from "./exampleVault";
import { installShareInbox } from "./shareInbox";

/**
 * What is drawn OVER the composer asks before it takes the message off the
 * screen (finding 2026-10-09).
 *
 * Only the screen on top is rendered. The share inbox lies over whatever is
 * open, and its ways on — "Choose vault", the note it just filed — put another
 * screen on top: a message being written was gone in that moment, and with
 * "Choose vault" the vault after it. The bar, the back arrow and Android back
 * asked first; this did not. It asks now, with the composer's own question, and
 * "Cancel" leaves the message standing.
 *
 * And "Cancel" leaves nothing behind (finding 2026-10-12): a new task asked
 * for over the message used to park its request before the question, so the
 * capture sheet opened by itself on the next visit to the tasks area.
 *
 * In the built app, because the wiring lives in the shell and the shell cannot
 * be rendered in a unit test. Against the locally routed Graph fixture; no
 * request leaves localhost.
 */

const NOTE = "---\ntype: Note\n---\n# Angebot\n\nEin Satz, den nur diese Notiz trägt: verlassprobe.\n";

/** A task database, so that the tasks area can capture — and one task that is always late. */
const TASK_BASE = `filters:
  and:
    - file.folder == "Aufgaben"
properties:
  note.status:
    displayName: Status
    plainva:
      input: select
      options:
        - Offen
        - Erledigt
  note.frist:
    displayName: Frist
    plainva:
      input: datetime
views:
  - type: table
    name: Tabelle
    order:
      - note.status
      - note.frist
`;
const LATE_TASK = "---\ntype: Note\nstatus: Offen\nfrist: 2026-01-05\n---\n# Steuer abgeben\n";

/**
 * The app on a vault that holds `files`, with one Microsoft mailbox signed in
 * on this device — the fixture's own shapes. `settings` are further stored
 * values, by their key.
 */
async function start(page: Page, context: BrowserContext, files: Array<[string, string]>, settings: Record<string, unknown> = {}) {
  const origin = new URL(test.info().project.use.baseURL ?? "http://localhost:4174").origin;
  await context.route((url) => url.origin !== origin, (route) => route.abort("blockedbyclient"));
  await installMailFixture(context);
  const sql = await installSqlBridge(context);
  try {
    const inbox = await installShareInbox(context);
    const storage = Object.fromEntries(
      Object.entries(fixtureStorage()).filter(([key]) => key.startsWith("mailAccounts_") || key.startsWith("secret_mail_") || key === "cloudAccounts_local"),
    );
    await context.addInitScript((seed) => {
      if (localStorage.getItem("CapacitorStorage.mobile-settings")) return;
      localStorage.setItem("CapacitorStorage.mobile-settings", JSON.stringify({ onboarded: true, language: "en", motion: "off" }));
      for (const [key, value] of Object.entries(seed)) localStorage.setItem(`CapacitorStorage.${key}`, JSON.stringify(value));
    }, { ...storage, ...settings });
    await page.goto("/");
    await waitForVaultDirectory(page);
    await page.evaluate(async (entries) => {
      const fs = (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem;
      for (const [path, data] of entries) await fs.writeFile({ path: `vault/${path}`, data, directory: "DATA", encoding: "utf8", recursive: true });
    }, files);
    await page.reload();
    await expect(page.locator("#root > *").first()).toBeVisible();
    const close = page.getByTestId("whats-new-close");
    await expect(close).toBeVisible({ timeout: 15000 });
    await close.click();
    return { sql, inbox };
  } catch (error) {
    await sql.close();
    throw error;
  }
}

/** A message being written: the note as an attachment, and a recipient typed. */
async function writeMessage(page: Page) {
  await page.getByTestId("appbar-search").first().click();
  await page.getByTestId("appbar-searchpage").locator("input").fill("verlassprobe");
  await page.locator("[data-search-occurrence]").first().click();
  await expect(page.locator(".cm-content")).toContainText("verlassprobe", { timeout: 15000 });
  await page.getByTestId("note-menu").click();
  await page.getByRole("button", { name: "Send as email attachment" }).click();
  await expect(page.getByRole("textbox", { name: "Subject", exact: true })).toHaveValue("Angebot");
  const recipient = page.getByRole("textbox", { name: "To", exact: true });
  const file = page.getByTestId("compose-attachment");
  await recipient.fill("ben@example.org");
  const question = page.getByTestId("confirm-act");
  const stay = page.getByTestId("confirm-safe");
  /** The message is still there, with everything in it. */
  const messageStands = async () => {
    await expect(question).toHaveCount(0);
    await expect(recipient).toHaveValue("ben@example.org");
    await expect(file).toHaveCount(1);
  };
  return { recipient, question, stay, messageStands };
}

/**
 * A launcher shortcut. A browser has no launcher: this is the event the app's
 * own URL route raises for `…://shortcut/<which>` (`services/appUrlRoutes.ts`).
 */
const shortcut = (page: Page, which: string) =>
  page.evaluate((name) => {
    window.dispatchEvent(new CustomEvent("m-shortcut", { detail: { which: name } }));
  }, which);

test("the share inbox over a message being written: choosing a vault and opening the filed note ask first", async ({ page, context }, testInfo) => {
  test.setTimeout(90_000);
  const { sql, inbox } = await start(page, context, [["Angebot.md", NOTE]]);
  try {
    const { recipient, question, stay, messageStands } = await writeMessage(page);
    const sheet = page.getByTestId("share-inbox");

    // Something is shared to Plainva from another app; back in the app, its
    // inbox lies over the composer.
    inbox.share({ id: "5a4e0002-7a5c-4b6e-8d9f-5ba7ed000001", text: "Buy stamps\nThe post office closes at six." });
    await returnToApp(page);
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText("Buy stamps");

    // THE DEFECT: "Choose vault" put the vault list on top, and the message was gone.
    await sheet.getByRole("button", { name: "Choose vault" }).click();
    await expect(question).toBeVisible();
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: testInfo.outputPath("compose-leave-share-inbox.png") });
    await stay.click();
    await messageStands();
    // "Cancel" means nothing happened: the inbox is still open, too.
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText("Buy stamps");

    // A second share arrives; the inbox counts it and goes on showing the
    // first. Filing that one works with the composer open — and the note it
    // made does not open over the message unasked.
    inbox.share({ id: "5a4e0002-7a5c-4b6e-8d9f-5ba7ed000002", text: "Call the tax office" });
    await returnToApp(page);
    await expect(sheet).toContainText("Waiting transfers: 2");
    await sheet.getByRole("button", { name: "Import", exact: true }).click();
    await expect.poll(() => inbox.acknowledged().length, { timeout: 20_000 }).toBe(1);
    await expect(question).toBeVisible();
    await stay.click();
    await messageStands();

    // The inbox is on to what still waits. "Discard" is the answer that lets
    // the message go: the vault list is on top.
    await expect(sheet).toContainText("Call the tax office");
    await sheet.getByRole("button", { name: "Choose vault" }).click();
    await expect(question).toBeVisible();
    await question.click();
    await expect(page.getByTestId("vault-row").first()).toBeVisible();
    await expect(recipient).toHaveCount(0);
    await expect(question).toHaveCount(0);
  } finally {
    await sql.close();
  }
});

test("a new task asked for over a message being written: Cancel leaves nothing behind that opens later", async ({ page, context }, testInfo) => {
  test.setTimeout(120_000);
  // Whether the capture sheet was EVER on screen, from the first render on:
  // "it is not there" must not be a question of looking too early.
  await context.addInitScript(() => {
    const seen = { captures: 0 };
    (globalThis as unknown as { __captureSheet: typeof seen }).__captureSheet = seen;
    let there = false;
    new MutationObserver(() => {
      const now = document.querySelector('[data-testid="task-capture-sheet"]') !== null;
      if (now && !there) seen.captures += 1;
      there = now;
    }).observe(document, { childList: true, subtree: true });
  });
  const captures = () => page.evaluate(() => (globalThis as unknown as { __captureSheet: { captures: number } }).__captureSheet.captures);
  const { sql } = await start(
    page,
    context,
    [["Angebot.md", NOTE], ["Aufgaben.base", TASK_BASE], ["Aufgaben/Steuer abgeben.md", LATE_TASK]],
    // The task database is a setting of the vault.
    { "mobile-vault-local": { taskDatabase: "Aufgaben.base" } },
  );
  try {
    const capture = page.getByTestId("task-capture-sheet");
    const tasksTab = page.locator(".m-tabbar .m-tab", { hasText: "Tasks" });
    const back = page.getByRole("button", { name: "Back", exact: true });
    const first = await writeMessage(page);

    // The launcher's "New task" arrives while the message is open. It leads to
    // the tasks area, so it asks — and "Cancel" keeps the message.
    await shortcut(page, "new-task");
    await expect(first.question).toBeVisible();
    await first.stay.click();
    await first.messageStands();

    // Later the message is given up the ordinary way, and the tasks area is
    // visited for its own sake.
    await back.click();
    await expect(first.question).toBeVisible();
    await first.question.click();
    await expect(first.recipient).toHaveCount(0);
    await back.click();
    await tasksTab.click();
    await expect(page.getByTestId("tasks-filters")).toBeVisible();
    // The list has come from the index: the area is done arriving.
    await expect(page.getByTestId("task-planner-section-overdue")).toContainText("Steuer abgeben", { timeout: 20_000 });
    // THE DEFECT: the request was parked before the question was asked, waited
    // through the "Cancel", and opened the capture sheet here.
    expect(await captures(), "the capture sheet opened on a visit nobody asked it for").toBe(0);
    await expect(capture).toHaveCount(0);

    // The same, through the journal's capture sheet. It covers nothing by
    // itself; its way on into the task capture leaves the message, and asks.
    await page.locator(".m-tabbar .m-tab", { hasText: "Home" }).click();
    const second = await writeMessage(page);
    await shortcut(page, "journal");
    const journal = page.getByTestId("journal-capture-sheet");
    const entry = journal.getByTestId("journal-capture-input");
    await entry.fill("Call the tax office");
    await journal.getByTestId("journal-capture-handover").click();
    await expect(second.question).toBeVisible();
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: testInfo.outputPath("compose-leave-journal-handover.png") });
    await second.stay.click();
    await second.messageStands();
    // "Cancel" means nothing happened: the sheet still holds what was typed,
    // and nothing says it was handed over.
    await expect(entry).toHaveValue("Call the tax office");
    await expect(page.locator(".pv-toast").filter({ hasText: "Continue in the task view" })).toHaveCount(0);

    // "Discard" is the answer that takes the step: the tasks area opens with
    // its capture sheet, and the sentence travelled with it.
    await journal.getByTestId("journal-capture-handover").click();
    await expect(second.question).toBeVisible();
    await second.question.click();
    await expect(capture).toBeVisible();
    await expect(capture.getByTestId("task-capture-input")).toHaveValue("Call the tax office");
    await expect(journal).toHaveCount(0);
    await expect(page.locator(".pv-toast").filter({ hasText: "Continue in the task view" })).toBeVisible();
    await expect(second.recipient).toHaveCount(0);
    await expect(page.getByTestId("tasks-filters")).toBeVisible();
    expect(await captures(), "once, and asked for").toBe(1);
  } finally {
    await sql.close();
  }
});
