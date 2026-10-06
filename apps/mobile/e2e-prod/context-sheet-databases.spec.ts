import { test, expect } from "@playwright/test";
import { installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { waitForVaultDirectory, type MobileTestGlobals } from "./exampleVault";

/**
 * The "Databases" tab of the note's context sheet (plan Befunde 2026-10-06, R3).
 *
 * The phone showed which database a note belongs to and the pager, and nothing
 * else; the desktop's section showed the database's columns as well. That was
 * a difference nobody had decided. Both now show the same thing, from the same
 * shared model: membership, position, and the columns the database COMPUTES
 * for the note — here a reverse relation and a rollup over it. A column the
 * note carries itself is named in one line and stays under Properties.
 *
 * Against the real SQLite index: the reverse relation and the rollup are
 * computed by the query layer from the links it indexed, not handed in.
 */
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
  "  note.offen:",
  "    plainva:",
  "      rollup:",
  "        through: projekte",
  "        of: status",
  "        fn: countWhere",
  "        where:",
  '          op: "!="',
  "          value: done",
  "views:",
  "  - type: table",
  "    name: Tabelle",
  "    order:",
  "      - file.name",
  "      - note.branche",
  "      - note.projekte",
  "      - note.offen",
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
  "      - note.status",
  "      - note.kunde",
  "",
].join("\n");

test("the Databases tab shows membership, position and what the database computes for the note", async ({ page, context }) => {
  const sql = await installSqlBridge(context);
  await context.addInitScript(() => {
    const key = "CapacitorStorage.mobile-settings";
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ onboarded: true, language: "en", motion: "off" }));
  });
  const files: Array<[string, string]> = [
    ["vault/Kundenkartei.base", customers],
    ["vault/Cockpit.base", projects],
    ["vault/Kunden/ACME.md", "---\nbranche: tech\n---\n# ACME\n\nThe headquarters of the acme company.\n"],
    ["vault/Kunden/Globex.md", "---\nbranche: energie\n---\n# Globex\n"],
    ["vault/Projekte/Alpha.md", '---\nstatus: active\nkunde: "[[ACME]]"\n---\n# Alpha\n'],
    ["vault/Projekte/Beta.md", '---\nstatus: done\nkunde: "[[ACME]]"\n---\n# Beta\n'],
  ];
  try {
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

    // Open the note the way a reader does: through the search.
    const field = page.getByTestId("appbar-searchpage").locator("input");
    const search = page.getByRole("button", { name: /^Search$/ }).first();
    await page.waitForTimeout(1500);
    for (let i = 0; i < 5 && !(await field.isVisible()) && !(await search.isVisible()); i++) {
      const back = page.getByRole("button", { name: /^Back$/ }).first();
      if (await back.isVisible()) await back.click();
      await page.waitForTimeout(400);
    }
    if (!(await field.isVisible())) await search.click();
    await field.fill("headquarters of the acme");
    await expect(page.locator("[data-search-occurrence]").first()).toContainText("ACME", { timeout: 15000 });
    await page.locator("[data-search-occurrence]").first().click();

    await page.getByTestId("note-context").click();
    const sheet = page.locator(".m-sheet");
    await expect(sheet).toBeVisible({ timeout: 10000 });
    await sheet.getByRole("radio", { name: "Databases" }).click();

    // Membership and position, as before.
    const block = sheet.getByTestId("db-membership");
    await expect(block).toHaveCount(1, { timeout: 15000 });
    await expect(block).toContainText("Kundenkartei");
    await expect(block.locator(".m-peekpos")).toHaveText(/^[12] \/ 2$/);

    // The reverse relation: the two projects that point here, each a row that
    // opens its note. Neither stands in ACME's file.
    const reverse = block.locator('[data-testid="db-computed"][data-column="projekte"]');
    await expect(reverse.getByRole("button")).toHaveText(["Alpha", "Beta"]);
    // The rollup over it: projects that are not done.
    const rollup = block.locator('[data-testid="db-computed"][data-column="offen"]');
    await expect(rollup.locator(".m-prop-val")).toHaveText("1");

    // `branche` is a property of the note: named here, edited under Properties.
    await expect(block.locator('[data-testid="db-computed"][data-column="branche"]')).toHaveCount(0);
    await expect(block.getByTestId("db-under-properties")).toHaveText("Under Properties: Branche");
    // The note's own name is not a field.
    await expect(block.locator('[data-testid="db-computed"][data-column="file.name"]')).toHaveCount(0);

    // A reverse link opens its note.
    await reverse.getByRole("button", { name: "Alpha" }).click();
    await expect(page.locator(".cm-content")).toContainText("Alpha", { timeout: 15000 });
  } finally { sql.close(); }
});
