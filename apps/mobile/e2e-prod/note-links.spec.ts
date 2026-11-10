import { test, expect, type Page } from "@playwright/test";
import { installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { waitForVaultDirectory, type MobileTestGlobals } from "./exampleVault";

/**
 * Note links on the phone (F2, ADR 0037): `plainva://open?…` arrives from the
 * system through Capacitor's `appUrlOpen` (Android intent filter, iOS URL
 * type) and opens the note at its heading; a note link clicked in a note opens
 * inside the app; the block sheet writes a block's id and copies the link;
 * the note's menu copies the note's address. The desktop's twin is
 * apps/desktop/e2e/note-links.spec.ts.
 */
const filler = Array.from({ length: 60 }, (_, i) => `Filler line ${i + 1}.`).join("\n\n");
const FILES: Array<[string, string]> = [
  ["vault/Plan.md", `# Plan\n\n${filler}\n\n## Goals\n\nShip the links.\n`],
  ["vault/Hub.md", "# Hub\n\nGo to [the goals](plainva://open?path=Plan.md&heading=Goals).\n\nFirst point to link\n"],
];

const line = (page: Page, text: string) => page.locator(".m-editor .cm-line", { hasText: text }).first();
const arrives = (page: Page, url: string) =>
  page.evaluate((address) => (globalThis as unknown as { Capacitor: { Plugins: { App: { notifyListeners(e: string, d: unknown): Promise<void> } } } }).Capacitor.Plugins.App.notifyListeners("appUrlOpen", { url: address }), url);

async function start(page: Page, context: Parameters<typeof installSqlBridge>[0]) {
  await page.addLocatorHandler(page.getByTestId("whats-new-sheet"), async () => page.getByTestId("whats-new-close").click());
  const sql = await installSqlBridge(context);
  await context.addInitScript(() => localStorage.setItem("CapacitorStorage.mobile-settings", JSON.stringify({ onboarded: true, language: "en", motion: "off" })));
  await page.goto("/");
  await waitForVaultDirectory(page);
  await page.evaluate(async (entries) => {
    const fs = (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem;
    for (const [path, data] of entries) await fs.writeFile({ path, data, directory: "DATA", encoding: "utf8", recursive: true });
  }, FILES);
  await page.reload();
  await expect(page.locator(".m-swipe-front").filter({ has: page.getByText("Hub", { exact: true }) }).first()).toBeVisible({ timeout: 20000 });
  return sql;
}

test("a note link from the system opens the note at its heading; one clicked in a note too", async ({ page, context }, testInfo) => {
  test.setTimeout(90_000);
  const sql = await start(page, context);
  try {
    await arrives(page, "plainva://open?path=Plan.md&heading=Goals");
    await expect(line(page, "Ship the links")).toBeInViewport({ timeout: 20000 });
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: testInfo.outputPath("phone-arrived.png") });

    // An address the app cannot read says so and opens nothing.
    await arrives(page, "plainva://open?path=..%2Fsecret.md");
    await expect(page.locator(".pv-toast").filter({ hasText: "Plainva can't open this link." })).toBeVisible();

    await page.getByRole("button", { name: "Back" }).first().click();
    await page.locator(".m-swipe-front").filter({ has: page.getByText("Hub", { exact: true }) }).first().click();
    await page.locator(".m-editor .cm-line", { hasText: "Go to" }).getByText("the goals").click();
    await expect(line(page, "Ship the links")).toBeInViewport({ timeout: 20000 });
  } finally {
    sql.close();
  }
});

test("the note menu copies the note's address; the block sheet writes an id and copies [[Hub#^id]]", async ({ page, context }, testInfo) => {
  test.setTimeout(90_000);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const sql = await start(page, context);
  try {
    await page.locator(".m-swipe-front").filter({ has: page.getByText("Hub", { exact: true }) }).first().click();
    await expect(line(page, "First point to link")).toBeVisible({ timeout: 20000 });
    // The note's menu, while reading: its address.
    await page.getByTestId("note-menu").click();
    await page.getByTestId("note-copy-link").click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toMatch(/^plainva:\/\/open\?vault=[^&]+&path=Hub\.md$/);
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: testInfo.outputPath("phone-copied.png") });
    // The block handles belong to editing, as on the device: a note opens for reading.
    await page.getByRole("button", { name: "Edit" }).click();
    // The block handle's event, as the shared plugin dispatches it.
    const from = FILES[1][1].indexOf("First point");
    await page.evaluate((at) => window.dispatchEvent(new CustomEvent("plainva-open-block-menu", { detail: { from: at, x: 100, y: 300 } })), from);
    await expect(page.getByTestId("block-copy-block-link")).toBeVisible();
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: testInfo.outputPath("phone-block-sheet.png") });
    await page.getByTestId("block-copy-block-link").click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toMatch(/^\[\[Hub#\^[a-z0-9]{6}\]\]$/);
    const id = /\^([a-z0-9]{6})/.exec(await page.evaluate(() => navigator.clipboard.readText()))![1];
    await expect(line(page, "First point to link")).toContainText(`^${id}`);
    await expect(page.locator(".pv-toast").filter({ hasText: "Link copied." }).first()).toBeVisible();
  } finally {
    sql.close();
  }
});
