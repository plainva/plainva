/* eslint-disable @typescript-eslint/no-explicit-any */
import { test, expect, type Page } from '@playwright/test';
import { FakeOAuthProvider, type FakeConsentChoice } from '../../../packages/ui/src/testing/fakeOAuthProvider';

/**
 * The one account sign-in on the desktop, against a stand-in for Google
 * (account sign-in plan E6).
 *
 * Every round of account fixes since June ended with "not run against a real
 * provider". The provider here behaves the way Google documents and was seen to
 * behave - granular consent, the identity from userinfo, a second account in
 * the same browser - and lives in the test process. The app reaches it through
 * the Tauri boundary: the browser that opens is the provider's consent screen,
 * the loopback hands back its code, and every request to the token endpoint
 * and to userinfo is answered by it.
 *
 * What a fake cannot show is that Google itself still behaves this way; what it
 * holds is the app's side of the two findings of 2026-10-23: a service left
 * unticked at the consent says so on its own row while the others connect, and
 * signing a card in again with another account changes nothing.
 *
 * The phone runs the same two flows in `apps/mobile/e2e-prod/account-sign-in.spec.ts`.
 */

const ANNA = { subject: 'sub-anna', email: 'anna@gmail.example' };
const BERT = { subject: 'sub-bert', email: 'bert@gmail.example' };
const CLIENT = { clientId: '1234-plainva-test.apps.googleusercontent.com', clientSecret: 'own-secret' };
const CALENDAR_SCOPES = ['https://www.googleapis.com/auth/calendar', 'https://www.googleapis.com/auth/tasks'];

interface Harness {
  provider: FakeOAuthProvider;
  /** What the person does on the next consent screen. */
  choice: FakeConsentChoice;
}

interface Seed {
  cards?: unknown[];
  keychain?: Record<string, string>;
  splash?: boolean;
  pickDir?: string;
  pim?: { id: string; label: string };
  /** Further settings entries (a mailbox list, say). */
  settings?: Record<string, unknown>;
}

async function wire(page: Page, seed: Seed = {}): Promise<Harness> {
  const harness: Harness = {
    provider: new FakeOAuthProvider({ family: 'google', accounts: [ANNA, BERT], clients: [CLIENT] }),
    choice: {},
  };
  page.on('pageerror', (err) => console.log('PAGE ERROR:', err.message));
  page.on('console', (msg) => { if (process.env.TRACE_E2E) console.log('PAGE:', msg.text()); });

  // The browser step: the consent URL the app opened, answered by the provider.
  await page.exposeFunction('__fakeConsent', (url: string) => {
    const params = new URL(url).searchParams;
    try {
      const code = harness.provider.consent({
        clientId: params.get('client_id') ?? '',
        scope: params.get('scope') ?? '',
        loginHint: params.get('login_hint') ?? undefined,
        codeChallenge: params.get('code_challenge') ?? undefined,
        redirectUri: params.get('redirect_uri') ?? undefined,
      }, harness.choice);
      return { code, state: params.get('state') };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  });
  // The provider's endpoints: token and userinfo.
  await page.exposeFunction('__fakeFetch', async (url: string, method: string, headers: [string, string][], body: string) => {
    const response = await harness.provider.fetch(url, { method, headers, body });
    return { status: response.status, body: await response.text() };
  });

  await page.addInitScript((seedIn: { cards: unknown[]; keychain: Record<string, string>; client: typeof CLIENT; splash: boolean; pickDir: string | null; pim: { id: string; label: string } | null; settings: Record<string, unknown> }) => {
    const fs: Record<string, any> = {
      '/test-vault': { isDir: true },
      '/test-vault/.plainva': { isDir: true },
      '/test-vault/Todo.md': '# Todo\nSome note content.',
    };
    // The local folder the person picks for an online vault, empty.
    if (seedIn.pickDir) fs[seedIn.pickDir] = { isDir: true };
    const noteRows = () =>
      Object.keys(fs)
        .filter((p) => !fs[p].isDir && p.startsWith('/test-vault/') && !p.includes('/.plainva/'))
        .map((p) => {
          const rel = p.replace('/test-vault/', '');
          return { path: rel, title: rel.split('/').pop()!.replace(/\.(md|base)$/i, ''), mode: 'obsidian', mtime_local: 1000, ctime: 500 };
        });
    const vaultKey = btoa('/test-vault');
    const settings = new Map<string, unknown>([
      ['lastVaultPath', '/test-vault'],
      ['recentVaults', ['/test-vault']],
      ['autoOpenLastVault', !seedIn.splash],
      ['whatsNewSeenVersion', '9.9.9'],
      [`okfPromptDismissed_${vaultKey}`, true],
      [`backupZipEnabled_${vaultKey}`, false],
      [`cloudAccounts_${vaultKey}`, seedIn.cards],
      ...Object.entries(seedIn.settings),
    ]);
    // This device signs in to Google with an own client (no Plainva client in the test build).
    const keychain = new Map<string, string>([
      ['oauth_access_google', JSON.stringify({ source: 'own', clientId: seedIn.client.clientId, clientSecret: seedIn.client.clientSecret })],
      ...Object.entries(seedIn.keychain),
    ]);
    (window as any).__trace = true;
    (window as any).__settings = settings;
    (window as any).__keychain = keychain;

    let redirect: { code: string; state: string | null } | { error: string } | null = null;
    // The seeded calendar row, until the account is removed.
    let pimGone = false;
    const responses = new Map<number, { status: number; url: string; body: string; read: boolean; type?: string }>();
    // A WebDAV server that lets anyone in: an empty folder for every listing.
    const isDav = (url: string) => url.startsWith('https://dav.example/');
    const EMPTY_LISTING = '<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"><d:response><d:href>/files/anna/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>';
    let nextRequest = 1;
    const isProvider = (url: string) => url.startsWith('https://oauth2.googleapis.com/') || url.startsWith('https://openidconnect.googleapis.com/');
    // Anything else of Google's (the Drive sync starting up) gets an empty answer.
    const otherGoogle = (method: string): unknown => (method === 'GET' ? { files: [], items: [] } : { id: 'created-1', name: 'Plainva' });

    (window as any).__TAURI_INTERNALS__ = {
      plugins: { path: { sep: '/' } },
      transformCallback: () => 1,
      invoke: async (cmd: string, args: any, options: any) => {
        if ((window as any).__trace && !cmd.startsWith('plugin:fs') && !cmd.startsWith('plugin:sql') && !cmd.startsWith('plugin:path') && !cmd.startsWith('checked_')) console.log('INVOKE ' + cmd + ' ' + JSON.stringify(args ?? {}).slice(0, 160));
        if (cmd === 'plugin:path|normalize') {
          let p = args.path.replace(/\\/g, '/');
          while (p.includes('//')) p = p.replace('//', '/');
          return p;
        }
        if (cmd === 'plugin:path|join') return args.paths.join('/').replace(/\\/g, '/').replace(/\/+/g, '/');
        if (cmd === 'plugin:app|version') return '9.9.9';
        if (cmd === 'plugin:store|load') return 1;
        if (cmd === 'plugin:store|get') return settings.has(args.key) ? [settings.get(args.key), true] : [null, false];
        if (cmd === 'plugin:store|set') { settings.set(args.key, args.value); return null; }
        if (cmd === 'plugin:store|delete') return settings.delete(args.key);
        if (cmd === 'plugin:store|save') return null;

        if (cmd === 'keychain_get') return keychain.get(args.key) ?? null;
        if (cmd === 'keychain_set') { keychain.set(args.key, args.value); return null; }
        if (cmd === 'keychain_delete') { keychain.delete(args.key); return null; }
        if (cmd === 'keychain_compare_and_set') {
          if ((keychain.get(args.key) ?? null) !== (args.expected ?? null)) return false;
          if (args.value === null || args.value === undefined) keychain.delete(args.key);
          else keychain.set(args.key, args.value);
          return true;
        }

        // The consent: the system browser opens on the provider, the loopback
        // receives its redirect.
        if (cmd === 'oauth_loopback_start') return 51234;
        if (cmd === 'plugin:opener|open_url') {
          redirect = await (window as any).__fakeConsent(String(args.url));
          return null;
        }
        if (cmd === 'oauth_loopback_wait') {
          const answer = redirect;
          redirect = null;
          if (!answer) throw new Error('oauth loopback timed out');
          if ('error' in answer) throw new Error(answer.error);
          return answer;
        }
        if (cmd === 'oauth_loopback_cancel') return null;
        // A renewal goes through the token relay.
        if (cmd === 'oauth_token_request') {
          const answer = await (window as any).__fakeFetch(String(args.url), 'POST', [['content-type', 'application/x-www-form-urlencoded']], String(args.body ?? ''));
          return { status: answer.status, body: answer.body };
        }
        if (cmd === 'plugin:http|fetch') {
          const cfg = args.clientConfig;
          const id = nextRequest++;
          const body = cfg.data ? new TextDecoder().decode(new Uint8Array(cfg.data)) : '';
          if (isProvider(cfg.url)) {
            const answer = await (window as any).__fakeFetch(cfg.url, cfg.method, cfg.headers, body);
            responses.set(id, { status: answer.status, url: cfg.url, body: answer.body, read: false });
          } else if (isDav(cfg.url)) {
            responses.set(id, { status: cfg.method === 'PROPFIND' ? 207 : 200, url: cfg.url, body: cfg.method === 'PROPFIND' ? EMPTY_LISTING : '', read: false, type: 'application/xml' });
          } else {
            responses.set(id, { status: 200, url: cfg.url, body: JSON.stringify(otherGoogle(cfg.method)), read: false });
          }
          return id;
        }
        if (cmd === 'plugin:http|fetch_send') {
          const response = responses.get(args.rid)!;
          return { status: response.status, statusText: '', url: response.url, headers: [['content-type', response.type ?? 'application/json']], rid: args.rid };
        }
        if (cmd === 'plugin:http|fetch_read_body') {
          const response = responses.get(args.rid)!;
          if (response.read) return [1];
          response.read = true;
          return [...new TextEncoder().encode(response.body), 0];
        }
        if (cmd === 'plugin:http|fetch_cancel' || cmd === 'plugin:http|fetch_cancel_body') return null;

        if (cmd === 'plugin:dialog|open') return seedIn.pickDir;
        if (cmd === 'plugin:dialog|ask' || cmd === 'plugin:dialog|confirm') return true;
        if (cmd === 'plugin:dialog|message') return String(args?.buttons) === 'OkCancel' ? 'Ok' : 'Yes';
        if (cmd === 'plugin:sql|load') return args.db;
        if (cmd === 'plugin:sql|execute') {
          if (/DELETE FROM pim_accounts/i.test(String(args.query))) pimGone = true;
          return [0, 0];
        }
        if (cmd === 'plugin:sql|select') {
          const q = String(args.query);
          // A Google calendar row of the vault, when the case seeds one.
          if (seedIn.pim && !pimGone && q.includes('FROM pim_accounts')) return [{ id: seedIn.pim.id, provider: 'google', label: seedIn.pim.label, config: '{}', enabled: 1 }];
          if (seedIn.pim && !pimGone && q.includes('FROM pim_calendars')) return [{ account_id: seedIn.pim.id, cal_id: 'cal-anna', name: 'Anna privat', color: '#3366cc', selected: 1, read_only: 0 }];
          if (q.includes('FROM files WHERE is_deleted = 0')) return noteRows();
          if (q.includes('path, title, mode FROM files') || q.includes('FROM files WHERE mode')) return noteRows().map((r) => ({ path: r.path, title: r.title, mode: 'note' }));
          if (q.includes('SELECT path, title FROM files')) return noteRows().map((r) => ({ path: r.path, title: r.title }));
          if (q.includes('SELECT path FROM files')) return noteRows().map((r) => ({ path: r.path }));
          return [];
        }
        if (cmd === 'plugin:sql|select_one') return null;
        if (cmd === 'checked_path_exists' || cmd === 'checked_read_text_file' || cmd === 'checked_read_dir') {
          const root = String(args.rootId).replace(/^mock-root:/, '').replace(/\/$/, '');
          const rel = String(args.relPath).replace(/^\/+/, '');
          const path = rel ? `${root}/${rel}` : root;
          const present = await (window as any).__TAURI_INTERNALS__.invoke('plugin:fs|exists', { path });
          if (cmd === 'checked_path_exists') return present;
          if (!present) return null;
          if (cmd === 'checked_read_dir') {
            const entries = await (window as any).__TAURI_INTERNALS__.invoke('plugin:fs|read_dir', { path });
            return entries.map((entry: any) => ({ name: entry.name, isDirectory: !!entry.isDirectory, isFile: entry.isFile ?? (!entry.isDirectory && !entry.isSymlink), isSymlink: !!entry.isSymlink }));
          }
          const bytes = await (window as any).__TAURI_INTERNALS__.invoke('plugin:fs|read_text_file', { path });
          return typeof bytes === 'string' ? bytes : new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes));
        }
        if (cmd === 'plugin:fs|exists') {
          const p = args.path.endsWith('/') ? args.path.slice(0, -1) : args.path;
          return !!fs[p];
        }
        if (cmd === 'plugin:fs|stat') {
          const p = args.path.endsWith('/') ? args.path.slice(0, -1) : args.path;
          const file = fs[p];
          if (!file) throw new Error('File not found');
          return { isDir: !!file.isDir, isFile: !file.isDir, mtime: Date.now(), size: typeof file === 'string' ? file.length : 0 };
        }
        if (cmd === 'plugin:fs|read_dir') {
          const p = args.path.endsWith('/') ? args.path.slice(0, -1) : args.path;
          const entries: Record<string, any> = {};
          for (const path of Object.keys(fs)) {
            if (path !== p && path.startsWith(p + '/')) {
              const name = path.substring(p.length + 1).split('/')[0];
              if (!entries[name]) {
                const isDir = !!fs[`${p}/${name}`]?.isDir;
                entries[name] = { name, isDirectory: isDir, isFile: !isDir, isSymlink: false };
              }
            }
          }
          return Object.values(entries);
        }
        if (cmd === 'plugin:fs|read_text_file' || cmd === 'plugin:fs|read_file') {
          const rawPath = options?.headers?.path ? decodeURIComponent(options.headers.path) : args?.path || '';
          const p = rawPath.endsWith('/') ? rawPath.slice(0, -1) : rawPath;
          const content = fs[p];
          if (content === undefined || content.isDir) throw new Error('File not found');
          return Array.from(new TextEncoder().encode(content));
        }
        if (cmd === 'register_write_root') return 'mock-root:' + String(args.path).replace(/\/$/, '');
        if (cmd === 'write_file_atomic') {
          const root = String(args.rootId).replace(/^mock-root:/, '');
          const rel = String(args.relPath).replace(/^\/+/, '');
          fs[root ? root + '/' + rel : rel] = args.encoding === 'base64' ? atob(String(args.contents)) : String(args.contents);
          return null;
        }
        if (cmd === 'plugin:fs|write_text_file' || cmd === 'plugin:fs|write_file') {
          const rawPath = options?.headers?.path ? decodeURIComponent(options.headers.path) : args?.path || '';
          const p = rawPath.endsWith('/') ? rawPath.slice(0, -1) : rawPath;
          fs[p] = cmd === 'plugin:fs|write_text_file' ? new TextDecoder().decode(new Uint8Array(args)) : new TextDecoder().decode(new Uint8Array(args.data || args));
          return null;
        }
        if (cmd === 'plugin:fs|mkdir') {
          const p = args.path.endsWith('/') ? args.path.slice(0, -1) : args.path;
          fs[p] = { isDir: true };
          return null;
        }
        // An IMAP server: the password "wrong" is turned away, any other lets in.
        if (cmd === 'mail_check_login') {
          if (String(args?.pass ?? args?.creds?.pass ?? '') === 'wrong') throw new Error('AUTHENTICATIONFAILED Invalid credentials');
          return [{ name: 'INBOX', role: 'inbox' }, { name: 'Sent', role: 'sent' }];
        }
        if (cmd === 'plugin:fs|watch') return 1;
        if (cmd === 'plugin:fs|unwatch') return null;
        return null;
      },
    };
  }, { cards: seed.cards ?? [], keychain: seed.keychain ?? {}, client: CLIENT, splash: !!seed.splash, pickDir: seed.pickDir ?? null, pim: seed.pim ?? null, settings: seed.settings ?? {} });
  return harness;
}

async function openCloudAccounts(page: Page) {
  await page.goto('/');
  await expect(page.getByText('Todo').first()).toBeVisible({ timeout: 20000 });
  const dialog = page.getByRole('dialog', { name: /Einstellungen|Settings/ });
  // The sync of a seeded account may still be starting; press again until the settings open.
  await expect(async () => {
    if (!(await dialog.isVisible())) await page.keyboard.press('Control+,');
    await expect(dialog).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 20_000 });
  await dialog.getByRole('button', { name: /^(Cloud-Konten|Cloud accounts)$/ }).click();
  return dialog;
}

const vaultKey = Buffer.from('/test-vault').toString('base64');
const cards = (page: Page): Promise<any[]> => page.evaluate((key) => ((window as any).__settings.get(`cloudAccounts_${key}`) ?? []) as any[], vaultKey);
/** The card's grant, wherever the keychain migration put its slot. */
const grantOf = (page: Page, cardId: string): Promise<string | null> => page.evaluate((id) => {
  const keychain = (window as any).__keychain as Map<string, string>;
  const key = [...keychain.keys()].find((k) => k.includes(` Account · ${id} `)) ?? [...keychain.keys()].find((k) => k.startsWith(`account_${id}_`));
  return key ? keychain.get(key) ?? null : null;
}, cardId);

test('a service left unticked at the consent says so on its own row - the others connect', async ({ page }, testInfo) => {
  const harness = await wire(page);
  const dialog = await openCloudAccounts(page);
  await dialog.getByTestId('cloudacct-add').click();
  await dialog.getByTestId('cloudacct-provider-google').click();
  await dialog.getByTestId('cloudacct-svc-files').check();
  await dialog.getByTestId('cloudacct-svc-calendar').check();
  await dialog.getByTestId('cloudacct-to-signin').click();

  // The device's access is the own client; the person leaves the calendar unticked.
  harness.choice = { account: ANNA.email, untick: CALENDAR_SCOPES };
  await dialog.getByTestId('cloudacct-connect').click();

  await expect(dialog.getByTestId('cloudacct-status-files')).toContainText(/verbunden|connected/, { timeout: 15_000 });
  await expect(dialog.getByTestId('cloudacct-status-calendar')).toContainText(/Nicht freigegeben|Not allowed/);
  if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: testInfo.outputPath('calendar-not-granted.png') });

  // ONE consent asked for both services.
  const consents = harness.provider.log.filter((entry) => entry.kind === 'consent');
  expect(consents).toHaveLength(1);
  expect(String(consents[0].detail.scope)).toContain('https://www.googleapis.com/auth/drive');
  expect(String(consents[0].detail.scope)).toContain('https://www.googleapis.com/auth/calendar');

  // One card, the account's own identity, files only - no calendar it was not allowed.
  await expect.poll(async () => (await cards(page)).length).toBe(1);
  const [card] = await cards(page);
  expect(card.family).toBe('google');
  expect(card.label).toBe(ANNA.email);
  expect(card.verifiedProviderIdentity).toMatchObject({ issuer: 'google', subject: ANNA.subject });
  expect(card.services.files).toBeTruthy();
  expect(card.services.calendar).toBeUndefined();

  // The card holds the grant, with what Google actually granted.
  const grant = JSON.parse((await grantOf(page, card.id)) ?? 'null');
  expect(grant).toMatchObject({ clientId: CLIENT.clientId, providerIdentity: { issuer: 'google', subject: ANNA.subject } });
  expect(grant.scopes).toContain('https://www.googleapis.com/auth/drive');
  expect(grant.scopes).not.toContain('https://www.googleapis.com/auth/calendar');
  expect(harness.provider.heldGrants()).toHaveLength(1);
});

test('signing a card in again with another account changes nothing and names both accounts', async ({ page }) => {
  // What the wizard left for Anna: her card and its grant.
  const card = { id: 'card-anna', family: 'google', label: ANNA.email, services: { files: { provider: 'drive' } }, verifiedProviderIdentity: { issuer: 'google', subject: ANNA.subject } };
  const grantKey = `account_card-anna_${vaultKey}`;
  const grant = JSON.stringify({ clientId: CLIENT.clientId, clientSecret: CLIENT.clientSecret, refreshToken: 'annas-grant', scopes: 'https://www.googleapis.com/auth/drive openid email', providerIdentity: { issuer: 'google', subject: ANNA.subject } });
  const driveSlot = `drive_credentials_${vaultKey}`;
  const harness = await wire(page, { cards: [card], keychain: { [grantKey]: grant, [driveSlot]: JSON.stringify({ clientId: CLIENT.clientId, clientSecret: CLIENT.clientSecret, refreshToken: '' }) } });
  const dialog = await openCloudAccounts(page);
  await dialog.getByTestId('cloudacct-row').click();

  // In the browser, Bert is signed in and the person picks him. Switching a
  // service on asks the provider for everything the card carries.
  harness.choice = { account: BERT.email };
  await dialog.getByTestId('cloudacct-service-mail').getByRole('switch').click();

  await expect(page.getByText(`You signed in as ${BERT.email}, but this account is ${ANNA.email}. Nothing was changed.`)).toBeVisible({ timeout: 15_000 });
  // The consent preselected Anna (the login hint), the person chose otherwise.
  const consents = harness.provider.log.filter((entry) => entry.kind === 'consent');
  expect(consents).toHaveLength(1);
  expect(consents[0].detail.loginHint).toBe(ANNA.email);

  // Nothing changed: the card, its services and Anna's grant are as before.
  expect(await cards(page)).toEqual([card]);
  expect(JSON.parse((await grantOf(page, 'card-anna')) ?? 'null')).toEqual(JSON.parse(grant));
});

test("opening an online vault signs in with this device's access and gives the new vault its account", async ({ page }) => {
  // "Open Vault -> Online vault -> Google Drive" asked for a client id in
  // fields of its own and left the sign-in in the files slot with no identity
  // and no card (account sign-in plan K4b).
  const harness = await wire(page, { splash: true, pickDir: '/new-vault' });
  await page.goto('/');
  await page.getByRole('button', { name: /^(Vault öffnen|Open Vault)$/ }).click();
  await page.getByRole('button', { name: /Online-Vault|Online vault/ }).click();
  await page.getByRole('button', { name: /Google Drive/ }).click();

  // No client fields: the device's access, here the own client.
  await expect(page.getByTestId('online-access')).toContainText(CLIENT.clientId);
  await expect(page.getByPlaceholder('xxxxxxxx.apps.googleusercontent.com')).toHaveCount(0);

  harness.choice = { account: ANNA.email };
  await page.getByRole('button', { name: /^(Verbinden|Connect)$/ }).click();
  // The cloud folder picker opens with the fresh sign-in; the root is fine.
  await page.getByRole('dialog').getByRole('button', { name: /^(Abbrechen|Cancel)$/ }).click();
  await page.getByRole('button', { name: /Lokalen Ordner wählen|Choose local folder and open/ }).click();

  // One consent, for files and the identity.
  const consents = harness.provider.log.filter((entry) => entry.kind === 'consent');
  expect(consents).toHaveLength(1);
  expect(String(consents[0].detail.scope)).toContain('https://www.googleapis.com/auth/drive');
  expect(String(consents[0].detail.scope)).toContain('openid');

  // The new vault has its card: Anna's identity, the files service, the grant on the card.
  const newVaultKey = Buffer.from('/new-vault').toString('base64');
  const newCards = () => page.evaluate((key) => ((window as any).__settings.get(`cloudAccounts_${key}`) ?? []) as any[], newVaultKey);
  await expect.poll(async () => (await newCards()).length, { timeout: 15_000 }).toBe(1);
  const [card] = await newCards();
  expect(card).toMatchObject({ family: 'google', label: ANNA.email, verifiedProviderIdentity: { issuer: 'google', subject: ANNA.subject }, services: { files: { provider: 'drive' } } });
  const grant = JSON.parse((await grantOf(page, card.id)) ?? 'null');
  expect(grant).toMatchObject({ clientId: CLIENT.clientId, providerIdentity: { issuer: 'google', subject: ANNA.subject } });
});

/**
 * Plan "Verbinden", V0, on the desktop: a card with files and a calendar from
 * no sign-in on this device to signed in, checked, signed out on this device
 * and signed in again. The phone runs the same case in
 * `apps/mobile/e2e-prod/account-sign-in.spec.ts`.
 */
test('a card signs in from its state, checks files and calendar as working, signs out on this device and in again', async ({ page }, testInfo) => {
  const card = { id: 'card-anna', family: 'google', label: ANNA.email, verifiedProviderIdentity: { issuer: 'google', subject: ANNA.subject }, services: { files: { provider: 'drive' }, calendar: { pimAccountId: 'pim-anna' } } };
  const harness = await wire(page, {
    cards: [card],
    pim: { id: 'pim-anna', label: ANNA.email },
    keychain: {
      // The slots as the one sign-in leaves them: the client, no token of their own.
      [`drive_credentials_${vaultKey}`]: JSON.stringify({ clientId: CLIENT.clientId, clientSecret: CLIENT.clientSecret, refreshToken: '' }),
      [`pim_pim-anna_${vaultKey}`]: JSON.stringify({ kind: 'google', clientId: CLIENT.clientId, clientSecret: CLIENT.clientSecret, refreshToken: '' }),
    },
  });
  harness.choice = { account: ANNA.email };
  const dialog = await openCloudAccounts(page);
  await expect(dialog.getByTestId('cloudacct-row-state')).toHaveAttribute('data-state', 'signin');
  await dialog.getByTestId('cloudacct-row').click();

  // No sign-in on this device: the state says so, and its button signs in.
  await expect(dialog.getByTestId('cloudacct-state')).toHaveAttribute('data-state', 'signin');
  await expect(dialog.getByTestId('cloudacct-signout')).toHaveCount(0);
  await expect(dialog.getByTestId('cloudacct-signin')).toHaveText(/^(Anmelden|Sign in)$/);
  await dialog.getByTestId('cloudacct-signin').click();
  await expect.poll(() => grantOf(page, 'card-anna'), { timeout: 15_000 }).not.toBeNull();
  await expect(dialog.getByTestId('cloudacct-state')).toHaveAttribute('data-state', 'connected', { timeout: 15_000 });
  await expect(dialog.getByTestId('cloudacct-signin')).toHaveCount(0);

  // Check connection: both services work with what this device holds.
  await dialog.getByTestId('cloudacct-check-open').click();
  await expect(page.getByTestId('cloudacct-check-files')).toHaveAttribute('data-state', 'ok', { timeout: 15_000 });
  await expect(page.getByTestId('cloudacct-check-calendar')).toHaveAttribute('data-state', 'ok', { timeout: 15_000 });
  if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: testInfo.outputPath('check-ok.png') });
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('cloudacct-check')).toHaveCount(0);

  // Sign out on this device: the grant goes, the card and its services stay.
  await dialog.getByTestId('cloudacct-signout').click();
  await expect.poll(() => grantOf(page, 'card-anna'), { timeout: 15_000 }).toBeNull();
  await expect(dialog.getByTestId('cloudacct-state')).toHaveAttribute('data-state', 'signin', { timeout: 15_000 });
  expect((await cards(page)).find((entry) => entry.id === 'card-anna')?.services).toEqual(card.services);
  if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: testInfo.outputPath('signed-out.png') });

  // And in again.
  await dialog.getByTestId('cloudacct-signin').click();
  await expect.poll(() => grantOf(page, 'card-anna'), { timeout: 15_000 }).not.toBeNull();
  await expect(dialog.getByTestId('cloudacct-state')).toHaveAttribute('data-state', 'connected', { timeout: 15_000 });
});

/*
 * Plan "Verbinden", V1-V3: one structure for every account - the head with
 * one state, the services with their pages, the access, the check with an
 * action per row, the end. The same cases for a Google, a WebDAV and an IMAP
 * account; the phone runs them in `apps/mobile/e2e-prod/account-sign-in.spec.ts`.
 */

/** Anna's Google card with files and a calendar, signed in on this device. */
function signedInGoogle(scopes: string) {
  const card = { id: 'card-anna', family: 'google', label: ANNA.email, verifiedProviderIdentity: { issuer: 'google', subject: ANNA.subject }, services: { files: { provider: 'drive' }, calendar: { pimAccountId: 'pim-anna' } } };
  return {
    card,
    seed: {
      cards: [card],
      pim: { id: 'pim-anna', label: ANNA.email },
      keychain: {
        [`account_card-anna_${vaultKey}`]: JSON.stringify({ clientId: CLIENT.clientId, clientSecret: CLIENT.clientSecret, refreshToken: 'annas-grant', scopes, providerIdentity: { issuer: 'google', subject: ANNA.subject } }),
        [`drive_credentials_${vaultKey}`]: JSON.stringify({ clientId: CLIENT.clientId, clientSecret: CLIENT.clientSecret, refreshToken: '' }),
        [`pim_pim-anna_${vaultKey}`]: JSON.stringify({ kind: 'google', clientId: CLIENT.clientId, clientSecret: CLIENT.clientSecret, refreshToken: '' }),
      },
    } satisfies Seed,
  };
}
const ALL_SCOPES = ['https://www.googleapis.com/auth/drive', ...CALENDAR_SCOPES, 'openid', 'email'].join(' ');

/** The in-app confirmation: its text, then its confirming button. */
async function confirmDialog(page: Page): Promise<string> {
  const overlay = page.locator('.pv-overlay--dialog');
  await expect(overlay).toBeVisible();
  const text = (await overlay.textContent()) ?? '';
  await overlay.locator('.pv-btn--danger, .pv-btn--primary').first().click();
  return text;
}

test('a Google account leads from the list to its calendar page and back, in five fixed sections', async ({ page }, testInfo) => {
  const { seed } = signedInGoogle(ALL_SCOPES);
  await wire(page, seed);
  const dialog = await openCloudAccounts(page);
  await expect(dialog.getByTestId('cloudacct-row-state')).toHaveAttribute('data-state', 'connected');
  await dialog.getByTestId('cloudacct-row').click();

  // The head: one state, no button while nothing needs a sign-in.
  await expect(dialog.getByTestId('cloudacct-state')).toHaveAttribute('data-state', 'connected');
  await expect(dialog.getByTestId('cloudacct-signin')).toHaveCount(0);
  // The services, always in the same order; what the card does not carry is off, not missing.
  const services = dialog.locator('[data-testid^="cloudacct-service-"]:not([data-testid^="cloudacct-service-open-"])');
  await expect(services).toHaveCount(3);
  expect(await services.evaluateAll((rows) => rows.map((row) => `${row.getAttribute('data-testid')}=${row.getAttribute('data-on')}`)))
    .toEqual(['cloudacct-service-files=true', 'cloudacct-service-calendar=true', 'cloudacct-service-mail=false']);
  // Access, check and the end, every one in its place.
  await expect(dialog.getByTestId('cloudacct-access-change')).toBeVisible();
  await expect(dialog.getByTestId('cloudacct-check-open')).toBeVisible();
  await expect(dialog.getByTestId('cloudacct-signout')).toBeVisible();
  await expect(dialog.getByTestId('cloudacct-remove')).toBeVisible();
  if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: testInfo.outputPath('google-account-page.png'), fullPage: true });

  // The calendar of THIS account: its calendars with their switch and colour.
  await dialog.getByTestId('cloudacct-service-open-calendar').click();
  await expect(dialog.getByTestId('account-service-calendar')).toBeVisible();
  await expect(dialog.getByTestId('account-service-switch')).toBeVisible();
  await expect(dialog.getByTestId('account-calendar-cal-anna')).toBeVisible({ timeout: 15_000 });
  await expect(dialog.getByTestId('account-calendar-color-cal-anna')).toBeVisible();
  await expect(dialog.getByTestId('account-service-global')).toBeVisible();
  if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: testInfo.outputPath('google-calendar-page.png'), fullPage: true });
  await dialog.getByTestId('account-service-back').click();
  await expect(dialog.getByTestId('cloudacct-head')).toBeVisible();
});

test('the check names a service that was never granted, and its action grants it', async ({ page }) => {
  // Signed in through the provider with the calendar left unticked at the consent.
  const { seed } = signedInGoogle('');
  const keychain = { ...seed.keychain };
  delete (keychain as Record<string, string>)[`account_card-anna_${vaultKey}`];
  const harness = await wire(page, { ...seed, keychain });
  harness.choice = { account: ANNA.email, untick: CALENDAR_SCOPES };
  const dialog = await openCloudAccounts(page);
  await dialog.getByTestId('cloudacct-row').click();
  await dialog.getByTestId('cloudacct-signin').click();
  await expect.poll(() => grantOf(page, 'card-anna'), { timeout: 15_000 }).not.toBeNull();
  harness.choice = { account: ANNA.email };

  await dialog.getByTestId('cloudacct-check-open').click();
  await expect(page.getByTestId('cloudacct-check-files')).toHaveAttribute('data-state', 'ok', { timeout: 15_000 });
  await expect(page.getByTestId('cloudacct-check-calendar')).toHaveAttribute('data-state', 'notGranted', { timeout: 15_000 });
  await expect(page.getByTestId('cloudacct-check-action-files-grant')).toHaveCount(0);
  await page.getByTestId('cloudacct-check-action-calendar-grant').click();

  // One consent later the card holds the calendar too, and the check says so.
  await expect.poll(async () => String(JSON.parse((await grantOf(page, 'card-anna')) ?? '{}').scopes ?? ''), { timeout: 15_000 })
    .toContain('https://www.googleapis.com/auth/calendar');
  await dialog.getByTestId('cloudacct-check-open').click();
  await expect(page.getByTestId('cloudacct-check-calendar')).toHaveAttribute('data-state', 'ok', { timeout: 15_000 });
});

test('removing a Google account says what goes and what stays, and takes the card and its sign-in out', async ({ page }) => {
  const { seed } = signedInGoogle(ALL_SCOPES);
  await wire(page, seed);
  const dialog = await openCloudAccounts(page);
  await dialog.getByTestId('cloudacct-row').click();
  await dialog.getByTestId('cloudacct-remove').click();
  const said = await confirmDialog(page);
  expect(said).toMatch(/Goes:|Es geht:/);
  expect(said).toMatch(/Stays:|Es bleibt:/);
  expect(said).toMatch(/nothing is deleted at the provider|beim Anbieter wird nichts gelöscht/);

  await expect.poll(async () => (await cards(page)).length, { timeout: 15_000 }).toBe(0);
  await expect.poll(() => grantOf(page, 'card-anna')).toBeNull();
  await expect(dialog.getByTestId('cloudacct-row')).toHaveCount(0);
});

/** A WebDAV card with its files, signed in with a password on this device. */
const DAV_CARD = { id: 'card-dav', family: 'webdav', label: 'anna@dav.example', services: { files: { provider: 'webdav' } } };
const davSeed = (pass: string): Seed => ({
  cards: [DAV_CARD],
  keychain: { [`webdav_credentials_${vaultKey}`]: JSON.stringify({ url: 'https://dav.example/files/anna/', user: 'anna', pass }) },
});
/** The password the WebDAV files slot holds now, wherever the migration put it. */
const davPass = (page: Page): Promise<string | null> => page.evaluate((key) => {
  const keychain = (window as any).__keychain as Map<string, string>;
  const slot = [...keychain.keys()].find((k) => k === `webdav_credentials_${key}` || (k.includes('webdav') && k.includes('Files')));
  return slot ? (JSON.parse(keychain.get(slot) ?? '{}').pass ?? null) : null;
}, vaultKey);

test('a WebDAV account shows its server and user, checks its files, signs out here and in again with the password', async ({ page }, testInfo) => {
  await wire(page, davSeed('secret'));
  const dialog = await openCloudAccounts(page);
  await dialog.getByTestId('cloudacct-row').click();

  await expect(dialog.getByTestId('cloudacct-state')).toHaveAttribute('data-state', 'connected');
  // The same five sections: what WebDAV cannot do is missing, nothing moves.
  await expect(dialog.getByTestId('cloudacct-service-files')).toHaveAttribute('data-on', 'true');
  await expect(dialog.getByTestId('cloudacct-service-mail')).toHaveCount(0);
  await expect(dialog.getByRole('group', { name: /Access on this device|Zugang auf diesem Gerät/ }).getByText('https://dav.example/files/anna/')).toBeVisible();
  await expect(dialog.getByTestId('cloudacct-password-change')).toBeVisible();

  await dialog.getByTestId('cloudacct-check-open').click();
  await expect(page.getByTestId('cloudacct-check-files')).toHaveAttribute('data-state', 'ok', { timeout: 15_000 });
  await page.keyboard.press('Escape');

  // Signing out empties the password on this device; the card stays.
  await dialog.getByTestId('cloudacct-signout').click();
  await expect.poll(() => davPass(page), { timeout: 15_000 }).toBe('');
  await expect(dialog.getByTestId('cloudacct-state')).toHaveAttribute('data-state', 'signin', { timeout: 15_000 });
  expect((await cards(page)).map((card) => card.id)).toEqual(['card-dav']);
  if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: testInfo.outputPath('webdav-signed-out.png'), fullPage: true });

  // "Sign in" opens the password, the server lets it in, the state follows.
  await dialog.getByTestId('cloudacct-signin').click();
  await dialog.getByTestId('cloudacct-new-password').fill('secret-2');
  await dialog.getByTestId('cloudacct-update-password').click();
  await expect.poll(() => davPass(page), { timeout: 15_000 }).toBe('secret-2');
  await expect(dialog.getByTestId('cloudacct-state')).toHaveAttribute('data-state', 'connected', { timeout: 15_000 });

  // And out of the vault.
  await dialog.getByTestId('cloudacct-remove').click();
  await confirmDialog(page);
  await expect.poll(async () => (await cards(page)).length, { timeout: 15_000 }).toBe(0);
});

/** An IMAP card and its mailbox; the password is whatever the case says. */
const IMAP_CARD = { id: 'card-imap', family: 'imap', label: 'anna@mail.example', services: { mail: { mailAccountId: 'm1' } } };
const imapSeed = (pass: string): Seed => ({
  cards: [IMAP_CARD],
  settings: { [`mailAccounts_${vaultKey}`]: [{ id: 'm1', label: 'anna@mail.example', host: 'imap.mail.example', port: 993, user: 'anna@mail.example', smtpHost: 'smtp.mail.example', smtpPort: 587 }] },
  keychain: { [`mail_m1_${vaultKey}`]: JSON.stringify({ pass }) },
});

test('an IMAP account whose password the server turns away: the check says so, its action leads to the password', async ({ page }) => {
  await wire(page, imapSeed('wrong'));
  const dialog = await openCloudAccounts(page);
  await dialog.getByTestId('cloudacct-row').click();
  await expect(dialog.getByTestId('cloudacct-service-mail')).toHaveAttribute('data-on', 'true');
  await expect(dialog.getByTestId('cloudacct-service-files')).toHaveCount(0);
  await expect(dialog.getByRole('group', { name: /Access on this device|Zugang auf diesem Gerät/ }).getByText('imap.mail.example:993')).toBeVisible();

  await dialog.getByTestId('cloudacct-check-open').click();
  // A password the server turns away reads as a sign-in that no longer works.
  await expect(page.getByTestId('cloudacct-check-mail')).toHaveAttribute('data-state', 'expired', { timeout: 15_000 });
  await page.getByTestId('cloudacct-check-action-mail-signInAgain').click();

  // The action opens the password of THIS account; a password the server takes repairs the check.
  await dialog.getByTestId('cloudacct-new-password').fill('right');
  await dialog.getByTestId('cloudacct-update-password').click();
  await expect(dialog.getByText(/Password updated|Passwort aktualisiert/)).toBeVisible({ timeout: 15_000 });
  await dialog.getByTestId('cloudacct-check-open').click();
  await expect(page.getByTestId('cloudacct-check-mail')).toHaveAttribute('data-state', 'ok', { timeout: 15_000 });
});

test('an IMAP account signs out on this device and in again, and its mail page shows the folders', async ({ page }) => {
  await wire(page, imapSeed('secret'));
  const dialog = await openCloudAccounts(page);
  await dialog.getByTestId('cloudacct-row').click();

  await dialog.getByTestId('cloudacct-service-open-mail').click();
  await expect(dialog.getByTestId('account-service-mail')).toBeVisible();
  await expect(dialog.getByTestId('account-mail-folders')).toContainText('INBOX', { timeout: 15_000 });
  await dialog.getByTestId('account-service-back').click();

  await dialog.getByTestId('cloudacct-signout').click();
  await expect(dialog.getByTestId('cloudacct-state')).toHaveAttribute('data-state', 'signin', { timeout: 15_000 });
  await dialog.getByTestId('cloudacct-signin').click();
  await dialog.getByTestId('cloudacct-new-password').fill('secret-2');
  await dialog.getByTestId('cloudacct-update-password').click();
  await expect(dialog.getByTestId('cloudacct-state')).toHaveAttribute('data-state', 'connected', { timeout: 15_000 });

  await dialog.getByTestId('cloudacct-remove').click();
  await confirmDialog(page);
  await expect.poll(async () => (await cards(page)).length, { timeout: 15_000 }).toBe(0);
});
