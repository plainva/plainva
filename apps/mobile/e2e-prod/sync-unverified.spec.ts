import { test, expect, type BrowserContext, type Page, type TestInfo } from "./clockedTest";
import { fixtureStorage, installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { waitForVaultDirectory, openSettings } from "./exampleVault";
import { byteExactDav } from "../../../packages/core/test/helpers/byteExactDav";

/**
 * "Google Drive no longer reports N files" on the phone (D7, mockup M2),
 * through the built app. The notice on the sync screen opens the list as a
 * sheet; "Upload again" hands the file to the sync worker, "Hide" puts the
 * notice away until the set changes.
 *
 * The facts come through the e2e build's seam (`__plainvaFixtureUnverified`):
 * a test run has no Drive that stops knowing a file. The worker side - the
 * name search, the probe by id, the queued upload - is covered by the core
 * tests; this spec holds the surface.
 */

const ROOT = "https://dav.example/files/anna/";
const CORS = { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, PUT, DELETE, PROPFIND, MKCOL, MOVE, OPTIONS, HEAD", "access-control-allow-headers": "*", "access-control-expose-headers": "*" };

async function boot(context: BrowserContext, page: Page): Promise<void> {
  const dav = byteExactDav(ROOT, { clock: () => Date.UTC(2026, 10, 6, 9, 0) });
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
    const body = request.postDataBuffer();
    const response = await dav.fetch(url, { method: request.method(), headers: request.headers(), ...(body ? { body: new Uint8Array(body) as BodyInit } : {}) });
    const headers: Record<string, string> = { ...CORS };
    response.headers.forEach((value, key) => { headers[key] = value; });
    if (request.method() === "PROPFIND") headers["content-type"] = "application/xml";
    const empty = response.status === 204 || response.status === 304;
    await route.fulfill({ status: response.status, headers, ...(empty ? {} : { body: Buffer.from(await response.arrayBuffer()) }) });
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
}

async function evidence(page: Page, info: TestInfo, name: string) {
  if (!process.env.PLAINVA_EVIDENCE) return;
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.waitForTimeout(150);
    await page.screenshot({ path: info.outputPath(`${name}-${scheme}.png`), fullPage: true });
  }
  await page.emulateMedia({ colorScheme: "light" });
}

test("the notice names the files, opens the list as a sheet, uploads one again and hides until the set changes", async ({ context, page }, info) => {
  test.setTimeout(120_000);
  await boot(context, page);
  await openSettings(page);
  await page.locator('[data-testid="settings-area-sync"]').click();

  await page.evaluate(() => {
    const w = window as unknown as { __uploaded: unknown[]; __plainvaFixtureUnverified: { set(paths: string[], upload?: (paths?: string[]) => Promise<number>): void } };
    w.__uploaded = [];
    w.__plainvaFixtureUnverified.set(["Journal/2026-03-14.md", "Rezepte/Brot.md"], async (paths) => {
      w.__uploaded.push(paths);
      return paths?.length ?? 0;
    });
  });

  const notice = page.getByTestId("sync-unverified");
  await expect(notice).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("sync-unverified-title")).toHaveText("Google Drive no longer reports 2 files");
  await evidence(page, info, "phone-unverified-notice");

  await page.getByTestId("sync-unverified-view").click();
  const sheet = page.getByTestId("sync-unverified-sheet");
  await expect(sheet).toBeVisible();
  await expect(sheet.getByTestId("sync-unverified-file")).toHaveCount(2);
  await expect(sheet).toContainText("Rezepte/Brot.md");
  await expect(sheet).toContainText("If the old file still exists in Drive, it will be there twice afterwards.");
  await evidence(page, info, "phone-unverified-sheet");

  await sheet.getByTestId("sync-unverified-one").first().click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __uploaded: unknown[] }).__uploaded)).toEqual([["Journal/2026-03-14.md"]]);

  // Hidden, the notice stays away; a changed set brings it back.
  await page.keyboard.press("Escape");
  await page.getByTestId("sync-unverified-hide").click();
  await expect(notice).toHaveCount(0);
  await page.evaluate(() => (window as unknown as { __plainvaFixtureUnverified: { set(paths: string[], upload?: () => Promise<number>): void } }).__plainvaFixtureUnverified.set(["Rezepte/Brot.md"], async () => 1));
  await expect(page.getByTestId("sync-unverified-title")).toHaveText("Google Drive no longer reports 1 file");
});
