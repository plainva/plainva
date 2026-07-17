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
    const mailAccount = { id: 'm1', label: 'marco@example.org', host: 'imap.example.org', port: 993, user: 'marco@example.org' };
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
            return (window as any).__noMailAccounts ? [null, false] : [[mailAccount], true];
          }
          return [null, false];
        }
        if (cmd === 'plugin:store|set' || cmd === 'plugin:store|save') return null;
        if (cmd === 'keychain_get') {
          if (String(args.key || '').startsWith('mail_m1_')) return JSON.stringify({ pass: 'app-pw' });
          return null;
        }
        if (cmd === 'mail_list_envelopes') {
          if (args.pass !== 'app-pw') throw new Error('bad credentials');
          return { total: envelopes.length, messages: envelopes };
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
  await expect(frame).toHaveAttribute('sandbox', '');
  const srcdoc = await frame.getAttribute('srcdoc');
  expect(srcdoc).toContain('Rechnung');
  expect(srcdoc).not.toContain('tracker.example.org');
  expect(srcdoc).toContain("default-src 'none'");

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
  expect(noteContent).toContain('uid: 2');
  expect(noteContent).toContain('# Rechnung Q3');
  expect(noteContent).toContain('anbei die Rechnung.');
  await expect(page.locator('.cm-content').getByText('Rechnung Q3').first()).toBeVisible();
});

test('mail tab without accounts shows the empty state and opens settings', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).__noMailAccounts = true;
  });
  await openVault(page);
  await page.getByTestId('ribbon-mail').click();
  await expect(page.getByTestId('mail-view')).toBeVisible();
  await expect(page.getByTestId('mail-open-settings')).toBeVisible();
  await page.getByTestId('mail-open-settings').click();
  await expect(page.getByRole('dialog')).toBeVisible();
});
