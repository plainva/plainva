import { test, expect, type Page } from "@playwright/test";
import { installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { waitForVaultDirectory, type MobileTestGlobals } from "./exampleVault";

/**
 * The vault's memory on the phone (AI harness P6), in the production bundle:
 * the segment "Memory" of the AI screen, an entry made by hand, what a row
 * can do, the switch of this phone — and the three drafts an assistant can
 * leave for the memory, each written by the reader's own tap.
 *
 * The model itself is the native `AiNet` plugin, which a browser does not
 * have. So the drafts are ones this phone already keeps — stored in the app's
 * data as a finished run would leave them — and what the test holds is
 * everything after the answer. The memory files are written as bytes, the way
 * a sync writes them: the app reads them as bytes too.
 */

const ACTIVE_FILE = "vault/.agent/active_memory.md";
const LONG_FILE = "vault/.agent/MEMORY.md";
const RULES_FILE = "vault/AGENTS.md";
const ACTIVE = "# Active memory\n\n- I write offers for film studios.\n- My day rate is 950. <!-- plainva: added=2026-10-01; by=user; deny=cloud -->\n";
const LONG = "# Memory\n\n## Clients\n- Harbour Studio pays within 14 days.\n- Yard 7 wants invoices as PDF.\n";

const AUTHOR = { id: "plainva-ai/m-1", label: "Plainva AI · m-1" };
const draft = (id: string, title: string, body: Record<string, unknown>) => ({ id, createdAt: "2026-10-09T10:00:04.000Z", author: AUTHOR, conversationId: null, title, body, inherited: [], sources: [], defused: 0 });
const DRAFTS = {
  version: 1,
  drafts: [
    draft("d-000001", "I prefer short offers.", { kind: "memory", text: "I prefer short offers.", place: "active", replaces: null }),
    draft("d-000002", "Yard 7 wants invoices as PDF.", { kind: "forget", entry: "Yard 7 wants invoices as PDF." }),
    draft("d-000003", "Answer in German.", { kind: "rule", text: "Answer in German." }),
  ],
  done: [],
};

/** Written as bytes, the way a sync writes a file. */
async function writeBytes(page: Page, path: string, text: string) {
  await page.evaluate(
    async ({ path, text }) => {
      let binary = "";
      for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
      await (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem.writeFile({ path, data: btoa(binary), directory: "DATA", recursive: true });
    },
    { path, text },
  );
}

/** A file as the app wrote it; null when there is none. */
async function readFile(page: Page, path: string): Promise<string | null> {
  return page.evaluate(async (path) => {
    const fs = (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem;
    const file = await fs.readFile({ path, directory: "DATA" }).catch(() => null);
    if (!file || typeof file.data !== "string") return null;
    try {
      return new TextDecoder().decode(Uint8Array.from(atob(file.data), (char) => char.charCodeAt(0)));
    } catch {
      return file.data;
    }
  }, path);
}

/** The folders of the AI's data on this phone: one per vault, under `ai/`. */
const aiVaults = (page: Page): Promise<string[]> =>
  page.evaluate(async () => {
    const fs = (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem;
    const listed = await fs.readdir({ path: "ai", directory: "DATA" }).catch(() => ({ files: [] }));
    return listed.files.map((entry) => entry.name);
  });

const appData = (page: Page, path: string): Promise<string | null> =>
  page.evaluate(async (file) => {
    const fs = (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem;
    const read = await fs.readFile({ path: file, directory: "DATA", encoding: "utf8" }).catch(() => null);
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

/** From the list of notes to the AI's history screen. */
async function toHistory(page: Page) {
  await toList(page);
  await page.getByTestId("tab-areas").click();
  await page.getByTestId("areas-ai").click();
  await page.getByTestId("ai-history-open").click();
  await expect(page.getByTestId("ai-history-screen")).toBeVisible();
}

test("AI memory: the phone shows both places, writes an entry by hand, and makes a draft an entry only on the reader's tap", async ({ page, context }) => {
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
    await writeBytes(page, ACTIVE_FILE, ACTIVE);
    await writeBytes(page, LONG_FILE, LONG);
    await page.reload();
    await expect(page.locator("#root > *").first()).toBeVisible({ timeout: 20_000 });

    // 1. The segment "Memory" of the AI screen: both places, how full the first is, the rule an entry carries.
    await toHistory(page);
    await page.getByTestId("ai-history-memory").click();
    const memory = page.getByTestId("ai-memory");
    await expect(memory.getByTestId("ai-memory-entry")).toHaveCount(4);
    await expect(memory.getByTestId("ai-memory-budget")).toContainText("of 2,000 characters");
    await expect(memory.getByTestId("ai-memory-entry").filter({ hasText: "My day rate is 950." })).toContainText("Not to cloud models");
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: test.info().outputPath("ai-memory-mobile.png") });

    // 2. The switch is this phone's: it lies in the app's data, and the vault's files do not change with it.
    await memory.getByTestId("ai-memory-switch").click();
    await expect(memory).toContainText("Off on this device");
    await expect.poll(() => aiVaults(page)).toHaveLength(1);
    const [vault] = await aiVaults(page);
    expect(JSON.parse((await appData(page, `ai/${vault}/memory.json`))!)).toEqual({ version: 1, on: false });
    expect(await readFile(page, ACTIVE_FILE)).toBe(ACTIVE);
    await memory.getByTestId("ai-memory-switch").click();
    await expect.poll(async () => JSON.parse((await appData(page, `ai/${vault}/memory.json`))!).on).toBe(true);

    // 3. An entry by hand: a sheet, then one more line in the file it was meant for — kept from the cloud, as ticked.
    await memory.getByTestId("ai-memory-new").click();
    const sheet = page.getByTestId("ai-memory-dialog");
    await sheet.getByTestId("ai-memory-text").fill("Yard 7 owes me 4200.");
    await sheet.getByTestId("ai-memory-place-long").click();
    await sheet.getByTestId("ai-memory-local").check();
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: test.info().outputPath("ai-memory-form-mobile.png") });
    await sheet.getByTestId("ai-memory-save").click();
    await expect(sheet).toHaveCount(0);
    await expect.poll(() => readFile(page, LONG_FILE)).toMatch(/^- Yard 7 owes me 4200\. <!-- plainva: added=\d{4}-\d\d-\d\d; by=user; deny=cloud -->$/m);
    await expect(memory.getByTestId("ai-memory-entry")).toHaveCount(5);

    // 4. What a row can do, from the shared list: moved to "always included", it is a line of the other file.
    await memory.getByTestId("ai-memory-entry").filter({ hasText: "Yard 7 owes me 4200." }).click();
    await expect(page.getByTestId("ai-memory-action-edit")).toBeVisible();
    await expect(page.getByTestId("ai-memory-action-delete")).toBeVisible();
    await page.getByTestId("ai-memory-action-toActive").click();
    await expect.poll(() => readFile(page, ACTIVE_FILE)).toContain("- Yard 7 owes me 4200. <!-- plainva: added=");
    expect(await readFile(page, LONG_FILE)).not.toContain("owes me");

    // 5. Three drafts an assistant left: an entry, the removal of one, a rule. Nothing of them is in the vault.
    await page.evaluate(
      async ({ vault, drafts }) => {
        await (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem.writeFile({ path: `ai/${vault}/drafts.json`, data: JSON.stringify(drafts), directory: "DATA", encoding: "utf8", recursive: true });
      },
      { vault, drafts: DRAFTS },
    );
    await toHistory(page);
    await expect(page.getByTestId("ai-history-waiting")).toHaveText("Open · 3");
    await page.getByTestId("ai-history-memory").click();
    await expect(page.getByTestId("ai-memory")).toContainText("3 suggestions of the AI for the memory are waiting under “Open”. None is in the memory before you accept it.");
    await page.getByTestId("ai-memory-waiting").click();
    const open = page.getByTestId("ai-open");
    await expect(open.getByTestId("ai-draft")).toHaveCount(3);
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: test.info().outputPath("ai-memory-drafts-mobile.png") });

    // "Remember": the reader's tap writes the entry — with who proposed it — where the reader wanted it.
    const entry = open.locator('[data-testid="ai-draft"][data-kind="memory"]');
    await expect(entry.getByTestId("ai-draft-title")).toHaveText("I prefer short offers.");
    await entry.getByTestId("ai-draft-place-long").click();
    await entry.getByTestId("ai-draft-create").click();
    await expect.poll(() => readFile(page, LONG_FILE)).toMatch(/^- I prefer short offers\. <!-- plainva: added=\d{4}-\d\d-\d\d; by=assistant -->$/m);

    // "Remove": the entry goes, and nothing else of the file.
    const removal = open.locator('[data-testid="ai-draft"][data-kind="forget"]');
    await expect(removal.getByTestId("ai-draft-title")).toHaveText("Yard 7 wants invoices as PDF.");
    await removal.getByTestId("ai-draft-create").click();
    await expect.poll(() => readFile(page, LONG_FILE)).not.toContain("invoices as PDF");
    expect(await readFile(page, LONG_FILE)).toContain("- Harbour Studio pays within 14 days.");

    // "Add as a rule": a line of the vault's instructions — the memory files do not hold it.
    const rule = open.locator('[data-testid="ai-draft"][data-kind="rule"]');
    await expect(rule).toContainText("AGENTS.md");
    expect(await readFile(page, RULES_FILE)).toBeNull();
    await rule.getByTestId("ai-draft-create").click();
    await expect.poll(() => readFile(page, RULES_FILE)).toBe("# Instructions for assistants\n\n- Answer in German.\n");
    expect(await readFile(page, ACTIVE_FILE)).not.toContain("German");
    await expect(page.getByTestId("ai-open-empty")).toContainText("Nothing is waiting for you");
    const stored = JSON.parse((await appData(page, `ai/${vault}/drafts.json`))!) as { drafts: unknown[]; done: { id: string; outcome: string }[] };
    expect(stored.drafts).toEqual([]);
    expect(stored.done.map((done) => [done.id, done.outcome])).toEqual([
      ["d-000001", "created"],
      ["d-000002", "created"],
      ["d-000003", "created"],
    ]);

    // 6. The vault's AI settings say it in one line and lead to the memory.
    await toList(page);
    await page.getByTestId("nav-settings").first().click();
    await page.getByTestId("settings-area-aiVault").click();
    const row = page.getByTestId("settings-ai-memory-open");
    await expect(row).toContainText("3 always included · 2 on demand");
    await row.click();
    await expect(page.getByTestId("ai-memory")).toBeVisible();
    await expect(page.getByTestId("ai-memory-rules-open")).toBeVisible();
    // The memory is the reader's files: each one that is there is offered for the editor.
    await expect(page.getByTestId("ai-memory-file-active")).toContainText(".agent/active_memory.md");
    await expect(page.getByTestId("ai-memory-file-long")).toContainText(".agent/MEMORY.md");
    if (process.env.PLAINVA_EVIDENCE) {
      await page.getByTestId("ai-memory-file-long").scrollIntoViewIfNeeded();
      await page.screenshot({ path: test.info().outputPath("ai-memory-foot-mobile.png") });
    }

    // 7. A rule by hand: one more line of the instructions, behind the one the draft left there.
    await page.getByTestId("ai-memory-rule-new").click();
    const ruleSheet = page.getByTestId("ai-memory-rule-dialog");
    await ruleSheet.getByTestId("ai-memory-rule-text").fill("Use the metric system.");
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: test.info().outputPath("ai-memory-rule-mobile.png") });
    await ruleSheet.getByTestId("ai-memory-rule-save").click();
    await expect(ruleSheet).toHaveCount(0);
    await expect.poll(() => readFile(page, RULES_FILE)).toBe("# Instructions for assistants\n\n- Answer in German.\n- Use the metric system.\n");
  } finally {
    await sql.close();
  }
});
