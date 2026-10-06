import { test, expect, type Page } from "@playwright/test";
import { installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { waitForVaultDirectory, type MobileTestGlobals } from "./exampleVault";

/**
 * The internet on the phone (AI harness P4): a vault nobody decided about has
 * no way onto it. The switch lives in the vault's AI settings and is kept in
 * the app's data on this phone — never in the vault, whose writers could
 * otherwise switch it on —, and only once it is on does a new conversation
 * offer the choice. The page fetch itself is the native `AiWeb` plugin, which
 * a browser does not have; what a fetch may do is held by the rule tests of
 * both platforms and by the session tests.
 */

/** The vault's internet settings on this device: in the app's data under `ai/`. */
async function webSettings(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const fs = (globalThis as MobileTestGlobals).Capacitor.Plugins.Filesystem;
    const out: string[] = [];
    const vaults = await fs.readdir({ path: "ai", directory: "DATA" }).catch(() => ({ files: [] }));
    for (const entry of vaults.files) {
      const file = await fs.readFile({ path: `ai/${entry.name}/web.json`, directory: "DATA", encoding: "utf8" }).catch(() => null);
      if (file && typeof file.data === "string") out.push(file.data);
    }
    return out;
  });
}

test("the internet is off for a fresh vault; the switch in its settings brings the choice into a new conversation", async ({ page, context }) => {
  const sql = await installSqlBridge(context);
  await context.addInitScript(() => {
    localStorage.setItem("CapacitorStorage.mobile-settings", JSON.stringify({ onboarded: true, language: "en", motion: "off" }));
    // The AI is opt-in per device: switched on here, with a model chosen, as the settings would store it.
    localStorage.setItem("CapacitorStorage.ai", JSON.stringify({ enabled: true, providers: ["anthropic"], profiles: { balanced: { providerId: "anthropic", model: "m-1" } } }));
  });
  try {
    await page.goto("/");
    await waitForVaultDirectory(page);
    await expect(page.locator("#root > *").first()).toBeVisible({ timeout: 20_000 });
    const close = page.getByTestId("whats-new-close");
    await expect(close).toBeVisible({ timeout: 15_000 });
    await close.click();
    const back = () => page.getByRole("button", { name: /^Back$/ }).first().click();

    // 1. A fresh vault: the conversation shows nothing of the internet, and nothing is stored about it.
    await page.getByTestId("tab-areas").click();
    await page.getByTestId("areas-ai").click();
    const conversation = page.getByTestId("ai-conversation");
    await expect(conversation.getByTestId("ai-input")).toBeVisible();
    await expect(conversation.getByTestId("ai-web-toggle")).toHaveCount(0);
    expect(await webSettings(page)).toEqual([]);

    // 2. The vault's AI settings: the switch is off, and no site can be added before it is on.
    await back();
    await page.getByTestId("nav-settings").first().click();
    await page.getByTestId("settings-area-aiVault").click();
    const allow = page.getByRole("switch", { name: "The AI may use the internet in this vault" });
    await expect(allow).toHaveAttribute("aria-checked", "false");
    await expect(page.getByTestId("settings-ai-web-add")).toHaveCount(0);
    await allow.click();
    await expect(allow).toHaveAttribute("aria-checked", "true");
    await expect.poll(async () => (await webSettings(page)).map((text) => JSON.parse(text))).toEqual([{ version: 1, enabled: true, allow: [] }]);

    // A site that needs no asking is kept as its name, whatever was typed; what is no public site is refused.
    const add = page.getByTestId("settings-ai-web-add");
    await add.click();
    const field = page.locator(".m-sheet input");
    await field.fill("https://docs.example.org/guide/start");
    await field.press("Enter");
    await expect(page.getByTestId("settings-ai-web-site")).toHaveText(["docs.example.org"]);
    await add.click();
    await page.locator(".m-sheet input").fill("localhost");
    await page.locator(".m-sheet input").press("Enter");
    await expect(page.getByText("That is not a site on the public internet.")).toBeVisible();
    await expect(page.getByTestId("settings-ai-web-site")).toHaveCount(1);
    await expect.poll(async () => (await webSettings(page)).map((text) => JSON.parse(text).allow)).toEqual([["docs.example.org"]]);

    // 3. A new conversation now offers the choice — off until it is pressed, for this one conversation.
    await back();
    await back();
    await page.getByTestId("tab-areas").click();
    await page.getByTestId("areas-ai").click();
    const toggle = conversation.getByTestId("ai-web-toggle");
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("ai-new").click();
    await expect(toggle).toHaveAttribute("aria-pressed", "false");

    // 4. Switched off again, the choice is gone at once.
    await back();
    await page.getByTestId("nav-settings").first().click();
    await page.getByTestId("settings-area-aiVault").click();
    await allow.click();
    await expect(allow).toHaveAttribute("aria-checked", "false");
    await back();
    await back();
    await page.getByTestId("tab-areas").click();
    await page.getByTestId("areas-ai").click();
    await expect(conversation.getByTestId("ai-input")).toBeVisible();
    await expect(conversation.getByTestId("ai-web-toggle")).toHaveCount(0);
  } finally {
    await sql.close();
  }
});
