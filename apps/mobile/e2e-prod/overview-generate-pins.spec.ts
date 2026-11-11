import { test, expect, type Page } from "./clockedTest";
import { installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { waitForVaultDirectory, type MobileTestGlobals } from "./exampleVault";

/**
 * P21 (maintainer, 03.11.): a link that names an overview only as `index`
 * leads to whichever `index.md` the link rule finds first. Generating an
 * overview puts a new `index.md` into a folder and took such links over
 * without a word, as an adoption did before decision E10
 * (overview-adopt-pins.spec.ts): here a link in Projekte/ to the overview of
 * Other/ led to the new listing. "Create overview" - in the overviews list
 * and on a folder's sheet - asks first where that would happen, counted and
 * preset; generating in every folder without one counts the whole run once,
 * and the links are written before any overview exists. The desktop asks the
 * same (index-generate-pins.spec.ts).
 */
const FILES: Array<[string, string]> = [
  ["vault/Other/index.md", "# Other\n"],
  ["vault/Other/Note.md", "Up: [[index]]\n"],
  ["vault/Projekte/Plan.md", "See [[index]].\n"],
  ["vault/Bereich/Note.md", "Back: [x](index.md)\n"],
];

async function openVault(page: Page) {
  await page.goto("/");
  await waitForVaultDirectory(page);
  await page.evaluate(async (entries) => {
    const fs = (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem;
    for (const [path, data] of entries) await fs.writeFile({ path, data, directory: "DATA", encoding: "utf8", recursive: true });
  }, FILES);
  await page.reload();
  await waitForVaultDirectory(page);
}

async function openOverviews(page: Page) {
  await page.locator('[data-testid="nav-settings"]').first().click();
  await page.getByTestId("settings-area-maintenance").click();
  await page.getByTestId("open-overviews").click();
  await expect(page.getByTestId("overview-row-Projekte")).toContainText("Projekte", { timeout: 15_000 });
}

const read = (page: Page) =>
  page.evaluate(async () => {
    const fs = (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem;
    const one = (path: string) => fs.readFile({ path, directory: "DATA", encoding: "utf8" }).then((r) => String(r.data), () => null);
    return {
      plan: await one("vault/Projekte/Plan.md"),
      other: await one("vault/Other/Note.md"),
      bereich: await one("vault/Bereich/Note.md"),
      index: await one("vault/Projekte/index.md"),
      rootIndex: await one("vault/index.md"),
      bereichIndex: await one("vault/Bereich/index.md"),
    };
  });

test.beforeEach(async ({ page, context }) => {
  await page.addLocatorHandler(page.getByTestId("whats-new-sheet"), async () => page.getByTestId("whats-new-close").click());
  await context.addInitScript(() => localStorage.setItem("CapacitorStorage.mobile-settings", JSON.stringify({ onboarded: true, language: "en", motion: "off" })));
});

test("Create overview in the overviews list offers to write the links to other overviews with their folder, and does", async ({ page, context }, testInfo) => {
  test.setTimeout(90_000);
  const sql = await installSqlBridge(context);
  try {
    await openVault(page);
    await openOverviews(page);
    await page.getByTestId("overview-row-Projekte").getByRole("button", { name: "Create overview" }).click();

    const offer = page.getByTestId("confirm-option");
    await expect(offer).toBeChecked({ timeout: 15_000 });
    // One link tips over: the one in Projekte/. Other/ keeps its own overview,
    // and from Bereich/ the shorter path still answers.
    await expect(page.locator(".m-sheet-option").filter({ has: offer })).toContainText("Write links to other overviews with their folder, so they keep leading there (1)");
    await expect(page.locator(".m-sheet")).toContainText("A link that names an overview only as “index” would lead to the new one.");
    await page.screenshot({ path: testInfo.outputPath("m-overview-generate-pin-offer.png") });
    await page.getByTestId("confirm-act").click();

    await expect(page.locator(".pv-toast", { hasText: "1 overview written (Links to other overviews written with their folder: 1)" })).toBeVisible({ timeout: 15_000 });
    const files = await read(page);
    expect(files.plan).toBe("See [[Other/index]].\n");
    expect(files.index).toContain("# Projekte");
    expect(files.other).toBe("Up: [[index]]\n");
    expect(files.bereich).toBe("Back: [x](index.md)\n");
  } finally {
    sql.close();
  }
});

test("a folder's sheet asks the same; a cancel writes no overview", async ({ page, context }) => {
  test.setTimeout(90_000);
  const sql = await installSqlBridge(context);
  try {
    await openVault(page);
    const folder = page.getByRole("button", { name: /^Projekte/ }).first();
    await expect(folder).toBeVisible({ timeout: 20_000 });
    await folder.dispatchEvent("contextmenu");
    await page.locator(".m-sheet").getByTestId("sheet-overview").click();
    await expect(page.getByTestId("confirm-option")).toBeChecked({ timeout: 15_000 });
    await expect(page.locator(".m-sheet")).toContainText("(1)");
    await page.getByTestId("confirm-safe").click();
    await expect(page.getByTestId("confirm-option")).toHaveCount(0);
    let files = await read(page);
    expect(files.index).toBeNull();
    expect(files.plan).toBe("See [[index]].\n");

    await folder.dispatchEvent("contextmenu");
    await page.locator(".m-sheet").getByTestId("sheet-overview").click();
    await expect(page.getByTestId("confirm-option")).toBeChecked({ timeout: 15_000 });
    await page.getByTestId("confirm-act").click();
    await expect(page.locator(".pv-toast", { hasText: "(Links to other overviews written with their folder: 1)" })).toBeVisible({ timeout: 15_000 });
    files = await read(page);
    expect(files.plan).toBe("See [[Other/index]].\n");
    expect(files.index).toContain("# Projekte");
  } finally {
    sql.close();
  }
});

test("generating in every folder without an overview counts the whole run once and writes the links first", async ({ page, context }, testInfo) => {
  test.setTimeout(90_000);
  const sql = await installSqlBridge(context);
  try {
    await openVault(page);
    await openOverviews(page);
    await page.getByTestId("overviews-all-missing").click();

    // The vault's root, Projekte and Bereich get one. The root's takes every
    // bare link - Other/'s own included - so all three are offered, in one count.
    const offer = page.getByTestId("confirm-option");
    await expect(offer).toBeChecked({ timeout: 15_000 });
    await expect(page.locator(".m-sheet-option").filter({ has: offer })).toContainText("Write links to other overviews with their folder, so they keep leading there (3)");
    await expect(page.locator(".m-sheet")).toContainText("A link that names an overview only as “index” would lead to one of the new ones.");
    await page.screenshot({ path: testInfo.outputPath("m-overview-generate-all-pin-offer.png") });
    await page.getByTestId("confirm-act").click();

    await expect(page.locator(".pv-toast", { hasText: "3 overviews written (Links to other overviews written with their folder: 3)" })).toBeVisible({ timeout: 20_000 });
    const files = await read(page);
    expect(files.plan).toBe("See [[Other/index]].\n");
    expect(files.other).toBe("Up: [[Other/index]]\n");
    expect(files.bereich).toBe("Back: [x](../Other/index.md)\n");
    expect(files.index).not.toBeNull();
    expect(files.rootIndex).not.toBeNull();
    expect(files.bereichIndex).not.toBeNull();
  } finally {
    sql.close();
  }
});
