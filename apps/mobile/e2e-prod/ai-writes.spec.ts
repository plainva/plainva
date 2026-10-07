import { test, expect, type Page } from "@playwright/test";
import { installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { waitForVaultDirectory, type MobileTestGlobals } from "./exampleVault";

/**
 * What an assistant laid down, on the phone (AI harness P5), in the
 * production bundle. A run proposes and drafts; nothing of it is in the vault
 * until the reader creates it. Under the answer stands the note that carries
 * a proposal, and a card per draft; everything that still waits is listed
 * under "Open" in the history.
 *
 * The model itself is the native `AiNet` plugin, which a browser does not
 * have. So the conversation and its drafts are ones this phone already keeps
 * — stored in the app's data as a finished run would leave them — and what
 * the test holds is everything after the answer: the cards, "Create" through
 * the phone's own ways of making a note and a journal line, and "Discard".
 */

const QUESTION = "Raise the day rate in the offer and plan the kick-off.";
const ANSWER = "I proposed the new rate on [[Offer]] and drafted a note, a journal line and a task. They wait for you.";
const AUTHOR = { id: "plainva-ai/m-1", label: "Plainva AI · m-1" };

const usage = { inputTokens: 40, outputTokens: 30, cacheReadTokens: 0, cacheWriteTokens: 0 };
const draft = (id: string, title: string, body: Record<string, unknown>) => ({ id, createdAt: "2026-10-07T10:00:04.000Z", author: AUTHOR, conversationId: "wrote-1", title, body, inherited: [], sources: [], defused: 0 });
const DRAFTS = {
  version: 1,
  drafts: [
    draft("d-000001", "Kick-off", { kind: "note", path: null, folder: null, content: "Agenda\n\n- one" }),
    draft("d-000002", "Met Anna about the offer", { kind: "journal", text: "Met Anna about the offer", day: "2026-10-07", time: "10:30", task: false }),
    draft("d-000003", "Call the roofer", { kind: "task", text: "Call the roofer", day: "2026-10-07" }),
  ],
  done: [],
};
const RECORD = {
  version: 1,
  id: "wrote-1",
  title: QUESTION,
  createdAt: "2026-10-07T10:00:00.000Z",
  updatedAt: "2026-10-07T10:00:05.000Z",
  providerId: "anthropic",
  model: "m-1",
  conversation: {
    id: "wrote-1",
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
      // What the run laid down, as its record keeps it: paths, counts and titles — never a proposed text.
      writes: {
        rounds: [{ path: "Offer.md", blocks: 1, properties: 0 }],
        drafts: DRAFTS.drafts.map((entry) => ({ id: entry.id, kind: String(entry.body.kind), title: entry.title })),
        plans: [],
      },
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

/** The Markdown files of the vault that hold `needle`, by path — two folders deep is as far as a daily note lies. */
const vaultFilesWith = (page: Page, needle: string): Promise<string[]> =>
  page.evaluate(async (wanted) => {
    const fs = (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem;
    const found: string[] = [];
    const walk = async (dir: string, depth: number): Promise<void> => {
      const listed = await fs.readdir({ path: `vault${dir ? `/${dir}` : ""}`, directory: "DATA" }).catch(() => ({ files: [] }));
      for (const entry of listed.files) {
        const rel = dir ? `${dir}/${entry.name}` : entry.name;
        if (entry.type === "directory") {
          if (depth < 3 && !entry.name.startsWith(".")) await walk(rel, depth + 1);
        } else if (/\.md$/i.test(entry.name)) {
          const read = await fs.readFile({ path: `vault/${rel}`, directory: "DATA", encoding: "utf8" }).catch(() => null);
          if (read && typeof read.data === "string" && read.data.includes(wanted)) found.push(rel);
        }
      }
    };
    await walk("", 0);
    return found;
  }, needle);

const storedDrafts = (page: Page, vault: string): Promise<{ drafts: { id: string }[]; done: { id: string; outcome: string }[] }> =>
  page.evaluate(async (folder) => {
    const fs = (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem;
    const read = await fs.readFile({ path: `ai/${folder}/drafts.json`, directory: "DATA", encoding: "utf8" });
    return JSON.parse(String(read.data));
  }, vault);

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

/** From the list of notes to the AI's history screen. */
async function toHistory(page: Page) {
  await toList(page);
  await page.getByTestId("tab-areas").click();
  await page.getByTestId("areas-ai").click();
  await page.getByTestId("ai-history-open").click();
  await expect(page.getByTestId("ai-history-screen")).toBeVisible();
}

test("AI writes: drafts wait on this phone until the reader creates or discards them", async ({ page, context }) => {
  test.setTimeout(120_000);
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
      await (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem.writeFile({ path: "vault/Offer.md", data: "# Offer\n\nThe day rate is 1,800 euros.\n", directory: "DATA", encoding: "utf8", recursive: true });
    });
    await page.reload();
    await expect(page.locator("#root > *").first()).toBeVisible({ timeout: 20_000 });

    // The folder of this vault's AI data is made when its first setting is stored.
    await page.getByTestId("nav-settings").first().click();
    await page.getByTestId("settings-area-aiVault").click();
    await page.getByRole("switch", { name: "The AI may use the internet in this vault" }).click();
    await expect.poll(() => aiVaults(page)).toHaveLength(1);
    const [vault] = await aiVaults(page);

    // A conversation this phone keeps, and the drafts its run left: nothing of them is in the vault.
    await page.evaluate(
      async ({ vault, record, index, drafts }) => {
        const fs = (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem;
        await fs.writeFile({ path: `ai/${vault}/conversations/${record.id}.json`, data: JSON.stringify(record), directory: "DATA", encoding: "utf8", recursive: true });
        await fs.writeFile({ path: `ai/${vault}/index.json`, data: JSON.stringify(index), directory: "DATA", encoding: "utf8", recursive: true });
        await fs.writeFile({ path: `ai/${vault}/drafts.json`, data: JSON.stringify(drafts), directory: "DATA", encoding: "utf8", recursive: true });
      },
      { vault, record: RECORD, index: INDEX, drafts: DRAFTS },
    );

    // 1. Everything that waits is counted on the history's third segment.
    await toHistory(page);
    await expect(page.getByTestId("ai-history-waiting")).toHaveText("Open · 3");

    // 2. The conversation: under its answer stand the note that carries the proposal, and a card per draft.
    await page.getByTestId("ai-history-row").first().click();
    const conversation = page.getByTestId("ai-conversation");
    await expect(conversation.getByText("I proposed the new rate on", { exact: false })).toBeVisible();
    await expect(conversation.getByTestId("ai-proposed")).toHaveText("Suggested in “Offer”: 1 passage");
    await expect(conversation.getByTestId("ai-draft")).toHaveCount(3);
    const noteCard = conversation.locator('[data-testid="ai-draft"][data-kind="note"]');
    await expect(noteCard.getByTestId("ai-draft-title")).toHaveText("Kick-off");
    await expect(noteCard).toContainText("Inbox folder");
    await noteCard.getByTestId("ai-draft-show").click();
    await expect(noteCard.getByTestId("ai-draft-text")).toHaveText("Agenda\n\n- one");
    expect(await vaultFilesWith(page, "Agenda")).toEqual([]);
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: test.info().outputPath("ai-writes-mobile.png") });

    // 3. "Create" is the reader's step: the phone writes the note into the inbox folder and says who drafted it.
    await noteCard.getByTestId("ai-draft-create").click();
    await expect.poll(() => readVaultFile(page, "Inbox/Kick-off.md")).not.toBeNull();
    const note = (await readVaultFile(page, "Inbox/Kick-off.md"))!;
    expect(note).toMatch(/generated:\s*\n\s+by: "?plainva-ai\/m-1/);
    expect(note).toContain("# Kick-off\n\nAgenda\n\n- one\n");
    expect((await storedDrafts(page, vault!)).done).toMatchObject([{ id: "d-000001", outcome: "created" }]);

    // 4. What still waits is listed under "Open", with who laid it down. A journal line is written through the journal.
    await toHistory(page);
    await expect(page.getByTestId("ai-history-waiting")).toHaveText("Open · 2");
    await page.getByTestId("ai-history-waiting").click();
    const open = page.getByTestId("ai-open");
    await expect(open.getByTestId("ai-draft")).toHaveCount(2);
    const lineCard = open.locator('[data-testid="ai-draft"][data-kind="journal"]');
    await expect(lineCard.getByTestId("ai-draft-author")).toHaveText("Plainva AI · m-1");
    await expect(lineCard).toContainText("10:30");
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: test.info().outputPath("ai-writes-open-mobile.png") });
    await lineCard.getByTestId("ai-draft-create").click();
    await expect.poll(() => vaultFilesWith(page, "Met Anna about the offer")).toHaveLength(1);
    const [daily] = await vaultFilesWith(page, "Met Anna about the offer");
    expect(daily).toContain("2026-10-07");
    expect(await readVaultFile(page, daily!)).toMatch(/^- 10:30 Met Anna about the offer$/m);

    // 5. "Discard" throws a draft away: nothing was made of it, and nothing waits any more.
    await toHistory(page);
    await page.getByTestId("ai-history-waiting").click();
    await page.getByTestId("ai-open").locator('[data-testid="ai-draft"][data-kind="task"]').getByTestId("ai-draft-discard").click();
    await expect(page.getByTestId("ai-open-empty")).toContainText("Nothing is waiting for you");
    expect(await vaultFilesWith(page, "Call the roofer")).toEqual([]);
    const stored = await storedDrafts(page, vault!);
    expect(stored.drafts).toEqual([]);
    expect(stored.done.map((entry) => [entry.id, entry.outcome])).toEqual([
      ["d-000001", "created"],
      ["d-000002", "created"],
      ["d-000003", "discarded"],
    ]);
  } finally {
    await sql.close();
  }
});
