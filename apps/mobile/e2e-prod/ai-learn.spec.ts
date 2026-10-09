import { createHash } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import { installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { waitForVaultDirectory, type MobileTestGlobals } from "./exampleVault";

/**
 * Learning from a conversation on the phone (AI harness P6-2), in the
 * production bundle: the sheet that says what would go where, a skill's
 * draft under review — what changes, what stays, reworked and accepted by
 * the reader's own tap —, the row that says a version is watched, and the
 * vault's log of what was accepted.
 *
 * The model itself is the native `AiNet` plugin, which a browser does not
 * have. So the conversation and the drafts are ones this phone already keeps
 * — stored in the app's data as a finished review would leave them —, and a
 * review that is started here ends where it would without a network: with
 * the sentence that says so, and nothing laid down.
 *
 * The browser's file system keeps a file written as text apart from one
 * written as bytes. A skill's file is written as bytes, so the version the
 * browser keeps of it does not read back as text there (the native store is
 * not affected). What this test holds of the earlier versions is therefore
 * that one is kept and listed; reading one against the skill and restoring
 * it is held by the session's tests and on the desktop.
 */

const SKILL_ID = ".agent/skills/offer-check";
const SKILL_FILE = `vault/${SKILL_ID}/SKILL.md`;
const HEAD = "---\nname: offer-check\ndescription: Checks an offer against last year's rates.\nallowed-tools: read_note search_vault\nmetadata:\n  plainva.folders: Projects/\n---";
const OLD = "1. Read the offer.\n2. Compare each position with last year's rates.";
const NEW = `${OLD}\n3. Check the tax rate of each position.`;
const SKILL = `${HEAD}\n\n${OLD}\n`;
const BASE = createHash("sha256").update(Buffer.from(SKILL, "utf8")).digest("hex");

const AUTHOR = { id: "plainva-ai/m-1", label: "Plainva AI · m-1" };
const usage = { inputTokens: 40, outputTokens: 30, cacheReadTokens: 0, cacheWriteTokens: 0 };
const RECORD = {
  version: 1,
  id: "learn-1",
  title: "Check the offer for Harbour Studio.",
  createdAt: "2026-10-09T10:00:00.000Z",
  updatedAt: "2026-10-09T10:00:05.000Z",
  providerId: "anthropic",
  model: "m-1",
  conversation: {
    id: "learn-1",
    system: "You are the assistant in Plainva.",
    tools: [],
    turns: [
      { role: "user", parts: [{ type: "text", text: "Check the offer for Harbour Studio." }], at: "2026-10-09T10:00:00.000Z" },
      { role: "assistant", parts: [{ type: "text", text: "Checked: every rate matches last year." }], at: "2026-10-09T10:00:05.000Z" },
    ],
  },
  usage,
  // The conversation ran the vault's own skill: a review is told about it, and may suggest other instructions for it.
  runs: [{ userTurn: 0, providerId: "anthropic", model: "m-1", sent: [], kept: [], usage, steps: 1, stop: "answered", skills: [{ id: SKILL_ID, how: "bound", tokens: 20 }] }],
  pins: [],
  instructions: { skill: { id: SKILL_ID, name: "offer-check", origin: "vault", sha256: BASE } },
};
const INDEX = { version: 1, conversations: [{ id: RECORD.id, title: RECORD.title, updatedAt: RECORD.updatedAt, providerId: RECORD.providerId, model: RECORD.model }] };
const draft = (id: string, title: string, why: string, body: Record<string, unknown>) => ({ id, createdAt: "2026-10-09T10:00:09.000Z", author: AUTHOR, conversationId: RECORD.id, title, body, inherited: [], sources: [], defused: 0, why });
const DRAFTS = {
  version: 1,
  drafts: [
    draft("d-000001", "offer-check", "The skill ran and did not check the tax rate.", { kind: "skill", change: { id: SKILL_ID, base: BASE }, name: "offer-check", description: "", body: NEW }),
    draft("d-000002", "fair-follow-up", "The reader walked through it by hand.", { kind: "skill", change: null, name: "fair-follow-up", description: "Writes the follow-up after a trade fair.", body: "1. Collect the contacts.\n2. Draft a note per contact." }),
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

test("AI learning: the phone says what a review would send, and a skill's draft is reviewed, reworked and accepted by the reader's tap", async ({ page, context }) => {
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
    await writeBytes(page, SKILL_FILE, SKILL);
    await page.reload();
    await expect(page.locator("#root > *").first()).toBeVisible({ timeout: 20_000 });

    // 1. The skill is the vault's own once it is approved on this phone.
    await toHistory(page);
    await page.getByTestId("ai-history-skills").click();
    const workshop = page.getByTestId("ai-skills-workshop");
    await workshop.getByTestId("ai-skill-review").click();
    await page.getByTestId("ai-skill-approve").click();
    await expect(page.getByTestId("ai-skill-approval")).toHaveCount(0);
    await expect.poll(() => aiVaults(page)).toHaveLength(1);
    const [vault] = await aiVaults(page);

    // A conversation this phone keeps, and what a review of it left: other instructions for the skill, and a new one.
    await page.evaluate(
      async ({ vault, record, index, drafts }) => {
        const fs = (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem;
        await fs.writeFile({ path: `ai/${vault}/conversations/${record.id}.json`, data: JSON.stringify(record), directory: "DATA", encoding: "utf8", recursive: true });
        await fs.writeFile({ path: `ai/${vault}/index.json`, data: JSON.stringify(index), directory: "DATA", encoding: "utf8", recursive: true });
        await fs.writeFile({ path: `ai/${vault}/drafts.json`, data: JSON.stringify(drafts), directory: "DATA", encoding: "utf8", recursive: true });
      },
      { vault, record: RECORD, index: INDEX, drafts: DRAFTS },
    );

    // 2. "Learn from this conversation" under its last answer: the sheet says to which model, how much, and what can come
    //    back — the skill's instructions go along, so that a better version can be suggested.
    await toHistory(page);
    await page.getByTestId("ai-history-row").first().click();
    await page.getByTestId("ai-learn-open").click();
    const learn = page.getByTestId("ai-learn");
    await expect(learn.getByTestId("ai-learn-recipient")).toContainText("m-1");
    await expect(learn.getByTestId("ai-learn-kinds")).toContainText("Entries for the memory · Rules · A skill, or other instructions for one");
    await expect(learn).toContainText("2 messages: what you wrote and what was answered.");
    await expect(learn).toContainText("The instructions of offer-check, so that a better version can be suggested.");
    await expect(learn).toContainText("Nothing it suggests counts before you accept it.");
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: test.info().outputPath("ai-learn-ask-mobile.png") });
    // Started here, it ends where it would without a network: said, and nothing laid down.
    await learn.getByTestId("ai-learn-start").click();
    await expect(learn.getByTestId("ai-learn-refused")).toBeVisible();
    await expect(learn.getByTestId("ai-learn-start")).toHaveCount(0);
    expect((JSON.parse((await appData(page, `ai/${vault}/drafts.json`))!) as { drafts: unknown[] }).drafts).toHaveLength(2);
    await learn.getByRole("button", { name: "Close", exact: true }).last().click();
    await expect(learn).toHaveCount(0);

    // 3. What waits: two drafts for a skill. Each says on what it rests, and has no button that writes.
    await toHistory(page);
    await expect(page.getByTestId("ai-history-waiting")).toHaveText("Open · 2");
    await page.getByTestId("ai-history-waiting").click();
    const open = page.getByTestId("ai-open");
    const changed = open.locator('[data-testid="ai-draft"][data-kind="skill"]').first();
    await expect(changed.getByTestId("ai-draft-title")).toHaveText("offer-check — other instructions");
    await expect(changed.getByTestId("ai-draft-why")).toHaveText("The skill ran and did not check the tax rate.");
    await expect(changed.getByTestId("ai-draft-skill-rights")).toHaveText("Only its instructions change. What it may do stays as it is.");
    await expect(changed.getByTestId("ai-draft-create")).toHaveCount(0);
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: test.info().outputPath("ai-learn-drafts-mobile.png") });

    // 4. The review: what changes, what the skill may do — unchanged —, what a run costs more, where it comes from.
    await changed.getByTestId("ai-draft-review").click();
    const review = page.getByTestId("ai-skill-draft");
    await expect(review.getByTestId("ai-skill-draft-changes")).toContainText("+ 3. Check the tax rate of each position.");
    await expect(review.getByTestId("ai-skill-draft-rights")).toContainText("Unchanged. Uses: ");
    await expect(review).toContainText("A suggestion changes the instructions only.");
    await expect(review.getByTestId("ai-skill-draft-cost")).toContainText("tokens more in every run of this skill.");
    await expect(review.getByTestId("ai-skill-draft-why")).toContainText("from the conversation “Check the offer for Harbour Studio.”");
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: test.info().outputPath("ai-learn-skill-review-mobile.png") });

    // Reworked here, then accepted: what stands in the field is what is written — and not one byte of the skill's head.
    await review.getByTestId("ai-skill-draft-rework").click();
    await expect(review.getByTestId("ai-skill-draft-body")).toHaveValue(NEW);
    await review.getByTestId("ai-skill-draft-body").fill(`${NEW}\n4. Say what is still open.`);
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: test.info().outputPath("ai-learn-skill-rework-mobile.png") });
    await review.getByTestId("ai-skill-draft-rework").click();
    await expect(review.getByTestId("ai-skill-draft-changes")).toContainText("+ 4. Say what is still open.");
    await review.getByTestId("ai-skill-draft-take").click();
    await expect(review).toHaveCount(0);
    await expect.poll(() => readFile(page, SKILL_FILE)).toBe(`${HEAD}\n\n${NEW}\n4. Say what is still open.\n`);

    // 5. A new skill is shown whole, with what it may do by the app's defaults, and written with those.
    const fresh = open.locator('[data-testid="ai-draft"][data-kind="skill"]').first();
    await expect(fresh.getByTestId("ai-draft-title")).toHaveText("fair-follow-up — new skill");
    await fresh.getByTestId("ai-draft-review").click();
    await expect(review.getByTestId("ai-skill-draft-purpose")).toHaveText("Writes the follow-up after a trade fair.");
    await expect(review.getByTestId("ai-skill-draft-text")).toContainText("1. Collect the contacts.");
    await expect(review.getByTestId("ai-skill-draft-rights")).toContainText("Changes nothing, sends nothing.");
    await review.getByTestId("ai-skill-draft-take").click();
    await expect(review).toHaveCount(0);
    const made = await readFile(page, "vault/.agent/skills/fair-follow-up/SKILL.md");
    expect(made).toContain("name: fair-follow-up");
    expect(made).toContain("1. Collect the contacts.");
    expect(made).not.toContain("allowed-tools");
    await expect(page.getByTestId("ai-open-empty")).toContainText("Nothing is waiting for you");

    // 6. Approved on this phone as the reader saw them; the rewritten one is watched, and the copy to go back to is kept.
    const approvals = JSON.parse((await appData(page, `ai/${vault}/instructions.json`))!) as { approved: Array<{ id: string; how: string; observe?: { runs: number; previous: string } }> };
    expect(approvals.approved.find((approval) => approval.id === SKILL_ID)).toMatchObject({ how: "learned", observe: { runs: 0, failed: 0, previous: SKILL } });
    expect(approvals.approved.find((approval) => approval.id === ".agent/skills/fair-follow-up")).toMatchObject({ how: "learned" });
    // The vault's log says what was accepted — the skill and the conversation, no word of the reviewer.
    const log = await readFile(page, "vault/.agent/logs/learning.md");
    expect(log).toContain("skill `offer-check`: other instructions, from an accepted suggestion — from the conversation \"Check the offer for Harbour Studio.\"");
    expect(log).toContain("new skill `fair-follow-up`, from an accepted suggestion");
    expect(log).not.toContain("did not check the tax rate");

    // 7. The workshop: nothing waits for a review, the row says that the version is watched, and the log can be opened.
    await page.getByTestId("ai-history-skills").click();
    await expect(workshop.getByTestId("ai-skill-review")).toHaveCount(0);
    const row = workshop.getByTestId("ai-skill-row").filter({ hasText: "offer-check" });
    await expect(row).toContainText("watched · 0 of 3 runs");
    await expect(workshop.getByTestId("ai-learn-log")).toBeVisible();
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: test.info().outputPath("ai-learn-workshop-mobile.png") });

    // 8. "Earlier versions…" in the row's sheet: the version the accepted one took the place of was kept before the
    //    write, and the sheet lists it under how the skill came to be as it is now.
    await row.click();
    await page.getByTestId("ai-skill-action-versions").click();
    const versions = page.getByTestId("ai-skill-versions");
    await expect(versions).toContainText("Earlier versions of “offer-check”");
    await expect(versions.getByTestId("ai-skill-version-now")).toContainText("Accepted from a suggestion on this device on");
    await expect(versions.getByTestId("ai-skill-version")).toHaveCount(1);
    await expect(versions.getByTestId("ai-skill-version")).toContainText("Version of ");
    // The accept wrote nothing else: the skill is still what the reader accepted.
    expect(await readFile(page, SKILL_FILE)).toBe(`${HEAD}\n\n${NEW}\n4. Say what is still open.\n`);
  } finally {
    await sql.close();
  }
});
