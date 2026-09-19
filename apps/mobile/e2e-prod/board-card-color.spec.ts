import { test, expect } from "@playwright/test";
import { installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { waitForVaultDirectory, type MobileTestGlobals } from "./exampleVault";

/**
 * A board card takes the NOTE's colour (finding 2026-09-19: "colour the whole
 * card, like on the pinboard").
 *
 * The handbook says a note's colour "applies everywhere the note appears"; the
 * board drew every card on the plain ground. Against the real index: one note
 * with its own colour, one without (coloured by the view's colour-by property
 * instead), one with neither — and the column head as a chip, like the
 * desktop's, instead of a dot and a label.
 */
const BASE = `filters:
  and:
    - file.folder == "Jobs"
properties:
  note.status:
    displayName: Status
    plainva:
      input: select
      options:
        - value: Open
          color: teal
        - value: Done
          color: gray
  note.priority:
    displayName: Priority
    plainva:
      input: select
      options:
        - value: High
          color: coral
        - value: Low
          color: gray
views:
  - type: table
    name: Board
    order:
      - note.status
      - note.priority
    plainva:
      render: board
      groupBy: status
      colorBy: priority
`;

const note = (title: string, fields: Record<string, string>, color?: string) =>
  `---\n${Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join("\n")}\n${color ? `plainva:\n  header_color: "${color}"\n` : ""}---\n# ${title}\n`;

test("a board card is tinted by the note's own colour first, then by the colour-by property", async ({ page, context }) => {
  const sql = await installSqlBridge(context);
  await context.addInitScript(() => localStorage.setItem("CapacitorStorage.mobile-settings", JSON.stringify({ onboarded: true, language: "en", motion: "off" })));
  const files: Array<[string, string]> = [
    ["vault/Jobboard.base", BASE],
    ["vault/Jobs/Own colour.md", note("Own colour", { status: "Open", priority: "High" }, "#2f6f8f")],
    ["vault/Jobs/By priority.md", note("By priority", { status: "Open", priority: "High" })],
    ["vault/Jobs/Plain.md", note("Plain", { status: "Open" })],
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

    // Into the database through the file list of the vault's root.
    await page.getByText(/^Jobboard$/).first().click();

    const card = (title: string) => page.locator(`.m-basecard[data-row-title="${title}"]`);
    await expect(card("Own colour")).toBeVisible({ timeout: 20000 });

    // The note's own colour wins over the property's.
    await expect(card("Own colour")).toHaveAttribute("data-card-color", "#2f6f8f");
    // No own colour: the option colour of "priority" (coral).
    await expect(card("By priority")).toHaveAttribute("data-card-color", "#d85a30");
    // Neither: a plain card.
    expect(await card("Plain").getAttribute("data-card-color")).toBeNull();

    const backgrounds = await page.evaluate(() =>
      Object.fromEntries([...document.querySelectorAll<HTMLElement>(".m-basecard")].map((el) => [el.dataset.rowTitle, getComputedStyle(el).backgroundColor])),
    );
    expect(backgrounds["Own colour"]).not.toBe(backgrounds["Plain"]);
    expect(backgrounds["By priority"]).not.toBe(backgrounds["Plain"]);
    expect(backgrounds["Own colour"]).not.toBe(backgrounds["By priority"]);

    // The column head is the group's coloured chip, as on the desktop (E4).
    await expect(page.getByTestId("board-col-chip").first()).toHaveText("Open");
  } finally {
    sql.close();
  }
});
