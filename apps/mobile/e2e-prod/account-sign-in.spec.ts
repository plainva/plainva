import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { fixtureStorage, installSqlBridge } from "../scripts/screenshot-fixture.mjs";
import { FakeOAuthProvider, type FakeConsentChoice } from "../../../packages/ui/src/testing/fakeOAuthProvider";
import { waitForVaultDirectory } from "./exampleVault";

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
// An iOS-type client: the phone's own Google access has no secret.
const CLIENT = { clientId: "1234-plainva-test.apps.googleusercontent.com" };

interface Harness {
  provider: FakeOAuthProvider;
  choice: FakeConsentChoice;
  /**
   * Answer Google's APIs (Drive, Calendar, Tasks) - each only for an access
   * token whose grant covers it, the way Google answers. Off, they are blocked.
   */
  answerApis: boolean;
}

const API_SCOPES: [prefix: string, scope: string][] = [
  ["https://www.googleapis.com/drive/", "https://www.googleapis.com/auth/drive"],
  ["https://www.googleapis.com/upload/drive/", "https://www.googleapis.com/auth/drive"],
  ["https://www.googleapis.com/calendar/", "https://www.googleapis.com/auth/calendar"],
  ["https://tasks.googleapis.com/", "https://www.googleapis.com/auth/tasks"],
  ["https://www.googleapis.com/tasks/", "https://www.googleapis.com/auth/tasks"],
];

async function boot(context: BrowserContext, page: Page, seed?: (storage: Record<string, unknown>) => void, withCalendar = false): Promise<Harness> {
  const harness: Harness = { provider: new FakeOAuthProvider({ family: "google", accounts: [ANNA, BERT], clients: [CLIENT] }), choice: {}, answerApis: false };
  const origin = new URL(test.info().project.use.baseURL ?? "http://localhost:4174").origin;
  await context.route((url) => url.origin !== origin, async (route) => {
    const url = route.request().url();
    if (url.startsWith("https://oauth2.googleapis.com/") || url.startsWith("https://openidconnect.googleapis.com/")) {
      const response = await harness.provider.fetch(url, { method: route.request().method(), headers: route.request().headers(), body: route.request().postData() ?? undefined });
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
    await route.abort("blockedbyclient");
  });
  const sql = await installSqlBridge(context);

  // The browser step: the consent URL the app opened, answered by the provider,
  // and its redirect handed back as the system would.
  await context.exposeFunction("__fakeConsent", (url: string) => {
    const params = new URL(url).searchParams;
    try {
      const code = harness.provider.consent({
        clientId: params.get("client_id") ?? "",
        scope: params.get("scope") ?? "",
        loginHint: params.get("login_hint") ?? undefined,
        codeChallenge: params.get("code_challenge") ?? undefined,
        redirectUri: params.get("redirect_uri") ?? undefined,
      }, harness.choice);
      return `${params.get("redirect_uri")}?code=${encodeURIComponent(code)}&state=${encodeURIComponent(params.get("state") ?? "")}`;
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
  await page.getByTestId("cloudacct-service-calendar").getByRole("button").click();

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
  await page.getByTestId("cloudacct-service-calendar").getByRole("button").click();

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
