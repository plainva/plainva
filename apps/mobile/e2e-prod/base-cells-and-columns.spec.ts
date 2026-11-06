import { test, expect, type Page } from "@playwright/test";
import { installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { waitForVaultDirectory, type MobileTestGlobals } from "./exampleVault";

/**
 * Three things the phone's database could not do and the desktop's could
 * (Sammelplan § 3.71 no. 1–3), against the real index:
 *
 * - a reverse relation's cell is an editor: a pick writes the OTHER note's
 *   owning property, taking it out removes the link there;
 * - a column's editor writes the property (empty) into the shown notes that
 *   lack it, after a question, and a calendar (or board) creates the column
 *   it needs and writes it the same way;
 * - switching a date column between "Date" and "Date & time" rewrites the
 *   values in the notes — a day gets 12:00, a moment loses its time after a
 *   question.
 */

const settings = () => localStorage.setItem("CapacitorStorage.mobile-settings", JSON.stringify({ onboarded: true, language: "en", motion: "off" }));

async function open(page: Page, files: Array<[string, string]>) {
  await page.goto("/");
  await waitForVaultDirectory(page);
  await page.evaluate(async (entries) => {
    const fs = (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem;
    for (const [path, data] of entries) await fs.writeFile({ path, data, directory: "DATA", encoding: "utf8", recursive: true });
  }, files);
  await page.reload();
  await expect(page.locator("#root > *").first()).toBeVisible();
  const close = page.getByTestId("whats-new-close");
  await expect(close).toBeVisible({ timeout: 15000 });
  await close.click();
}

const reader = (page: Page) => (path: string) =>
  page.evaluate(async (p) => String((await (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem.readFile({ path: p, directory: "DATA", encoding: "utf8" })).data), path);

const customers = [
  "filters:",
  "  and:",
  '    - file.folder == "Kunden"',
  "properties:",
  "  note.projekte:",
  "    plainva:",
  "      reverseOf:",
  "        base: Cockpit.base",
  "        property: kunde",
  "views:",
  "  - type: table",
  "    name: Tabelle",
  "    order:",
  "      - file.name",
  "      - note.projekte",
  "",
].join("\n");

const projects = [
  "filters:",
  "  and:",
  '    - file.folder == "Projekte"',
  "properties:",
  "  note.kunde:",
  "    plainva:",
  "      input: relation",
  "      relationBase: Kundenkartei.base",
  "      relationLimit: one",
  "views:",
  "  - type: table",
  "    name: Tabelle",
  "    order:",
  "      - file.name",
  "      - note.kunde",
  "",
].join("\n");

test("a reverse relation's cell writes the link into the other note, and takes it out there", async ({ page, context }, testInfo) => {
  const sql = await installSqlBridge(context);
  await context.addInitScript(settings);
  const read = reader(page);
  try {
    await open(page, [
      ["vault/Kundenkartei.base", customers],
      ["vault/Cockpit.base", projects],
      ["vault/Kunden/ACME.md", "---\nbranche: tech\n---\n# ACME\n"],
      ["vault/Kunden/Globex.md", "---\nbranche: energie\n---\n# Globex\n"],
      ["vault/Projekte/Alpha.md", '---\nstatus: active\nkunde: "[[ACME]]"\n---\n# Alpha\n'],
      ["vault/Projekte/Beta.md", "---\nstatus: done\n---\n# Beta\n\nBody stays.\n"],
    ]);
    await page.getByText(/^Kundenkartei$/).first().click();
    const row = (name: string) => page.locator(`tr[data-row-title="${name}"]`);
    await expect(row("Globex")).toBeVisible({ timeout: 20000 });
    await expect(row("ACME")).toContainText("Alpha");

    // The cell opens the relation's picker over the notes the links come from.
    await row("Globex").locator("td").nth(1).click();
    const sheet = page.locator(".m-sheet").filter({ hasText: "projekte" });
    await expect(sheet.getByRole("button", { name: "Beta" })).toBeVisible({ timeout: 10000 });
    await expect(sheet.getByRole("button", { name: "Alpha" })).toBeVisible();
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: testInfo.outputPath("phone-reverse-cell-picker.png") });
    await sheet.getByRole("button", { name: "Beta" }).click();

    // Written in Beta's owning property — not in Globex — and the rest of Beta stays.
    await expect.poll(() => read("vault/Projekte/Beta.md"), { timeout: 10000 }).toMatch(/kunde: "?\[\[Globex\]\]"?/);
    expect(await read("vault/Projekte/Beta.md")).toMatch(/^---\nstatus: done\nkunde: .*\n---\n# Beta\n\nBody stays\.\n$/);
    expect(await read("vault/Kunden/Globex.md")).toBe("---\nbranche: energie\n---\n# Globex\n");
    await expect(row("Globex")).toContainText("Beta", { timeout: 10000 });
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: testInfo.outputPath("phone-reverse-cell-written.png") });

    // Taken out again: the key goes from Beta, the note is as it was.
    await row("Globex").locator("td").nth(1).click();
    await expect(sheet.getByRole("button", { name: "Beta" })).toBeVisible({ timeout: 10000 });
    await sheet.getByRole("button", { name: "Beta" }).click();
    await expect.poll(() => read("vault/Projekte/Beta.md"), { timeout: 10000 }).toBe("---\nstatus: done\n---\n# Beta\n\nBody stays.\n");
    await expect(row("Globex")).not.toContainText("Beta", { timeout: 10000 });
  } finally {
    sql.close();
  }
});

const tasks = [
  "filters:",
  "  and:",
  '    - file.folder == "Chores"',
  "properties:",
  "  note.owner:",
  "    displayName: Owner",
  "    plainva:",
  "      input: text",
  "  note.due:",
  "    displayName: Due",
  "    plainva:",
  "      input: date",
  "views:",
  "  - type: table",
  "    name: Table",
  "    order:",
  "      - file.name",
  "      - note.owner",
  "      - note.due",
  "",
].join("\n");

test("a column's editor fills the property into the notes that lack it, and a date switch rewrites the values", async ({ page, context }, testInfo) => {
  const sql = await installSqlBridge(context);
  await context.addInitScript(settings);
  const read = reader(page);
  try {
    await open(page, [
      ["vault/Chore board.base", tasks],
      // CRLF and a comment: the rewrite keeps both.
      ["vault/Chores/Alpha.md", "---\r\nowner: Ann # lead\r\ndue: 2026-11-05\r\n---\r\n# Alpha\r\n"],
      ["vault/Chores/Beta.md", "---\ndue: 2026-11-06T09:30\n---\n# Beta\n"],
      ["vault/Chores/Gamma.md", "# Gamma\n"],
    ]);
    await page.getByText(/^Chore board$/).first().click();
    await expect(page.locator('tr[data-row-title="Gamma"]')).toBeVisible({ timeout: 20000 });

    await page.getByRole("button", { name: "Configure", exact: true }).click();
    const config = page.locator(".m-sheet--config");
    await config.getByRole("button", { name: /^Properties/ }).click();
    await config.getByRole("button", { name: "Property: Owner" }).click();

    // Two of the three shown notes lack it: asked, then written (empty).
    const sheet = page.locator(".m-sheet").filter({ hasText: "Missing values" });
    await expect(sheet.getByTestId("base-property-fill-missing")).toHaveText("Add to 2 source files");
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: testInfo.outputPath("phone-fill-missing.png") });
    await sheet.getByTestId("base-property-fill-missing").click();
    await expect(page.locator(".m-sheet").filter({ hasText: 'The property "Owner" will be added (empty) to 2 files.' })).toBeVisible();
    await page.getByTestId("confirm-act").click();
    await expect.poll(() => read("vault/Chores/Gamma.md"), { timeout: 10000 }).toMatch(/^---\nowner: ("")?\n---\n# Gamma\n$/);
    expect(await read("vault/Chores/Beta.md")).toMatch(/^---\ndue: 2026-11-06T09:30\nowner: ("")?\n---\n# Beta\n$/);
    expect(await read("vault/Chores/Alpha.md")).toBe("---\r\nowner: Ann # lead\r\ndue: 2026-11-05\r\n---\r\n# Alpha\r\n");
    // Filled: the section is gone once the rows carry the property.
    await expect(page.getByTestId("base-property-fill-missing")).toHaveCount(0, { timeout: 10000 });
    await page.locator(".m-sheet-backdrop").last().click({ position: { x: 5, y: 5 } });

    // Date -> Date & time: a day gets 12:00, without a question.
    await config.getByRole("button", { name: "Property: Due" }).click();
    const due = page.locator(".m-sheet").filter({ hasText: "Property: Due" });
    await due.getByRole("button", { name: "Date & time", exact: true }).click();
    await expect.poll(() => read("vault/Chores/Alpha.md"), { timeout: 10000 }).toBe("---\r\nowner: Ann # lead\r\ndue: 2026-11-05T12:00\r\n---\r\n# Alpha\r\n");
    expect(await read("vault/Chores/Beta.md")).toContain("due: 2026-11-06T09:30\n");
    await expect.poll(() => read("vault/Chore board.base"), { timeout: 10000 }).toMatch(/note\.due:[\s\S]*input: datetime/);

    // Date & time -> Date: asked first; a declined question changes nothing.
    await due.getByRole("button", { name: "Date", exact: true }).click();
    await expect(page.locator(".m-sheet").filter({ hasText: 'Switching to "Date only" will discard' })).toBeVisible();
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: testInfo.outputPath("phone-date-switch-question.png") });
    await page.getByTestId("confirm-safe").click();
    expect(await read("vault/Chores/Beta.md")).toContain("due: 2026-11-06T09:30\n");
    await due.getByRole("button", { name: "Date", exact: true }).click();
    await page.getByTestId("confirm-act").click();
    await expect.poll(() => read("vault/Chores/Beta.md"), { timeout: 10000 }).toContain("due: 2026-11-06\n");
    await expect.poll(() => read("vault/Chores/Alpha.md"), { timeout: 10000 }).toBe("---\r\nowner: Ann # lead\r\ndue: 2026-11-05\r\n---\r\n# Alpha\r\n");
    await expect.poll(() => read("vault/Chore board.base"), { timeout: 10000 }).toMatch(/note\.due:[\s\S]*input: date\n/);
  } finally {
    sql.close();
  }
});

const calendar = [
  "filters:",
  "  and:",
  '    - file.folder == "Events"',
  "views:",
  "  - type: table",
  "    name: Calendar",
  "    plainva:",
  "      render: calendar",
  "",
].join("\n");

test("a calendar creates a date property and writes it into the shown notes", async ({ page, context }, testInfo) => {
  const sql = await installSqlBridge(context);
  await context.addInitScript(settings);
  const read = reader(page);
  try {
    await open(page, [
      ["vault/Gatherings.base", calendar],
      ["vault/Events/Launch.md", "---\nplace: Hall\n---\n# Launch\n"],
    ]);
    await page.getByText(/^Gatherings$/).first().click();
    await page.getByRole("button", { name: "Configure", exact: true }).click({ timeout: 20000 });
    const config = page.locator(".m-sheet--config");
    await config.getByRole("button", { name: /^View(?! options)/ }).click();
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: testInfo.outputPath("phone-calendar-new-field.png") });
    await config.getByTestId("base-create-date-column").click();

    const prompt = page.locator(".m-sheet").filter({ hasText: "Create new field" });
    await prompt.locator("input").fill("when");
    await prompt.getByRole("button", { name: "OK", exact: true }).click();
    await page.locator(".m-sheet").filter({ hasText: "Date & time" }).getByText("Date only", { exact: true }).click();

    await expect.poll(() => read("vault/Events/Launch.md"), { timeout: 10000 }).toMatch(/^---\nplace: Hall\nwhen: ("")?\n---\n# Launch\n$/);
    await expect.poll(() => read("vault/Gatherings.base"), { timeout: 10000 }).toMatch(/note\.when:[\s\S]*input: date/);
    expect(await read("vault/Gatherings.base")).toMatch(/dateField: when/);
  } finally {
    sql.close();
  }
});
