import { test, expect, type BrowserContext, type Page, type TestInfo } from "./clockedTest";
import { fixtureStorage, installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { waitForVaultDirectory } from "./exampleVault";
import { byteExactDav, type ByteExactDav } from "../../../packages/core/test/helpers/byteExactDav";

/**
 * "Same name, two files" on the phone (finding 2026-11-03), through the built
 * app and a real sync. On an iPhone syncing with Google Drive the card listed
 * pairs like `Aufgaben/Notiz.md ↔ Aufgaben/Notiz.md`: the same name in its
 * composed and its decomposed Unicode form, side by side in one cloud folder.
 * Nothing on it could tell them apart or act, and the second one was not even
 * reachable in the file list.
 *
 * The cloud here is a WebDAV server that keeps names byte for byte (the core's
 * test server), answered in the test process; the vault syncs with it for
 * real. No request leaves localhost.
 */

const SAME = "Brötchen holen.md".normalize("NFC");
const DIFFERS = "Käse kaufen.md".normalize("NFC");
const BODY = "# Brötchen holen\n\n- [ ] beim Bäcker\n";
const OLD = "# Käse kaufen\n\n- [ ] Gouda\n";
const NEW = "# Käse kaufen\n\n- [x] Gouda, und Brie\n";
const ROOT = "https://dav.example/files/anna/";
const CORS = { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, PUT, DELETE, PROPFIND, MKCOL, MOVE, OPTIONS, HEAD", "access-control-allow-headers": "*", "access-control-expose-headers": "*" };
const bytes = (text: string) => new TextEncoder().encode(text);
const text = (dav: ByteExactDav, path: string) => {
  const file = dav.files.get(path);
  return file ? new TextDecoder().decode(file.bytes) : null;
};

async function boot(context: BrowserContext, page: Page): Promise<ByteExactDav> {
  const dav = byteExactDav(ROOT, { clock: () => Date.UTC(2026, 8, 22, 13, 59) });
  dav.folders.add("Aufgaben");
  dav.files.set(`Aufgaben/${SAME}`, { bytes: bytes(BODY), etag: "a1", modified: Date.UTC(2026, 8, 22, 13, 59) });
  dav.files.set(`Aufgaben/${SAME.normalize("NFD")}`, { bytes: bytes(BODY), etag: "a2", modified: Date.UTC(2026, 8, 22, 13, 58) });
  dav.files.set(`Aufgaben/${DIFFERS}`, { bytes: bytes(OLD), etag: "b1", modified: Date.UTC(2026, 8, 22, 13, 59) });
  dav.files.set(`Aufgaben/${DIFFERS.normalize("NFD")}`, { bytes: bytes(NEW), etag: "b2", modified: Date.UTC(2026, 8, 23, 8, 15) });

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
    // A status without a body (204, 304) must not carry one, not even an empty one.
    const empty = response.status === 204 || response.status === 304;
    await route.fulfill({ status: response.status, headers, ...(empty ? {} : { body: Buffer.from(await response.arrayBuffer()) }) });
  });
  await installSqlBridge(context);

  const storage: Record<string, unknown> = fixtureStorage();
  // The local vault syncs with the WebDAV account, running.
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
  return dav;
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

test("the card tells the two copies apart, removes the identical one and keeps the differing one as a file of its own", async ({ context, page }, info) => {
  test.setTimeout(120_000);
  const logs: string[] = [];
  page.on("console", (message) => { if (message.type() !== "log" || /nameTwins|SyncWorker|SyncEngine/.test(message.text())) logs.push(`${message.type()}: ${message.text()}`); });
  page.on("pageerror", (error) => logs.push(`pageerror: ${error.message}`));
  const dav = await boot(context, page);
  await page.locator('[data-testid="nav-settings"]').first().click();
  await page.locator('[data-testid="settings-area-sync"]').click();

  const card = page.getByTestId("sync-collisions");
  await expect(card).toBeVisible({ timeout: 60_000 });
  const rows = card.getByTestId("sync-collision-case");
  await expect(rows).toHaveCount(2, { timeout: 30_000 });
  await expect(card).not.toContainText("↔");
  const same = rows.filter({ hasText: SAME });
  const differs = rows.filter({ hasText: DIFFERS });
  await expect(same).toContainText("exists twice · identical", { timeout: 30_000 }).catch((e) => {
    console.log(["LOGS", ...logs.map((l) => l.slice(0, 300))].join(" ## "));
    throw e;
  });
  await expect(differs).toContainText("different");
  // The cloud copy's size (downloaded). The copy here is sized by the store,
  // and the web shell's store counts characters, not bytes.
  await expect(differs).toContainText(`${bytes(NEW).length} B`);
  await evidence(page, info, "phone-collision-card");

  // Remove duplicates: the identical twin goes from the cloud, the synced note stays.
  await card.getByTestId("sync-collisions-remove").click();
  await page.getByTestId("confirm-act").click();
  await expect.poll(() => dav.files.has(`Aufgaben/${SAME.normalize("NFD")}`), { timeout: 30_000 }).toBe(false);
  expect(text(dav, `Aufgaben/${SAME}`)).toBe(BODY);
  await expect(rows).toHaveCount(1, { timeout: 30_000 });

  // Keep both: the differing twin becomes "Käse kaufen (2).md", here and in the cloud.
  const copy = `Aufgaben/${"Käse kaufen (2).md".normalize("NFC")}`;
  await card.getByTestId("sync-collisions-keep").click();
  await page.getByTestId("confirm-act").click();
  await expect.poll(() => text(dav, copy), { timeout: 30_000 }).toBe(NEW).catch((e) => {
    console.log(["DAV", ...[...dav.files.keys()].map((k) => JSON.stringify(k)), ...dav.log.slice(-30), "LOGS", ...logs.slice(-40).map((l) => l.slice(0, 300))].join(" ## "));
    throw e;
  });
  expect(dav.files.has(`Aufgaben/${DIFFERS.normalize("NFD")}`)).toBe(false);
  expect(text(dav, `Aufgaben/${DIFFERS}`)).toBe(OLD);
  await expect(card).toHaveCount(0, { timeout: 30_000 });
  await evidence(page, info, "phone-collision-card-resolved");
});
