/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { test, expect } from '@playwright/test';

/**
 * Two Microsoft mailboxes, each with the sign-in of its own account (finding
 * 2026-10-12).
 *
 * A Microsoft mailbox reads and sends through Graph, and Graph answers `/me`
 * for the account of the access token — whatever mailbox the app believes it
 * is in. The main window asked the account broker for "the mail token of this
 * vault", without the mailbox, and the broker answered with the first card
 * that carried mail. With two Microsoft accounts the second mailbox therefore
 * listed the first one's messages under its own name, and a message written
 * from it left from the first account.
 *
 * The vault here is what the account wizard leaves behind for two Microsoft
 * accounts: one cloud account card per account, the card holds the sign-in,
 * the mailbox's own slot is empty. Below the Tauri boundary everything is
 * local: the token relay answers a sign-in with an access token that names it,
 * and Graph answers a token with the mailbox of its account — so the list on
 * screen and the `Authorization` of every request say whose sign-in travelled.
 *
 * That two real Microsoft accounts behave this way is not something a fake can
 * show; what it holds is the app's side: which sign-in each request is sent
 * with. The phone holds the same in `apps/mobile/e2e-prod/mail-sign-in.spec.ts`.
 *
 * A file of its own: `mail.spec.ts` runs against one IMAP fixture, this needs
 * a registry, a keychain and a provider that tell two accounts apart.
 */

const FIRST = 'anna@outlook.example';
const SECOND = 'privat@outlook.example';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (err) => console.log('PAGE ERROR:', err.message));
  await page.addInitScript(() => {
    const fs: Record<string, any> = {
      '/test-vault': { isDir: true },
      '/test-vault/.plainva': { isDir: true },
      '/test-vault/Todo.md': '# Todo\nSome note content.',
    };
    const noteRows = () =>
      Object.keys(fs)
        .filter((p) => !fs[p].isDir && p.startsWith('/test-vault/') && !p.includes('/.plainva/'))
        .map((p) => {
          const rel = p.replace('/test-vault/', '');
          return { path: rel, title: rel.split('/').pop()!.replace(/\.(md|base)$/i, ''), mode: 'obsidian', mtime_local: 1000, ctime: 500 };
        });

    // The desktop keys what it stores per vault by the base64 of the vault path.
    const vaultKey = btoa('/test-vault');
    const MAIL_SCOPES = 'User.Read Mail.ReadWrite Mail.Send offline_access';
    const mailbox = (id: string, address: string) => ({ id, kind: 'microsoft', label: address, host: '', port: 0, user: address, clientId: 'cid' });
    const card = (id: string, address: string, mailAccountId: string) => ({ id, family: 'microsoft', label: address, services: { mail: { mailAccountId } } });

    const settings = new Map<string, unknown>([
      ['lastVaultPath', '/test-vault'],
      ['recentVaults', ['/test-vault']],
      ['autoOpenLastVault', true],
      // A marker equal to the running version means "already seen".
      ['whatsNewSeenVersion', '9.9.9'],
      [`okfPromptDismissed_${vaultKey}`, true],
      [`backupZipEnabled_${vaultKey}`, false],
      [`mailAccounts_${vaultKey}`, [mailbox('ms-a', 'anna@outlook.example'), mailbox('ms-b', 'privat@outlook.example')]],
      [`cloudAccounts_${vaultKey}`, [card('card-a', 'anna@outlook.example', 'ms-a'), card('card-b', 'privat@outlook.example', 'ms-b')]],
    ]);

    // The keychain: the card holds the sign-in, the mailbox's own slot is empty.
    const keychain = new Map<string, string>([
      [`mail_ms-a_${vaultKey}`, JSON.stringify({ refreshToken: '' })],
      [`mail_ms-b_${vaultKey}`, JSON.stringify({ refreshToken: '' })],
      [`account_card-a_${vaultKey}`, JSON.stringify({ clientId: 'cid', refreshToken: 'sign-in-a', scopes: MAIL_SCOPES })],
      [`account_card-b_${vaultKey}`, JSON.stringify({ clientId: 'cid', refreshToken: 'sign-in-b', scopes: MAIL_SCOPES })],
    ]);
    // A test can name entries this device never got (`__missingSecrets`). Read
    // when the keychain is asked, not here: a test's own init script is not
    // guaranteed to run before this one.
    const missing = (key: string) => ((window as any).__missingSecrets ?? []).includes(key);

    // The provider: an access token belongs to one account, and `/me/...` is
    // that account's mailbox — one message each, so the list says whose it is.
    const accounts: Record<string, { address: string; message: { id: string; subject: string; preview: string } }> = {
      'access-for:sign-in-a': { address: 'anna@outlook.example', message: { id: 'a-1', subject: 'Nur im ersten Postfach', preview: 'Diese Nachricht liegt im ersten Postfach.' } },
      'access-for:sign-in-b': { address: 'privat@outlook.example', message: { id: 'b-1', subject: 'Nur im zweiten Postfach', preview: 'Diese Nachricht liegt im zweiten Postfach.' } },
    };
    (window as any).__tokenRequests = [];
    (window as any).__graphCalls = [];
    const graph = (method: string, url: string, authorization: string | null): { status: number; json: unknown } => {
      const account = accounts[(authorization ?? '').replace(/^Bearer /, '')];
      if (!account) return { status: 401, json: { error: { code: 'InvalidAuthenticationToken' } } };
      const path = url.replace('https://graph.microsoft.com/v1.0', '');
      const envelope = {
        id: account.message.id, subject: account.message.subject, conversationId: account.message.id, bodyPreview: account.message.preview,
        from: { emailAddress: { name: 'Ben Beispiel', address: 'ben@example.org' } }, receivedDateTime: '2026-09-14T09:00:00Z',
        isRead: true, flag: { flagStatus: 'notFlagged' }, hasAttachments: false,
      };
      if (method === 'POST' && path === '/me/sendMail') return { status: 202, json: null };
      if (method === 'PATCH' && path.startsWith(`/me/messages/${account.message.id}`)) return { status: 200, json: {} };
      if (method !== 'GET') return { status: 404, json: { error: { code: 'unexpected' } } };
      if (path.startsWith('/me?')) return { status: 200, json: { id: `id-of-${account.address}`, mail: account.address, userPrincipalName: account.address } };
      if (path.startsWith('/me/mailFolders?')) {
        return { status: 200, json: { value: [{ id: 'f-in', displayName: 'Posteingang', childFolderCount: 0 }, { id: 'f-dr', displayName: 'Entwürfe', childFolderCount: 0 }] } };
      }
      if (path.startsWith('/me/mailFolders/inbox?')) return { status: 200, json: { id: 'f-in' } };
      if (path.startsWith('/me/mailFolders/drafts?')) return { status: 200, json: { id: 'f-dr' } };
      if (/^\/me\/mailFolders\/(f-in|inbox)\/messages\?/.test(path)) return { status: 200, json: { value: [envelope], '@odata.count': 1 } };
      if (/^\/me\/mailFolders\/[^/?]+\/messages\?/.test(path)) return { status: 200, json: { value: [], '@odata.count': 0 } };
      if (/^\/me\/mailFolders\/(f-in|f-dr|inbox)\?/.test(path)) return { status: 200, json: { unreadItemCount: 0 } };
      if (path.startsWith(`/me/messages/${account.message.id}?`)) {
        return { status: 200, json: { ...envelope, toRecipients: [{ emailAddress: { address: account.address } }], body: { contentType: 'text', content: account.message.preview }, internetMessageId: `<${account.message.id}@fixture>` } };
      }
      return { status: 404, json: { error: { code: 'ErrorItemNotFound' } } };
    };
    const requests = new Map<number, { method: string; url: string; authorization: string | null; read: boolean }>();
    let nextRequest = 1;

    (window as any).__TAURI_INTERNALS__ = {
      plugins: { path: { sep: '/' } },
      transformCallback: (_cb: any) => 1,
      invoke: async (cmd: string, args: any, options: any) => {
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

        if (cmd === 'keychain_get') return missing(args.key) ? null : keychain.get(args.key) ?? null;
        if (cmd === 'keychain_set') { keychain.set(args.key, args.value); return null; }
        if (cmd === 'keychain_delete') { keychain.delete(args.key); return null; }
        if (cmd === 'keychain_compare_and_set') {
          if ((keychain.get(args.key) ?? null) !== (args.expected ?? null)) return false;
          if (args.value === null || args.value === undefined) keychain.delete(args.key);
          else keychain.set(args.key, args.value);
          return true;
        }

        // The token relay: every sign-in is answered with an access token that
        // names it, and keeps its refresh token.
        if (cmd === 'oauth_token_request') {
          const refreshToken = new URLSearchParams(String(args.body ?? '')).get('refresh_token') ?? '';
          (window as any).__tokenRequests.push(refreshToken);
          return { status: 200, body: JSON.stringify({ access_token: `access-for:${refreshToken}`, expires_in: 3600 }) };
        }
        if (cmd === 'plugin:http|fetch') {
          const cfg = args.clientConfig;
          const id = nextRequest++;
          const authorization = (cfg.headers.find((h: string[]) => h[0].toLowerCase() === 'authorization') ?? [])[1] ?? null;
          requests.set(id, { method: cfg.method, url: cfg.url, authorization, read: false });
          (window as any).__graphCalls.push({
            method: cfg.method,
            url: cfg.url,
            authorization,
            body: cfg.data ? new TextDecoder().decode(new Uint8Array(cfg.data)) : '',
          });
          return id;
        }
        if (cmd === 'plugin:http|fetch_send') {
          const request = requests.get(args.rid)!;
          return { status: graph(request.method, request.url, request.authorization).status, statusText: '', url: request.url, headers: [['content-type', 'application/json']], rid: args.rid };
        }
        if (cmd === 'plugin:http|fetch_read_body') {
          const request = requests.get(args.rid)!;
          if (request.read) return [1];
          request.read = true;
          const { json } = graph(request.method, request.url, request.authorization);
          return [...new TextEncoder().encode(json === null ? '' : JSON.stringify(json)), 0];
        }
        if (cmd === 'plugin:http|fetch_cancel' || cmd === 'plugin:http|fetch_cancel_body') return null;

        if (cmd === 'plugin:dialog|ask' || cmd === 'plugin:dialog|confirm') return true;
        if (cmd === 'plugin:dialog|message') return String(args?.buttons) === 'OkCancel' ? 'Ok' : 'Yes';
        if (cmd === 'plugin:sql|load') return args.db;
        if (cmd === 'plugin:sql|execute') return [0, 0];
        if (cmd === 'plugin:sql|select') {
          const q = String(args.query);
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
        if (cmd === 'plugin:fs|watch') return 1;
        if (cmd === 'plugin:fs|unwatch') return null;
        return null;
      },
    };
  });
});

type GraphCall = { method: string; url: string; authorization: string | null; body: string };

const graphCalls = (page: any): Promise<GraphCall[]> => page.evaluate(() => (window as any).__graphCalls as any[]);
const path = (call: GraphCall) => call.url.replace('https://graph.microsoft.com/v1.0', '');

/**
 * Every request made so far, once no new one has started for a moment.
 *
 * A request does not say which mailbox it is for — `/me` is all Graph is told —
 * so the test tells them apart by WHEN they were made. A request the open
 * mailbox starts a little after its list is on screen (its sent folder, for
 * the conversations) must not be counted to the mailbox opened next.
 */
async function settledCalls(page: any): Promise<GraphCall[]> {
  let seen = -1;
  for (;;) {
    const calls = await graphCalls(page);
    if (calls.length === seen) return calls;
    seen = calls.length;
    await page.waitForTimeout(400);
  }
}

async function openMail(page: any) {
  await page.goto('/');
  await expect(page.getByText('Todo').first()).toBeVisible({ timeout: 20000 });
  await page.getByTestId('ribbon-mail').click();
  await expect(page.getByTestId('mail-view')).toBeVisible();
}

async function chooseMailbox(page: any, address: string) {
  await page.getByRole('button', { name: /^(Konto|Account)$/ }).click();
  await page.getByRole('option', { name: address }).click();
}

test('each of two Microsoft mailboxes lists, opens and sends with the sign-in of its own account', async ({ page }, testInfo) => {
  await openMail(page);
  const rows = page.getByTestId('mail-envelope');

  // The first mailbox: its own message, read with its own sign-in.
  await expect(rows).toHaveText([/Nur im ersten Postfach/]);
  const first = await settledCalls(page);
  expect(first.length).toBeGreaterThan(0);
  for (const call of first) {
    expect(call.authorization, `${call.method} ${path(call)}`).toBe('Bearer access-for:sign-in-a');
  }

  // The second mailbox. It used to list the FIRST one's message here: every
  // request went out with the first account's token, and Graph answered for
  // that account.
  await chooseMailbox(page, SECOND);
  await expect(rows).toHaveText([/Nur im zweiten Postfach/], { timeout: 10_000 });
  if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: testInfo.outputPath('second-mailbox-own-mail.png') });

  // Reading: the folder list, the message list and the message itself.
  await rows.first().click();
  await expect(page.getByTestId('mail-subject')).toHaveText('Nur im zweiten Postfach');
  const reading = (await settledCalls(page)).slice(first.length);
  expect(reading.some((c) => path(c).startsWith('/me/mailFolders?'))).toBe(true);
  expect(reading.some((c) => /^\/me\/mailFolders\/[^/?]+\/messages\?/.test(path(c)))).toBe(true);
  expect(reading.some((c) => path(c).startsWith('/me/messages/b-1?'))).toBe(true);
  for (const call of reading) {
    expect(call.authorization, `${call.method} ${path(call)}`).toBe('Bearer access-for:sign-in-b');
  }

  // Sending: a new message from the second mailbox leaves from ITS account.
  await page.getByTestId('mail-compose').click();
  await expect(page.getByTestId('draft-form')).toBeVisible();
  await expect(page.getByTestId('draft-from-select')).toContainText(SECOND);
  await page.getByTestId('draft-to').fill('carla@example.org');
  await page.getByTestId('draft-to').press('Enter');
  await page.getByTestId('draft-subject').fill('Hallo');
  await page.getByTestId('draft-send').click();
  await expect(page.getByTestId('draft-form')).toHaveCount(0);
  const sends = async () => (await graphCalls(page)).filter((c) => c.method === 'POST' && path(c) === '/me/sendMail');
  await expect.poll(async () => (await sends()).length, { timeout: 15_000 }).toBe(1);
  const [sent] = await sends();
  expect(sent.authorization).toBe('Bearer access-for:sign-in-b');
  expect(JSON.parse(sent.body).message.subject).toBe('Hallo');

  // And back: the first mailbox is still the first account's.
  const second = await settledCalls(page);
  for (const call of second.slice(first.length)) {
    expect(call.authorization, `${call.method} ${path(call)}`).toBe('Bearer access-for:sign-in-b');
  }
  await chooseMailbox(page, FIRST);
  await expect(rows).toHaveText([/Nur im ersten Postfach/], { timeout: 10_000 });
  const back = (await settledCalls(page)).slice(second.length);
  expect(back.length).toBeGreaterThan(0);
  for (const call of back) {
    expect(call.authorization, `${call.method} ${path(call)}`).toBe('Bearer access-for:sign-in-a');
  }

  // Each sign-in was renewed for its own mailbox, and for nothing else.
  expect(new Set(await page.evaluate(() => (window as any).__tokenRequests as string[]))).toEqual(new Set(['sign-in-a', 'sign-in-b']));
});

test('all inboxes shows the mail of both accounts, each read with its own sign-in', async ({ page }) => {
  await openMail(page);
  await expect(page.getByTestId('mail-envelope')).toHaveText([/Nur im ersten Postfach/]);

  // One list across the two mailboxes: it used to show the first account's
  // message twice — once under each mailbox's name.
  await page.getByTestId('mail-all-inboxes').click();
  await expect(page.getByTestId('mail-envelope')).toHaveCount(2, { timeout: 10_000 });
  await expect(page.getByTestId('mail-envelope').filter({ hasText: 'Nur im ersten Postfach' })).toHaveCount(1);
  await expect(page.getByTestId('mail-envelope').filter({ hasText: 'Nur im zweiten Postfach' })).toHaveCount(1);
});

test('a mailbox whose account holds no sign-in on this device says so — it does not borrow the first one\'s', async ({ page }) => {
  // What the settings sync leaves on a second computer: the mailbox and its
  // card arrive, the sign-in never does. It used to show the first account's
  // mail under this mailbox's name, with nothing on screen to tell.
  await page.addInitScript(() => {
    (window as any).__missingSecrets = [`account_card-b_${btoa('/test-vault')}`];
  });
  await openMail(page);
  await expect(page.getByTestId('mail-envelope')).toHaveText([/Nur im ersten Postfach/]);

  await chooseMailbox(page, SECOND);
  await expect(page.getByTestId('mail-signin-offer')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('mail-envelope')).toHaveCount(0);
  // The reason names THIS mailbox's account: its card holds no sign-in.
  await expect(page.getByTestId('mail-signin-reason')).toContainText('none holds the shared sign-in');
  // And the only sign-in that was ever renewed is the first account's own.
  expect(new Set(await page.evaluate(() => (window as any).__tokenRequests as string[]))).toEqual(new Set(['sign-in-a']));
});
