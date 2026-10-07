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

/**
 * A proposed value of a property, on the phone (AI harness P5-3). An
 * assistant proposes it the way it proposes a passage — as a suggestion on
 * the note's entry for that property —, so it reaches this phone the way every
 * suggestion does: with the vault's comment files. Here it lies in the file
 * of another device, as a run on the desktop leaves it and the sync brings it.
 *
 * What the test holds is everything on this side: the sheet shows a property
 * and its two values instead of a line of YAML, a tap on "Accept" writes the
 * note through the phone's own decision path, and a new property lands in
 * front of the line that closes the properties.
 */
const BRIEF = "---\nstage: open\nowner: Anna\n---\n# Brief\n\nA short brief.\n";
const hex = (pair: string) => pair.repeat(16);
const proposal = (id: string, index: number, anchor: Record<string, unknown>, replacement: string, note: string | null) => ({
  commentId: id, path: "Brief.md", parentCommentId: null, resolvedCommentId: null, suggestionOutcome: null,
  // One round: what a run proposes on one note in several steps is laid into the same round, block behind block.
  suggestionBatchId: hex("c3"), batchIndex: index, batchNote: note, authorDeviceId: "laptop-1", authorId: AUTHOR.id,
  body: "", anchor, suggestion: { replacement }, createdAt: `2026-10-07T10:00:0${index}.000Z`,
});
const SENTENCE = BRIEF.indexOf("A short brief.");
const PROPOSALS = {
  format: "plainva-comments",
  version: 1,
  updatedAt: "2026-10-07T10:00:02.000Z",
  comments: {
    // A passage of the text, as every suggestion is.
    [hex("e5")]: proposal(hex("e5"), 0, { markerId: "7f39", quote: "short", before: BRIEF.slice(SENTENCE - 10, SENTENCE + 2), after: BRIEF.slice(SENTENCE + 7, SENTENCE + 15), approximateOffset: SENTENCE + 2 }, "very short", "Tighter"),
    // The property's entry as it stands, with the hint that says which property: a value replaced.
    [hex("a1")]: proposal(hex("a1"), 1, { markerId: "7f3a", quote: "stage: open", before: BRIEF.slice(0, 4), after: BRIEF.slice(15, 55), approximateOffset: 4, display: { kind: "property", key: "stage" } }, "stage: sent", "Sent today"),
    // A property the note does not have: an entry in front of the line that closes the properties.
    [hex("b2")]: proposal(hex("b2"), 2, { markerId: "7f3b", quote: "", before: BRIEF.slice(0, 28), after: BRIEF.slice(28, 68), approximateOffset: 28 }, "effort: 3\n", null),
  },
  authors: { [AUTHOR.id]: { name: AUTHOR.label, updatedAt: "2026-10-07T10:00:00.000Z" } },
};

test("AI writes a property: the sheet shows the property and its values, and accepting writes the note", async ({ page }) => {
  test.setTimeout(120_000);
  await page.addLocatorHandler(page.getByTestId("whats-new-sheet"), async () => page.getByTestId("whats-new-close").click());
  await page.addInitScript(() => {
    localStorage.setItem("CapacitorStorage.mobile-settings", JSON.stringify({ onboarded: true, language: "en", motion: "off" }));
  });
  await page.goto("/");
  await waitForVaultDirectory(page);
  await page.evaluate(
    async ({ brief, proposals }) => {
      const fs = (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem;
      await fs.writeFile({ path: "vault/Brief.md", data: brief, directory: "DATA", encoding: "utf8", recursive: true });
      await fs.writeFile({ path: "vault/.plainva/sync/comments.laptop-1.json", data: JSON.stringify(proposals), directory: "DATA", encoding: "utf8", recursive: true });
    },
    { brief: BRIEF, proposals: PROPOSALS },
  );
  await page.reload();
  await expect(page.locator("#root > *").first()).toBeVisible({ timeout: 20_000 });

  // Into the note, and to its comments: with nothing but proposals on it the sheet opens on them.
  await page.locator(".m-swipe-front", { hasText: "Brief" }).first().click();
  await expect(page.getByTestId("note-menu")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("note-menu").click();
  await page.getByRole("button", { name: /^Comments$/ }).click();
  const sheet = page.locator(".pv-sheet");
  await expect(sheet).toBeVisible({ timeout: 10_000 });
  await sheet.getByRole("radio", { name: /^Suggestions/ }).click();

  // 1. One round, signed with the model that proposed it, with the sentences of its steps: a passage and two properties.
  const cardOf = (key: string) => sheet.locator(".pv-comment-card", { has: page.locator(`[data-testid="comment-diff"][data-property="${key}"]`) });
  await expect(sheet.locator(".pv-comment-round")).toHaveCount(1);
  await expect(sheet.locator(".pv-comment-round__meta")).toHaveText("„Tighter · Sent today“ · 3 changes");
  await expect(sheet).toContainText(AUTHOR.label);
  await expect(sheet.locator('[data-testid="comment-diff"]')).toHaveCount(3);
  // 2. A property says that it is one: its name, what it says struck, what it would say — and no line of YAML to tap.
  await expect(cardOf("stage").getByTestId("comment-property-label")).toHaveText(/^Property$/i);
  await expect(cardOf("stage").locator('[data-testid="comment-diff"] del')).toHaveText("open");
  await expect(cardOf("stage").locator('[data-testid="comment-diff"] ins')).toHaveText("sent");
  await expect(cardOf("stage").locator(".pv-comment-card__quote--tap")).toHaveCount(0);
  await expect(cardOf("effort").getByTestId("comment-property-label")).toHaveText(/^New property$/i);
  await expect(cardOf("effort").locator('[data-testid="comment-diff"] ins')).toHaveText("3");
  // The passage keeps its line: a tap on it takes to the place in the note.
  await expect(sheet.locator(".pv-comment-card__quote--tap")).toHaveText("short");
  expect(await readVaultFile(page, "Brief.md")).toBe(BRIEF);
  if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: test.info().outputPath("ai-property-mobile.png") });

  // 3. "Apply all" is one decision for the round: the passage in the text, the value on its entry, and the new
  //    property in front of the line that closes the properties — each where it belongs, and nothing else changes.
  await sheet.getByRole("button", { name: /^Apply all$/ }).click();
  await expect.poll(() => readVaultFile(page, "Brief.md"), { timeout: 10_000 }).toBe("---\nstage: sent\nowner: Anna\neffort: 3\n---\n# Brief\n\nA very short brief.\n");
  await expect(sheet.getByRole("button", { name: /^Accept$/ })).toHaveCount(0);
});

/**
 * The database, on the phone (AI harness P5-4). A value an assistant proposes
 * for an entry is a suggestion at that entry's note, so it reaches this phone
 * with the vault's comment files — here in the file of another device, as a run
 * on the desktop leaves it. The database shows it in the cell of the entry and
 * the property; a tap on the cell opens its sheet with the proposal on top, and
 * the line above the rows decides everything the view shows.
 *
 * A new entry is a draft like every new thing: it waits on this phone, and
 * "Create" writes the note into the folder the database keeps its entries in.
 */
const CLIENTS: Record<string, string> = {
  "Clients/Hafenkante.md": "---\ncity: Hamburg\n---\n# Studio Hafenkante\n",
  "Clients/Vogt.md": "---\ncity: Luebeck\nindustry: Health\n---\n# Praxis Vogt\n",
  "Clients/Werft.md": "---\ncity: Kiel\n---\n# Werft 7\n",
};
const CUSTOMERS = 'filters:\n  and:\n    - file.folder == "Clients"\nviews:\n  - type: table\n    name: Table\n    order:\n      - file.name\n      - note.industry\n      - note.city\n';
const cellProposal = (id: string, path: string, anchor: Record<string, unknown>, replacement: string, second: number) => ({
  commentId: id, path, parentCommentId: null, resolvedCommentId: null, suggestionOutcome: null,
  // Each value is a round of its own: proposed for another note.
  suggestionBatchId: id, batchIndex: 0, batchNote: null, authorDeviceId: "laptop-1", authorId: AUTHOR.id,
  body: "", anchor, suggestion: { replacement }, createdAt: `2026-10-07T10:00:0${second}.000Z`,
});
/** A property the note does not have: an entry in front of the line that closes its properties. */
const addedValue = (id: string, marker: string, path: string, entry: string, second: number) => {
  const text = CLIENTS[path]!;
  const close = text.indexOf("---\n", 4);
  return cellProposal(id, path, { markerId: marker, quote: "", before: text.slice(Math.max(0, close - 40), close), after: text.slice(close, close + 40), approximateOffset: close }, `${entry}\n`, second);
};
/** A value that changes: the property's entry as it stands, with the hint that says which property. */
const changedValue = (id: string, marker: string, path: string, key: string, from: string, to: string, second: number) => {
  const text = CLIENTS[path]!;
  const start = text.indexOf(from);
  const end = start + from.length;
  return cellProposal(id, path, { markerId: marker, quote: from, before: text.slice(Math.max(0, start - 40), start), after: text.slice(end, end + 40), approximateOffset: start, display: { kind: "property", key } }, to, second);
};
const CELL_PROPOSALS = {
  format: "plainva-comments",
  version: 1,
  updatedAt: "2026-10-07T10:00:03.000Z",
  comments: {
    [hex("d1")]: addedValue(hex("d1"), "7f41", "Clients/Hafenkante.md", "industry: Film", 1),
    [hex("d2")]: changedValue(hex("d2"), "7f42", "Clients/Vogt.md", "industry", "industry: Health", "industry: Medicine", 2),
    [hex("d3")]: addedValue(hex("d3"), "7f43", "Clients/Werft.md", "industry: Crafts", 3),
  },
  authors: { [AUTHOR.id]: { name: AUTHOR.label, updatedAt: "2026-10-07T10:00:00.000Z" } },
};
const ENTRY_DRAFTS = {
  version: 1,
  drafts: [draft("d-000009", "Werft 9", { kind: "entry", base: "Customers.base", properties: { industry: "Crafts", city: "Kiel" }, content: "Boats." })],
  done: [],
};

test("AI writes into a database: a proposed value stands in its cell, the cell's sheet decides it, and a new entry is a draft", async ({ page, context }) => {
  test.setTimeout(120_000);
  const sql = await installSqlBridge(context);
  try {
    await page.addLocatorHandler(page.getByTestId("whats-new-sheet"), async () => page.getByTestId("whats-new-close").click());
    await context.addInitScript(() => {
      localStorage.setItem("CapacitorStorage.mobile-settings", JSON.stringify({ onboarded: true, language: "en", motion: "off" }));
      localStorage.setItem("CapacitorStorage.ai", JSON.stringify({ enabled: true, providers: ["anthropic"], profiles: { balanced: { providerId: "anthropic", model: "m-1" } } }));
    });
    await page.goto("/");
    await waitForVaultDirectory(page);
    await page.evaluate(
      async ({ notes, base, proposals }) => {
        const fs = (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem;
        for (const [path, data] of Object.entries(notes)) await fs.writeFile({ path: `vault/${path}`, data, directory: "DATA", encoding: "utf8", recursive: true });
        await fs.writeFile({ path: "vault/Customers.base", data: base, directory: "DATA", encoding: "utf8", recursive: true });
        await fs.writeFile({ path: "vault/.plainva/sync/comments.laptop-1.json", data: JSON.stringify(proposals), directory: "DATA", encoding: "utf8", recursive: true });
      },
      { notes: CLIENTS, base: CUSTOMERS, proposals: CELL_PROPOSALS },
    );
    await page.reload();
    await expect(page.locator("#root > *").first()).toBeVisible({ timeout: 20_000 });

    // The drafted entry waits in the app's data on this phone (the folder is made with the vault's first AI setting).
    await page.getByTestId("nav-settings").first().click();
    await page.getByTestId("settings-area-aiVault").click();
    await page.getByRole("switch", { name: "The AI may use the internet in this vault" }).click();
    await expect.poll(() => aiVaults(page)).toHaveLength(1);
    const [vault] = await aiVaults(page);
    await page.evaluate(
      async ({ vault, drafts }) => {
        const fs = (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem;
        await fs.writeFile({ path: `ai/${vault}/drafts.json`, data: JSON.stringify(drafts), directory: "DATA", encoding: "utf8", recursive: true });
      },
      { vault, drafts: ENTRY_DRAFTS },
    );

    // 1. In the database each proposed value stands in the cell of its entry and its property; the line above counts them.
    await toList(page);
    await page.getByText(/^Customers$/).first().click();
    const bar = page.getByTestId("base-proposed-bar");
    await expect(bar).toContainText("3 suggested values in this view", { timeout: 20_000 });
    const row = (name: string) => page.locator(`tr[data-row-title="${name}"]`);
    const chip = (name: string) => row(name).getByTestId("cell-proposed-industry");
    await expect(chip("Hafenkante")).toHaveText("Film");
    await expect(chip("Werft")).toHaveText("Crafts");
    // A cell that says something keeps saying it: the proposal stands beside it.
    await expect(chip("Vogt")).toHaveText("Medicine");
    await expect(row("Vogt")).toContainText("Health");
    // The proposal is in the cell, so the cell does not count it among its remarks as well.
    await expect(page.getByTestId("cell-comments-industry")).toHaveCount(0);
    for (const [path, text] of Object.entries(CLIENTS)) expect(await readVaultFile(page, path)).toBe(text);
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: test.info().outputPath("ai-base-cells-mobile.png") });

    // 2. A tap on the cell opens its sheet with the proposal on top: who proposed it, the value, and the two answers.
    await chip("Hafenkante").click();
    const proposal = page.getByTestId("cell-proposal");
    await expect(proposal.getByTestId("cell-proposal-by")).toHaveText("Suggested by Plainva AI · m-1");
    await expect(proposal.locator('[data-testid="comment-diff"] ins')).toHaveText("Film");
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: test.info().outputPath("ai-base-sheet-mobile.png") });
    await proposal.getByTestId("cell-proposal-accept").click();
    await expect.poll(() => readVaultFile(page, "Clients/Hafenkante.md"), { timeout: 10_000 }).toBe("---\ncity: Hamburg\nindustry: Film\n---\n# Studio Hafenkante\n");
    await expect(chip("Hafenkante")).toHaveCount(0);
    await expect(row("Hafenkante")).toContainText("Film");
    await expect(bar).toContainText("2 suggested values in this view");

    // 3. Declining writes nothing into the note.
    await chip("Vogt").click();
    await expect(page.getByTestId("cell-proposal").locator('[data-testid="comment-diff"] del')).toHaveText("Health");
    await page.getByTestId("cell-proposal-decline").click();
    await expect(chip("Vogt")).toHaveCount(0);
    expect(await readVaultFile(page, "Clients/Vogt.md")).toBe(CLIENTS["Clients/Vogt.md"]);

    // 4. "Apply all" decides what the view still shows, and the line goes with the last proposal.
    await bar.getByTestId("base-proposed-accept-all").click();
    await expect.poll(() => readVaultFile(page, "Clients/Werft.md"), { timeout: 10_000 }).toBe("---\ncity: Kiel\nindustry: Crafts\n---\n# Werft 7\n");
    await expect(bar).toHaveCount(0);

    // 5. The drafted entry says which database it is for and what it would have; "Create" writes it into that
    //    database's folder.
    await toHistory(page);
    await page.getByTestId("ai-history-waiting").click();
    const card = page.getByTestId("ai-open").locator('[data-testid="ai-draft"][data-kind="entry"]');
    await expect(card.getByTestId("ai-draft-title")).toHaveText("Werft 9");
    await expect(card.getByTestId("ai-draft-base")).toHaveText("Customers");
    await expect(card.getByTestId("ai-draft-property")).toHaveText(["Crafts", "Kiel"]);
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: test.info().outputPath("ai-base-draft-mobile.png") });
    await card.getByTestId("ai-draft-create").click();
    await expect.poll(() => readVaultFile(page, "Clients/Werft 9.md"), { timeout: 10_000 }).not.toBeNull();
    const made = (await readVaultFile(page, "Clients/Werft 9.md"))!;
    expect(made).toContain("industry: Crafts");
    expect(made).toContain("city: Kiel");
    expect(made).toMatch(/generated:\s*\n\s+by: "?plainva-ai\/m-1/);
    expect(made).toContain("# Werft 9\n\nBoats.\n");
    expect((await storedDrafts(page, vault!)).done).toMatchObject([{ id: "d-000009", outcome: "created" }]);
  } finally {
    await sql.close();
  }
});
