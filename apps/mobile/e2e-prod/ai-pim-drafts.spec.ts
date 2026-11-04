import { test, expect, type Page } from "@playwright/test";
import { fixtureStorage, installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { installMailFixture } from "../scripts/screenshot-services.mjs";
import { waitForVaultDirectory, type MobileTestGlobals } from "./exampleVault";

/**
 * An e-mail and an appointment an assistant drafted, on the phone (AI harness
 * P5-6), in the production bundle. Both would leave the vault, so neither is
 * made by the assistant: each waits as a draft on this phone, names every
 * address it would go to, and opens in the phone's own composer and event
 * sheet. The draft stays in the list until the mail is really out or the
 * calendar took the appointment.
 *
 * The model itself is the native `AiNet` plugin, which a browser does not
 * have. So the conversation and its drafts are ones this phone already keeps,
 * stored as a finished run would leave them; what the test holds is everything
 * after the answer. The mailbox is the locally routed Graph fixture and the
 * calendar the seeded one of the event tests — a writable calendar without a
 * sign-in, so a save is refused: the branch a browser run can show.
 */

const QUESTION = "Tell Ms Okafor and tom@example.org that the 14th is fixed, and put the shooting day into my calendar.";
const ANSWER = "I drafted the reply and the appointment. Both wait for you.";
const AUTHOR = { id: "plainva-ai/m-1", label: "Plainva AI · m-1" };
const BODY = "Hello Ms Okafor,\n\nthe 14th is fixed. We start at nine in Studio 2.\n\nBest regards";

const usage = { inputTokens: 40, outputTokens: 30, cacheReadTokens: 0, cacheWriteTokens: 0 };
const draft = (id: string, title: string, body: Record<string, unknown>) => ({ id, createdAt: `2026-10-07T10:00:0${id.slice(-1)}.000Z`, author: AUTHOR, conversationId: "pim-1", title, body, inherited: [], sources: [], defused: 0 });
const DRAFTS = {
  version: 1,
  drafts: [
    // Tom's address the reader wrote; Ms Okafor's the model brought — the card says so.
    draft("d-000001", "Re: Shooting day", { kind: "mail", to: ["a.okafor@example.org"], cc: ["tom@example.org"], bcc: [], subject: "Re: Shooting day", body: BODY, unnamed: ["a.okafor@example.org"] }),
    draft("d-000002", "Shooting day", { kind: "event", title: "Shooting day", allDay: false, day: "2026-11-14", endDay: "2026-11-14", start: "09:00", end: "17:00", location: "Studio 2", description: "", attendees: ["tom@example.org"], unnamed: [] }),
  ],
  done: [],
};
const RECORD = {
  version: 1,
  id: "pim-1",
  title: QUESTION,
  createdAt: "2026-10-07T10:00:00.000Z",
  updatedAt: "2026-10-07T10:00:05.000Z",
  providerId: "anthropic",
  model: "m-1",
  conversation: {
    id: "pim-1",
    system: "You are the assistant in Plainva.",
    tools: [],
    turns: [
      { role: "user", parts: [{ type: "text", text: QUESTION }], at: "2026-10-07T10:00:00.000Z" },
      { role: "assistant", parts: [{ type: "text", text: ANSWER }], at: "2026-10-07T10:00:05.000Z" },
    ],
  },
  usage,
  runs: [
    {
      userTurn: 0,
      providerId: "anthropic",
      model: "m-1",
      sent: [],
      kept: [],
      usage,
      steps: 1,
      stop: "answered",
      writes: { rounds: [], drafts: DRAFTS.drafts.map((entry) => ({ id: entry.id, kind: String(entry.body.kind), title: entry.title })), plans: [] },
    },
  ],
  pins: [],
};
const INDEX = { version: 1, conversations: [{ id: RECORD.id, title: RECORD.title, updatedAt: RECORD.updatedAt, providerId: RECORD.providerId, model: RECORD.model }] };

/** The folders of the AI's data on this phone: one per vault, under `ai/`. */
const aiVaults = (page: Page): Promise<string[]> =>
  page.evaluate(async () => {
    const fs = (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem;
    const listed = await fs.readdir({ path: "ai", directory: "DATA" }).catch(() => ({ files: [] }));
    return listed.files.map((entry) => entry.name);
  });

const storedDrafts = (page: Page, vault: string): Promise<{ drafts: { id: string }[]; done: { id: string; kind: string; outcome: string }[] }> =>
  page.evaluate(async (folder) => {
    const fs = (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem;
    const read = await fs.readFile({ path: `ai/${folder}/drafts.json`, directory: "DATA", encoding: "utf8" });
    return JSON.parse(String(read.data));
  }, vault);

/** From wherever the app is to the conversation that drafted both, through the AI's history. */
async function toConversation(page: Page) {
  for (let step = 0; step < 5; step++) {
    const button = page.getByRole("button", { name: /^Back$/ }).first();
    if (!(await button.isVisible().catch(() => false))) break;
    await button.click();
    await page.waitForTimeout(300);
  }
  await page.getByTestId("tab-areas").click();
  await page.getByTestId("areas-ai").click();
  await page.getByTestId("ai-history-open").click();
  await expect(page.getByTestId("ai-history-screen")).toBeVisible();
  await expect(page.getByTestId("ai-history-row")).toHaveCount(1);
  await page.getByTestId("ai-history-row").first().click();
  await expect(page.getByTestId("ai-conversation").getByText("I drafted the reply and the appointment.", { exact: false })).toBeVisible();
}

/** Toasts lie over the bar at the bottom. The ones that stay until they are read are closed by hand, as a reader would. */
async function closeToasts(page: Page) {
  const close = page.locator(".pv-toast").getByRole("button", { name: "Close" });
  for (let round = 0; round < 8 && (await close.count()) > 0; round++) {
    await close.first().click();
    await page.waitForTimeout(150);
  }
  await expect(page.locator(".pv-toast")).toHaveCount(0);
}

const field = (page: Page, label: string) => page.locator("label.m-field").filter({ has: page.locator("span", { hasText: new RegExp(`^${label}$`) }) }).locator("input");

test("AI drafts an e-mail and an appointment: both wait on this phone, open in the composer and the event sheet, and stay until the mail is out", async ({ page, context }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const origin = new URL(test.info().project.use.baseURL ?? "http://localhost:4174").origin;
  await context.route((url) => url.origin !== origin, (route) => route.abort("blockedbyclient"));
  await installMailFixture(context);
  // What the mailbox was asked to send — registered after the fixture, so this one answers.
  const sentMails: Array<{ message: { subject: string; toRecipients: { emailAddress: { address: string } }[]; ccRecipients?: { emailAddress: { address: string } }[]; body: { content: string } } }> = [];
  await context.route("https://graph.microsoft.com/v1.0/me/sendMail", async (route) => {
    sentMails.push(route.request().postDataJSON());
    await route.fulfill({ status: 202, body: "" });
  });
  const sql = await installSqlBridge(context);
  // One Microsoft mailbox, signed in on this device — the fixture's own shapes.
  const storage = Object.fromEntries(Object.entries(fixtureStorage()).filter(([key]) => key.startsWith("mailAccounts_") || key.startsWith("secret_mail_") || key === "cloudAccounts_local"));
  try {
    await page.addLocatorHandler(page.getByTestId("whats-new-sheet"), async () => page.getByTestId("whats-new-close").click());
    await context.addInitScript((seed) => {
      // Seeded ONCE: a reload has to find what the test changed.
      if (localStorage.getItem("CapacitorStorage.mobile-settings")) return;
      localStorage.setItem("CapacitorStorage.mobile-settings", JSON.stringify({ onboarded: true, language: "en", motion: "off" }));
      // The AI is opt-in per device: switched on here, with a model chosen, as the settings would store it.
      localStorage.setItem("CapacitorStorage.ai", JSON.stringify({ enabled: true, providers: ["anthropic"], profiles: { balanced: { providerId: "anthropic", model: "m-1" } } }));
      for (const [key, value] of Object.entries(seed)) localStorage.setItem(`CapacitorStorage.${key}`, JSON.stringify(value));
    }, storage);
    await page.goto("/");
    await waitForVaultDirectory(page);
    // A calendar that takes appointments: the seeded one of the event tests.
    await expect.poll(() => sql.count("plainva-index", "sqlite_master WHERE name = 'pim_calendars'"), { timeout: 20_000 }).toBe(1);
    sql.seedPim("plainva-index");
    await page.reload();
    await expect(page.locator(".m-tabbar")).toBeVisible({ timeout: 20_000 });

    // The folder of this vault's AI data is made when its first setting is stored.
    await page.getByTestId("nav-settings").first().click();
    await page.getByTestId("settings-area-aiVault").click();
    await page.getByRole("switch", { name: "The AI may use the internet in this vault" }).click();
    await expect.poll(() => aiVaults(page)).toHaveLength(1);
    const [vault] = await aiVaults(page);
    await page.evaluate(
      async ({ vault, record, index, drafts }) => {
        const fs = (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem;
        await fs.writeFile({ path: `ai/${vault}/conversations/${record.id}.json`, data: JSON.stringify(record), directory: "DATA", encoding: "utf8", recursive: true });
        await fs.writeFile({ path: `ai/${vault}/index.json`, data: JSON.stringify(index), directory: "DATA", encoding: "utf8", recursive: true });
        await fs.writeFile({ path: `ai/${vault}/drafts.json`, data: JSON.stringify(drafts), directory: "DATA", encoding: "utf8", recursive: true });
      },
      { vault, record: RECORD, index: INDEX, drafts: DRAFTS },
    );
    await page.reload();
    await expect(page.locator(".m-tabbar")).toBeVisible({ timeout: 20_000 });

    // 1. Under the answer stands a card per draft: every address it would go to, and a word about the one the reader
    //    did not write. Nothing was sent, nothing saved.
    await toConversation(page);
    const conversation = page.getByTestId("ai-conversation");
    const mailCard = conversation.locator('[data-testid="ai-draft"][data-kind="mail"]');
    const eventCard = conversation.locator('[data-testid="ai-draft"][data-kind="event"]');
    await expect(mailCard.getByTestId("ai-draft-title")).toHaveText("Re: Shooting day");
    await expect(mailCard.getByTestId("ai-draft-to")).toHaveText("a.okafor@example.org");
    await expect(mailCard.getByTestId("ai-draft-cc")).toHaveText("tom@example.org");
    await expect(mailCard.getByTestId("ai-draft-bcc")).toHaveCount(0);
    await expect(mailCard.getByTestId("ai-draft-unnamed")).toContainText("a.okafor@example.org");
    await expect(mailCard.getByTestId("ai-draft-create")).toHaveText(/Open in Mail/);
    await expect(eventCard.getByTestId("ai-draft-title")).toHaveText("Shooting day");
    await expect(eventCard.getByTestId("ai-draft-when")).toContainText("09:00");
    await expect(eventCard.getByTestId("ai-draft-where")).toHaveText("Studio 2");
    await expect(eventCard.getByTestId("ai-draft-attendees")).toHaveText("tom@example.org");
    await expect(eventCard.getByTestId("ai-draft-unnamed")).toHaveCount(0);
    await expect(eventCard.getByTestId("ai-draft-create")).toHaveText(/Open in Calendar/);
    expect(sentMails).toEqual([]);
    if (process.env.PLAINVA_EVIDENCE) {
      await page.screenshot({ path: test.info().outputPath("ai-pim-event-card-mobile.png") });
      await mailCard.evaluate((card) => card.scrollIntoView({ block: "start" }));
      await page.screenshot({ path: test.info().outputPath("ai-pim-mail-card-mobile.png") });
    }

    // 2. "Open in Mail" pushes the phone's own composer with every recipient in sight — Cc is open, not folded away.
    await mailCard.getByTestId("ai-draft-create").click();
    await expect(field(page, "To")).toHaveValue("a.okafor@example.org");
    await expect(field(page, "Cc")).toHaveValue("tom@example.org");
    await expect(field(page, "Bcc")).toHaveValue("");
    await expect(field(page, "Subject")).toHaveValue("Re: Shooting day");
    await expect(page.locator(".m-page")).toContainText("the 14th is fixed");
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: test.info().outputPath("ai-pim-composer-mobile.png") });

    // 3. Left without sending, nothing happened: the draft still waits, and the conversation is where it was.
    await page.getByRole("button", { name: /^Back$/ }).first().click();
    await expect(mailCard).toHaveCount(1);
    expect((await storedDrafts(page, vault!)).drafts.map((entry) => entry.id)).toEqual(["d-000001", "d-000002"]);
    expect(sentMails).toEqual([]);

    // 4. Sent from the composer, the mail goes after its undo window — and only then does the draft leave the list.
    await mailCard.getByTestId("ai-draft-create").click();
    await expect(field(page, "To")).toHaveValue("a.okafor@example.org");
    await page.getByRole("button", { name: /^Send$/ }).last().click();
    await expect(page.locator(".pv-toast").filter({ hasText: /Sending in \d+ s/ })).toBeVisible();
    // Queued, and it could still be taken back: the draft is still the reader's.
    expect(sentMails).toEqual([]);
    expect((await storedDrafts(page, vault!)).drafts.map((entry) => entry.id)).toEqual(["d-000001", "d-000002"]);
    await expect.poll(() => sentMails.length, { timeout: 25_000 }).toBe(1);
    expect(sentMails[0]!.message.subject).toBe("Re: Shooting day");
    expect(sentMails[0]!.message.toRecipients.map((recipient) => recipient.emailAddress.address)).toEqual(["a.okafor@example.org"]);
    expect((sentMails[0]!.message.ccRecipients ?? []).map((recipient) => recipient.emailAddress.address)).toEqual(["tom@example.org"]);
    expect(sentMails[0]!.message.body.content).toContain("the 14th is fixed");
    await expect.poll(async () => (await storedDrafts(page, vault!)).done.map((entry) => [entry.id, entry.kind, entry.outcome])).toEqual([["d-000001", "mail", "sent"]]);
    await expect(mailCard).toHaveCount(0);
    await expect(conversation.locator('[data-testid="ai-draft-done"][data-outcome="sent"]')).toContainText("Re: Shooting day");
    await closeToasts(page);

    // 5. "Open in Calendar" leads to the screen with the event sheet, filled with what was drafted. Nothing is saved
    //    by that; saved from there, this fixture's calendar refuses — and the draft is still in the list.
    await eventCard.getByTestId("ai-draft-create").click();
    const sheet = page.locator(".m-sheet").filter({ has: page.locator(".m-sheet-title", { hasText: "New event" }) });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByPlaceholder("Title")).toHaveValue("Shooting day");
    await expect(sheet.getByRole("textbox", { name: "Attendees" })).toHaveValue("tom@example.org");
    await expect(sheet).toContainText("Email invitees about this event");
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: test.info().outputPath("ai-pim-event-mobile.png") });
    expect((await storedDrafts(page, vault!)).drafts.map((entry) => entry.id)).toEqual(["d-000002"]);
    await sheet.getByRole("button", { name: "Save" }).click();
    await expect(sheet).toHaveCount(0);
    const refused = page.locator(".pv-toast--error").filter({ hasText: "The event was not saved" });
    await expect(refused).toBeVisible();
    expect((await storedDrafts(page, vault!)).drafts.map((entry) => entry.id)).toEqual(["d-000002"]);
    // The refusal stays until it is read; closed, the way back to the conversation is free.
    await closeToasts(page);
    await toConversation(page);
    await expect(eventCard).toHaveCount(1);
    expect(errors).toEqual([]);
  } finally {
    await sql.close();
  }
});
