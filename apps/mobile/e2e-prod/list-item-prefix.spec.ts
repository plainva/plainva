/* eslint-disable @typescript-eslint/no-explicit-any */
import { test, expect } from "@playwright/test";
import { installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { waitForVaultDirectory, type MobileTestGlobals } from "./exampleVault";

/**
 * List items the way many generators write Markdown, on the phone (finding
 * 2026-11-02): `*   item` and `4.  item` - several spaces after the marker -,
 * content starting with emphasis, an emoji or code, nested under ordered and
 * unordered items, after a line ending in emphasis. Every item keeps the
 * bullet of its level, and its wrapped lines start under the first letter of
 * its text. The phone's editor is the desktop's session; this pins it in the
 * production bundle at phone width.
 */
const WRAP = "and enough further words to wrap onto another display line on the phone";
const NOTE = [
  "# Items",
  "",
  "Intro sentence for the list.",
  "",
  "4.  **Fourth item with a bold title (~100–120 m²):**",
  `    *   *Italic lead-in:* Text after an italic lead-in ${WRAP}.`,
  "    *   *Second lead-in:* More text with **bold part** and an italic tail *(in parentheses ~6.000–8.000 €)*.",
  `    *   👉 **Bold summary line:** **ca. 7.300 €** *(italic remark ${WRAP})*.`,
  `    *   Plain sub item ${WRAP}.`,
  `        *   \`code\` lead ${WRAP}.`,
  "",
  `-   *Three spaces* after the dash ${WRAP}.`,
  `-   [ ] *Task* after three spaces ${WRAP}.`,
  "",
  "end",
].join("\n");

test("list items with several spaces after the marker keep their bullet and their wrapped lines start under the text", async ({ page, context }, testInfo) => {
  const sql = await installSqlBridge(context);
  await context.addInitScript(() => {
    const key = "CapacitorStorage.mobile-settings";
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ onboarded: true, language: "en", motion: "off" }));
  });
  try {
    await page.goto("/");
    await waitForVaultDirectory(page);
    await page.evaluate(async (data) => {
      await (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem.writeFile({ path: "vault/Items.md", data, directory: "DATA", encoding: "utf8", recursive: true });
    }, NOTE);
    await page.reload();
    await expect(page.locator("#root > *").first()).toBeVisible();
    const close = page.getByTestId("whats-new-close");
    await expect(close).toBeVisible({ timeout: 15000 });
    await close.click();
    await page.getByRole("button", { name: /^Search$/ }).first().click();
    await page.getByTestId("appbar-searchpage").locator("input").fill("Intro sentence for the list");
    await expect(page.locator("[data-search-occurrence]").first()).toContainText("Items");
    await page.locator("[data-search-occurrence]").first().click();
    await expect(page.locator(".cm-content .cm-md-bullet").first()).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(600);
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: testInfo.outputPath("list-items-phone.png") });

    const rows = await page.evaluate(() => {
      const content = document.querySelector(".cm-content") as unknown as { cmTile?: { root?: { view?: any } } };
      const view = content?.cmTile?.root?.view;
      if (!view) throw new Error("no editor view");
      const out: Array<{ text: string; bullet: string | null; box: boolean; bulletLeft: number | null; lineLeft: number; first: number | null; wrapped: number | null }> = [];
      const marker = /^(\s*)([-*+]|\d+[.)])( {1,4}|\t)(\[[ xX]\] +)?/;
      for (let n = 1; n <= view.state.doc.lines; n++) {
        const line = view.state.doc.line(n);
        const m = marker.exec(line.text);
        if (!m) continue;
        const start = line.from + m[0].length;
        const first = view.coordsAtPos(start, 1);
        let wrapped: number | null = null;
        for (let pos = start + 1; first && pos < line.to; pos++) {
          const c = view.coordsAtPos(pos, 1);
          if (c && c.top > first.top + 8) { wrapped = c.left; break; }
        }
        const dom = view.domAtPos(line.from).node as Node;
        const el = (dom.nodeType === 1 ? (dom as Element) : dom.parentElement)!.closest(".cm-line") as HTMLElement;
        const bullet = el.querySelector(".cm-md-bullet") as HTMLElement | null;
        out.push({ text: line.text.trim().slice(0, 24), bullet: bullet ? bullet.textContent : null, box: !!el.querySelector('.cm-md-task'), bulletLeft: bullet ? bullet.getBoundingClientRect().left : null, lineLeft: el.getBoundingClientRect().left, first: first ? first.left : null, wrapped });
      }
      return out;
    });
    console.log(JSON.stringify(rows));
    const expected: Array<[string, string]> = [
      ["*   *Italic lead-in:*", "◦"],
      ["*   *Second lead-in:*", "◦"],
      ["*   👉", "◦"],
      ["*   Plain sub item", "◦"],
      ["*   `code` lead", "▪"],
      ["-   *Three spaces*", "•"],
    ];
    for (const [start, glyph] of expected) {
      const row = rows.find((r) => r.text.startsWith(start));
      expect(row, start).toBeTruthy();
      expect(row!.bullet, start).toBe(glyph);
      expect(row!.bulletLeft!, start).toBeGreaterThanOrEqual(row!.lineLeft - 0.5);
      expect(row!.bulletLeft!, start).toBeLessThan(row!.first!);
    }
    const task = rows.find((r) => r.text.startsWith("-   [ ] *Task*"));
    expect(task).toBeTruthy();
    expect(task!.bullet).toBeNull();
    expect(task!.box).toBe(true);
    for (const row of rows) {
      if (row.wrapped === null) continue;
      expect(Math.abs(row.wrapped - row.first!), JSON.stringify(row)).toBeLessThanOrEqual(1.5);
    }
    expect(rows.filter((r) => r.wrapped !== null).length).toBeGreaterThanOrEqual(5);
  } finally { sql.close(); }
});
