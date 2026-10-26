import { test, expect } from "@playwright/test";
import { installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { waitForVaultDirectory } from "./exampleVault";

/**
 * A vault that does not open is never a blank screen (issue 143).
 *
 * The reporter connected a folder vault on Android and got an empty window for
 * good: the shell rendered an empty container while it had no vault, and the
 * boot had no failure branch. In the web bundle a vault in a picked folder
 * cannot open at all — the folder plugin has no web side — which makes it the
 * real failing boot the phone met, without a fake. The app starts with that
 * vault active: the window has to say which vault failed and why, and lead to
 * another one.
 */
test("a vault that does not open says why and leads to another vault", async ({ page, context }) => {
  const sql = await installSqlBridge(context);
  await context.addInitScript(() => {
    localStorage.setItem("CapacitorStorage.mobile-settings", JSON.stringify({ onboarded: true, language: "en", motion: "off" }));
    if (!localStorage.getItem("CapacitorStorage.vault_registry")) {
      localStorage.setItem("CapacitorStorage.vault_registry", JSON.stringify({
        vaults: [{ id: "local", name: "" }, { id: "mirror", name: "Mirror", external: { handle: "content://mirror", label: "Mirror", platform: "android" } }],
        activeId: "mirror",
      }));
    }
  });
  try {
    await page.goto("/");
    const surface = page.getByTestId("vault-boot");
    await expect(surface).toBeVisible({ timeout: 20_000 });
    await expect(surface).toHaveAttribute("data-state", "failed");
    await expect(surface).toContainText("“Mirror” could not be opened");
    await expect(page.getByTestId("vault-boot-reason")).not.toBeEmpty();
    await expect(page.getByTestId("vault-boot-retry")).toBeVisible();
    // A cold start: no vault to go back to, so the others are offered.
    await page.getByTestId("vault-boot-other").click();
    await page.getByRole("button", { name: "On this device" }).click();
    await waitForVaultDirectory(page);
    await expect(surface).toHaveCount(0);
    await expect(page.locator(".m-tab").first()).toBeVisible({ timeout: 20_000 });
  } finally { sql.close(); }
});
