import { test, expect, type BrowserContext, type Page } from "./clockedTest";
import { fixtureStorage, installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { waitForVaultDirectory } from "./exampleVault";
import { byteExactDav } from "../../../packages/core/test/helpers/byteExactDav";

/**
 * Switching vaults on the phone waits within a deadline, also in the built
 * app: a sync step whose upload the provider never answers holds the switch
 * for 30 seconds at most, with a notice after 5 seconds, and then the switch
 * goes on. Opening the same vault again waits until that step has ended —
 * never two runtimes at one vault — and says so until it has.
 *
 * The provider is a WebDAV server in the test (`byteExactDav`) behind the
 * page's network; its first upload is held until the test lets it go.
 */

const ROOT = "https://dav.example/files/anna/";
const CORS = { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, PUT, DELETE, PROPFIND, MKCOL, MOVE, OPTIONS, HEAD", "access-control-allow-headers": "*", "access-control-expose-headers": "*" };

async function boot(context: BrowserContext, page: Page): Promise<{ uploadHeld: Promise<void>; release(): void }> {
  const dav = byteExactDav(ROOT, { clock: () => Date.UTC(2026, 10, 6, 9, 0) });
  let arrived!: () => void;
  const uploadHeld = new Promise<void>((resolve) => (arrived = resolve));
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  let holding = true;
  const origin = new URL(test.info().project.use.baseURL ?? "http://localhost:4174").origin;
  await context.route((url) => url.origin !== origin, async (route) => {
    const request = route.request();
    const url = request.url();
    if (!url.startsWith("https://dav.example/")) {
      await route.abort("blockedbyclient");
      return;
    }
    if (request.method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: CORS });
      return;
    }
    // The first upload does not answer until the test lets it go.
    if (request.method() === "PUT" && holding) {
      holding = false;
      arrived();
      await released;
    }
    const body = request.postDataBuffer();
    const response = await dav.fetch(url, { method: request.method(), headers: request.headers(), ...(body ? { body: new Uint8Array(body) as BodyInit } : {}) });
    const headers: Record<string, string> = { ...CORS };
    response.headers.forEach((value, key) => { headers[key] = value; });
    if (request.method() === "PROPFIND") headers["content-type"] = "application/xml";
    const empty = response.status === 204 || response.status === 304;
    await route.fulfill({ status: response.status, headers, ...(empty ? {} : { body: Buffer.from(await response.arrayBuffer()) }) }).catch(() => undefined);
  });
  await installSqlBridge(context);
  const storage: Record<string, unknown> = fixtureStorage();
  storage.cloudAccounts_local = [
    ...(storage.cloudAccounts_local as { id: string }[]),
    { id: "card-dav", family: "webdav", label: "anna@dav.example", services: { files: { provider: "webdav" } } },
  ];
  const registry = storage.vault_registry as { vaults: { id: string }[] };
  registry.vaults = registry.vaults.map((vault) => (vault.id === "local" ? { ...vault, provider: "webdav", paused: false } : vault));
  storage.secret_sync_provider_mobile_local = { provider: "webdav", creds: { url: ROOT, user: "anna", pass: "secret" } };
  await context.addInitScript((seed) => {
    if (localStorage.getItem("CapacitorStorage.mobile-settings")) return;
    localStorage.setItem("CapacitorStorage.mobile-settings", JSON.stringify({ onboarded: true, language: "en", motion: "off" }));
    for (const [key, value] of Object.entries(seed)) localStorage.setItem(`CapacitorStorage.${key}`, JSON.stringify(value));
  }, storage);
  await page.goto("/");
  await waitForVaultDirectory(page);
  const close = page.getByTestId("whats-new-close");
  await expect(close).toBeVisible({ timeout: 15000 });
  await close.click();
  return { uploadHeld, release };
}

async function chooseVault(page: Page, name: string) {
  await page.getByRole("button", { name: /Switch Vault/ }).first().click();
  await page.getByTestId("vault-row").filter({ hasText: name }).click();
}

test("a switch away from a vault whose upload hangs goes on after 30 s, and the vault opens again once that step has ended", async ({ context, page }) => {
  test.setTimeout(180_000);
  const dav = await boot(context, page);
  // The first sync uploads the vault's notes: its first upload hangs.
  await dav.uploadHeld;

  await chooseVault(page, "Leerer Vault");
  await expect(page.getByText("A sync step of “On this device” is still running – then it goes on.")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("The sync step of “On this device” did not finish. Plainva stops it and goes on; nothing is lost – the next sync catches up on what is missing.")).toBeVisible({ timeout: 40_000 });
  await waitForVaultDirectory(page);

  // Back while the old step still hangs: the vault waits for it, and says so (text 7).
  await chooseVault(page, "On this device");
  const stillClosing = page.getByText("“On this device” is still closing – then Plainva opens it again.");
  await expect(stillClosing).toBeVisible({ timeout: 15_000 });

  // The provider answers: the old runtime ends, the vault opens, the notice goes.
  dav.release();
  await expect(stillClosing).toHaveCount(0, { timeout: 30_000 });
  await waitForVaultDirectory(page);
});
