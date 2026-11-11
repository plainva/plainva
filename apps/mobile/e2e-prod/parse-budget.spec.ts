import { test, expect, type Page } from "./clockedTest";
import { installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { waitForVaultDirectory, type MobileTestGlobals } from "./exampleVault";

/**
 * The parse budget on the phone (open-items plan 3.133 no. 4). The phone reads
 * a note in its editor, and its outline and journal read the note source: a
 * line of 100 000 `]`, 1 250 short lines of them without a blank line, a long
 * run of `*a` or a table of 6 000 rows held the parsers for minutes. Each
 * note here opens, shows its last line and leaves the page answering — within
 * a budget the old parse exceeded by far. The desktop holds the same in
 * `apps/desktop/e2e/parse-budget.spec.ts`.
 *
 * And what a note fetches from the web (decision E1, open-items plan 3.79):
 * the editor loads a picture a note embeds from the web, on the phone as on
 * the desktop — which is why a filed mail must not carry one in.
 *
 * No request leaves localhost: a request to the web is recorded and refused.
 */

const around = (stretch: string) => `# Title\n\nBefore [[Kept]] and *em*.\n\n${stretch}\n\n## After\n\nThe end.\n`;
const NOTES: Record<string, string> = {
  "LongLine.md": around("]".repeat(100_000)),
  "ShortLines.md": around(Array.from({ length: 1_250 }, () => "]".repeat(80)).join("\n")),
  "Emphasis.md": around("*a".repeat(150_000)),
  "BigTable.md": around(["| a | b |", "|---|---|", ...Array.from({ length: 6_000 }, (_, i) => `| row ${i} | [[n${i}]] |`)].join("\n")),
  "Remote.md": [
    "# Remote",
    "",
    "![pixel](https://tracker.example.org/md.png)",
    "",
    "![[https://tracker.example.org/wiki.png]]",
    "",
    '<img src="https://tracker.example.org/html.png">',
    "",
    "![ref][r]",
    "",
    "[r]: https://tracker.example.org/ref.png",
    "",
    "The end.",
    "",
  ].join("\n"),
};

async function openVaultWith(page: Page, files: Record<string, string>) {
  await page.goto("/");
  await waitForVaultDirectory(page);
  await page.evaluate(async (all) => {
    const fs = (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem;
    for (const [path, data] of Object.entries(all)) await fs.writeFile({ path: `vault/${path}`, data, directory: "DATA", encoding: "utf8", recursive: true });
  }, files);
  await page.reload();
  await expect(page.locator("#root > *").first()).toBeVisible();
  const close = page.getByTestId("whats-new-close");
  await expect(close).toBeVisible({ timeout: 15_000 });
  await close.click();
}

async function openNote(page: Page, title: string) {
  // A row reads "<title> <when>"; the titles here share no beginning.
  await page.locator(".m-swipe-front").filter({ hasText: title }).first().click({ timeout: 30_000 });
  await expect(page.locator(".cm-content").first()).toBeVisible({ timeout: 30_000 });
}

/** How long the page takes to answer a script: a frozen main thread does not. */
async function answers(page: Page): Promise<number> {
  const start = performance.now();
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve(null))));
  return performance.now() - start;
}

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => localStorage.setItem("CapacitorStorage.mobile-settings", JSON.stringify({ onboarded: true, language: "en", motion: "off" })));
});

for (const name of ["LongLine", "ShortLines", "Emphasis", "BigTable"]) {
  test(`${name}: opens and reads to its end in a moment, the stretch as written`, async ({ page, context }, testInfo) => {
    test.setTimeout(150_000);
    const sql = await installSqlBridge(context);
    try {
      await openVaultWith(page, { [`${name}.md`]: NOTES[`${name}.md`] });
      const start = performance.now();
      await openNote(page, name);
      const editor = page.locator(".cm-content").first();
      await expect(editor.getByText("Title").first()).toBeVisible({ timeout: 30_000 });
      // To the end of the note: the editor's parser has to read through the stretch.
      await page.locator(".cm-scroller").first().evaluate((el) => { el.scrollTop = el.scrollHeight; });
      await expect(editor.getByText("The end.")).toBeVisible({ timeout: 30_000 });
      expect(await answers(page)).toBeLessThan(5_000);
      // The old parse took minutes for each of these notes; a generous budget for the whole way.
      expect(performance.now() - start).toBeLessThan(60_000);
      if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: testInfo.outputPath(`parse-budget-${name}.png`) });
    } finally {
      await sql.close();
    }
  });
}

test("a picture from the web in a note: the editor fetches it, HTML in the note fetches nothing", async ({ page, context }, testInfo) => {
  test.setTimeout(90_000);
  const origin = new URL(test.info().project.use.baseURL ?? "http://localhost:4174").origin;
  const fetched: string[] = [];
  await context.route((url) => url.origin !== origin, (route) => {
    const url = new URL(route.request().url());
    if (url.host === "tracker.example.org") fetched.push(url.pathname);
    return route.abort("blockedbyclient");
  });
  const sql = await installSqlBridge(context);
  try {
    await openVaultWith(page, { "Remote.md": NOTES["Remote.md"] });
    await openNote(page, "Remote");
    await expect(page.locator(".cm-content").first().getByText("The end.")).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => [...new Set(fetched)].sort(), { timeout: 15_000 }).toEqual(["/md.png", "/wiki.png"]);
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: testInfo.outputPath("remote-phone.png") });
  } finally {
    await sql.close();
  }
});
