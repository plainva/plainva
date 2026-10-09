import { test, expect, type Page } from "@playwright/test";
import { installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { waitForVaultDirectory, type MobileTestGlobals } from "./exampleVault";

/**
 * Tidying up on the phone (AI harness P6-3), in the production bundle: what
 * this phone notices by itself about the skills and the memory — two skills
 * that say almost the same, a tool that does not exist, two entries that say
 * almost the same, an entry of years ago — as a group of rows; what a row can
 * do, in its sheet: one step, or "don't show again"; and the two comparisons.
 *
 * No model is asked for any of it, which is also why this test needs none:
 * the hints are arithmetic over what the phone holds. The skill that looks
 * through the memory with a model is offered here and not started — a browser
 * has no way to a model (the native `AiNet` plugin), and what such a run does
 * is held by the session's tests and on the desktop.
 */

const skill = (name: string, description: string, body: string, tools: string) => `---\nname: ${name}\ndescription: ${description}\nallowed-tools: ${tools}\n---\n\n${body}\n`;
const SKILLS: Record<string, string> = {
  "client-letter": skill("client-letter", "Drafts a letter to a client in the tone of the last three letters to this client.", "1. Read the last three letters.\n2. Write the letter.", "search_vault read_note"),
  "letter-to-client": skill("letter-to-client", "Drafts a letter to a client in the tone of the last letters to that client.", "1. Read the last letters.\n2. Compose it.", "search_vault read_note"),
  "fair-follow-up": skill("fair-follow-up", "Writes the follow-up after a trade fair, one note per contact.", "1. Collect the contacts.\n2. Draft a note per contact.", "search_vault send_mail"),
};
const ACTIVE_FILE = "vault/.agent/active_memory.md";
const LONG_FILE = "vault/.agent/MEMORY.md";
const ACTIVE = "# Active memory\n\n- Harbour Studio bills per episode. <!-- plainva: added=2026-09-01; by=user -->\n";
const LONG = "# Memory\n\n- Harbour Studio bills per episode, not per hour. <!-- plainva: added=2026-10-01; by=user -->\n- Ms Petersen is my tax adviser. <!-- plainva: added=2024-01-15; by=user -->\n";

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

test("AI tidying up: the phone names what it noticed without a model; a row's sheet has its one step and “don't show again”; two skills and two entries are compared", async ({ page, context }) => {
  test.setTimeout(150_000);
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
    for (const [name, text] of Object.entries(SKILLS)) await writeBytes(page, `vault/.agent/skills/${name}/SKILL.md`, text);
    await writeBytes(page, ACTIVE_FILE, ACTIVE);
    await writeBytes(page, LONG_FILE, LONG);
    await page.reload();
    await expect(page.locator("#root > *").first()).toBeVisible({ timeout: 20_000 });

    // 1. Three skills arrived; each is read and approved on this phone. Before that nothing is said about them.
    await toHistory(page);
    await page.getByTestId("ai-history-skills").click();
    const workshop = page.getByTestId("ai-skills-workshop");
    await expect(workshop.getByTestId("ai-skill-review")).toHaveCount(3);
    await expect(workshop.getByTestId("ai-upkeep-row")).toHaveCount(0);
    for (let left = 3; left > 0; left--) {
      await workshop.getByTestId("ai-skill-review").first().click();
      await page.getByTestId("ai-skill-approve").click();
      await expect(page.getByTestId("ai-skill-approval")).toHaveCount(0);
      await expect(workshop.getByTestId("ai-skill-review")).toHaveCount(left - 1);
    }
    await expect.poll(() => aiVaults(page)).toHaveLength(1);
    const [vault] = await aiVaults(page);

    // 2. "Tidy up": two rows, sentences of the app's own, and the line that says no model was asked.
    await expect(workshop).toContainText("Tidy up · 2");
    const rows = workshop.getByTestId("ai-upkeep-row");
    await expect(rows).toHaveCount(2);
    await expect(rows.filter({ hasText: "not every tool on its list exists" })).toContainText("Not a tool of Plainva's: send_mail. The skill runs without.");
    await expect(rows.filter({ hasText: "say almost the same" })).toContainText("“client-letter” and “letter-to-client” say almost the same");
    await expect(workshop).toContainText("Noticed by this device, without asking a model.");
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: test.info().outputPath("ai-upkeep-skills-mobile.png") });

    // 3. A tap opens what the row can do: its one step, and "don't show again". The step compares the two skills.
    await rows.filter({ hasText: "say almost the same" }).click();
    await expect(page.getByTestId("ai-upkeep-action-step")).toHaveText("Compare");
    await expect(page.getByTestId("ai-upkeep-action-dismiss")).toHaveText("Don't show again");
    await page.getByTestId("ai-upkeep-action-step").click();
    const compare = page.getByTestId("ai-skill-compare");
    await expect(compare.getByTestId("ai-skill-compare-side")).toHaveCount(2);
    await expect(compare.getByTestId("ai-skill-compare-lines")).toContainText("+ 2. Compose it.");
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: test.info().outputPath("ai-upkeep-compare-mobile.png") });
    // Switching one of the two off is its row's switch: this phone's list, and the skill's file stays as it is.
    await compare.getByTestId("ai-skill-compare-off").last().click();
    await expect(compare).toHaveCount(0);
    await expect(workshop).toContainText("Tidy up · 1");
    expect(await readFile(page, "vault/.agent/skills/letter-to-client/SKILL.md")).toBe(SKILLS["letter-to-client"]);

    // 4. "Don't show again" puts the other row away — in the app's data on this phone, never in the vault.
    await workshop.getByTestId("ai-upkeep-row").click();
    await page.getByTestId("ai-upkeep-action-dismiss").click();
    await expect(workshop.getByTestId("ai-upkeep-row")).toHaveCount(0);
    await expect(workshop).not.toContainText("Tidy up");
    const kept = JSON.parse((await appData(page, `ai/${vault}/upkeep.json`))!) as { dismissed: string[] };
    expect(kept.dismissed).toHaveLength(1);
    expect(await readFile(page, "vault/.agent/upkeep.json")).toBeNull();

    // 5. The memory has its own group: two entries that say almost the same, one from years ago, and the offer to
    //    have a skill look through it.
    await page.getByTestId("ai-history-memory").click();
    const memory = page.getByTestId("ai-memory");
    await expect(memory).toContainText("Tidy up · 2");
    const hints = memory.getByTestId("ai-upkeep-row");
    await expect(hints.filter({ hasText: "Two entries say almost the same" })).toContainText("“Harbour Studio bills per episode.” · “Harbour Studio bills per episode, not per hour.”");
    await expect(hints.filter({ hasText: "Ms Petersen is my tax adviser." })).toContainText("more than a year ago. Is it still true?");
    await expect(memory.getByTestId("ai-memory-care")).toContainText("Have the memory looked through");
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: test.info().outputPath("ai-upkeep-memory-mobile.png") });

    // 6. "Compare" shows the two entries as the list shows them; a tap on one opens what an entry can do.
    await hints.filter({ hasText: "Two entries say almost the same" }).click();
    await page.getByTestId("ai-upkeep-action-step").click();
    const pair = page.getByTestId("ai-memory-compare");
    await expect(pair.getByTestId("ai-memory-entry")).toHaveCount(2);
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: test.info().outputPath("ai-upkeep-entries-mobile.png") });
    await pair.getByTestId("ai-memory-entry").last().click();
    await expect(page.getByTestId("ai-memory-action-delete")).toBeVisible();
    await page.keyboard.press("Escape");

    // 7. Nothing of all this wrote into the vault: both files of the memory are as they were.
    expect(await readFile(page, ACTIVE_FILE)).toBe(ACTIVE);
    expect(await readFile(page, LONG_FILE)).toBe(LONG);
  } finally {
    await sql.close?.();
  }
});
