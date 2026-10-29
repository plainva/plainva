import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { fixtureStorage, installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { FakeOAuthProvider, type FakeConsentChoice } from "../../../packages/ui/src/testing/fakeOAuthProvider";
import { waitForVaultDirectory } from "./exampleVault";
import { E2E_STANDARD_GOOGLE_IOS_CLIENT_ID } from "../scripts/e2e-build-env.mjs";
import { PLAINVA_ONEDRIVE_CLIENT_ID } from "../../../packages/ui/src/services/providerDefaults";

/**
 * The one account sign-in on the phone, against a stand-in for Google
 * (account sign-in plan E6) - the same provider the desktop's end-to-end test
 * signs in against (`apps/desktop/e2e/account-sign-in.spec.ts`).
 *
 * The built app runs in the browser; what the operating system does around a
 * sign-in is played here: the browser the app opens is the provider's consent
 * screen, and its redirect comes back the way the system delivers it - as the
 * app's `appUrlOpen` event. The token endpoint and userinfo are answered by
 * the provider in the test process. No request leaves localhost.
 */

const ANNA = { subject: "sub-anna", email: "anna@gmail.com" };
const BERT = { subject: "sub-bert", email: "bert@gmail.com" };
// An iOS-type client: the phone's own Google access has no secret. The same
// client is the e2e build's standard one (`scripts/e2e-build-env.mjs`), so a
// test can sign in either way against the one fake provider.
const CLIENT = { clientId: E2E_STANDARD_GOOGLE_IOS_CLIENT_ID };

const CARLA = { subject: "ms-carla", email: "carla@outlook.com" };

interface Harness {
  provider: FakeOAuthProvider;
  /** A stand-in for Microsoft, with Plainva's own client. */
  microsoft: FakeOAuthProvider;
  choice: FakeConsentChoice;
  /**
   * Answer Google's APIs (Drive, Calendar, Tasks) - each only for an access
   * token whose grant covers it, the way Google answers. Off, they are blocked.
   */
  answerApis: boolean;
  /** The app's SQLite, to seed rows a single test needs. */
  sql: Awaited<ReturnType<typeof installSqlBridge>>;
}

const API_SCOPES: [prefix: string, scope: string][] = [
  ["https://www.googleapis.com/drive/", "https://www.googleapis.com/auth/drive"],
  ["https://www.googleapis.com/upload/drive/", "https://www.googleapis.com/auth/drive"],
  ["https://www.googleapis.com/calendar/", "https://www.googleapis.com/auth/calendar"],
  ["https://tasks.googleapis.com/", "https://www.googleapis.com/auth/tasks"],
  ["https://www.googleapis.com/tasks/", "https://www.googleapis.com/auth/tasks"],
];

async function boot(context: BrowserContext, page: Page, seed?: (storage: Record<string, unknown>) => void, withCalendar = false): Promise<Harness> {
  const harness = {
    provider: new FakeOAuthProvider({ family: "google", accounts: [ANNA, BERT], clients: [CLIENT] }),
    microsoft: new FakeOAuthProvider({ family: "microsoft", accounts: [CARLA], clients: [{ clientId: PLAINVA_ONEDRIVE_CLIENT_ID }] }),
    choice: {},
    answerApis: false,
  } as Harness;
  const origin = new URL(test.info().project.use.baseURL ?? "http://localhost:4174").origin;
  await context.route((url) => url.origin !== origin, async (route) => {
    const url = route.request().url();
    if (url.startsWith("https://oauth2.googleapis.com/") || url.startsWith("https://openidconnect.googleapis.com/")) {
      const response = await harness.provider.fetch(url, { method: route.request().method(), headers: route.request().headers(), body: route.request().postData() ?? undefined });
      await route.fulfill({ status: response.status, contentType: "application/json", body: await response.text() });
      return;
    }
    if (/^https:\/\/login\.microsoftonline\.com\/.*\/oauth2\/v2\.0\/token/.test(url) || url.startsWith("https://graph.microsoft.com/v1.0/me")) {
      const response = await harness.microsoft.fetch(url, { method: route.request().method(), headers: route.request().headers(), body: route.request().postData() ?? undefined });
      await route.fulfill({ status: response.status, contentType: "application/json", body: await response.text() });
      return;
    }
    const api = API_SCOPES.find(([prefix]) => url.startsWith(prefix));
    if (harness.answerApis && api) {
      const token = (route.request().headers()["authorization"] ?? "").replace(/^Bearer\s+/i, "");
      if (!harness.provider.scopesOf(token)?.includes(api[1])) {
        await route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: { code: 401, status: "UNAUTHENTICATED", message: "Request had invalid authentication credentials." } }) });
        return;
      }
      const method = route.request().method();
      const body = method === "GET"
        ? { files: [], items: [{ id: "primary", summary: "Anna", primary: true, accessRole: "owner" }], startPageToken: "1", newStartPageToken: "1", changes: [] }
        : { id: "created-1", name: "Plainva", mimeType: "application/vnd.google-apps.folder" };
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
      return;
    }
    // A WebDAV server that lets anyone in: an empty folder for every listing.
    if (url.startsWith("https://dav.example/")) {
      const method = route.request().method();
      const cors = { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, PUT, DELETE, PROPFIND, MKCOL, MOVE, OPTIONS", "access-control-allow-headers": "*", "access-control-expose-headers": "*" };
      if (method === "OPTIONS") { await route.fulfill({ status: 204, headers: cors }); return; }
      const listing = '<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"><d:response><d:href>/files/anna/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>';
      await route.fulfill({ status: method === "PROPFIND" ? 207 : 200, headers: { ...cors, "content-type": "application/xml" }, body: method === "PROPFIND" ? listing : "" });
      return;
    }
    await route.abort("blockedbyclient");
  });
  const sql = await installSqlBridge(context);
  harness.sql = sql;

  // The browser step: the consent URL the app opened, answered by the provider,
  // and its redirect handed back as the system would.
  await context.exposeFunction("__fakeConsent", (url: string) => {
    const params = new URL(url).searchParams;
    const provider = new URL(url).hostname === "login.microsoftonline.com" ? harness.microsoft : harness.provider;
    try {
      const code = provider.consent({
        clientId: params.get("client_id") ?? "",
        scope: params.get("scope") ?? "",
        loginHint: params.get("login_hint") ?? undefined,
        codeChallenge: params.get("code_challenge") ?? undefined,
        redirectUri: params.get("redirect_uri") ?? undefined,
      }, harness.choice);
      // Microsoft answers at the address with the slash of its empty path (device finding 2026-10-28).
      const address = provider === harness.microsoft ? `${params.get("redirect_uri")}/` : params.get("redirect_uri");
      return `${address}?code=${encodeURIComponent(code)}&state=${encodeURIComponent(params.get("state") ?? "")}`;
    } catch {
      return `${params.get("redirect_uri")}?error=access_denied&state=${encodeURIComponent(params.get("state") ?? "")}`;
    }
  });
  await context.addInitScript(() => {
    (window as unknown as { open: (url?: string) => null }).open = (url?: string) => {
      void (async () => {
        const redirect = await (window as unknown as { __fakeConsent: (u: string) => Promise<string> }).__fakeConsent(String(url));
        const app = (globalThis as unknown as { Capacitor: { Plugins: { App: { notifyListeners: (e: string, d: unknown) => void } } } }).Capacitor.Plugins.App;
        app.notifyListeners("appUrlOpen", { url: redirect });
      })();
      return null;
    };
  });

  const storage: Record<string, unknown> = fixtureStorage();
  // A Google card that carries the local vault's files, with the identity a
  // sign-in leaves on it. The vault syncs through Drive, paused, so no cycle
  // runs against the blocked network.
  storage.cloudAccounts_local = [
    ...(storage.cloudAccounts_local as { id: string }[]).filter((card) => card.id !== "acct-fixture-cal"),
    { id: "acct-fixture-cal", family: "google", label: ANNA.email, verifiedProviderIdentity: { issuer: "google", subject: ANNA.subject }, services: { files: { provider: "drive" } } },
  ];
  const registry = storage.vault_registry as { vaults: { id: string }[] };
  registry.vaults = registry.vaults.map((vault) => (vault.id === "local" ? { ...vault, provider: "drive", paused: true } : vault));
  storage.secret_sync_provider_mobile_local = { provider: "drive", creds: { clientId: CLIENT.clientId, refreshToken: "" } };
  // This phone signs in to Google with an own access.
  storage.secret_oauth_access_google = { source: "own", clientId: CLIENT.clientId };
  seed?.(storage);
  await context.addInitScript((seed) => {
    if (localStorage.getItem("CapacitorStorage.mobile-settings")) return;
    localStorage.setItem("CapacitorStorage.mobile-settings", JSON.stringify({ onboarded: true, language: "en", motion: "off" }));
    for (const [key, value] of Object.entries(seed)) localStorage.setItem(`CapacitorStorage.${key}`, JSON.stringify(value));
  }, storage);

  await page.goto("/");
  await waitForVaultDirectory(page);
  if (withCalendar) {
    // The fixture's Google calendar row (pim-fixture-1), in the vault's index once it exists.
    await expect.poll(() => sql.count("plainva-index", "sqlite_master WHERE name = 'pim_calendars'"), { timeout: 20_000 }).toBe(1);
    sql.seedPim("plainva-index");
    await page.reload();
    await waitForVaultDirectory(page);
  }
  const close = page.getByTestId("whats-new-close");
  await expect(close).toBeVisible({ timeout: 15000 });
  await close.click();
  return harness;
}

async function openGoogleCard(page: Page) {
  await page.locator('[data-testid="nav-settings"]').first().click();
  await page.locator('[data-testid="settings-area-cloudAccounts"]').click();
  await page.getByTestId("cloudacct-row").filter({ hasText: ANNA.email }).click();
  await expect(page.getByTestId("cloudacct-detail")).toBeVisible();
}

test("adding a service with another account in the browser changes nothing and names both accounts", async ({ context, page }, testInfo) => {
  const harness = await boot(context, page);
  await openGoogleCard(page);
  const before = await page.evaluate(() => localStorage.getItem("CapacitorStorage.cloudAccounts_local"));

  // Bert is signed in in the browser and the person picks him.
  harness.choice = { account: BERT.email };
  await page.getByTestId("cloudacct-switch-calendar").click();

  // Said once, at the card - not again in every service row, not again as a toast.
  const refusal = page.getByText(`You signed in as ${BERT.email}, but this account is ${ANNA.email}. Nothing was changed.`);
  await expect(refusal).toHaveCount(1, { timeout: 15000 });
  await expect(page.getByTestId("cloudacct-service-calendar")).not.toContainText(BERT.email);
  await page.waitForTimeout(500);
  await expect(page.locator(".pv-toast")).toHaveCount(0);
  if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: testInfo.outputPath("wrong-account.png") });

  // One consent, for everything the card carries plus the calendar, with Anna preselected.
  const consents = harness.provider.log.filter((entry) => entry.kind === "consent");
  expect(consents).toHaveLength(1);
  expect(consents[0].detail.loginHint).toBe(ANNA.email);
  expect(String(consents[0].detail.scope)).toContain("https://www.googleapis.com/auth/drive");
  expect(String(consents[0].detail.scope)).toContain("https://www.googleapis.com/auth/calendar");
  // The card is as it was.
  expect(await page.evaluate(() => localStorage.getItem("CapacitorStorage.cloudAccounts_local"))).toBe(before);
});

test("signing the card in again with its own account writes its grant, with the identity", async ({ context, page }) => {
  const harness = await boot(context, page);
  await openGoogleCard(page);

  harness.choice = { account: ANNA.email };
  await page.getByTestId("cloudacct-switch-calendar").click();

  // The consent came back for Anna: the card now holds one grant of its own.
  await expect.poll(async () => harness.provider.heldGrants().length, { timeout: 15000 }).toBe(1);
  const readGrant = () => page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith("CapacitorStorage.secret_account_acct-fixture-cal"));
    return key ? localStorage.getItem(key) : null;
  });
  await expect.poll(readGrant, { timeout: 15000 }).not.toBeNull();
  const stored = JSON.parse((await readGrant())!);
  expect(JSON.stringify(stored)).toContain(ANNA.subject);
});

/** The card's grant on this phone, or null. */
const cardGrant = (page: Page) => page.evaluate(() => {
  const key = Object.keys(localStorage).find((k) => k.startsWith("CapacitorStorage.secret_account_acct-fixture-cal"));
  return key ? localStorage.getItem(key) : null;
});

/**
 * Plan "Verbinden", V0 - the findings on TestFlight build 144: the yellow
 * "sign in" could not be tapped, "Check connection" reported files and the
 * calendar as not connected while both ran, and no sign-in could be removed
 * from the phone. One card with files and a calendar, from no sign-in to
 * signed in, checked, signed out on this phone and signed in again.
 */
test("a card signs in from its state, checks files and calendar as working, signs out on this phone and in again", async ({ context, page }, testInfo) => {
  const harness = await boot(context, page, (storage) => {
    storage.cloudAccounts_local = [
      ...(storage.cloudAccounts_local as { id: string }[]).filter((card) => card.id !== "acct-fixture-cal"),
      { id: "acct-fixture-cal", family: "google", label: ANNA.email, verifiedProviderIdentity: { issuer: "google", subject: ANNA.subject }, services: { files: { provider: "drive" }, calendar: { pimAccountId: "pim-fixture-1" } } },
    ];
    // The calendar's slot as the one sign-in leaves it: the client, no token of its own.
    storage["secret_pim_local_pim-fixture-1"] = { kind: "google", clientId: CLIENT.clientId, refreshToken: "" };
  }, true);
  harness.answerApis = true;
  harness.choice = { account: ANNA.email };
  await openGoogleCard(page);

  // No sign-in on this phone: the state IS the button.
  const signIn = page.getByTestId("cloudacct-signin");
  await expect(signIn).toHaveText("Sign in");
  if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: testInfo.outputPath("signin-needed.png") });
  await signIn.click();
  await expect.poll(() => cardGrant(page), { timeout: 15000 }).not.toBeNull();
  await expect(page.getByTestId("cloudacct-signin")).toHaveCount(0, { timeout: 15000 });

  // Files through the vault's slot and the card's sign-in, the calendar the page shows.
  await page.getByTestId("cloudacct-check-open").click();
  await expect(page.getByTestId("cloudacct-check-files")).toHaveAttribute("data-state", "ok", { timeout: 15000 });
  await expect(page.getByTestId("cloudacct-check-calendar")).toHaveAttribute("data-state", "ok", { timeout: 15000 });
  if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: testInfo.outputPath("check-ok.png") });
  await page.locator(".m-sheet-backdrop").click({ position: { x: 10, y: 10 } });

  // Signed out on this phone: the grant goes, the account and its services stay.
  await page.getByTestId("cloudacct-signout").click();
  await expect.poll(() => cardGrant(page), { timeout: 15000 }).toBeNull();
  await expect(page.getByTestId("cloudacct-signin")).toHaveText("Sign in", { timeout: 15000 });
  const cards = JSON.parse((await page.evaluate(() => localStorage.getItem("CapacitorStorage.cloudAccounts_local"))) ?? "[]") as { id: string; services: Record<string, unknown> }[];
  expect(cards.find((card) => card.id === "acct-fixture-cal")?.services).toMatchObject({ files: { provider: "drive" }, calendar: { pimAccountId: "pim-fixture-1" } });
  if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: testInfo.outputPath("signed-out.png") });

  // And in again, from the same button.
  await page.getByTestId("cloudacct-signin").click();
  await expect.poll(() => cardGrant(page), { timeout: 15000 }).not.toBeNull();
  await expect(page.getByTestId("cloudacct-signin")).toHaveCount(0, { timeout: 15000 });
});

/*
 * Plan "Verbinden", V1-V3, on the phone: one structure for every account - the
 * head with one state, the services with their pages, the access, the check
 * with an action per row, the end. The desktop runs the same cases in
 * `apps/desktop/e2e/account-sign-in.spec.ts`.
 */

const CALENDAR_SCOPES = ["https://www.googleapis.com/auth/calendar", "https://www.googleapis.com/auth/tasks"];
const LOCAL_KEY = Buffer.from("local").toString("base64");

/** Anna's card with files and the fixture calendar, as the V0 case seeds it. */
const withGoogleCalendar = (storage: Record<string, unknown>) => {
  storage.cloudAccounts_local = [
    ...(storage.cloudAccounts_local as { id: string }[]).filter((card) => card.id !== "acct-fixture-cal"),
    { id: "acct-fixture-cal", family: "google", label: ANNA.email, verifiedProviderIdentity: { issuer: "google", subject: ANNA.subject }, services: { files: { provider: "drive" }, calendar: { pimAccountId: "pim-fixture-1" } } },
  ];
  storage["secret_pim_local_pim-fixture-1"] = { kind: "google", clientId: CLIENT.clientId, refreshToken: "" };
};
const storedCards = async (page: Page) => JSON.parse((await page.evaluate(() => localStorage.getItem("CapacitorStorage.cloudAccounts_local"))) ?? "[]") as { id: string; services: Record<string, unknown> }[];
const openCard = async (page: Page, label: string) => {
  await page.locator('[data-testid="nav-settings"]').first().click();
  await page.locator('[data-testid="settings-area-cloudAccounts"]').click();
  await page.getByTestId("cloudacct-row").filter({ hasText: label }).click();
  await expect(page.getByTestId("cloudacct-detail")).toBeVisible();
};

test("a Google account leads from the list to its calendar page and back, in five fixed sections", async ({ context, page }, testInfo) => {
  const harness = await boot(context, page, withGoogleCalendar, true);
  harness.answerApis = true;
  harness.choice = { account: ANNA.email };
  await openGoogleCard(page);
  await page.getByTestId("cloudacct-signin").click();
  await expect(page.getByTestId("cloudacct-state")).toHaveAttribute("data-state", "connected", { timeout: 15000 });

  // The services in their order; mail is off, not missing.
  const services = page.locator('[data-testid^="cloudacct-service-"]');
  expect(await services.evaluateAll((rows) => rows.map((row) => `${row.getAttribute("data-testid")}=${row.getAttribute("data-on")}`)))
    .toEqual(["cloudacct-service-files=true", "cloudacct-service-calendar=true", "cloudacct-service-mail=false"]);
  await expect(page.getByTestId("cloudacct-access")).toBeVisible();
  await expect(page.getByTestId("cloudacct-check-open")).toBeVisible();
  await expect(page.getByTestId("cloudacct-signout")).toBeVisible();
  await expect(page.getByTestId("cloudacct-remove")).toBeVisible();
  if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: testInfo.outputPath("google-account-page.png"), fullPage: true });

  // The calendar page of THIS account.
  await page.getByTestId("cloudacct-service-calendar").getByText("Calendar", { exact: false }).first().click();
  await expect(page.getByTestId("account-service-calendar")).toBeVisible();
  await expect(page.getByTestId("account-service-switch")).toBeVisible();
  await expect(page.getByTestId("account-calendar-primary")).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId("account-service-global")).toBeVisible();
  if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: testInfo.outputPath("google-calendar-page.png"), fullPage: true });
  await page.getByRole("button", { name: "Back" }).first().click();
  await expect(page.getByTestId("cloudacct-detail")).toBeVisible();
});

test("the check names a service that was never granted, and its action grants it", async ({ context, page }) => {
  const harness = await boot(context, page, withGoogleCalendar, true);
  harness.answerApis = true;
  // The first consent leaves the calendar unticked.
  harness.choice = { account: ANNA.email, untick: CALENDAR_SCOPES };
  await openGoogleCard(page);
  await page.getByTestId("cloudacct-signin").click();
  await expect.poll(() => cardGrant(page), { timeout: 15000 }).not.toBeNull();

  await page.getByTestId("cloudacct-check-open").click();
  await expect(page.getByTestId("cloudacct-check-files")).toHaveAttribute("data-state", "ok", { timeout: 15000 });
  await expect(page.getByTestId("cloudacct-check-calendar")).toHaveAttribute("data-state", "notGranted", { timeout: 15000 });
  harness.choice = { account: ANNA.email };
  await page.getByTestId("cloudacct-check-action-calendar-grant").click();

  await expect.poll(async () => String(await cardGrant(page)), { timeout: 15000 }).toContain("https://www.googleapis.com/auth/calendar");
  await page.getByTestId("cloudacct-check-open").click();
  await expect(page.getByTestId("cloudacct-check-calendar")).toHaveAttribute("data-state", "ok", { timeout: 15000 });
});

test("removing a Google account says what goes and what stays, and takes the card out", async ({ context, page }) => {
  await boot(context, page, withGoogleCalendar, true);
  await openGoogleCard(page);
  await page.getByTestId("cloudacct-remove").click();
  await expect(page.getByText(/Stays:/)).toBeVisible();
  await expect(page.getByText(/nothing is deleted at the provider/)).toBeVisible();
  await page.getByTestId("confirm-act").click();
  await expect.poll(async () => (await storedCards(page)).some((card) => card.id === "acct-fixture-cal"), { timeout: 15000 }).toBe(false);
  await expect(page.getByTestId("cloudacct-row").filter({ hasText: ANNA.email })).toHaveCount(0);
});

/** The local vault on a WebDAV server, its card signed in with a password. */
const withWebDav = (storage: Record<string, unknown>) => {
  storage.cloudAccounts_local = [
    ...(storage.cloudAccounts_local as { id: string }[]).filter((card) => card.id !== "acct-fixture-cal"),
    { id: "card-dav", family: "webdav", label: "anna@dav.example", services: { files: { provider: "webdav" } } },
  ];
  const registry = storage.vault_registry as { vaults: { id: string }[] };
  registry.vaults = registry.vaults.map((vault) => (vault.id === "local" ? { ...vault, provider: "webdav", paused: true } : vault));
  storage.secret_sync_provider_mobile_local = { provider: "webdav", creds: { url: "https://dav.example/files/anna/", user: "anna", pass: "secret" } };
};
const davPassword = async (page: Page) => (JSON.parse((await page.evaluate(() => localStorage.getItem("CapacitorStorage.secret_sync_provider_mobile_local"))) ?? "{}") as { creds?: { pass?: string } }).creds?.pass ?? null;

test("a WebDAV account shows its server and user, checks its files, signs out here and in again with the password", async ({ context, page }, testInfo) => {
  await boot(context, page, withWebDav);
  await openCard(page, "anna@dav.example");

  await expect(page.getByTestId("cloudacct-state")).toHaveAttribute("data-state", "connected");
  await expect(page.getByTestId("cloudacct-service-files")).toHaveAttribute("data-on", "true");
  await expect(page.getByTestId("cloudacct-service-mail")).toHaveCount(0);
  await expect(page.getByText("https://dav.example/files/anna/")).toBeVisible();

  await page.getByTestId("cloudacct-check-open").click();
  await expect(page.getByTestId("cloudacct-check-files")).toHaveAttribute("data-state", "ok", { timeout: 15000 });
  await page.locator(".m-sheet-backdrop").click({ position: { x: 10, y: 10 } });

  await page.getByTestId("cloudacct-signout").click();
  await expect.poll(() => davPassword(page), { timeout: 15000 }).toBe("");
  await expect(page.getByTestId("cloudacct-state")).toHaveAttribute("data-state", "signin", { timeout: 15000 });
  if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: testInfo.outputPath("webdav-signed-out.png"), fullPage: true });

  // "Sign in" opens the password of this account. Storing it needs the phone's
  // protected storage (Keychain/Keystore), which a browser does not have.
  await page.getByTestId("cloudacct-signin").click();
  await expect(page.getByTestId("account-password-change")).toBeVisible();
  await expect(page.getByTestId("cloudacct-new-password")).toBeVisible();
  if (process.env.PLAINVA_EVIDENCE) {
    await page.getByTestId("account-password-change").scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath("webdav-password-panel.png") });
  }

  await page.getByTestId("cloudacct-remove").click();
  await page.getByTestId("confirm-act").click();
  await expect.poll(async () => (await storedCards(page)).some((card) => card.id === "card-dav"), { timeout: 15000 }).toBe(false);
});

/** An IMAP mailbox on the local vault, signed in with a password. */
const withImap = (storage: Record<string, unknown>) => {
  storage.cloudAccounts_local = [
    ...(storage.cloudAccounts_local as { id: string }[]),
    { id: "card-imap", family: "imap", label: "anna@mail.example", services: { mail: { mailAccountId: "m-imap" } } },
  ];
  storage[`mailAccounts_${LOCAL_KEY}`] = [
    ...((storage[`mailAccounts_${LOCAL_KEY}`] as unknown[]) ?? []),
    { id: "m-imap", label: "anna@mail.example", host: "imap.mail.example", port: 993, user: "anna@mail.example", smtpHost: "smtp.mail.example", smtpPort: 587, kind: "imap" },
  ];
  // The mail module's slot on the phone, under both its names, with its `pass`.
  storage[`secret_mail_${LOCAL_KEY}_m-imap`] = { pass: "secret" };
  storage[`secret_mail_m-imap_${LOCAL_KEY}`] = { pass: "secret" };
};

/*
 * A browser has no raw socket, so the phone's IMAP client refuses every
 * request here (`MailImapUnavailableError`): the check shows a mail row that
 * does not work and its action; signing in again with a password, which asks
 * the server first, cannot be shown without the native socket.
 */
test("an IMAP account: the same sections, a check that names the failing mailbox and its action, sign out and remove", async ({ context, page }) => {
  await boot(context, page, withImap);
  await openCard(page, "anna@mail.example");

  await expect(page.getByTestId("cloudacct-service-mail")).toHaveAttribute("data-on", "true");
  await expect(page.getByTestId("cloudacct-service-files")).toHaveCount(0);
  await expect(page.getByText("imap.mail.example")).toBeVisible();

  await page.getByTestId("cloudacct-check-open").click();
  await expect(page.getByTestId("cloudacct-check-mail")).toHaveAttribute("data-state", "failed", { timeout: 15000 });
  await expect(page.locator('[data-testid^="cloudacct-check-action-mail-"]')).toHaveCount(1);
  await page.locator(".m-sheet-backdrop").click({ position: { x: 10, y: 10 } });

  await page.getByTestId("cloudacct-signout").click();
  await expect(page.getByTestId("cloudacct-state")).toHaveAttribute("data-state", "signin", { timeout: 15000 });
  await expect(page.getByTestId("cloudacct-signin")).toHaveText("Sign in");

  await page.getByTestId("cloudacct-remove").click();
  await page.getByTestId("confirm-act").click();
  await expect.poll(async () => (await storedCards(page)).some((card) => card.id === "card-imap"), { timeout: 15000 }).toBe(false);
});

/*
 * A first connect from nothing (device finding 2026-10-27, TestFlight 146):
 * no card, no slot, no cloud vault. Google is chosen with files and a
 * calendar, the sign-in returns, "Connect" opens the Drive folder picker, a
 * folder is taken. On the iPhone the wizard then stood on step 1, files,
 * again - with nothing said. Everything after the pick was dropped in
 * silence: an error, the long read of the cloud folder, a cancelled copy.
 * The wizard's own end-to-end test never got past the files form (it ran
 * without the index the files step needs), so none of this was ever run.
 */
async function firstGoogleConnect(context: BrowserContext, page: Page, access: "own" | "standard" = "own", withMail = false): Promise<Harness> {
  const harness = await boot(context, page, (storage) => {
    // The standard sign-in: the client this build ships (the e2e build, `scripts/e2e-build-env.mjs`).
    if (access === "standard") storage.secret_oauth_access_google = { source: "plainva" };
    storage.cloudAccounts_local = (storage.cloudAccounts_local as { id: string }[]).filter((card) => card.id !== "acct-fixture-cal");
    const registry = storage.vault_registry as { vaults: Record<string, unknown>[] };
    registry.vaults = registry.vaults.map((vault) => {
      if (vault.id !== "local") return vault;
      const rest = { ...vault };
      delete rest.provider;
      delete rest.paused;
      return rest;
    });
    delete storage.secret_sync_provider_mobile_local;
  });
  harness.answerApis = true;
  page.on("pageerror", (error) => console.log("PAGE ERROR:", error.message));

  await page.locator('[data-testid="nav-settings"]').first().click();
  await page.locator('[data-testid="settings-area-cloudAccounts"]').click();
  await page.getByTestId("cloudacct-connect").click();
  await page.getByTestId("connect-family-google").click();
  await page.getByTestId("connect-service-files").click();
  await page.getByTestId("connect-service-calendar").click();
  if (withMail) await page.getByTestId("connect-service-mail").click();
  await page.getByTestId("connect-start").click();

  // Back from Google: the setup's frame on its folder step, the sign-in counted as done
  // (plan "Verbinden-Assistent", E1). Provider and sign-in are settled, so the step does not
  // ask for them again (E5).
  await expect(page.getByTestId("connectrun-frame")).toHaveAttribute("data-step", "files", { timeout: 20000 });
  await expect(page.locator('[data-testid="connectrun-steps"] li')).toHaveCount(withMail ? 4 : 3);
  await expect(page.locator('[data-testid="connectrun-steps"] li[data-state="done"]')).toHaveText(["Sign in"]);
  await expect(page.getByTestId("connectrun-account")).toContainText(ANNA.email);
  await expect(page.getByTestId("vault-access")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Connect", exact: true })).toHaveCount(0);
  return harness;
}

/** The step on screen, as the frame names it. */
async function expectStep(page: Page, step: "files" | "calendar" | "mail" | "summary"): Promise<void> {
  await expect(page.getByTestId("connectrun-frame")).toHaveAttribute("data-step", step, { timeout: 20000 });
}

/** "Choose folder", then the folder picker's own folder. */
async function connectAndPick(page: Page): Promise<void> {
  await page.getByTestId("connectrun-choose-folder").click();
  await page.getByRole("button", { name: "Use this folder" }).click({ timeout: 15000 });
}


test("a first Google connect from nothing goes from the files step on to the next one", async ({ context, page }, testInfo) => {
  await firstGoogleConnect(context, page);
  await connectAndPick(page);
  // The vault the run started in has nothing local to copy: no question, straight on.
  try {
    await expectStep(page, "calendar");
  } finally {
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: testInfo.outputPath("first-connect-step-2.png"), fullPage: true });
  }
});

test("a files step that fails after the folder pick says why, with its sender", async ({ context, page }, testInfo) => {
  // An iPhone's width: the step label and a long message share the banner (device finding 2026-10-27).
  await page.setViewportSize({ width: 375, height: 812 });
  await firstGoogleConnect(context, page);
  // From now on Google cannot say whose account this is.
  await context.route("https://openidconnect.googleapis.com/v1/userinfo", (route) => route.fulfill({ status: 500, contentType: "application/json", body: "{}" }));
  await connectAndPick(page);
  try {
    await expect(page.getByTestId("connectrun-outcome")).toHaveText(/identity could not be verified/, { timeout: 20000 });
  } finally {
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: testInfo.outputPath("first-connect-failed.png"), fullPage: true });
  }
  await expectStep(page, "files");
  await expect(page.getByTestId("connectrun-choose-folder")).toBeEnabled();
  // The sender first: Plainva could not confirm whose account this is - its own check, not a refusal.
  await expect(page.getByTestId("connectrun-outcome")).toHaveAttribute("data-source", "plainva");
  await expect(page.getByTestId("connectrun-signin")).toBeVisible();
  // Nothing in the frame is squeezed below a few characters: the step label broke letter by letter.
  const squeezed = await page.locator(".m-connectrun").evaluate((root) => [...root.querySelectorAll("span, button, strong")]
    .filter((el) => (el.textContent ?? "").trim().length > 0 && el.children.length === 0)
    .map((el) => {
      const text = (el.textContent ?? "").trim();
      const size = parseFloat(getComputedStyle(el).fontSize);
      return { text: text.slice(0, 24), width: Math.round(el.getBoundingClientRect().width), min: Math.round(Math.min(4, text.length) * size * 0.5) };
    })
    .filter((entry) => entry.width < entry.min));
  expect(squeezed).toEqual([]);
  const labels = await page.locator(".pv-wizstep-label").evaluateAll((els) => els.map((el) => ({ height: el.getBoundingClientRect().height, line: parseFloat(getComputedStyle(el).lineHeight) || parseFloat(getComputedStyle(el).fontSize) * 1.4 })));
  for (const label of labels) expect(label.height, "a step label stays on one line").toBeLessThanOrEqual(label.line + 1);
});

test("leaving the wizard after the sign-in keeps the account, with its services off (device finding 2026-10-27)", async ({ context, page }, testInfo) => {
  await firstGoogleConnect(context, page);
  // "Stop" asks first (E2); keeping on changes nothing.
  await page.getByTestId("connectrun-cancel").click();
  await expect(page.getByText("Stop the setup?")).toBeVisible();
  await page.getByRole("button", { name: "Continue setup" }).click();
  await expectStep(page, "files");
  await page.getByTestId("connectrun-cancel").click();
  await page.getByTestId("confirm-act").click();
  // Back from the wizard's provider list to the accounts.
  await page.getByRole("button", { name: "Back" }).first().click();
  try {
    await expect(page.getByTestId("cloudacct-row").filter({ hasText: ANNA.email })).toBeVisible({ timeout: 15000 });
  } finally {
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: testInfo.outputPath("left-wizard-account-stays.png"), fullPage: true });
  }
  await page.getByTestId("cloudacct-row").filter({ hasText: ANNA.email }).click();
  await expect(page.getByTestId("cloudacct-state")).toHaveAttribute("data-state", "connected", { timeout: 15000 });
  await expect(page.getByTestId("cloudacct-service-files")).toHaveAttribute("data-on", "false");
  await expect(page.getByTestId("cloudacct-service-calendar")).toHaveAttribute("data-on", "false");
});

test("a first Google connect with the standard sign-in goes from the files step on to the next one", async ({ context, page }, testInfo) => {
  await firstGoogleConnect(context, page, "standard");
  await connectAndPick(page);
  try {
    await expectStep(page, "calendar");
  } finally {
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: testInfo.outputPath("standard-after-pick.png"), fullPage: true });
  }
});

test("a first Google connect with the standard sign-in and all three services goes on from the files step", async ({ context, page }, testInfo) => {
  await firstGoogleConnect(context, page, "standard", true);
  await connectAndPick(page);
  try {
    await expectStep(page, "calendar");
    await expect(page.locator('[data-testid="connectrun-steps"] li[data-state="done"]')).toHaveText(["Sign in", "Folder"]);
  } finally {
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: testInfo.outputPath("standard-three-after-pick.png"), fullPage: true });
  }
});

/*
 * Device finding 2026-10-27 (TestFlight 147): a Google card with a sign-in,
 * files working, its calendar "not signed in" - and signing in again from the
 * check changed nothing. An older calendar row of the same account, folded
 * into the card first, was the row the check read and the row line showed,
 * while the sign-in bound the row the card's record names.
 */
test("a calendar not signed in under a signed-in card says so on its row, and signing in from the check repairs it", async ({ context, page }, testInfo) => {
  const harness = await boot(context, page, withGoogleCalendar, true);
  harness.answerApis = true;
  harness.choice = { account: ANNA.email };
  // An older calendar row of the same account, without a sign-in, listed first.
  harness.sql.run("plainva-index", "INSERT OR REPLACE INTO pim_accounts (id, provider, label, config, enabled) VALUES (?, ?, ?, ?, 1)", ["pim-a-old", "google", "Anna@gmail.com", JSON.stringify({ clientId: "fixture-client" })]);
  await page.reload();
  await waitForVaultDirectory(page);
  await openGoogleCard(page);
  await page.getByTestId("cloudacct-signin").click();
  await expect(page.getByTestId("cloudacct-state")).toHaveAttribute("data-state", "connected", { timeout: 15000 });
  // The card keeps its sign-in; its calendar's sign-in on this phone is gone.
  await page.evaluate(() => localStorage.removeItem("CapacitorStorage.secret_pim_local_pim-fixture-1"));
  await page.reload();
  await waitForVaultDirectory(page);
  await openGoogleCard(page);
  await expect(page.getByTestId("cloudacct-state")).toHaveAttribute("data-state", "connected", { timeout: 15000 });
  // The card is signed in; its calendar is not - the row says so.
  await expect(page.getByTestId("cloudacct-service-calendar")).toContainText("Not signed in", { timeout: 15000 });

  await page.getByTestId("cloudacct-check-open").click();
  await expect(page.getByTestId("cloudacct-check-files")).toHaveAttribute("data-state", "ok", { timeout: 15000 });
  await expect(page.getByTestId("cloudacct-check-calendar")).toHaveAttribute("data-state", "signin", { timeout: 15000 });
  await page.getByTestId("cloudacct-check-action-calendar-signIn").click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("CapacitorStorage.secret_pim_local_pim-fixture-1")), { timeout: 15000 }).not.toBeNull();

  await page.getByTestId("cloudacct-check-open").click();
  try {
    await expect(page.getByTestId("cloudacct-check-calendar")).toHaveAttribute("data-state", "ok", { timeout: 15000 });
  } finally {
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: testInfo.outputPath("calendar-repaired-check.png"), fullPage: true });
  }
  await page.locator(".m-sheet-backdrop").click({ position: { x: 10, y: 10 } });
  await expect(page.getByTestId("cloudacct-service-calendar")).not.toContainText("Not signed in");
  await expect(page.getByTestId("cloudacct-service-calendar")).not.toContainText("waiting");
});

/**
 * A Drive folder "Vault" with `count` notes, answered ahead of the generic API
 * stand-in. Downloads wait for `release()`, so a test can tell "the step went
 * on" from "the files arrived".
 */
async function driveVaultFolder(context: BrowserContext, count: number) {
  const notes = Array.from({ length: count }, (_, i) => ({ id: `n${i + 1}`, name: `Note ${i + 1}.md`, mimeType: "text/markdown", md5Checksum: `m${i + 1}`, modifiedTime: "2026-10-20T10:00:00.000Z" }));
  const state = { started: 0, finished: 0, release: () => {} };
  const released = new Promise<void>((resolve) => { state.release = resolve; });
  const json = (body: unknown) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  await context.route((url) => url.href.startsWith("https://www.googleapis.com/drive/v3/files"), async (route) => {
    const url = new URL(route.request().url());
    const media = /\/files\/(n\d+)$/.exec(url.pathname);
    if (media && url.searchParams.get("alt") === "media") {
      state.started++;
      await released;
      state.finished++;
      await route.fulfill({ status: 200, contentType: "text/markdown", body: `# ${media[1]}\n` });
      return;
    }
    const q = url.searchParams.get("q") ?? "";
    if (route.request().method() === "GET" && q) {
      if (/name='Vault' and 'root' in parents/.test(q)) return route.fulfill(json({ files: [{ id: "vault-id", name: "Vault" }] }));
      if (/^'root' in parents and mimeType='application\/vnd\.google-apps\.folder'/.test(q)) return route.fulfill(json({ files: [{ id: "vault-id", name: "Vault" }] }));
      if (/^'vault-id' in parents and mimeType=/.test(q)) return route.fulfill(json({ files: [] }));
      if (/^'vault-id' in parents and trashed=false$/.test(q)) return route.fulfill(json({ files: notes }));
    }
    await route.fallback();
  });
  return state;
}

test("a first connect onto a folder with many files goes on to step 2 before a file is pulled, and the files arrive through the sync", async ({ context, page }, testInfo) => {
  await firstGoogleConnect(context, page);
  const drive = await driveVaultFolder(context, 60);
  await page.getByTestId("connectrun-choose-folder").click();
  await page.getByRole("button", { name: "Vault" }).click({ timeout: 15000 });
  await page.getByRole("button", { name: "Use this folder" }).click();
  // Nothing of the folder is read up front: the run is on its next step while no file has come in.
  try {
    await expectStep(page, "calendar");
  } finally {
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: testInfo.outputPath("many-files-step-2.png"), fullPage: true });
  }
  expect(drive.finished).toBe(0);
  // The sync takes them in, in the background.
  drive.release();
  await expect.poll(() => drive.finished, { timeout: 60000 }).toBe(60);
});

/*
 * Plan "Verbinden-Assistent" (2026-10-28), E6: a step can be left out, and the
 * setup ends on a summary that names it - no account change to advance on, so
 * the summary comes from the skip itself.
 */
test("skipping the calendar ends the setup on a summary that names it, and Done leaves", async ({ context, page }, testInfo) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await firstGoogleConnect(context, page);
  if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: testInfo.outputPath("setup-folder-step.png"), fullPage: true });
  await connectAndPick(page);
  await expectStep(page, "calendar");
  await page.getByTestId("connectrun-skip").click();
  try {
    await expectStep(page, "summary");
    await expect(page.getByTestId("connectrun-summary-files")).toHaveAttribute("data-state", "connected");
    await expect(page.getByTestId("connectrun-summary-calendar")).toHaveAttribute("data-state", "skipped");
    await expect(page.locator('[data-testid="connectrun-steps"] li[data-state="skipped"]')).toHaveText(["Calendar"]);
  } finally {
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: testInfo.outputPath("setup-summary.png"), fullPage: true });
  }
  await page.getByTestId("connectrun-done").click();
  await expect(page.getByTestId("connectrun-frame")).toHaveCount(0, { timeout: 15000 });
});

/*
 * Device finding 2026-10-28 (TestFlight 150): with the vault's files on a
 * Google account, a Microsoft account for calendar and mail came back from
 * Microsoft's sign-in to the service choice, and nothing went on.
 */
test("a Microsoft account for calendar and mail, next to a Google account that carries the files, goes on to its calendar step", async ({ context, page }, testInfo) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await boot(context, page, (storage) => {
    storage.secret_oauth_access_microsoft = { source: "plainva" };
  });
  page.on("pageerror", (error) => console.log("PAGE ERROR:", error.message));
  await page.locator('[data-testid="nav-settings"]').first().click();
  await page.locator('[data-testid="settings-area-cloudAccounts"]').click();
  await page.getByTestId("cloudacct-connect").click();
  await page.getByTestId("connect-family-microsoft").click();
  try {
    // Files go through one account per vault: Google carries them, so they are offered off, named.
    await expect(page.getByTestId("connect-service-files")).toBeDisabled();
    await expect(page.getByTestId("connect-service-files")).toContainText(ANNA.email);
    await page.getByTestId("connect-service-calendar").click();
    await page.getByTestId("connect-service-mail").click();
    await page.getByTestId("connect-start").click();
    await expectStep(page, "calendar");
    await expect(page.getByTestId("connectrun-account")).toContainText(CARLA.email);
  } finally {
    if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: testInfo.outputPath("microsoft-next-to-google.png"), fullPage: true });
  }
});
