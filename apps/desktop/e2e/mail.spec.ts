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
      { uid: 2, subject: 'Rechnung Q3', from: 'Anna Beispiel <anna@example.org>', dateTs: NOW, seen: false },
      { uid: 1, subject: 'Newsletter Juli', from: 'News <news@example.org>', dateTs: NOW - 86400000, seen: true },
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
          if (String(args.key || '').startsWith('mailAccounts_')) {
            if ((window as any).__noMailAccounts) return [null, false];
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
          return [{ name: 'INBOX' }, { name: 'Entwürfe' }, { name: 'Sent' }, { name: 'Trash' }];
        }
        if (cmd === 'mail_set_seen') {
          (window as any).__setSeen = { mailbox: args.mailbox, uid: args.uid, seen: args.seen };
          return null;
        }
        if (cmd === 'mail_move_message') {
          (window as any).__moved = { mailbox: args.mailbox, uid: args.uid, target: args.target };
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
          ((window as any).__envCalls ||= []).push({ user: args.user, mailbox: args.mailbox });
          const own = String(args.user || '').includes('zweit') ? ['Archiv', 'Posteingang'] : ['INBOX', 'Entwürfe', 'Sent', 'Trash'];
          if (!own.includes(String(args.mailbox))) {
            await new Promise((r) => setTimeout(r, 400)); // a SLOW failure, like a real server
            throw new Error('examine failed: No Response: [NONEXISTENT] Unknown Mailbox: ' + args.mailbox + ' (Failure)');
          }
          return { total: envelopes.length, unseen: envelopes.filter((e: any) => !e.seen).length, messages: envelopes };
        }
        if (cmd === 'mail_fetch_message') return fullMessage;
        if (cmd === 'mail_fetch_raw') return btoa('From: anna@example.org\r\nSubject: Rechnung Q3\r\n\r\nBody');
        if (cmd === 'plugin:dialog|ask' || cmd === 'plugin:dialog|confirm') return true;
        if (cmd === 'plugin:dialog|message') return String(args?.buttons) === 'OkCancel' ? 'Ok' : 'Yes';
        if (cmd === 'plugin:sql|load') return args.db;
        if (cmd === 'plugin:sql|execute') return [0, 0];
        if (cmd === 'plugin:sql|select') {
          const q = String(args.query);
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
  await expect(page.getByTestId('draft-body')).toHaveValue(/anbei die Rechnung\./);
  // The body is editable; sending goes straight through SMTP with the edited text.
  await page.getByTestId('draft-body').fill('Danke, passt!');
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
