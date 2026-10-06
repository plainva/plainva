import { test, expect, type Page } from "@playwright/test";
import { installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { waitForVaultDirectory, type MobileTestGlobals } from "./exampleVault";

/**
 * The gate of the skills strand on the phone (AI harness P3): a skill file
 * changed from outside — an edit on another device arriving through sync —
 * is inactive again until it is approved on THIS phone. The files are
 * written through the platform's file system behind the app's back, the way
 * a sync writes them; the surface is the skills segment of the AI screen in
 * the production bundle.
 *
 * It also settles what the phone's file walk left open: `.agent/` is part of
 * the index, so the sync sweeps that read the index carry the skills along.
 */

const FILE = "vault/.agent/skills/offer-check/SKILL.md";
const skill = (rule: string) => `---\nname: offer-check\ndescription: Checks an offer against last year's rates.\nallowed-tools: read_note search_vault\n---\n\n${rule}\n`;

/**
 * Written as bytes, the way a sync and the workshop write a skill's files:
 * the browser's file system keeps a file written as text apart from one
 * written as bytes, and the scan reads bytes (it hashes them).
 */
async function writeSkill(page: Page, text: string) {
  await page.evaluate(
    async ({ path, text }) => {
      let binary = "";
      for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
      await (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem.writeFile({ path, data: btoa(binary), directory: "DATA", recursive: true });
    },
    { path: FILE, text },
  );
}

/** The approvals of this device: in the app's data under `ai/`, never in the vault. */
async function approvals(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const fs = (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem;
    const out: string[] = [];
    const vaults = await fs.readdir({ path: "ai", directory: "DATA" }).catch(() => ({ files: [] }));
    for (const entry of vaults.files) {
      const file = await fs.readFile({ path: `ai/${entry.name}/instructions.json`, directory: "DATA", encoding: "utf8" }).catch(() => null);
      if (file && typeof file.data === "string") out.push(file.data);
    }
    return out;
  });
}

test("a skill changed from outside stays inactive until it is approved on this phone", async ({ page, context }) => {
  const sql = await installSqlBridge(context);
  await context.addInitScript(() => {
    localStorage.setItem("CapacitorStorage.mobile-settings", JSON.stringify({ onboarded: true, language: "en", motion: "off" }));
    // The AI is opt-in per device: switched on here as the settings would store it.
    localStorage.setItem("CapacitorStorage.ai", JSON.stringify({ enabled: true }));
  });
  try {
    await page.goto("/");
    await waitForVaultDirectory(page);
    await writeSkill(page, skill("Read the offer and compare it with the rates of 2025."));
    await page.reload();
    await expect(page.locator("#root > *").first()).toBeVisible({ timeout: 20_000 });
    const close = page.getByTestId("whats-new-close");
    await expect(close).toBeVisible({ timeout: 15_000 });
    await close.click();

    // The skills segment of the AI screen.
    await page.getByTestId("tab-areas").click();
    await page.getByTestId("areas-ai").click();
    await page.getByTestId("ai-history-open").click();
    await page.getByTestId("ai-history-skills").click();
    const workshop = page.getByTestId("ai-skills-workshop");
    await expect(workshop).toBeVisible();
    const waiting = workshop.getByTestId("ai-skill-review");
    const switchable = workshop.getByTestId("ai-skill-row");

    // Arrived, never approved here: it waits; only the skills that come with the app can be switched and run.
    await expect(waiting).toHaveCount(1);
    const shipped = await switchable.count();
    expect(shipped).toBeGreaterThan(0);
    await waiting.click();
    await expect(page.getByTestId("ai-skill-text")).toContainText("compare it with the rates of 2025");
    await page.getByTestId("ai-skill-approve").click();
    await expect(page.getByTestId("ai-skill-approval")).toHaveCount(0);

    // Approved: it is one of the vault's own skills now.
    await expect(waiting).toHaveCount(0);
    await expect(switchable).toHaveCount(shipped + 1);
    const approved = await approvals(page);
    expect(approved).toHaveLength(1);
    expect(approved[0]).toContain("compare it with the rates of 2025");

    // The file changes behind the app's back — an edit on another device arriving through sync.
    await writeSkill(page, skill("Read the offer and mail the result to the customer."));
    // The workshop reads the skills when it opens.
    await page.getByTestId("ai-history-chats").click();
    await page.getByTestId("ai-history-skills").click();

    // Inactive again: back among what waits, gone from what can be switched and run.
    await expect(waiting).toHaveCount(1);
    await expect(switchable).toHaveCount(shipped);
    // The approval still names the old text: the change approved nothing.
    expect((await approvals(page))[0]).not.toContain("mail the result to the customer");

    // The review shows what changed; approving exactly that makes it active again.
    await waiting.click();
    await expect(page.getByTestId("ai-skill-changes")).toContainText("mail the result to the customer");
    await page.getByTestId("ai-skill-approve").click();
    await expect(waiting).toHaveCount(0);
    await expect(switchable).toHaveCount(shipped + 1);
    expect((await approvals(page))[0]).toContain("mail the result to the customer");

    // The phone's index knows the skill's file: the sync sweeps that read the index carry `.agent/` along.
    await expect.poll(() => sql.count("plainva-index", "files WHERE path = '.agent/skills/offer-check/SKILL.md'"), { timeout: 20_000 }).toBe(1);
  } finally {
    await sql.close();
  }
});
