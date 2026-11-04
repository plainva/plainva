import { test, expect, type BrowserContext, type Page, type TestInfo } from "@playwright/test";
import { fixtureStorage, installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { waitForVaultDirectory } from "./exampleVault";
import { PLAINVA_DROPBOX_APP_KEY } from "../../../packages/ui/src/services/providerDefaults";

/**
 * Connecting an account on the phone, one frame for every provider
 * (settings plan 2026-10-29, § 5, package P5): the sign-in step is drawn by
 * ACCESS KIND - the browser with an app key (Dropbox), one form of
 * credentials for every chosen service (Fastmail, IMAP), keys (S3) - and
 * every service says its own result with its sender. Google and Microsoft run
 * in `account-sign-in.spec.ts`.
 *
 * The built app runs in the browser; every server is a stand-in answered
 * here. No request leaves localhost. With PLAINVA_EVIDENCE set, each step is
 * photographed in light and dark.
 */

const CORS = { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, PUT, DELETE, PROPFIND, MKCOL, MOVE, OPTIONS, HEAD", "access-control-allow-headers": "*", "access-control-expose-headers": "*" };
const LISTING = '<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"><d:response><d:href>/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>';
const S3_LISTING = '<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>notes</Name><Prefix></Prefix><KeyCount>0</KeyCount><MaxKeys>1000</MaxKeys><Delimiter>/</Delimiter><IsTruncated>false</IsTruncated></ListBucketResult>';

interface Harness {
  /** The addresses the app opened in "the browser". */
  opened: string[];
}

async function boot(context: BrowserContext, page: Page): Promise<Harness> {
  const harness: Harness = { opened: [] };
  const origin = new URL(test.info().project.use.baseURL ?? "http://localhost:4174").origin;
  await context.route((url) => url.origin !== origin, async (route) => {
    const url = route.request().url();
    const method = route.request().method();
    if (method === "OPTIONS") { await route.fulfill({ status: 204, headers: CORS }); return; }
    // Fastmail's files let the app password in, its calendar turns it away.
    if (url.startsWith("https://webdav.fastmail.com")) {
      await route.fulfill({ status: method === "PROPFIND" ? 207 : 200, headers: { ...CORS, "content-type": "application/xml" }, body: method === "PROPFIND" ? LISTING : "" });
      return;
    }
    if (url.startsWith("https://caldav.fastmail.com")) {
      await route.fulfill({ status: 401, headers: { ...CORS, "content-type": "text/plain" }, body: "Unauthorized" });
      return;
    }
    // An S3 store with an empty bucket.
    if (url.startsWith("https://s3.example/")) {
      await route.fulfill({ status: 200, headers: { ...CORS, "content-type": "application/xml" }, body: S3_LISTING });
      return;
    }
    await route.abort("blockedbyclient");
  });
  await installSqlBridge(context);
  await context.exposeFunction("__browserOpened", (url: string) => { harness.opened.push(url); });
  await context.addInitScript(() => {
    (window as unknown as { open: (url?: string) => null }).open = (url?: string) => {
      void (window as unknown as { __browserOpened: (u: string) => Promise<void> }).__browserOpened(String(url));
      return null;
    };
  });
  const storage: Record<string, unknown> = fixtureStorage();
  // The fixture's account carries no files here: the files service is free to connect.
  storage.cloudAccounts_local = [];
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
  return harness;
}

async function openConnect(page: Page) {
  await page.locator('[data-testid="nav-settings"]').first().click();
  await page.locator('[data-testid="settings-area-cloudAccounts"]').click();
  await page.getByTestId("cloudacct-connect").click();
  await expect(page.getByTestId("connect-steps")).toBeVisible();
}

/** A photograph of the screen in light and in dark, when evidence is asked for. */
async function evidence(page: Page, info: TestInfo, name: string) {
  if (!process.env.PLAINVA_EVIDENCE) return;
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.waitForTimeout(150);
    await page.screenshot({ path: info.outputPath(`${name}-${scheme}.png`), fullPage: true });
  }
  await page.emulateMedia({ colorScheme: "light" });
}

test("Fastmail: one form for every service, each says its own result, the run goes on without the failed ones", async ({ context, page }, info) => {
  await boot(context, page);
  await openConnect(page);
  await page.getByTestId("connect-family-fastmail").click();
  // All three preselected, as on the desktop.
  for (const service of ["files", "calendar", "mail"]) {
    await expect(page.getByTestId(`connect-service-${service}`).getByRole("checkbox")).toBeChecked();
  }
  await page.getByTestId("connect-start").click();

  // ONE form: the address and the app password, nothing per service, the endpoints folded away.
  await expect(page.getByTestId("connect-field-email")).toBeVisible();
  await expect(page.getByTestId("connect-field-secret")).toBeVisible();
  await expect(page.getByTestId("connect-field-filesUrl")).toHaveCount(0);
  await expect(page.getByTestId("connect-step-line")).toHaveText(/Create it at Fastmail and paste it here/);
  await expect(page.getByTestId("connect-summary")).toContainText("One app password for every chosen service.");
  await expect(page.getByTestId("connect-other-signin")).toContainText("endpoints one by one");
  await expect(page.getByTestId("connect-signin")).toHaveText("Connect with app password");
  await evidence(page, info, "fastmail-form");

  await page.getByTestId("connect-other-signin").click();
  await expect(page.getByTestId("connect-field-filesUrl")).toHaveValue("https://webdav.fastmail.com");
  await page.getByTestId("connect-other-signin").click();

  await page.getByTestId("connect-field-email").fill("ada@fastmail.com");
  await page.getByTestId("connect-field-secret").fill("app-pass");
  await page.getByTestId("connect-signin").click();

  // Files signed in; the calendar refused; mail could not be tried in the browser. Each on its row, with its sender.
  await expect(page.getByTestId("connect-status-files")).toHaveAttribute("data-state", "ok", { timeout: 20000 });
  await expect(page.getByTestId("connect-status-calendar")).toHaveAttribute("data-state", "error", { timeout: 20000 });
  await expect(page.getByTestId("connect-status-mail")).toHaveAttribute("data-state", "error", { timeout: 20000 });
  await expect(page.getByTestId("connect-status-calendar").locator("strong")).not.toHaveText("");
  await expect(page.locator(".pv-toast")).toHaveCount(0);
  await expect(page.getByTestId("connect-signin")).toHaveText("Try again");
  await evidence(page, info, "fastmail-results");

  // Without the failed ones: the run's files step, signed in, choosing the folder with the proven credential.
  await page.getByTestId("connect-continue-without").click();
  await expect(page.getByTestId("connectrun-frame")).toHaveAttribute("data-step", "files", { timeout: 20000 });
  await expect(page.getByTestId("connectrun-signed-in")).toBeVisible();
  await expect(page.getByTestId("connectrun-folder")).toBeVisible();
  await expect(page.getByTestId("sync-webdav-url")).toHaveCount(0);
  await expect(page.locator('[data-testid="connectrun-steps"] li[data-state="skipped"]')).toHaveCount(2);
  await evidence(page, info, "fastmail-files-step");
});

test("S3: the keys, Advanced holds region, prefix and path style, and the folder step follows signed in", async ({ context, page }, info) => {
  await boot(context, page);
  await openConnect(page);
  await page.getByTestId("connect-search").fill("s3");
  await page.getByTestId("connect-family-s3").click();
  await expect(page.getByTestId("connect-service-calendar")).toContainText("has no calendar Plainva can read");
  await page.getByTestId("connect-start").click();
  for (const field of ["endpoint", "bucket", "accessKeyId", "secret"]) await expect(page.getByTestId(`connect-field-${field}`)).toBeVisible();
  await expect(page.getByTestId("connect-field-region")).toHaveCount(0);
  await expect(page.getByTestId("connect-other-signin")).toContainText("Advanced");
  await page.getByTestId("connect-other-signin").click();
  await expect(page.getByTestId("connect-field-region")).toBeVisible();
  await expect(page.getByTestId("connect-signin")).toHaveText("Connect");
  await page.getByTestId("connect-field-endpoint").fill("https://s3.example");
  await page.getByTestId("connect-field-bucket").fill("notes");
  await page.getByTestId("connect-field-accessKeyId").fill("AKIATEST");
  await page.getByTestId("connect-field-secret").fill("secret");
  await evidence(page, info, "s3-form");
  await page.getByTestId("connect-signin").click();
  await expect(page.getByTestId("connectrun-frame")).toHaveAttribute("data-step", "files", { timeout: 20000 });
  await expect(page.getByTestId("connectrun-signed-in")).toBeVisible();
  await expect(page.getByTestId("sync-s3-endpoint")).toHaveCount(0);
  await evidence(page, info, "s3-files-step");
});

test("IMAP: the search finds the provider, the password is named as GMX names it, Outlook points to Microsoft", async ({ context, page }, info) => {
  await boot(context, page);
  await openConnect(page);
  await page.getByTestId("connect-search").fill("outlook");
  await expect(page.getByTestId("connect-family-microsoft")).toBeVisible();
  await page.getByTestId("connect-search").fill("gmx");
  await expect(page.getByTestId("connect-family-imap")).toContainText("GMX");
  await page.getByTestId("connect-family-imap").click();
  await expect(page.getByTestId("connect-service-mail").getByRole("checkbox")).toBeChecked();
  await page.getByTestId("connect-start").click();
  await expect(page.getByTestId("connect-field-email")).toBeVisible();
  await expect(page.getByTestId("connect-field-imapHost")).toHaveCount(0);
  await expect(page.getByTestId("connect-other-signin")).toContainText("servers one by one");
  await page.getByTestId("connect-field-email").fill("ada@gmx.de");
  await page.getByTestId("connect-field-secret").fill("pw");
  await evidence(page, info, "imap-form");
  await page.getByTestId("connect-signin").click();
  // The browser has no mail socket: the row says so, with its sender, and nothing goes on.
  await expect(page.getByTestId("connect-status-mail")).toHaveAttribute("data-state", "error", { timeout: 20000 });
  await expect(page.getByTestId("connect-continue-without")).toHaveCount(0);

  // An Outlook address: the way is the Microsoft entry.
  await page.getByTestId("connect-field-email").fill("ada@outlook.com");
  await expect(page.getByTestId("connect-note")).toContainText("Microsoft");
  await expect(page.getByTestId("connect-signin")).toBeDisabled();
  await page.getByTestId("connect-open-microsoft").click();
  await expect(page.getByTestId("connect-start")).toHaveText("Sign in with Microsoft…");
});

test("Dropbox: the sign-in starts from the services page, and 'Signed in' waits for it", async ({ context, page }, info) => {
  const harness = await boot(context, page);
  await openConnect(page);
  await page.getByTestId("connect-family-dropbox").click();
  // The other services stay in the list, off, with the reason.
  await expect(page.getByTestId("connect-service-mail")).toContainText("has no mailbox Plainva can fetch");
  await expect(page.getByTestId("connect-summary")).toContainText("Standard sign-in");
  await expect(page.getByTestId("connect-other-signin")).toContainText("own app key");
  await expect(page.getByTestId("connect-start")).toHaveText("Sign in with Dropbox…");
  await evidence(page, info, "dropbox-services");
  await page.getByTestId("connect-start").click();

  // The browser opens on Dropbox with this phone's key, at once.
  await expect.poll(() => harness.opened.find((url) => url.includes("dropbox.com")), { timeout: 15000 }).toBeTruthy();
  const consent = new URL(harness.opened.find((url) => url.includes("dropbox.com"))!);
  expect(consent.searchParams.get("client_id")).toBe(PLAINVA_DROPBOX_APP_KEY);
  // The run's frame: the sign-in is the step on screen, not a done one, and no "Signed in" yet.
  await expect(page.getByTestId("connectrun-frame")).toHaveAttribute("data-step", "files", { timeout: 20000 });
  await expect(page.getByTestId("connectrun-signed-in")).toHaveCount(0);
  await expect(page.locator('[data-testid="connectrun-steps"] li').first()).toHaveAttribute("data-state", "active");
  await evidence(page, info, "dropbox-run-before-sign-in");
});
