import { test, expect, type Page } from "./clockedTest";
import { installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { waitForVaultDirectory, type MobileTestGlobals } from "./exampleVault";

/**
 * Mobile E2E coverage for the closed R13 parity items:
 * - code-block-copy: one-tap copy button on fenced code blocks in the live preview;
 * - base-cell-text-links: tapping a link in free cell text opens its target while plain text opens CellEditSheet;
 * - base-template-assignment: database Templates sheet lists assigned templates first and toggles plainva.templateFor.
 */

const settings = () =>
  localStorage.setItem("CapacitorStorage.mobile-settings", JSON.stringify({ onboarded: true, language: "en", motion: "off" }));

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

test("a fenced code block carries a one-tap copy button that copies only the code", async ({ page, context }) => {
  const sql = await installSqlBridge(context);
  await context.addInitScript(() => {
    const key = "CapacitorStorage.mobile-settings";
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ onboarded: true, language: "en", motion: "off" }));
    (window as unknown as { __copied?: string[] }).__copied = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: (text: string) => {
          (window as unknown as { __copied: string[] }).__copied.push(text);
          return Promise.resolve();
        },
      },
    });
  });
  const note = [
    "# Snippet",
    "",
    "```ts",
    "const answer = 42;",
    "console.log(answer);",
    "```",
    "",
    "After the block.",
    "",
  ].join("\n");
  try {
    await open(page, [["vault/Snippet.md", note]]);
    await page.getByRole("button", { name: /^Search$/ }).first().click();
    await page.getByTestId("appbar-searchpage").locator("input").fill("After the block.");
    await expect(page.locator("[data-search-occurrence]").first()).toContainText("Snippet");
    await page.locator("[data-search-occurrence]").first().click();

    const copyBtn = page.locator("button.cm-md-codecopy");
    await expect(copyBtn).toBeVisible({ timeout: 15000 });
    await copyBtn.click();
    await expect(copyBtn).toHaveClass(/is-copied/);
    const copied = await page.evaluate(() => (window as unknown as { __copied: string[] }).__copied);
    expect(copied).toEqual(["const answer = 42;\nconsole.log(answer);"]);
  } finally {
    sql.close();
  }
});

const linksBase = [
  "filters:",
  "  and:",
  '    - file.folder == "Items"',
  "properties:",
  "  note.summary:",
  "    displayName: Summary",
  "views:",
  "  - type: table",
  "    name: Table",
  "    order:",
  "      - file.name",
  "      - note.summary",
  "",
].join("\n");

test("a link inside a free-text database cell opens its target while tapping plain text opens the cell editor", async ({ page, context }) => {
  const sql = await installSqlBridge(context);
  await context.addInitScript(() => {
    const w = window as Window & { __opened?: string[] };
    w.__opened = [];
    window.open = ((url?: string | URL) => {
      w.__opened!.push(String(url));
      return null;
    }) as typeof window.open;
    localStorage.setItem("CapacitorStorage.mobile-settings", JSON.stringify({ onboarded: true, language: "en", motion: "off" }));
  });
  try {
    await open(page, [
      ["vault/Links.base", linksBase],
      ["vault/Items/Row.md", '---\nsummary: "See [[Target]] or https://plainva.com/guide"\n---\n# Row\n'],
      ["vault/Target.md", "# Target\n\nReached directly from the cell.\n"],
    ]);
    await page.getByText(/^Links$/).first().click();
    const cell = page.locator("table.m-basetable tbody td").nth(1);
    await expect(cell).toContainText("See Target or https://plainva.com/guide", { timeout: 20000 });

    // Tapping plain text opens the cell editor sheet.
    await cell.locator("span", { hasText: "See " }).first().click();
    await expect(page.locator(".m-sheet").filter({ hasText: "summary" })).toBeVisible();
    await page.locator(".m-sheet-backdrop").last().click({ position: { x: 5, y: 5 } });

    // Tapping a bare URL inside free text opens it directly without the sheet.
    await cell.locator("a.pv-web-link", { hasText: "https://plainva.com/guide" }).click();
    await expect.poll(() => page.evaluate(() => (window as Window & { __opened?: string[] }).__opened)).toEqual(["https://plainva.com/guide"]);

    // Tapping the wiki link follows it to Target.md.
    await cell.locator(".pv-web-link", { hasText: "Target" }).click();
    await expect(page.locator(".cm-content")).toContainText("Reached directly from the cell.", { timeout: 15000 });
  } finally {
    sql.close();
  }
});

const tplBase = [
  "filters:",
  "  and:",
  '    - file.folder == "Work"',
  "views:",
  "  - type: table",
  "    name: Table",
  "    order:",
  "      - file.name",
  "",
].join("\n");

test("the database Templates sheet lists assigned templates first and toggles plainva.templateFor", async ({ page, context }) => {
  const sql = await installSqlBridge(context);
  await context.addInitScript(settings);
  const read = reader(page);
  try {
    await open(page, [
      ["vault/Assigned.base", tplBase],
      ["vault/Work/One.md", "# One\n"],
      ["vault/Templates/AssignedTpl.md", '---\ntype: Note\nplainva:\n  templateFor:\n    - "[[Assigned.base]]"\n---\n# {{title}}\n'],
      ["vault/Templates/OtherTpl.md", "---\ntype: Note\n---\n# {{title}}\n"],
    ]);
    await page.getByText(/^Assigned$/).first().click();
    await page.getByTestId("base-templates").click({ timeout: 20000 });

    await expect(page.getByTestId("base-template-Templates/AssignedTpl.md")).toBeVisible();
    await expect(page.getByTestId("base-template-Templates/OtherTpl.md")).toHaveCount(0);

    await page.getByRole("button", { name: /Show all templates/ }).click();
    const otherRow = page.getByTestId("base-template-Templates/OtherTpl.md");
    await expect(otherRow).toBeVisible();
    await otherRow.getByTestId("base-template-assign").click();

    await expect.poll(() => read("vault/Templates/OtherTpl.md"), { timeout: 10000 }).toContain("Assigned.base");
  } finally {
    sql.close();
  }
});
