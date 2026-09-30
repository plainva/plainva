import { test, expect } from "@playwright/test";
import { installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { waitForVaultDirectory } from "./exampleVault";

/**
 * "My theme" on the phone: the mood being edited is the mood the app wears
 * (plan Befunde 2026-09-24, E22).
 *
 * The finding: switching the mood only changed the small preview card, so
 * work on the other mood was invisible whenever Mode disagreed. Against the
 * production build: a design with only its dark mood adopted pins Mode — the
 * Appearance screen now shows that and says where the other mood comes from
 * (it used to take the tap on "Light" without a word). On "My theme" the
 * whole app follows the mood row there and back, a proposal included, and
 * leaving the screen brings the stored look back without having written
 * anything.
 */
const KEY = "CapacitorStorage.mobile-settings";
const DARK = { mode: "dark", background: "#1c1815", accent: "#e58a5e", fontUi: "", radius: "normal" };

test("the whole app wears the mood being edited, there and back, and leaving restores Mode", async ({ page, context }) => {
  const sql = await installSqlBridge(context);
  await context.addInitScript(({ key, dark }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({
      onboarded: true, language: "en", motion: "off",
      themeName: "custom", themeMode: "dark",
      customTheme: { version: 2, radius: "normal", light: null, dark },
    }));
  }, { key: KEY, dark: DARK });
  try {
    await page.goto("/");
    await waitForVaultDirectory(page);
    await expect(page.locator("#root > *").first()).toBeVisible();
    const close = page.getByTestId("whats-new-close");
    await expect(close).toBeVisible({ timeout: 15000 });
    await close.click();

    const html = page.locator("html");
    const ground = () => page.evaluate(() => document.documentElement.style.getPropertyValue("--bg-primary"));
    const stored = () => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "{}"), KEY);
    await expect(html).toHaveAttribute("data-theme", "dark");
    expect(await ground()).toBe(DARK.background);

    await page.locator('[data-testid="nav-settings"]').first().click();
    await page.locator('[data-testid="settings-area-appearance"]').click();
    // One adopted mood pins Mode: the choice shows it, takes no tap, and says why.
    const modes = page.getByRole("radiogroup", { name: "Appearance" });
    await expect(modes.getByRole("radio", { name: "Dark" })).toHaveAttribute("aria-checked", "true");
    await expect(modes.getByRole("radio", { name: "Light" })).toBeDisabled();
    await expect(page.getByTestId("theme-mode-pinned")).toHaveText("Adopt the other mood under My theme.");

    await page.getByTestId("theme-card-custom-edit").click();
    const row = page.getByTestId("custom-theme-mood");
    const banner = page.getByTestId("custom-theme-preview-banner");
    // It starts on the mood the app shows.
    await expect(row).toContainText("Dark");
    await expect(banner).toHaveText("Preview: the app shows the dark mood while this page is open.");

    const pick = async (label: "Light" | "Dark") => {
      await row.click();
      await page.locator(".m-sheet").getByText(label, { exact: true }).click();
      await expect(row).toContainText(label);
    };
    // There and back, twice: the whole app follows, the proposal included.
    await pick("Light");
    await expect(html).toHaveAttribute("data-theme", "light");
    const proposal = await ground();
    expect(proposal).not.toBe(DARK.background);
    await expect(page.getByTestId("custom-theme-adopt-mood")).toBeVisible();
    await expect(banner).toHaveText("Preview: the app shows the light mood while this page is open. Afterwards, Mode applies again: Dark.");
    await pick("Dark");
    await expect(html).toHaveAttribute("data-theme", "dark");
    expect(await ground()).toBe(DARK.background);
    await pick("Light");
    await expect(html).toHaveAttribute("data-theme", "light");
    expect(await ground()).toBe(proposal);
    await page.screenshot({ path: test.info().outputPath("my-theme-preview-light.png") });

    // Leaving the screen brings the stored look back; nothing was written.
    await page.getByRole("button", { name: /^Back$/ }).first().click();
    await expect(page.getByTestId("theme-card-custom-edit")).toBeVisible();
    await expect(html).toHaveAttribute("data-theme", "dark");
    expect(await ground()).toBe(DARK.background);
    const after = await stored();
    expect(after.themeMode).toBe("dark");
    expect(after.customTheme.light).toBeNull();
    expect(after.customTheme.dark.background).toBe(DARK.background);
  } finally { sql.close(); }
});
