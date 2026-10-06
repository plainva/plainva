import { test, expect } from "@playwright/test";
import { installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { waitForVaultDirectory, type MobileTestGlobals } from "./exampleVault";

test("folder bookmarks import into the navigator and follow nested rename and move", async ({ page, context }) => {
  test.setTimeout(90_000);
  await page.addLocatorHandler(page.getByTestId("whats-new-sheet"), async () => page.getByTestId("whats-new-close").click());
  const sql = await installSqlBridge(context);
  await context.addInitScript(() => localStorage.setItem("CapacitorStorage.mobile-settings", JSON.stringify({ onboarded: true, language: "en", motion: "off" })));
  try {
    await page.goto("/"); await waitForVaultDirectory(page);
    const source = JSON.stringify({ items: [{ type: "group", items: [{ type: "folder", path: "Projects/Sub" }, { type: "file", path: "Projects/Sub/Note.md" }, { type: "folder", path: "Gone" }] }] });
    await page.evaluate(async source => {
      const fs = (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem;
      for (const [path, data] of [["Projects/Sub/Note.md", "# Note"], ["Archive/Other.md", "# Other"], [".obsidian/bookmarks.json", source]]) await fs.writeFile({ path: "vault/" + path, data, directory: "DATA", encoding: "utf8", recursive: true });
    }, source);
    await page.reload();
    const chip = (name: string) => page.locator(".m-chiprow .pv-chip-open").filter({ hasText: name });
    await expect(chip("Sub")).toBeVisible();
    await expect(chip("Gone")).toHaveAttribute("aria-disabled", "true");
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: test.info().outputPath("bookmarks-mobile.png") });
    await chip("Sub").click();
    await expect(page.getByRole("button", { name: /^Note/ }).first()).toBeVisible();
    await page.getByRole("button", { name: /^Back$/ }).click();
    await page.getByRole("button", { name: /^Projects/ }).first().click();
    await page.getByRole("button", { name: /^Sub/ }).first().dispatchEvent("contextmenu");
    await page.locator(".m-sheet").getByRole("button", { name: /Rename/ }).click();
    await page.locator(".m-sheet").getByRole("textbox").fill("Renamed");
    await page.locator(".m-sheet").getByRole("button", { name: /OK|Confirm/ }).click();
    const read = () => page.evaluate(async () => JSON.parse(String((await (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem.readFile({ path: "vault/.plainva/bookmarks.json", directory: "DATA", encoding: "utf8" })).data)).items);
    await expect.poll(read).toContainEqual({ type: "folder", path: "Projects/Renamed" });
    await page.getByRole("button", { name: /^Renamed/ }).first().dispatchEvent("contextmenu");
    await page.locator(".m-sheet").getByRole("button", { name: /Move/ }).click();
    await page.locator(".m-sheet").getByRole("button", { name: "Archive", exact: true }).click();
    await page.locator(".m-sheet").getByRole("button", { name: /Use this folder/ }).click();
    await expect.poll(read).toContainEqual({ type: "folder", path: "Archive/Renamed" });
    await expect.poll(read).toContainEqual({ type: "file", path: "Archive/Renamed/Note.md" });
    expect(await page.evaluate(async () => (await (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem.readFile({ path: "vault/.obsidian/bookmarks.json", directory: "DATA", encoding: "utf8" })).data)).toBe(source);
    await page.getByRole("button", { name: /^Back$/ }).click();
    await expect(chip("Renamed")).toBeVisible();
    await chip("Gone").locator("..").getByRole("button", { name: /Remove bookmark/ }).click();
    await expect(chip("Gone")).toHaveCount(0);
  } finally { sql.close(); }
});

test("bookmarks are arranged with the grip at a row's end, and the order is the file's (plan Befunde 2026-10-06, W6)", async ({ page, context }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addLocatorHandler(page.getByTestId("whats-new-sheet"), async () => page.getByTestId("whats-new-close").click());
  const sql = await installSqlBridge(context);
  await context.addInitScript(() => localStorage.setItem("CapacitorStorage.mobile-settings", JSON.stringify({ onboarded: true, language: "en", motion: "off" })));
  try {
    await page.goto("/"); await waitForVaultDirectory(page);
    const items = [{ type: "file", path: "Alpha.md" }, { type: "folder", path: "Projects" }, { type: "file", path: "Beta.md" }, { type: "file", path: "Gamma.md" }];
    await page.evaluate(async (source) => {
      const fs = (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem;
      for (const [path, data] of [["Alpha.md", "# Alpha"], ["Beta.md", "# Beta"], ["Gamma.md", "# Gamma"], ["Projects/Plan.md", "# Plan"], [".plainva/bookmarks.json", source]]) await fs.writeFile({ path: "vault/" + path, data, directory: "DATA", encoding: "utf8", recursive: true });
    }, JSON.stringify({ items }));
    await page.reload();
    await expect(page.locator(".m-tabbar")).toBeVisible({ timeout: 20_000 });
    // The navigator shows the bookmarks as a band that scrolls sideways; the
    // one action at its heading opens the list in which they are arranged.
    const chips = page.locator(".m-chiprow .pv-chip-open");
    await expect(chips).toHaveText(["Alpha", "Projects", "Beta", "Gamma"]);
    await page.getByTestId("bookmarks-arrange").click();

    const rows = page.getByTestId("bookmarks-list").locator("[data-bookmark-row]");
    const order = () => rows.evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.bookmarkKey));
    const onDisk = () => page.evaluate(async () => (JSON.parse(String((await (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem.readFile({ path: "vault/.plainva/bookmarks.json", directory: "DATA", encoding: "utf8" })).data)).items as Array<{ type: string; path: string }>).map((item) => `${item.type}:${item.path}`));
    await expect(rows).toHaveCount(4);
    expect(await order()).toEqual(["file:Alpha.md", "folder:Projects", "file:Beta.md", "file:Gamma.md"]);

    // Every row carries a grip a finger can hit; the grip, not the row, starts the drag.
    const grips = page.getByTestId("bookmark-grip");
    await expect(grips).toHaveCount(4);
    expect((await grips.first().boundingBox())!.height).toBeGreaterThanOrEqual(44);

    // Drag the last entry in front of the first.
    const from = (await grips.nth(3).boundingBox())!;
    const first = (await rows.nth(0).boundingBox())!;
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2, from.y - 20, { steps: 4 });
    await expect(rows.nth(3)).toHaveClass(/is-dragging/);
    await page.mouse.move(from.x + from.width / 2, first.y + 4, { steps: 8 });
    await expect(rows.nth(0)).toHaveClass(/is-drop-before/);
    await page.mouse.up();
    await expect.poll(order).toEqual(["file:Gamma.md", "file:Alpha.md", "folder:Projects", "file:Beta.md"]);
    await expect.poll(onDisk).toEqual(["file:Gamma.md", "file:Alpha.md", "folder:Projects", "file:Beta.md"]);

    // A drop behind the last row goes to the end; files and folders keep their kind.
    const top = (await grips.nth(0).boundingBox())!;
    const last = (await rows.nth(3).boundingBox())!;
    await page.mouse.move(top.x + top.width / 2, top.y + top.height / 2);
    await page.mouse.down();
    await page.mouse.move(top.x + top.width / 2, last.y + last.height - 3, { steps: 10 });
    await expect(rows.nth(3)).toHaveClass(/is-drop-after/);
    await page.mouse.up();
    await expect.poll(onDisk).toEqual(["file:Alpha.md", "folder:Projects", "file:Beta.md", "file:Gamma.md"]);

    // One more move, then back: the band in the navigator shows the new order —
    // it is the file's, not this screen's.
    const second = (await grips.nth(1).boundingBox())!;
    const head = (await rows.nth(0).boundingBox())!;
    await page.mouse.move(second.x + second.width / 2, second.y + second.height / 2);
    await page.mouse.down();
    await page.mouse.move(second.x + second.width / 2, head.y + 4, { steps: 8 });
    await page.mouse.up();
    await expect.poll(onDisk).toEqual(["folder:Projects", "file:Alpha.md", "file:Beta.md", "file:Gamma.md"]);
    await page.getByRole("button", { name: /^Back$/ }).click();
    await expect(chips).toHaveText(["Projects", "Alpha", "Beta", "Gamma"]);
    expect(errors).toEqual([]);
  } finally { sql.close(); }
});
