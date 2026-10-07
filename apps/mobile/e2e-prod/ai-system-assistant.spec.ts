import { test, expect, type Page } from "@playwright/test";
import { installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { waitForVaultDirectory, type MobileTestGlobals } from "./exampleVault";
import { installSystemAssistant } from "./systemAssistant";

/**
 * Plainva as a tool of the system's assistant (AI harness P4.7), in the
 * production bundle.
 *
 * Siri and Shortcuts are native, and a browser has neither; what a browser
 * can hold is everything the app itself does about them — which is everything
 * that decides: which titles it writes down for the system (and that it
 * writes none until asked to), that a note the privacy rules keep back is
 * never among them, that the switch empties the list, and that what somebody
 * said while the app was closed is in the vault once the app has opened —
 * through the journal the app writes itself.
 *
 * "The app was closed and is opened" is a reload here: the bridge of this
 * test lives in the test process, as the native files live outside the web
 * view.
 */

const POLICY = "folders:\n  Private/: { cloud: deny }\n  Research/: { web: deny }\n";
const NOTES: Record<string, string> = {
  "Projects/Plan.md": "# Plan\n\nShooting days and the route.\n",
  "Health/Results.md": "---\nplainva:\n  ai:\n    cloud: deny\n---\n# Results\n\nFor nobody else.\n",
  "Private/Diary.md": "# Diary\n\nKept at home.\n",
  "Research/Paper.md": "# Paper\n\nNever where the internet is used.\n",
  "Welcome.md": "# Welcome\n\nA first note.\n",
  ".agent/policy.yml": POLICY,
};
const SWITCH = "Let Siri and Shortcuts find notes of the open vault";
const DAY = "vault/2026-10-07.md";
const at = (clock: string) => new Date(`2026-10-07T${clock}:00`).getTime();

const writeVaultFile = (page: Page, path: string, data: string) =>
  page.evaluate(
    async ([file, text]) => {
      await (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem.writeFile({ path: `vault/${file}`, data: text, directory: "DATA", encoding: "utf8", recursive: true });
    },
    [path, data] as const,
  );

const readNote = (page: Page, path: string) =>
  page.evaluate(async (file) => {
    try {
      return String((await (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem.readFile({ path: file, directory: "DATA", encoding: "utf8" })).data);
    } catch {
      return null;
    }
  }, path);

/** The app is opened again: what the system holds for it is found, and the page is up. */
async function reopen(page: Page) {
  await page.reload();
  await expect(page.locator("#root > *").first()).toBeVisible({ timeout: 20_000 });
}

test("the system's assistant: no title until the switch is on, never one a rule keeps back, and what was said is written when the app opens", async ({ page, context }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addLocatorHandler(page.getByTestId("whats-new-sheet"), async () => page.getByTestId("whats-new-close").click());
  const sql = await installSqlBridge(context);
  const system = await installSystemAssistant(context);
  await page.clock.setFixedTime(new Date("2026-10-07T10:05:00"));
  await context.addInitScript(() => {
    localStorage.setItem("CapacitorStorage.mobile-settings", JSON.stringify({ onboarded: true, language: "en", motion: "off" }));
    // The AI is opt-in per device, and finding notes through Siri is a second opt-in on top of it: only the
    // first is stored here, once — the second is switched in the settings below, as a person would.
    if (!localStorage.getItem("CapacitorStorage.ai")) localStorage.setItem("CapacitorStorage.ai", JSON.stringify({ enabled: true }));
  });
  try {
    await page.goto("/");
    await waitForVaultDirectory(page);
    for (const [path, text] of Object.entries(NOTES)) await writeVaultFile(page, path, text);
    await reopen(page);

    // 1. Off until chosen: the app wipes whatever an earlier run may have left, and writes nothing.
    await expect.poll(() => system.wipes(), { timeout: 30_000 }).toBeGreaterThan(0);
    expect(system.raw()).toBeNull();

    // 2. The switch, in the AI settings of this device. On: the titles the rules let go, and nothing else.
    await page.getByTestId("nav-settings").first().click();
    await page.getByTestId("settings-area-ai").click();
    const row = page.getByTestId("ai-system-find");
    await row.scrollIntoViewIfNeeded();
    await expect(page.getByTestId("ai-system-status")).toHaveCount(0);
    await page.getByRole("switch", { name: SWITCH }).click();
    await expect.poll(() => system.titles().sort(), { timeout: 30_000 }).toEqual(["Plan", "Welcome"]);
    await expect(page.getByTestId("ai-system-status")).toContainText("Note titles the system can read right now: 2");
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: test.info().outputPath("ai-system-settings-mobile.png") });

    // A title and the name of its folder — never where a note lies, and no trace of what a rule keeps back:
    // the note that says so itself, the folder kept from the cloud, the folder kept from the internet.
    const sent = system.raw()!;
    expect(system.directory()!.notes.find((note) => note.t === "Plan")).toMatchObject({ t: "Plan", f: "Projects" });
    expect(sent).not.toContain(".md");
    for (const kept of ["Results", "Health", "Diary", "Private", "Paper", "Research", "policy"]) expect(sent, kept).not.toContain(kept);

    // 3. Off empties the list at once; on writes it again, with the same key for the same note.
    const plan = system.directory()!.notes.find((note) => note.t === "Plan")!;
    await page.getByRole("switch", { name: SWITCH }).click();
    await expect.poll(() => system.raw(), { timeout: 15_000 }).toBeNull();
    await expect(page.getByTestId("ai-system-status")).toHaveCount(0);
    await page.getByRole("switch", { name: SWITCH }).click();
    await expect.poll(() => system.titles().sort(), { timeout: 30_000 }).toEqual(["Plan", "Welcome"]);
    expect(system.directory()!.notes.find((note) => note.t === "Plan")!.k).toBe(plan.k);

    // 4. Said to Siri while the app was closed — a journal entry, and a task where no task database takes it.
    //    The app writes both when it is opened, into the day and at the minute they were said.
    system.ask({ kind: "journal", text: "Called the dentist", at: at("09:41") });
    system.ask({ kind: "task", text: "Buy milk", at: at("09:45") });
    expect(await readNote(page, DAY)).toBeNull();
    await reopen(page);
    await expect.poll(() => readNote(page, DAY), { timeout: 30_000 }).toMatch(/- 09:41 Called the dentist\n- \[ \] 09:45 Buy milk\n$/);
    await expect.poll(() => system.waiting(), { timeout: 15_000 }).toEqual([]);
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: test.info().outputPath("ai-system-filed-mobile.png") });
    // The day's note is a note like any other: the list names it once it exists.
    await expect.poll(() => system.titles().sort(), { timeout: 30_000 }).toEqual(["2026-10-07", "Plan", "Welcome"]);

    // 5. "Open Plan": the order names a key, the app's own table knows which note that is.
    system.ask({ kind: "open", text: "Plan", key: plan.k, at: at("10:05") });
    await reopen(page);
    await expect(page.getByText("Shooting days and the route.")).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => system.waiting(), { timeout: 15_000 }).toEqual([]);
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: test.info().outputPath("ai-system-open-mobile.png") });

    // 6. A rule that arrived since: the folder is kept from the cloud now. The list drops the note …
    await writeVaultFile(page, ".agent/policy.yml", `${POLICY}  Projects/: { cloud: deny }\n`);
    await reopen(page);
    await expect.poll(() => system.titles().sort(), { timeout: 30_000 }).toEqual(["2026-10-07", "Welcome"]);
    expect(system.raw()).not.toContain(plan.k);
    // … and a shortcut that still remembers its key no longer opens it: the title is searched for instead.
    system.ask({ kind: "open", text: "Plan", key: plan.k, at: at("10:05") });
    await reopen(page);
    await expect(page.getByTestId("appbar-searchpage").locator("input")).toHaveValue("Plan", { timeout: 30_000 });
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: test.info().outputPath("ai-system-search-mobile.png") });

    expect(errors).toEqual([]);
  } finally {
    sql.close();
  }
});
