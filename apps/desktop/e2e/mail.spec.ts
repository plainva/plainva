/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { test, expect } from '@playwright/test';

/**
 * Mail-capture tab E2E (PIM stage 5): envelope list from the mocked read-only
 * IMAP commands, the sandboxed viewer (remote content blocked, attachment
 * chip), and "Als Notiz ablegen" writing the anchored Email note to disk.
 */

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (err) => console.log('PAGE ERROR:', err.message));
  await page.addInitScript(() => {
    (window as any).mockFs = {
      '/test-vault': { isDir: true },
      '/test-vault/.plainva': { isDir: true },
      '/test-vault/Todo.md': '# Todo\nSome note content.',
    };
    const fs = (window as any).mockFs;
    const noteRows = () =>
      Object.keys(fs)
        .filter((p) => !fs[p].isDir && p.startsWith('/test-vault/') && !p.includes('/.plainva/'))
        .map((p) => {
          const rel = p.replace('/test-vault/', '');
          const isMd = /\.md$/i.test(rel);
          return { path: rel, title: rel.split('/').pop()!.replace(/\.(md|base)$/i, ''), mode: isMd ? 'obsidian' : 'attachment', mtime_local: 1000, ctime: 500 };
        });

    const NOW = Date.now();
    const mailAccount = { id: 'm1', label: 'marco@example.org', host: 'imap.example.org', port: 993, user: 'marco@example.org', smtpHost: 'smtp.example.org', smtpPort: 587 };
    // Second account with DIFFERENT folder names (the account-switch race).
    const mailAccount2 = { id: 'm2', label: 'zweit@example.net', host: 'imap.example.net', port: 993, user: 'zweit@example.net', smtpHost: 'smtp.example.net', smtpPort: 587 };
    const envelopes = [
      { uid: 2, subject: 'Rechnung Q3', from: 'Anna Beispiel <anna@example.org>', dateTs: NOW, seen: false, messageId: 'a@x' },
      { uid: 1, subject: 'Newsletter Juli', from: 'News <news@example.org>', dateTs: NOW - 86400000, seen: true, messageId: 'n@news' },
    ];
    /**
     * Conversation fixture (P9.3), only served when a test asks for it: the
     * shared list above carries the assertions of half this file, so the
     * grouping test brings its own chain rather than changing everyone's counts.
     * The reply in the middle lives in SENT — that is what makes the thread
     * cross a folder boundary.
     */
    const threadReply = { uid: 3, subject: 'Re: Rechnung Q3', from: 'Anna Beispiel <anna@example.org>', dateTs: NOW + 7200000, seen: false, messageId: 'c@x', inReplyTo: 'b@x', references: 'a@x b@x' };
    const sentEnvelopes = [
      { uid: 91, subject: 'Re: Rechnung Q3', from: 'Marco <marco@example.org>', dateTs: NOW + 3600000, seen: true, messageId: 'b@x', inReplyTo: 'a@x', references: 'a@x' },
      // Answers a mail older than the loaded page: it belongs to NO thread on
      // screen and must not become an inbox row (report 2026-07-30).
      { uid: 92, subject: 'Re: Rechnung 2019', from: 'Marco <marco@example.org>', dateTs: NOW - 99999999, seen: true, messageId: 'z@x', inReplyTo: 'ancient@x', references: 'ancient@x' },
    ];
    const fullMessage = {
      uid: 2,
      subject: 'Rechnung Q3',
      from: 'Anna Beispiel <anna@example.org>',
      to: 'marco@example.org',
      dateTs: NOW,
      text: 'Hallo,\n\nanbei die Rechnung.\n',
      html: '<p>Hallo,</p><p>anbei die <b>Rechnung</b>.</p><img src="https://tracker.example.org/pixel.gif" width="1" height="1">',
      attachments: [{ index: 0, name: 'rechnung.pdf', mime: 'application/pdf', size: 20480 }],
    };

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
        if (cmd === 'plugin:store|load') return 1;
        if (cmd === 'plugin:store|get') {
          if (args.key === 'lastVaultPath') return ['/test-vault', true];
          if (args.key === 'recentVaults') return [['/test-vault'], true];
          if (args.key === 'autoOpenLastVault') return [true, true];
          if (String(args.key || '').startsWith('okfPromptDismissed_')) return [true, true];
          if (String(args.key || '').startsWith('backupZipEnabled_')) return [false, true];
          if (String(args.key || '').startsWith('mailRules_')) return [(window as any).__mailRules ?? null, !!(window as any).__mailRules];
          if (String(args.key || '').startsWith('mailAccounts_')) {
            if ((window as any).__noMailAccounts) return [null, false];
            // A test can supply its own mailboxes (e.g. with a signature/aliases).
            if ((window as any).__mailAccountsOverride) return [(window as any).__mailAccountsOverride, true];
            return [(window as any).__twoMailAccounts ? [mailAccount, mailAccount2] : [mailAccount], true];
          }
          return [null, false];
        }
        if (cmd === 'plugin:store|set' || cmd === 'plugin:store|save') return null;
        if (cmd === 'keychain_get') {
          if (String(args.key || '').startsWith('mail_m1_') || String(args.key || '').startsWith('mail_m2_')) return JSON.stringify({ pass: 'app-pw' });
          return null;
        }
        if (cmd === 'mail_check_login') {
          // The second account localizes its folders (a Graph mailbox) and
          // answers slowly — a stale request would have time to land first.
          if (String(args.user || '').includes('zweit')) {
            await new Promise((r) => setTimeout(r, 250));
            return [{ name: 'Archiv' }, { name: 'Posteingang', role: 'inbox' }];
          }
          // Opt-in so the folder-count assertions of the other tests stand:
          // most accounts here have NO junk folder, which is its own case.
          return (window as any).__withJunk
            ? [{ name: 'INBOX' }, { name: 'Entwürfe' }, { name: 'Sent' }, { name: 'Trash' }, { name: 'Junk' }]
            : [{ name: 'INBOX' }, { name: 'Entwürfe' }, { name: 'Sent' }, { name: 'Trash' }];
        }
        if (cmd === 'mail_release_sessions') {
          // P7.2: the pooled IMAP session is handed back on account switch and
          // when mail is left — the mock only records WHO was released.
          ((window as any).__released ||= []).push(args.user ?? null);
          return null;
        }
        if (cmd === 'mail_set_seen') {
          (window as any).__setSeen = { user: args.user, mailbox: args.mailbox, uid: args.uid, seen: args.seen };
          // Which folders were actually asked — a thread spans them.
          ((window as any).__seenBoxes ??= []).push(args.mailbox);
          ((window as any).__seenCalls ||= []).push({ user: args.user, mailbox: args.mailbox, uid: args.uid });
          return null;
        }
        if (cmd === 'mail_move_message') {
          // The uid must be a NUMBER here: the Rust command takes u32, and a
          // composite row id reached it as null (reported live 2026-07-30).
          if (typeof args.uid !== 'number') throw new Error("invalid args 'uid' for command 'mail_move_message'");
          (window as any).__moved = { user: args.user, mailbox: args.mailbox, uid: args.uid, target: args.target };
          return null;
        }
        if (cmd === 'mail_set_junk') {
          ((window as any).__junk ||= []).push({ mailbox: args.mailbox, uid: args.uid, junk: args.junk });
          // A server that refuses custom keywords — the ordinary case the
          // interface has to stay honest about.
          if ((window as any).__refuseJunkFlag) throw new Error('BAD Invalid system flag');
          return null;
        }
        if (cmd === 'mail_create_mailbox') {
          (window as any).__createdMailbox = args.name;
          return null;
        }
        if (cmd === 'mail_search') {
          const q = String(args.query || '').toLowerCase();
          return envelopes.filter((e) => e.subject.toLowerCase().includes(q)).map((e) => e.uid);
        }
        if (cmd === 'mail_search_envelopes') {
          // Server-side search returns the matching ENVELOPES (not just ids),
          // so hits outside the loaded page still show (P2).
          const q = String(args.query || '').toLowerCase();
          return envelopes.filter((e) => e.subject.toLowerCase().includes(q));
        }
        if (cmd === 'mail_append_draft') {
          (window as any).__appendedDraft = { mailbox: args.mailbox, to: args.to, subject: args.subject, text: args.text, html: args.html };
          return null;
        }
        if (cmd === 'mail_send') {
          (window as any).__sentMail = { host: args.host, port: args.port, from: args.from, to: args.to, cc: args.cc, bcc: args.bcc, subject: args.subject, text: args.text, html: args.html, attachments: args.attachments };
          return null;
        }
        if (cmd === 'mail_list_envelopes') {
          if (args.pass !== 'app-pw') throw new Error('bad credentials');
          ((window as any).__loadOrder ||= []).push('network');
          ((window as any).__envCalls ||= []).push({ user: args.user, mailbox: args.mailbox });
          // A deliberately slow server, so a test can SEE what is on screen
          // while the refresh is still running.
          if ((window as any).__slowList) await new Promise((r) => setTimeout(r, (window as any).__slowList));
          const own = String(args.user || '').includes('zweit') ? ['Archiv', 'Posteingang'] : ['INBOX', 'Entwürfe', 'Sent', 'Trash'];
          if (!own.includes(String(args.mailbox))) {
            await new Promise((r) => setTimeout(r, 400)); // a SLOW failure, like a real server
            throw new Error('examine failed: No Response: [NONEXISTENT] Unknown Mailbox: ' + args.mailbox + ' (Failure)');
          }
          if (String(args.mailbox) === 'Sent') {
            // Sent behaves as it always did (the folder is not empty); the
            // conversation fixture only ADDS our own reply of the chain.
            const sent = (window as any).__threadFixture ? [...sentEnvelopes, ...envelopes] : envelopes;
            return { total: sent.length, unseen: 0, messages: sent };
          }
          const box = (window as any).__threadFixture ? [threadReply, ...envelopes] : envelopes;
          return { total: box.length, unseen: box.filter((e: any) => !e.seen).length, messages: box };
        }
        if (cmd === 'mail_fetch_message') {
          ((window as any).__loadOrder ||= []).push('network-body');
          if ((window as any).__failFetch) throw new Error('offline');
          return fullMessage;
        }
        if (cmd === 'mail_fetch_raw') return btoa('From: anna@example.org\r\nSubject: Rechnung Q3\r\n\r\nBody');
        if (cmd === 'plugin:dialog|ask' || cmd === 'plugin:dialog|confirm') return true;
        if (cmd === 'plugin:dialog|message') return String(args?.buttons) === 'OkCancel' ? 'Ok' : 'Yes';
        if (cmd === 'plugin:sql|load') return args.db;
        if (cmd === 'plugin:sql|execute') return [0, 0];
        if (cmd === 'plugin:sql|select') {
          const q = String(args.query);
          // Order log for the cache-first test (F4a): who is asked first, the
          // local cache or the server?
          if (q.includes('FROM mail_envelopes')) {
            ((window as any).__loadOrder ||= []).push('cache');
            return (window as any).__cachedEnvelopes ?? [];
          }
          if (q.includes('FROM mail_bodies')) {
            ((window as any).__loadOrder ||= []).push('cache-body');
            return (window as any).__cachedBody ? [{ payload: (window as any).__cachedBody }] : [];
          }
          if (q.includes('FROM pim_')) return [];
          if (q.includes('FROM files WHERE is_deleted = 0')) return noteRows();
          if (q.includes('path, title, mode FROM files') || q.includes('FROM files WHERE mode')) {
            return noteRows().map((r) => ({ path: r.path, title: r.title, mode: r.mode === 'obsidian' ? 'note' : r.mode }));
          }
          if (q.includes('SELECT path, title FROM files')) {
            return noteRows().filter((r) => r.mode !== 'attachment' && !r.path.endsWith('.base')).map((r) => ({ path: r.path, title: r.title }));
          }
          if (q.includes('SELECT path FROM files')) return noteRows().map((r) => ({ path: r.path }));
          return [];
        }
        if (cmd === 'plugin:sql|select_one') return null;
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
          const p = root ? root + '/' + rel : rel;
          fs[p] = args.encoding === 'base64' ? atob(String(args.contents)) : String(args.contents);
          return null;
        }
        if (cmd === 'plugin:fs|write_text_file' || cmd === 'plugin:fs|write_file') {
          const rawPath = options?.headers?.path ? decodeURIComponent(options.headers.path) : args?.path || '';
          const p = rawPath.endsWith('/') ? rawPath.slice(0, -1) : rawPath;
          const str = cmd === 'plugin:fs|write_text_file' ? new TextDecoder().decode(new Uint8Array(args)) : new TextDecoder().decode(new Uint8Array(args.data || args));
          fs[p] = str;
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

async function openVault(page: any) {
  await page.goto('/');
  await expect(page.getByText('Todo').first()).toBeVisible({ timeout: 20000 });
}

test('mail tab lists envelopes, sandboxes the message and captures it as an anchored note', async ({ page }) => {
  await openVault(page);
  await page.getByTestId('ribbon-mail').click();

  await expect(page.getByTestId('mail-view')).toBeVisible();
  const rows = page.getByTestId('mail-envelope');
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText('Rechnung Q3');
  await expect(rows.first()).toContainText('Anna Beispiel');
  await expect(rows.nth(1)).toContainText('Newsletter Juli');

  // Open the message: subject header, attachment chip, remote-blocked hint,
  // sandboxed iframe WITHOUT the tracker URL.
  await rows.first().click();
  await expect(page.getByTestId('mail-subject')).toHaveText('Rechnung Q3');
  await expect(page.getByText('rechnung.pdf (20 KB)')).toBeVisible();
  await expect(page.getByTestId('mail-blocked-hint')).toBeVisible();
  const frame = page.getByTestId('mail-frame');
  await expect(frame).toBeVisible();
  await expect(frame).toHaveAttribute('sandbox', 'allow-same-origin');
  const srcdoc = await frame.getAttribute('srcdoc');
  expect(srcdoc).toContain('Rechnung');
  expect(srcdoc).not.toContain('tracker.example.org');
  expect(srcdoc).toContain("default-src 'none'");

  // Per-message opt-in: "Show images" re-renders with https images allowed
  // (sanitizer + frame CSP in lock-step); the button disappears afterwards.
  await page.getByTestId('mail-show-images').click();
  await expect
    .poll(() => page.getByTestId('mail-frame').getAttribute('srcdoc'))
    .toContain('tracker.example.org');
  expect(await page.getByTestId('mail-frame').getAttribute('srcdoc')).toContain('img-src data: https:');
  await expect(page.getByTestId('mail-show-images')).toHaveCount(0);

  // Re-opening a message resets the one-shot reveal (blocked again).
  await rows.first().click();
  await expect
    .poll(() => page.getByTestId('mail-frame').getAttribute('srcdoc'))
    .not.toContain('tracker.example.org');
  await expect(page.getByTestId('mail-show-images')).toBeVisible();

  // Capture as note: the anchored Email note lands in Mail/ and opens.
  await page.getByTestId('mail-capture-note').click();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const fs = (window as any).mockFs;
        return Object.keys(fs).find((p) => p.startsWith('/test-vault/Mail/') && p.endsWith('.md')) ?? null;
      })
    )
    .toBeTruthy();
  const noteContent = await page.evaluate(() => {
    const fs = (window as any).mockFs;
    const p = Object.keys(fs).find((k) => k.startsWith('/test-vault/Mail/') && k.endsWith('.md'))!;
    return fs[p];
  });
  expect(noteContent).toContain('type: Email');
  expect(noteContent).toContain('kind: email');
  expect(noteContent).toMatch(/uid:\s*['"]?2['"]?/); // the message id (IMAP uid as string) — YAML may quote it
  expect(noteContent).toContain('# Rechnung Q3');
  expect(noteContent).toContain('anbei die Rechnung.');
  await expect(page.locator('.cm-content').getByText('Rechnung Q3').first()).toBeVisible();
});

test('mail-client E1: folder column, new-message compose and forward', async ({ page }) => {
  await openVault(page);
  await page.getByTestId('ribbon-mail').click();
  await expect(page.getByTestId('mail-view')).toBeVisible();

  // Folder column lists the account's mailboxes (from mail_check_login), INBOX first.
  const folders = page.getByTestId('mail-folder');
  await expect(folders).toHaveCount(4);
  await expect(page.getByTestId('mail-folders')).toContainText('INBOX');
  await expect(page.getByTestId('mail-folders')).toContainText('Sent');
  // The active folder's badge shows the UNREAD count (1 of 2), not the total.
  await expect(page.locator('.pv-mail-folder.on .pv-mail-folder-ct')).toHaveText('1');
  // Switching folders keeps the envelope list working.
  await folders.filter({ hasText: 'Sent' }).click();
  await expect(page.getByTestId('mail-envelope').first()).toBeVisible();

  // New message opens the compose draft dialog (empty); Escape closes it.
  await page.getByTestId('mail-compose').click();
  await expect(page.getByTestId('draft-form')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('draft-form')).toHaveCount(0);

  // Forward: compose opens prefilled with a "Fwd:" subject.
  await page.getByTestId('mail-envelope').first().click();
  await expect(page.getByTestId('mail-subject')).toHaveText('Rechnung Q3');
  await page.getByTestId('mail-forward').click();
  await expect(page.getByTestId('draft-form')).toBeVisible();
  await expect(page.getByTestId('draft-subject')).toHaveValue(/Fwd: Rechnung Q3/);
});

test('mail-client E3: compose sends directly via SMTP', async ({ page }) => {
  await openVault(page);
  await page.getByTestId('ribbon-mail').click();
  await page.getByTestId('mail-envelope').first().click();
  await expect(page.getByTestId('mail-subject')).toHaveText('Rechnung Q3');
  // Forward pre-fills the compose dialog; Send goes straight through SMTP.
  await page.getByTestId('mail-forward').click();
  await expect(page.getByTestId('draft-form')).toBeVisible();
  await expect(page.getByTestId('draft-subject')).toHaveValue(/Fwd: Rechnung Q3/);
  // Recipient becomes a chip on Enter; the input clears.
  await page.getByTestId('draft-to').fill('anna@example.org');
  await page.getByTestId('draft-to').press('Enter');
  await expect(page.getByTestId('draft-to-chip').filter({ hasText: 'anna@example.org' })).toBeVisible();
  await expect(page.getByTestId('draft-to')).toHaveValue('');
  await page.getByTestId('draft-send').click();
  await expect.poll(() => page.evaluate(() => (window as any).__sentMail ?? null)).toBeTruthy();
  const sent = await page.evaluate(() => (window as any).__sentMail);
  expect(sent.host).toBe('smtp.example.org');
  expect(sent.port).toBe(587);
  expect(sent.from).toBe('marco@example.org');
  expect(sent.to).toBe('anna@example.org');
  expect(sent.subject).toMatch(/Fwd: Rechnung Q3/);
  expect(sent.text).toContain('Forwarded message');
  await expect(page.getByTestId('draft-form')).toHaveCount(0);
});

test('mail-client: Cc/Bcc toggle reveals chip rows that ride the SMTP send', async ({ page }) => {
  await openVault(page);
  await page.getByTestId('ribbon-mail').click();
  await page.getByTestId('mail-envelope').first().click();
  await page.getByTestId('mail-forward').click();
  await expect(page.getByTestId('draft-form')).toBeVisible();
  await page.getByTestId('draft-to').fill('anna@example.org');
  await page.getByTestId('draft-to').press('Enter');
  // Cc/Bcc are hidden until the toggle is used.
  await expect(page.getByTestId('draft-cc')).toHaveCount(0);
  await page.getByTestId('draft-cc-toggle').click();
  // Cc becomes a chip on comma; Bcc rides uncommitted (folded in on send).
  await page.getByTestId('draft-cc').fill('bob@example.org');
  await page.getByTestId('draft-cc').press(',');
  await expect(page.getByTestId('draft-cc-chip').filter({ hasText: 'bob@example.org' })).toBeVisible();
  await page.getByTestId('draft-bcc').fill('sec@example.org');
  await page.getByTestId('draft-send').click();
  await expect.poll(() => page.evaluate(() => (window as any).__sentMail ?? null)).toBeTruthy();
  const sent = await page.evaluate(() => (window as any).__sentMail);
  expect(sent.to).toBe('anna@example.org');
  expect(sent.cc).toBe('bob@example.org');
  expect(sent.bcc).toBe('sec@example.org');
});

test('mail-client: Reply opens a real compose (SMTP), not a note, quoting the original', async ({ page }) => {
  await openVault(page);
  await page.getByTestId('ribbon-mail').click();
  await page.getByTestId('mail-envelope').first().click();
  await expect(page.getByTestId('mail-subject')).toHaveText('Rechnung Q3');
  // "Antworten" opens the compose window (NOT a vault note), prefilled to the sender.
  await page.getByTestId('mail-reply').click();
  await expect(page.getByTestId('draft-form')).toBeVisible();
  // The prefilled recipient shows as a chip (Enter/comma-committed).
  await expect(page.getByTestId('draft-to-chip').filter({ hasText: 'anna@example.org' })).toBeVisible();
  await expect(page.getByTestId('draft-subject')).toHaveValue(/Re: Rechnung Q3/);
  await expect(page.getByTestId('draft-body')).toContainText('anbei die Rechnung.');
  // The body is a live-preview editor (CodeMirror); select all + type replaces it.
  await page.getByTestId('draft-body').locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('Danke, passt!');
  await page.getByTestId('draft-send').click();
  await expect.poll(() => page.evaluate(() => (window as any).__sentMail ?? null)).toBeTruthy();
  const sent = await page.evaluate(() => (window as any).__sentMail);
  expect(sent.to).toBe('anna@example.org');
  expect(sent.subject).toMatch(/Re: Rechnung Q3/);
  expect(sent.text).toContain('Danke, passt!');
});

test('mail-client E4: search, mark seen, and delete to Trash', async ({ page }) => {
  await openVault(page);
  await page.getByTestId('ribbon-mail').click();
  await expect(page.getByTestId('mail-view')).toBeVisible();
  await expect(page.getByTestId('mail-envelope')).toHaveCount(2);

  // Search filters the folder to the matching message; clearing restores it.
  await page.getByTestId('mail-search').fill('Newsletter');
  await page.getByTestId('mail-search').press('Enter');
  await expect(page.getByTestId('mail-envelope')).toHaveCount(1);
  await expect(page.getByTestId('mail-envelope').first()).toContainText('Newsletter');
  await page.getByTestId('mail-search-clear').click();
  await expect(page.getByTestId('mail-envelope')).toHaveCount(2);

  // Open the unread message and mark it read.
  await page.getByTestId('mail-envelope').filter({ hasText: 'Rechnung Q3' }).click();
  await expect(page.getByTestId('mail-subject')).toHaveText('Rechnung Q3');
  await page.getByTestId('mail-mark-seen').click();
  await expect.poll(() => page.evaluate(() => (window as any).__setSeen ?? null)).toBeTruthy();
  expect(await page.evaluate(() => (window as any).__setSeen)).toMatchObject({ uid: 2, seen: true });

  // Delete moves it to Trash (confirmed in-app) and drops it from the list.
  await page.getByTestId('mail-delete').click();
  await page.locator('.pv-modal-footer button.pv-btn--primary').click();
  await expect.poll(() => page.evaluate(() => (window as any).__moved ?? null)).toBeTruthy();
  expect(await page.evaluate(() => (window as any).__moved)).toMatchObject({ uid: 2, target: 'Trash' });
  await expect(page.getByTestId('mail-envelope')).toHaveCount(1);
});

test('mail-client E4b: a message held unread stays unread until it is left', async ({ page }) => {
  await openVault(page);
  await page.getByTestId('ribbon-mail').click();
  await expect(page.getByTestId('mail-view')).toBeVisible();

  // Opening an unread message marks it read on its own after three seconds.
  await page.getByTestId('mail-envelope').filter({ hasText: 'Rechnung Q3' }).click();
  await expect(page.getByTestId('mail-subject')).toHaveText('Rechnung Q3');
  await expect
    .poll(() => page.evaluate(() => ((window as any).__seenCalls ?? []).filter((c: any) => c.uid === 2).length), {
      timeout: 8000,
    })
    .toBeGreaterThan(0);

  // Turning it unread BY HAND holds it: the timer must not restart and claw it
  // back three seconds later — the defect this test exists for.
  await page.evaluate(() => { (window as any).__seenCalls = []; });
  await page.getByTestId('mail-mark-seen').click();
  await expect.poll(() => page.evaluate(() => (window as any).__setSeen ?? null)).toMatchObject({ uid: 2, seen: false });
  await page.waitForTimeout(4500);
  expect(await page.evaluate(() => (window as any).__setSeen)).toMatchObject({ uid: 2, seen: false });

  // Leaving the message releases the hold, so the next visit behaves normally.
  // (The transport mock answers every fetch with the same body, so the switch
  // is asserted on the row that is selected, not on the reader's subject.)
  await page.getByTestId('mail-envelope').filter({ hasText: 'Newsletter' }).click();
  // `aria-selected` is the bulk checkbox; the OPEN row carries the `on` class.
  await expect(page.getByTestId('mail-envelope').filter({ hasText: 'Newsletter' })).toHaveClass(/(^|\s)on(\s|$)/);
  await page.getByTestId('mail-envelope').filter({ hasText: 'Rechnung Q3' }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).__setSeen), { timeout: 8000 })
    .toMatchObject({ uid: 2, seen: true });
});

test('mail-client E5: compose from an attachment payload sends the file', async ({ page }) => {
  await openVault(page);
  // The editor ⋮ "Send as attachment" dispatches this compose event (the App
  // renders the dialog globally); assert the attachment rides to SMTP.
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('plainva-compose-mail', {
      detail: { subject: 'Meine Notiz', markdown: '', attachments: [{ name: 'Note.md', mime: 'text/markdown', contentBase64: btoa('# Hallo') }] },
    }));
  });
  await expect(page.getByTestId('draft-form')).toBeVisible();
  await expect(page.getByTestId('draft-subject')).toHaveValue('Meine Notiz');
  await expect(page.getByTestId('draft-attachments')).toContainText('Note.md');
  await page.getByTestId('draft-to').fill('anna@example.org');
  await page.getByTestId('draft-send').click();
  await expect.poll(() => page.evaluate(() => (window as any).__sentMail ?? null)).toBeTruthy();
  const sent = await page.evaluate(() => (window as any).__sentMail);
  expect(sent.subject).toBe('Meine Notiz');
  expect(sent.attachments[0].name).toBe('Note.md');
  expect(sent.attachments[0].mime).toBe('text/markdown');
});

test('mail-out: reply-as-note quotes the original; the draft dialog appends via IMAP', async ({ page }) => {
  await openVault(page);
  await page.getByTestId('ribbon-mail').click();
  await page.getByTestId('mail-envelope').first().click();
  await expect(page.getByTestId('mail-subject')).toHaveText('Rechnung Q3');

  // Reply as note: a "Re" note in Mail/ addressed at the sender, original quoted.
  await page.getByTestId('mail-reply-note').click();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const fs = (window as any).mockFs;
        return Object.keys(fs).find((p) => p.includes('/Mail/') && p.includes('Re Rechnung')) ?? null;
      })
    )
    .toBeTruthy();
  const reply = await page.evaluate(() => {
    const fs = (window as any).mockFs;
    const p = Object.keys(fs).find((k) => k.includes('/Mail/') && k.includes('Re Rechnung'))!;
    return fs[p];
  });
  expect(reply).toContain('# Re: Rechnung Q3');
  expect(reply).toContain('to: Anna Beispiel <anna@example.org>');
  expect(reply).toContain('> anbei die Rechnung.');

  // Draft dialog from the command palette on the open reply note: prefilled
  // subject, the recipient prefilled from the note's `to:` frontmatter (P2b), a
  // guessed drafts folder, and the append call carries both bodies (frontmatter
  // stripped). (The mail-out commands are gated on an ACTIVE markdown note — wait
  // for the reply note's editor before opening the palette.)
  await expect(page.locator('.cm-content').getByText('Re: Rechnung Q3').first()).toBeVisible();
  await page.keyboard.press('Control+p');
  const palette = page.getByTestId('command-palette');
  await (await import('@playwright/test')).expect(palette).toBeVisible();
  await palette.getByRole('textbox').fill('draft');
  await palette.getByRole('button', { name: /email draft|E-Mail-Entwurf/i }).click();
  await expect(page.getByTestId('draft-form')).toBeVisible();
  await expect(page.getByTestId('draft-subject')).toHaveValue(/Re Rechnung/);
  await page.getByTestId('draft-save').click();
  await expect.poll(() => page.evaluate(() => (window as any).__appendedDraft ?? null)).toBeTruthy();
  const appended = await page.evaluate(() => (window as any).__appendedDraft);
  expect(appended.mailbox).toBe('Entwürfe');
  // Prefilled from the note's `to:` frontmatter (reply-as-note round-trip, P2b).
  expect(appended.to).toBe('Anna Beispiel <anna@example.org>');
  expect(appended.text).toContain('anbei die Rechnung.');
  expect(appended.html).toContain('<blockquote>');
  await expect(page.getByTestId('draft-form')).toHaveCount(0);
});

test('mail tab without accounts: ribbon entry is gated away, palette still opens the empty state into cloud accounts', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).__noMailAccounts = true;
  });
  await openVault(page);

  // Cloud-accounts gating (mockup 6): no account carries the mail service,
  // so the ribbon shortcut disappears entirely.
  await expect(page.getByTestId('ribbon-tasks')).toBeVisible();
  await expect(page.getByTestId('ribbon-mail')).toHaveCount(0);

  // The palette command still reaches the tab (persisted layouts/deep links).
  await page.keyboard.press('Control+p');
  const palette = page.getByTestId('command-palette');
  await expect(palette).toBeVisible();
  await palette.getByRole('button', { name: /E-Mail öffnen|Open email/ }).click();

  await expect(page.getByTestId('mail-view')).toBeVisible();
  await expect(page.getByTestId('mail-open-settings')).toBeVisible();
  await page.getByTestId('mail-open-settings').click();
  // The empty state deep-links into the new Cloud accounts area.
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByTestId('cloudacct-add')).toBeVisible();
});

test('mail: switching accounts never loads the previous provider\'s folder name', async ({ page }) => {
  // Reported 2026-07-20: going from the Outlook account (Graph, "Posteingang")
  // back to Gmail (IMAP, "INBOX") showed "Unknown Mailbox" over the freshly
  // loaded inbox — a request for the OLD folder had been fired against the NEW
  // account, and its late failure overwrote the good state.
  await page.addInitScript(() => {
    (window as any).__twoMailAccounts = true;
  });
  await openVault(page);
  await page.getByTestId('ribbon-mail').click();
  await expect(page.getByTestId('mail-view')).toBeVisible();
  await expect(page.getByTestId('mail-folders')).toContainText('INBOX');

  // Switch to the second (localized, slow) account.
  await page.getByRole('button', { name: /^(Konto|Account)$/ }).click();
  await page.getByRole('option', { name: 'zweit@example.net' }).click();

  // Its own inbox arrives and is selected — by ROLE, not by the English name.
  await expect(page.getByTestId('mail-folders')).toContainText('Posteingang', { timeout: 10000 });
  await expect(page.locator('.pv-mail-folder.on')).toHaveText(/Posteingang/);

  // …and back again.
  await page.getByRole('button', { name: /^(Konto|Account)$/ }).click();
  await page.getByRole('option', { name: 'marco@example.org' }).click();
  await expect(page.locator('.pv-mail-folder.on')).toHaveText(/INBOX/, { timeout: 10000 });

  // No error surfaced at any point, and no request ever asked an account for a
  // folder that belongs to the other one.
  await expect(page.getByText(/Unknown Mailbox/)).toHaveCount(0);
  const calls = (await page.evaluate(() => (window as any).__envCalls ?? [])) as { user: string; mailbox: string }[];
  expect(calls.length).toBeGreaterThan(0);
  for (const c of calls) {
    const own = c.user.includes('zweit') ? ['Archiv', 'Posteingang'] : ['INBOX', 'Entwürfe', 'Sent', 'Trash'];
    expect(own, c.user + ' was asked for ' + c.mailbox).toContain(c.mailbox);
  }

  // P7.2: each switch hands the previous account's pooled IMAP session back, so
  // no logged-in connection sits around for a mailbox nobody is looking at.
  const released = (await page.evaluate(() => (window as any).__released ?? [])) as (string | null)[];
  expect(released).toEqual(['marco@example.org', 'zweit@example.net']);
});

test('mail list: right-click context menu, multi-select bulk bar, and the unread filter', async ({ page }) => {
  await openVault(page);
  await page.getByTestId('ribbon-mail').click();
  const rows = page.getByTestId('mail-envelope');
  await expect(rows).toHaveCount(2);

  // Multi-select via Ctrl/Cmd+click -> the bulk bar counts the selection.
  await rows.nth(0).click({ modifiers: ['ControlOrMeta'] });
  await rows.nth(1).click({ modifiers: ['ControlOrMeta'] });
  await expect(page.getByTestId('mail-bulkbar')).toContainText('2');
  await page.getByTestId('mail-bulk-clear').click();
  await expect(page.getByTestId('mail-bulkbar')).toHaveCount(0);

  // "Ungelesen" filter keeps only the unread envelope (uid 2), hides the read one.
  await page.getByTestId('mail-filter-unread').click();
  await expect(page.getByTestId('mail-envelope')).toHaveCount(1);
  await expect(page.getByTestId('mail-envelope').first()).toContainText('Rechnung Q3');
  await page.getByTestId('mail-filter-unread').click();
  await expect(page.getByTestId('mail-envelope')).toHaveCount(2);

  // Right-click a row -> context menu; "Als gelesen" marks that message read.
  await rows.filter({ hasText: 'Rechnung Q3' }).click({ button: 'right' });
  await expect(page.getByTestId('mail-ctx-open')).toBeVisible();
  await expect(page.getByTestId('mail-ctx-move')).toBeVisible();
  await expect(page.getByTestId('mail-ctx-delete')).toBeVisible();
  await page.getByTestId('mail-ctx-read').click();
  expect(await page.evaluate(() => (window as any).__setSeen)).toMatchObject({ uid: 2, seen: true });
});

test('signature and sender aliases ride the send (issue #34, round one)', async ({ page }) => {
  await page.addInitScript(() => {
    // One mailbox with a signature and one alias.
    (window as any).__mailAccountsOverride = [
      {
        id: 'm1',
        label: 'marco@example.org',
        host: 'imap.example.org',
        port: 993,
        user: 'marco@example.org',
        smtpHost: 'smtp.example.org',
        smtpPort: 587,
        signature: 'Marco\nPlainva',
        senders: ['Support <support@example.org>'],
      },
    ];
  });
  await openVault(page);
  await page.getByTestId('ribbon-mail').click();
  await page.getByTestId('mail-compose').click();
  await expect(page.getByTestId('draft-form')).toBeVisible();

  // The signature is already in the body, under the (empty) text.
  await expect(page.getByTestId('draft-body')).toContainText('Marco');

  /* The field shows the SENDER, never the key behind it. It read
     "m1 marco@example.org" because the field built its value with a newline
     while the options were built with senderKey — no option matched, so the
     Select printed the raw value (report 2026-07-29, screenshot). Hence
     toHaveText, not toContainText: the raw key CONTAINS the label. */
  await expect(page.getByTestId('draft-from-select')).toHaveText('marco@example.org');

  // The From picker offers ADDRESSES: the mailbox's own plus its alias.
  await page.getByTestId('draft-from-select').click();
  await page.getByRole('option', { name: /support@example\.org/ }).click();
  await expect(page.getByTestId('draft-from-select')).toHaveText('Support <support@example.org>');
  await expect(page.getByTestId('draft-from-select')).not.toContainText('m1');

  await page.getByTestId('draft-to').fill('anna@example.org');
  await page.getByTestId('draft-to').press('Enter');
  await page.getByTestId('draft-subject').fill('Rückfrage');
  await page.getByTestId('draft-send').click();

  await expect.poll(() => page.evaluate(() => (window as any).__sentMail ?? null)).toBeTruthy();
  const sent = await page.evaluate(() => (window as any).__sentMail);
  // The chosen alias reaches SMTP, and the signature is in the body.
  expect(sent.from).toBe('Support <support@example.org>');
  expect(sent.text).toContain('Marco');
});

/**
 * P7.1: the cache is read BEFORE the network, not only in the `catch`. Opening a
 * folder you have opened before used to wait for the full roundtrip even though
 * the last page was already on this device (F4a) — the single biggest part of
 * "mail feels slow". The banner keeps saying the copy is not confirmed, so
 * showing it early is not a claim of freshness.
 */
test('mail: the cache is read before the network, and the banner says so (P7.1)', async ({ page }) => {
  await page.addInitScript(() => {
    // A folder that was opened before: one envelope lies in the local cache.
    (window as any).__cachedEnvelopes = [
      { id: '77', subject: 'Aus dem Cache', sender: 'Cache <cache@example.org>', date_ts: Date.now(), seen: 1, flagged: 0, preview: 'lokal' },
    ];
    (window as any).__cachedBody = JSON.stringify({
      id: '77', subject: 'Aus dem Cache', from: 'Cache <cache@example.org>',
      date: new Date().toISOString(), text: 'Aus dem lokalen Cache', html: null, attachments: [],
    });
    // Without a slow server the refresh lands before Playwright can look, and
    // the test would be measuring the mock rather than the app.
    (window as any).__slowList = 1500;
  });
  await openVault(page);
  await page.getByTestId('ribbon-mail').click();
  await expect(page.getByTestId('mail-view')).toBeVisible();

  // The cached row appears, and the very first thing asked was the CACHE.
  await expect(page.getByTestId('mail-envelope').first()).toContainText('Aus dem Cache');
  expect(await page.evaluate(() => (window as any).__loadOrder?.[0])).toBe('cache');
  await expect(page.getByTestId('mail-offline')).toHaveText(/wird aktualisiert|updating/i);

  // Then the refresh lands: the server's envelopes replace the cached page and
  // the banner goes away entirely — nothing pretends to be stale once confirmed.
  await expect(page.getByTestId('mail-envelope')).toHaveCount(2, { timeout: 10000 });
  await expect(page.getByTestId('mail-envelope').first()).toContainText('Rechnung Q3');
  await expect(page.getByTestId('mail-offline')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__loadOrder?.includes('network'))).toBe(true);

  // A message, too: the cached body shows before the fetch is asked for. With
  // the fetch failing, what stays on screen is the cached copy — the pane is
  // never blank for a message that was read once.
  await page.evaluate(() => {
    (window as any).__failFetch = true;
    (window as any).__loadOrder = [];
  });
  await page.getByTestId('mail-envelope').first().click();
  await expect(page.getByTestId('mail-subject')).toHaveText('Aus dem Cache');
  const order = await page.evaluate(() => (window as any).__loadOrder as string[]);
  expect(order.indexOf('cache-body')).toBeGreaterThanOrEqual(0);
  expect(order.indexOf('cache-body')).toBeLessThan(order.indexOf('network-body'));
});

test('mail columns: two grips resize the panes, minimums hold, widths survive a reload (P8.1)', async ({ page }) => {
  // The three columns were fixed at 210/320/rest, so a long folder name was cut
  // off with no way to widen it.
  await openVault(page);
  await page.getByTestId('ribbon-mail').click();
  const grid = page.getByTestId('mail-view');
  await expect(grid).toBeVisible();

  const widths = async () => {
    const t = await grid.evaluate((el) => getComputedStyle(el).gridTemplateColumns);
    return t.split(' ').map((v) => Math.round(parseFloat(v)));
  };
  const before = await widths();
  expect(before[0]).toBe(210);
  // 360, not 320: three labelled filter toggles need that much (finding
  // 2026-07-30 — at 320 the third one hung over the reader).
  expect(before[2]).toBe(360);

  // Drag the first grip 60px to the right: the folder rail grows, the list does not.
  const grip = page.getByTestId('mail-grip-folders');
  const box = (await grip.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  const wider = await widths();
  expect(wider[0]).toBeGreaterThan(before[0] + 40);
  expect(wider[2]).toBe(before[2]);

  // Drag it far to the LEFT: the minimum holds instead of collapsing the rail.
  const box2 = (await grip.boundingBox())!;
  await page.mouse.move(box2.x + box2.width / 2, box2.y + box2.height / 2);
  await page.mouse.down();
  await page.mouse.move(box2.x - 400, box2.y + box2.height / 2, { steps: 6 });
  await page.mouse.up();
  const narrow = await widths();
  expect(narrow[0]).toBe(150);

  // Widen the rail again, then reload: the pair is remembered per vault.
  const box3 = (await grip.boundingBox())!;
  await page.mouse.move(box3.x + box3.width / 2, box3.y + box3.height / 2);
  await page.mouse.down();
  await page.mouse.move(box3.x + 110, box3.y + box3.height / 2, { steps: 5 });
  await page.mouse.up();
  const chosen = await widths();
  expect(chosen[0]).toBeGreaterThan(200);

  await page.reload();
  await page.getByTestId('ribbon-mail').click();
  await expect(page.getByTestId('mail-view')).toBeVisible();
  expect((await widths())[0]).toBe(chosen[0]);
});

test('the account chooser stays inside a narrow folder rail (finding 2026-07-30)', async ({ page }) => {
  // With two accounts the rail head holds a Select, and the primitive's 150px
  // baseline is an INLINE style — it beat every class rule, so at the rail's
  // 150px minimum the chooser drew 42px outside the column, across the search
  // field. Measured, then capped at the container.
  await page.addInitScript(() => { (window as any).__twoMailAccounts = true; });
  await openVault(page);
  await page.getByTestId('ribbon-mail').click();
  await expect(page.getByTestId('mail-view')).toBeVisible();

  const grip = page.getByTestId('mail-grip-folders');
  const box = (await grip.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x - 400, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();

  const rail = (await page.locator('.pv-mail-folders').boundingBox())!;
  expect(Math.round(rail.width)).toBe(150);
  const trigger = (await page.locator('.pv-selecttrigger').first().boundingBox())!;
  expect(trigger.x + trigger.width).toBeLessThanOrEqual(rail.x + rail.width + 1);
  // Still a working chooser, not a clipped stub: it opens and lists both.
  await page.getByRole('button', { name: /^(Konto|Account)$/ }).click();
  await expect(page.getByRole('option', { name: 'zweit@example.net' })).toBeVisible();
});

test('a narrow list keeps its filter row inside the column (finding 2026-07-30)', async ({ page }) => {
  // Pulled to its minimum, the row of three labelled toggles used to overflow
  // the column and draw over the reader: a flex row cannot shrink below its own
  // min-content width. Now it drops the words and keeps the icons — and the
  // accessible name, so nothing becomes unnameable.
  await openVault(page);
  await page.getByTestId('ribbon-mail').click();
  const grid = page.getByTestId('mail-view');
  await expect(grid).toBeVisible();

  const threads = page.getByTestId('mail-filter-threads');
  await expect(threads).toContainText('Conversations');

  // Drag the SECOND grip far left: the list falls to its 240px minimum.
  const grip = page.getByTestId('mail-grip-list');
  const box = (await grip.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x - 500, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();

  const cols = (await grid.evaluate((el) => getComputedStyle(el).gridTemplateColumns))
    .split(' ')
    .map((v) => Math.round(parseFloat(v)));
  expect(cols[2]).toBe(240);

  // The defect itself, first: nothing sticks out of the column.
  const listBox = (await page.locator('.pv-mail-list').boundingBox())!;
  for (const id of ['mail-filter-unread', 'mail-filter-flagged', 'mail-filter-threads']) {
    const b = (await page.getByTestId(id).boundingBox())!;
    expect(b.x + b.width).toBeLessThanOrEqual(listBox.x + listBox.width + 1);
  }

  // The mechanism: the words are gone, the button is still named and still a toggle.
  await expect(threads).not.toContainText('Conversations');
  await expect(threads).toHaveAttribute('aria-label', 'Conversations');
  await expect(threads).toHaveAttribute('aria-pressed', 'false');
});

test('all inboxes: one list across accounts, and every action goes to its own mailbox (P9.3b)', async ({ page }) => {
  // A uid is folder- AND account-local: two IMAP accounts both have a message
  // with uid "1". A merged list that forgets where a row came from does not fail
  // loudly — it marks, moves or deletes a DIFFERENT message.
  await page.addInitScript(() => { (window as any).__twoMailAccounts = true; });
  await openVault(page);
  await page.getByTestId('ribbon-mail').click();
  await expect(page.getByTestId('mail-view')).toBeVisible();
  await expect(page.getByTestId('mail-envelope')).toHaveCount(2);

  await page.getByTestId('mail-all-inboxes').click();

  // Both accounts' inboxes, and every row says whose it is.
  await expect(page.getByTestId('mail-envelope')).toHaveCount(4);
  await expect(page.getByText('marco@example.org').first()).toBeVisible();
  await expect(page.getByText('zweit@example.net').first()).toBeVisible();

  // The per-folder server queries are gone: they answer about ONE mailbox.
  await expect(page.getByTestId('mail-search')).toHaveCount(0);
  await expect(page.getByTestId('mail-filter-flagged')).toHaveCount(0);

  // Mark a row of the SECOND account as read. The mock records who was asked.
  const second = page.getByTestId('mail-envelope').filter({ hasText: 'zweit@example.net' }).first();
  await second.click({ modifiers: ['ControlOrMeta'] });
  await page.getByTestId('mail-bulk-read').click();
  await expect
    .poll(async () => await page.evaluate(() => (window as any).__setSeen))
    .toMatchObject({ user: 'zweit@example.net', mailbox: 'Posteingang' });

  // Moving and deleting need a target folder per account — they are not offered.
  await expect(page.getByTestId('mail-bulk-move')).toHaveCount(0);
  await expect(page.getByTestId('mail-bulk-delete')).toHaveCount(0);

  // Opening a row and deleting it from the reader: the id the transport gets
  // must be the message's own uid, not the row's address. It reached the Rust
  // boundary as null before this (reported live 2026-07-30).
  await page.getByTestId('mail-envelope').filter({ hasText: 'marco@example.org' }).first().click();
  await expect(page.getByTestId('mail-subject')).toBeVisible();
  await page.getByTestId('mail-delete').click();
  await page.locator('.pv-modal-footer button.pv-btn--primary').click();
  await expect
    .poll(async () => await page.evaluate(() => (window as any).__moved))
    .toMatchObject({ user: 'marco@example.org', mailbox: 'INBOX', target: 'Trash' });
  expect(await page.evaluate(() => typeof (window as any).__moved.uid)).toBe('number');

  // Picking a folder leaves the merged list again — with the deleted message
  // gone from the folder list too: it was addressed, so removing it reached the
  // list it actually lives in.
  await page.getByTestId('mail-folder').first().click();
  await expect(page.getByTestId('mail-envelope')).toHaveCount(1);
  await expect(page.getByTestId('mail-search')).toBeVisible();
});

test('signature: the field fills the settings row and is draggable in height only', async ({ page }) => {
  // Reported twice (2026-07-30): the box stayed at its content width. The
  // control column of a settings row is a centring flex row, so a control that
  // does not set its own width shrinks — measured here rather than eyeballed.
  await openVault(page);
  await page.getByTestId('ribbon-mail').click();
  await expect(page.getByTestId('mail-view')).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('plainva-open-sync-settings', { detail: { area: 'mail' } })));
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.locator('.pv-navlink', { hasText: /^(E-Mail|Email)$/ }).click();
  const editor = page.locator('.pv-mail-cmpeditor').first();
  await expect(editor).toBeVisible();

  // As wide as the row's content box — measured, because "looks full width"
  // was wrong twice.
  const w = await editor.evaluate((el) => {
    const row = el.closest('.pv-setrow') as HTMLElement;
    const cs = getComputedStyle(row);
    return {
      editor: el.getBoundingClientRect().width,
      content: row.getBoundingClientRect().width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight),
    };
  });
  expect(Math.round(w.editor)).toBe(Math.round(w.content));

  // A height grip, never a width one — sideways would leave the column.
  expect(await editor.evaluate((el) => getComputedStyle(el).resize)).toBe('vertical');

  // The "/" menu must not be clipped by that box (reported 2026-07-30). A
  // clipped element still reports its full rect, so the mechanism is what gets
  // pinned: positioned against the viewport, and inside it.
  await editor.locator('.cm-content').click();
  await page.keyboard.type('/');
  const menu = page.getByTestId('compose-slash-menu');
  await expect(menu).toBeVisible();
  expect(await menu.evaluate((el) => getComputedStyle(el).position)).toBe('fixed');
  const fits = await menu.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return r.left >= 0 && r.top >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1;
  });
  expect(fits).toBe(true);
});

test('conversations: a modifier-click still selects, and each message keeps its own folder', async ({ page }) => {
  // Turning conversations on took multi-select away — the rows there are
  // threads, and only the flat rows carried the modifier click (reported live
  // 2026-07-30). A thread spans folders, so a selected message has to keep its
  // origin or a Sent reply gets marked in INBOX.
  await page.addInitScript(() => { (window as any).__threadFixture = true; });
  await openVault(page);
  await page.getByTestId('ribbon-mail').click();
  await page.getByTestId('mail-filter-threads').click();
  const thread = page.getByTestId('mail-thread-row').first();
  await expect(thread).toBeVisible();

  // The whole conversation in one modifier-click: three messages, not one row.
  await thread.click({ modifiers: ['ControlOrMeta'] });
  await expect(page.getByTestId('mail-bulkbar')).toContainText('3');
  await expect(thread).toHaveAttribute('aria-selected', 'true');
  // ...and it did not unfold: the modifier means "pick", not "open".
  await expect(thread).toHaveAttribute('aria-expanded', 'false');

  // Marking them read reaches the folder each message actually lives in.
  await page.getByTestId('mail-bulk-read').click();
  await expect
    .poll(async () => await page.evaluate(() => (window as any).__seenBoxes ?? []))
    .toEqual(expect.arrayContaining(['INBOX', 'Sent']));

  // A single message inside the thread can be picked on its own.
  await thread.click();
  await page.getByTestId('mail-thread-message').nth(1).click({ modifiers: ['ControlOrMeta'] });
  await expect(page.getByTestId('mail-bulkbar')).toContainText('1');
});

test('conversations group a thread across two folders and remember the switch', async ({ page }) => {
  await page.addInitScript(() => { (window as any).__threadFixture = true; });
  await openVault(page);
  await page.getByTestId('ribbon-mail').click();
  await expect(page.getByTestId('mail-view')).toBeVisible();
  await expect(page.getByTestId('mail-envelope').first()).toBeVisible();

  // Off by default: today's flat list, one row per message.
  await expect(page.getByTestId('mail-thread-row')).toHaveCount(0);
  await expect(page.getByTestId('mail-envelope')).toHaveCount(3);
  // The stray Sent reply is not part of this folder in either mode.
  await expect(page.getByText('Rechnung 2019')).toHaveCount(0);

  await page.getByTestId('mail-filter-threads').click();

  // One row now stands for the conversation, and its count includes the reply
  // that lives in Sent — the whole point of reading that folder along.
  const thread = page.getByTestId('mail-thread-row').first();
  await expect(thread).toBeVisible();
  await expect(page.getByTestId('mail-thread-count').first()).toHaveText('3');
  // ...and the Sent message that belongs to NO thread on screen stays out: the
  // read-along folder completes conversations, it never adds rows to this one
  // (report 2026-07-30). One conversation, and the newsletter as a plain row.
  await expect(page.getByTestId('mail-thread-row')).toHaveCount(1);
  await expect(page.getByText('Rechnung 2019')).toHaveCount(0);
  await expect(thread).toContainText('Rechnung Q3');
  // Both sides of the exchange are named, oldest first.
  await expect(thread).toContainText('Anna Beispiel');
  await expect(thread).toContainText('Marco');

  // Unfolded, every message says where it lives when that is not this folder.
  await thread.click();
  await expect(page.getByTestId('mail-thread-message')).toHaveCount(3);
  await expect(page.getByTestId('mail-thread-folder')).toHaveText('Sent');

  // Opening a message of the thread fetches it against ITS folder: an IMAP uid
  // is folder-local, so the wrong mailbox would open the wrong message.
  await page.getByTestId('mail-thread-message').nth(1).click();
  await expect(page.getByTestId('mail-subject')).toBeVisible();

  // The switch is remembered per vault: still on after a reload.
  await page.reload();
  await openVault(page);
  await page.getByTestId('ribbon-mail').click();
  await expect(page.getByTestId('mail-thread-row').first()).toBeVisible();
  await expect(page.getByTestId('mail-filter-threads')).toHaveAttribute('aria-pressed', 'true');
});


test('spam: the keyword goes first, the move follows, and the message says which of the two happened', async ({ page }) => {
  // Two things happen and only one is guaranteed to mean anything. The order is
  // not cosmetic: after the move the message carries a NEW uid in the target
  // mailbox, so marking afterwards would mark nothing.
  await page.addInitScript(() => { (window as any).__withJunk = true; });
  await openVault(page);
  await page.getByTestId('ribbon-mail').click();
  await page.getByTestId('mail-envelope').first().click();

  await expect(page.getByTestId('mail-junk')).toHaveAttribute('aria-label', 'Spam');
  await page.getByTestId('mail-junk').click();

  await expect.poll(async () => await page.evaluate(() => (window as any).__junk ?? [])).toHaveLength(1);
  const junk = await page.evaluate(() => (window as any).__junk[0]);
  expect(junk).toMatchObject({ mailbox: 'INBOX', junk: true });
  const moved = await page.evaluate(() => (window as any).__moved);
  expect(moved).toMatchObject({ mailbox: 'INBOX', target: 'Junk' });
  // The keyword stuck here, so the confirmation may say so.
  await expect(page.locator('.pv-toast').last()).toContainText('as spam');
});

test('spam: a server that refuses the keyword still gets the message moved, and is not called trained', async ({ page }) => {
  await page.addInitScript(() => { (window as any).__withJunk = true; (window as any).__refuseJunkFlag = true; });
  await openVault(page);
  await page.getByTestId('ribbon-mail').click();
  await page.getByTestId('mail-envelope').first().click();
  await page.getByTestId('mail-junk').click();

  // Moved anyway — the keyword is decoration, the move is the action.
  await expect.poll(async () => await page.evaluate(() => (window as any).__moved ?? null)).toMatchObject({ target: 'Junk' });
  await expect(page.locator('.pv-toast').last()).toContainText('Moved');
  await expect(page.locator('.pv-toast').last()).toContainText('no spam marking');
});

test('spam: without a junk folder Plainva offers to create one instead of inventing a name', async ({ page }) => {
  await openVault(page); // this account has no junk folder
  await page.getByTestId('ribbon-mail').click();
  await page.getByTestId('mail-envelope').first().click();
  await page.getByTestId('mail-junk').click();

  const dialog = page.locator('.pv-overlay--dialog');
  await expect(dialog).toContainText('spam folder');
  // The honest sentence belongs where the decision is made, not in a footnote.
  await expect(dialog).toContainText('does not necessarily train the filter');
  await dialog.locator('.pv-btn--primary, .pv-btn--danger').first().click();

  await expect.poll(async () => await page.evaluate(() => (window as any).__createdMailbox ?? null)).toBe('Junk');
  await expect.poll(async () => await page.evaluate(() => (window as any).__moved ?? null)).toMatchObject({ target: 'Junk' });
});

test('out-of-office: offered only where it survives the machine being switched off', async ({ page }) => {
  // A plain IMAP mailbox has no server-side auto-reply. A switch here would be
  // a promise that breaks the moment the lid closes, so there is none — and the
  // card says why instead of staying silent.
  await openVault(page);
  await page.keyboard.press('Control+,');
  const dlg = page.getByRole('dialog', { name: /Einstellungen|Settings/ });
  await dlg.getByRole('button', { name: /^(E-Mail|Email)$/ }).click();

  await expect(dlg.getByTestId('vacation-unsupported')).toBeVisible();
  await expect(dlg.getByTestId('vacation-unsupported')).toContainText(/server-side|serverseitige/i);
  await expect(dlg.getByTestId('vacation-enabled')).toHaveCount(0);
});

test('out-of-office: with a Sieve server the form appears and names where the notice lives', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).__mailAccountsOverride = [
      {
        id: 'm1',
        label: 'marco@example.org',
        host: 'imap.example.org',
        port: 993,
        user: 'marco@example.org',
        sieveHost: 'sieve.example.org',
      },
    ];
  });
  await openVault(page);
  await page.keyboard.press('Control+,');
  const dlg = page.getByRole('dialog', { name: /Einstellungen|Settings/ });
  await dlg.getByRole('button', { name: /^(E-Mail|Email)$/ }).click();

  await expect(dlg.getByTestId('vacation-enabled')).toBeVisible();
  await expect(dlg.getByTestId('vacation-message')).toBeVisible();
  // The sentence that makes the feature honest: it keeps answering without us.
  const where = dlg.getByTestId('vacation-where');
  await expect(where).toContainText('sieve.example.org');
  await expect(where).toContainText(/Plainva is closed|Plainva geschlossen/i);
  // ...and it never claims to own the whole script.
  await expect(where).toContainText(/hand-written|von Hand/i);
  await expect(where).not.toContainText('{{');
});

test('rules: a local rule files a fetched message, and the card says what "local" means', async ({ page }) => {
  // The honest label is the point: a rule that only runs while Plainva is open
  // must say so, or someone relies on a filter that is not running while their
  // laptop is shut.
  await page.addInitScript(() => {
    (window as any).__withJunk = true;
    (window as any).__mailRules = [
      {
        id: 'r1',
        name: 'Newsletter',
        enabled: true,
        match: 'all',
        conditions: [{ field: 'subject', op: 'contains', value: 'Rechnung' }],
        actions: [{ kind: 'moveTo', mailbox: 'Junk' }],
      },
    ];
  });
  await openVault(page);
  await page.getByTestId('ribbon-mail').click();

  // The rule acted on what was fetched — the matching row left the folder.
  await expect.poll(async () => await page.evaluate(() => (window as any).__moved ?? null)).toMatchObject({ target: 'Junk' });
  await expect(page.getByTestId('mail-envelope').filter({ hasText: 'Rechnung Q3' })).toHaveCount(0);

  await page.keyboard.press('Control+,');
  const dlg = page.getByRole('dialog', { name: /Einstellungen|Settings/ });
  await dlg.getByRole('button', { name: /^(E-Mail|Email)$/ }).click();
  const where = dlg.getByTestId('rules-where');
  await expect(where).toContainText(/only while Plainva is open|nur, während Plainva geöffnet/i);
  await expect(where).toContainText(/fetched|abgerufen/i);
  await expect(where).not.toContainText('{{');
});

test('rules: a rule that reads the body says it cannot run from the overview', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).__mailRules = [
      { id: 'r1', name: 'Body', enabled: true, match: 'all', conditions: [{ field: 'body', op: 'contains', value: 'x' }], actions: [{ kind: 'flag' }] },
    ];
  });
  await openVault(page);
  await page.keyboard.press('Control+,');
  const dlg = page.getByRole('dialog', { name: /Einstellungen|Settings/ });
  await dlg.getByRole('button', { name: /^(E-Mail|Email)$/ }).click();
  await expect(dlg.getByTestId('rules-body-note')).toContainText(/open the message|öffnest/i);
});
