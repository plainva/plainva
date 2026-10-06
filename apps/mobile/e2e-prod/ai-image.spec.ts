import { test, expect, type Page } from "@playwright/test";
import { installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { waitForVaultDirectory, type MobileTestGlobals } from "./exampleVault";

/**
 * "Explain image" on the phone (AI harness P4-5), in the production bundle.
 * The door stands below an opened picture while the AI is on. Before
 * anything is sent, the overview shows the picture as it would go — drawn,
 * scaled down and encoded anew by this web view, which is the code path the
 * phones run. And a picture that a note kept from the cloud shows stays on
 * the device: the viewer no longer knows the note, so the app looks up which
 * notes embed the picture — against the real index here, whose text scan the
 * desktop suite only mocks.
 *
 * The model itself is the native `AiNet` plugin, which a browser does not
 * have: what reaches a provider is held by the session tests and by the
 * desktop suite's scripted model.
 */

const BOARD =
  '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000" font-family="sans-serif"><rect width="1600" height="1000" fill="#f7f5ef"/><g stroke="#333" stroke-width="4"><line x1="540" y1="60" x2="540" y2="940"/><line x1="1070" y1="60" x2="1070" y2="940"/></g><g font-size="56" fill="#222"><text x="80" y="120">Now</text><text x="600" y="120">Next</text><text x="1130" y="120">Later</text></g><g font-size="34"><rect x="70" y="180" width="400" height="150" fill="#ffe27a"/><text x="90" y="265">Offer Northwind</text><rect x="600" y="180" width="400" height="150" fill="#a7d8ff"/><text x="620" y="265">Kickoff 14 Nov</text><rect x="1130" y="180" width="400" height="150" fill="#c9f0b5"/><text x="1150" y="265">Retrospective</text></g></svg>';
const SCAN = '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1100"><rect width="800" height="1100" fill="white"/><text x="60" y="120" font-size="48">Lab results</text></svg>';
const DENY = "---\nplainva:\n  ai:\n    cloud: deny\n---\n";

const FILES: Array<[path: string, data: string]> = [
  ["Board.md", "# Board\n\n![[Whiteboard kickoff.svg]]\n\nAfter the picture.\n"],
  ["Whiteboard kickoff.svg", BOARD],
  // Kept from the cloud by the note's own rule; the pictures sit in a folder without a rule.
  ["Private.md", `${DENY}# Private\n\n![[Scan 1.svg]]\n\nAfter the scan.\n`],
  ["Attachments/Scan 1.svg", SCAN],
  // The same, written as a Markdown image with an encoded name: no link in the index, found in the text.
  ["Private two.md", `${DENY}# Private two\n\n![the scan](Attachments/Scan%202.svg)\n\nAfter the scan.\n`],
  ["Attachments/Scan 2.svg", SCAN],
];

async function start(page: Page, ai: Record<string, unknown> | null) {
  await page.addLocatorHandler(page.getByTestId("whats-new-sheet"), async () => page.getByTestId("whats-new-close").click());
  await page.context().addInitScript((settings) => {
    localStorage.setItem("CapacitorStorage.mobile-settings", JSON.stringify({ onboarded: true, language: "en", motion: "off" }));
    // The AI is opt-in per device: switched on here, with a model chosen, as the settings would store it.
    if (settings) localStorage.setItem("CapacitorStorage.ai", JSON.stringify(settings));
  }, ai);
  await page.goto("/");
  await waitForVaultDirectory(page);
  await page.evaluate(async (files) => {
    const fs = (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem;
    for (const [path, data] of files) {
      // A picture is written as bytes, a note as text: the browser's file system keeps the two apart.
      await fs.writeFile({ path: `vault/${path}`, data: path.endsWith(".md") ? data : btoa(data), directory: "DATA", ...(path.endsWith(".md") ? { encoding: "utf8" as const } : {}), recursive: true });
    }
  }, FILES);
  await page.reload();
  await expect(page.locator("#root > *").first()).toBeVisible({ timeout: 20_000 });
}

/** Opens a note from the list, then its picture in the viewer. */
async function openPictureOf(page: Page, note: string) {
  await page.locator(".m-swipe-front").filter({ has: page.getByText(note, { exact: true }) }).first().click();
  const embed = page.locator(".pv-image-embed img");
  await expect(embed).toBeVisible();
  await expect.poll(() => embed.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Open image", exact: true }).click();
  await expect(page.getByTestId("image-zoom-stage")).toBeVisible();
}

const back = (page: Page) => page.getByRole("button", { name: /^Back$/ }).first().click();

/** Back to the list of notes. A reload closes the AI's sheet, and the session comes back on the screen it was left on. */
async function toList(page: Page) {
  await page.goto("/");
  await expect(page.locator("#root > *").first()).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(1500);
  for (let step = 0; step < 4; step++) {
    const button = page.getByRole("button", { name: /^Back$/ }).first();
    if (!(await button.isVisible().catch(() => false))) break;
    await button.click();
    await page.waitForTimeout(300);
  }
}
const AI_ON = { enabled: true, providers: ["anthropic"], profiles: { balanced: { providerId: "anthropic", model: "m-1" } } };

test("explain image: the overview shows the picture as it would go; a note kept from the cloud keeps its pictures", async ({ page, context }) => {
  test.setTimeout(90_000);
  const sql = await installSqlBridge(context);
  try {
    await start(page, AI_ON);

    // 1. The door stands below the opened picture, and the AI's sheet comes with the overview.
    await openPictureOf(page, "Board");
    await page.getByTestId("image-explain").click();
    const overview = page.getByTestId("ai-consent");
    await expect(overview).toBeVisible();
    // The picture as it would go: drawn by this web view at 1,568 pixels, as a PNG — the file is an SVG of 1,600.
    const shown = overview.getByTestId("ai-overview-pictures").locator("img");
    await expect(shown).toHaveCount(1);
    expect(await shown.getAttribute("src")).toMatch(/^data:image\/png;base64,/);
    await expect.poll(() => shown.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBe(1568);
    await expect(overview).toContainText("image, 1,568 × 980 px");
    await expect(overview).toContainText("without the place, the date or the camera the file records");
    // Listed with what else goes: a picture is a kind of data of its own.
    await expect(overview).toContainText("an image");
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: test.info().outputPath("ai-image-overview-mobile.png") });
    // Declined: nothing was sent, and no conversation was made of it.
    await overview.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(overview).toHaveCount(0);
    await expect(page.locator(".pv-ai-figure")).toHaveCount(0);

    // 2. A picture a note with "never to the cloud" embeds stays — asked at the opened picture, where no note is named.
    await toList(page);
    await openPictureOf(page, "Private");
    await page.getByTestId("image-explain").click();
    await expect(page.getByText("Your rules keep this image from this model", { exact: false })).toBeVisible();
    await expect(page.getByTestId("ai-consent")).toHaveCount(0);

    // 3. The same for a picture embedded the Markdown way, with its name encoded — opened from its folder, far from the note.
    await toList(page);
    await page.getByText("Attachments", { exact: true }).first().click();
    await page.getByText("Scan 2.svg", { exact: true }).first().click();
    await expect(page.getByTestId("image-zoom-stage")).toBeVisible();
    await page.getByTestId("image-explain").click();
    await expect(page.getByText("Your rules keep this image from this model", { exact: false })).toBeVisible();
    await expect(page.getByTestId("ai-consent")).toHaveCount(0);
  } finally {
    sql.close();
  }
});

test("explain image: no door while the AI is off", async ({ page, context }) => {
  const sql = await installSqlBridge(context);
  try {
    await start(page, null);
    await openPictureOf(page, "Board");
    await expect(page.getByTestId("image-explain")).toHaveCount(0);
    await back(page);
  } finally {
    sql.close();
  }
});
