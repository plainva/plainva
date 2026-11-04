import { test, expect, type Page } from "@playwright/test";
import { installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { waitForVaultDirectory, type MobileTestGlobals } from "./exampleVault";

/**
 * "Keep as a note" on the phone (AI harness P4-6), in the production bundle.
 * Under a finished answer the button turns the answer into a note of the
 * vault: written by the app into the vault's inbox folder — where the ＋ quick
 * capture puts its notes too —, marked as an AI's, with the page the run read
 * as its source, and known to the index like any new note. No address the
 * model wrote stays live in it.
 *
 * The model itself is the native `AiNet` plugin, which a browser does not
 * have. So the conversation is one this phone already keeps — stored in the
 * app's data as a finished run would leave it — and what the test holds is
 * everything after the answer: the button, the note, the folder, the index.
 */

const QUESTION = "What is the day rate for 2026?";
const RATES = "https://example.org/rates";
const ANSWER = `The day rate for 2026 is 1,900 euros, see [the rates](${RATES}) and [[Offer]]. ![chart](https://collect.example.net/p.png?d=1900)`;

const usage = { inputTokens: 40, outputTokens: 30, cacheReadTokens: 0, cacheWriteTokens: 0 };
const RECORD = {
  version: 1,
  id: "kept-1",
  title: QUESTION,
  createdAt: "2026-10-06T10:00:00.000Z",
  updatedAt: "2026-10-06T10:00:05.000Z",
  providerId: "anthropic",
  model: "m-1",
  conversation: {
    id: "kept-1",
    system: "You are the assistant in Plainva.",
    tools: [],
    turns: [
      { role: "user", parts: [{ type: "text", text: QUESTION }], at: "2026-10-06T10:00:00.000Z" },
      { role: "assistant", parts: [{ type: "text", text: ANSWER }], at: "2026-10-06T10:00:05.000Z" },
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
      // What the run asked of the internet, as its record keeps it: one page that was read.
      web: { pages: [{ url: RATES, title: "Rates 2026", at: "2026-10-06T10:00:03.000Z", read: true }], searches: [], inputTokens: 0, outputTokens: 0 },
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

const readVaultFile = (page: Page, path: string): Promise<string | null> =>
  page.evaluate(async (file) => {
    const fs = (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem;
    const read = await fs.readFile({ path: `vault/${file}`, directory: "DATA", encoding: "utf8" }).catch(() => null);
    return read && typeof read.data === "string" ? read.data : null;
  }, path);

/** Back to the list of notes: the session comes back on the screen it was left on. */
async function toList(page: Page) {
  await page.goto("/");
  await expect(page.locator("#root > *").first()).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(1500);
  for (let step = 0; step < 5; step++) {
    const button = page.getByRole("button", { name: /^Back$/ }).first();
    if (!(await button.isVisible().catch(() => false))) break;
    await button.click();
    await page.waitForTimeout(300);
  }
}

test("keep as a note: an answer becomes a marked note in the inbox folder, with its sources, and the index knows it", async ({ page, context }) => {
  test.setTimeout(90_000);
  const sql = await installSqlBridge(context);
  try {
    await page.addLocatorHandler(page.getByTestId("whats-new-sheet"), async () => page.getByTestId("whats-new-close").click());
    await context.addInitScript(() => {
      localStorage.setItem("CapacitorStorage.mobile-settings", JSON.stringify({ onboarded: true, language: "en", motion: "off" }));
      // The AI is opt-in per device: switched on here, with a model chosen, as the settings would store it.
      localStorage.setItem("CapacitorStorage.ai", JSON.stringify({ enabled: true, providers: ["anthropic"], profiles: { balanced: { providerId: "anthropic", model: "m-1" } } }));
    });
    await page.goto("/");
    await waitForVaultDirectory(page);
    await page.evaluate(async () => {
      await (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem.writeFile({ path: "vault/Offer.md", data: "# Offer\n\nFor Northwind.\n", directory: "DATA", encoding: "utf8", recursive: true });
    });
    await page.reload();
    await expect(page.locator("#root > *").first()).toBeVisible({ timeout: 20_000 });

    // The folder of this vault's AI data is made when its first setting is stored.
    await page.getByTestId("nav-settings").first().click();
    await page.getByTestId("settings-area-aiVault").click();
    await page.getByRole("switch", { name: "The AI may use the internet in this vault" }).click();
    await expect.poll(() => aiVaults(page)).toHaveLength(1);
    const [vault] = await aiVaults(page);

    // A conversation this phone keeps: one question, one finished answer, one page read for it.
    await page.evaluate(
      async ({ vault, record, index }) => {
        const fs = (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem;
        await fs.writeFile({ path: `ai/${vault}/conversations/${record.id}.json`, data: JSON.stringify(record), directory: "DATA", encoding: "utf8", recursive: true });
        await fs.writeFile({ path: `ai/${vault}/index.json`, data: JSON.stringify(index), directory: "DATA", encoding: "utf8", recursive: true });
      },
      { vault, record: RECORD, index: INDEX },
    );
    await toList(page);

    // 1. The conversation, opened from the history: under its answer stands the button.
    await page.getByTestId("tab-areas").click();
    await page.getByTestId("areas-ai").click();
    await page.getByTestId("ai-history-open").click();
    await page.getByTestId("ai-history-row").first().click();
    const conversation = page.getByTestId("ai-conversation");
    await expect(conversation.getByText("The day rate for 2026 is 1,900 euros", { exact: false })).toBeVisible();
    const keep = conversation.getByTestId("ai-capture");
    await expect(keep).toHaveText("Keep as a note");
    expect(await readVaultFile(page, `Inbox/${QUESTION.replace("?", "")}.md`)).toBeNull();
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: test.info().outputPath("ai-capture-mobile.png") });

    // 2. One tap writes the note and says so.
    await keep.click();
    await expect(page.getByText(`Kept as a note: ${QUESTION}`)).toBeVisible();
    const note = await readVaultFile(page, "Inbox/What is the day rate for 2026.md");
    expect(note).not.toBeNull();
    // Who wrote it, for machines and in words.
    expect(note!).toMatch(/generated:\s*\n\s+by: "?plainva-ai\/m-1/);
    expect(note!).toMatch(/^> Answer by Plainva AI · m-1, .*to: “What is the day rate for 2026\?”$/m);
    // What it rests on: the page the run's record names.
    expect(note!).toMatch(/sources:\s*\n\s+- resource: "?https:\/\/example\.org\/rates/);
    const body = note!.slice(note!.indexOf("\n---\n") + 5);
    const [answer, sources] = body.split("## Sources");
    // Nothing the model wrote leads or loads anywhere: a link and an image are words with the address beside them as text.
    // Its link into the vault stays one.
    expect(answer).not.toMatch(/https?:\/\//);
    expect(answer).toContain("see the rates (https[://]example.org/rates) and [[Offer]]. chart (https[://]collect.example.net/p.png?d=1900)");
    expect(answer).not.toContain("](");
    expect(sources!.match(/https:\/\/[^\s)]+/g)).toEqual([RATES]);
    expect(sources).toContain("**From the web**\n\n- [Rates 2026](https://example.org/rates) — read on ");

    // 3. It is a note like any other: in its folder, and found by the index through a word only the answer holds.
    await toList(page);
    await expect(page.getByText("Inbox", { exact: true }).first()).toBeVisible();
    await page.getByRole("button", { name: /^Search$/ }).first().click();
    await page.getByTestId("appbar-searchpage").locator("input").fill("euros");
    await expect(page.getByText("What is the day rate for 2026", { exact: false }).first()).toBeVisible();

    // 4. Kept again, the first note stays as it is: the next one gets the next name.
    await toList(page);
    await page.getByTestId("tab-areas").click();
    await page.getByTestId("areas-ai").click();
    await page.getByTestId("ai-history-open").click();
    await page.getByTestId("ai-history-row").first().click();
    await conversation.getByTestId("ai-capture").click();
    await expect.poll(() => readVaultFile(page, "Inbox/What is the day rate for 2026 2.md")).not.toBeNull();
    expect(await readVaultFile(page, "Inbox/What is the day rate for 2026.md")).toBe(note);
  } finally {
    await sql.close();
  }
});
