/* eslint-disable @typescript-eslint/no-explicit-any */
import { test, expect, type Page } from '@playwright/test';

// OKF 0.2 trust signals (plan OKF v0.2, P3a): the lifecycle badge in the
// document header (live widget AND read view), the stale banner with its one
// action, and the trust section of the properties panel. The form check is
// the point of the third test: a task database's `status: Offen` is not a
// lifecycle and must never get a badge — that rule protects every task note.

test.beforeEach(async ({ page }) => {
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', err => console.log('PAGE ERROR:', err.message));
  await page.addInitScript(() => {
    const draft = [
      '---',
      'type: Note',
      'status: draft',
      'generated:',
      '  by: plainva-import/0.6.7',
      '  at: 2026-08-01T10:00:00Z',
      'verified:',
      '  - by: human:marco',
      '    at: 2026-08-02T09:00:00Z',
      'sources:',
      '  - resource: https://example.org/spec',
      '    title: Spec',
      '---',
      '',
      '# Draft',
      '',
      'Text.',
      '',
    ].join('\n');
    const deprecated = ['---', 'type: Note', 'status: deprecated', '---', '', '# Deprecated', '', 'Old.', ''].join('\n');
    const stale = ['---', 'type: Note', 'stale_after: 2000-01-01', '---', '', '# Stale', '', 'Old.', ''].join('\n');
    const task = ['---', 'type: Task', 'status: Offen', '---', '', '# Task', '', 'Todo.', ''].join('\n');

    (window as any).mockFs = {
      '/test-vault': { isDir: true },
      '/test-vault/.plainva': { isDir: true },
      '/test-vault/Welcome.md': '# Hello\nWelcome to the mock vault!',
      '/test-vault/Draft.md': draft,
      '/test-vault/Deprecated.md': deprecated,
      '/test-vault/Stale.md': stale,
      '/test-vault/Task.md': task,
    };

    (window as any).__TAURI_INTERNALS__ = {
      plugins: { path: { sep: '/' } },
      transformCallback: () => 1,
      invoke: async (cmd: string, args: any, options: any) => {
        const fs = (window as any).mockFs;

        if (cmd === 'plugin:path|normalize') {
          let p = args.path.replace(/\\/g, '/');
          while (p.includes('//')) p = p.replace('//', '/');
          return p;
        }
        if (cmd === 'plugin:path|join') {
          return args.paths.join('/').replace(/\\/g, '/').replace(/\/+/g, '/');
        }

        if (cmd === 'plugin:store|load') return 1;
        // The version the marker above is compared against. Without it the
        // command falls through to `null` and every start looks like an update.
        if (cmd === 'plugin:app|version') return '9.9.9';
        if (cmd === 'plugin:store|get') {
          if (args.key === 'lastVaultPath') return ['/test-vault', true];
          if (args.key === 'recentVaults') return [['/test-vault'], true];
          if (args.key === 'autoOpenLastVault') return [true, true];
          // Stage D remounts `App` when the shown vault arrives, which is when
          // the release dialog finally gets a vault to render over. A marker
          // equal to the running version means "already seen" - this suite
          // tests the app, not its first five seconds (onboarding.spec covers
          // those on purpose).
          if (args.key === 'whatsNewSeenVersion') return ['9.9.9', true];
          if (String(args.key || '').startsWith('okfPromptDismissed_')) return [true, true];
          if (String(args.key || '').startsWith('backupZipEnabled_')) return [false, true];
          return [null, false];
        }
        if (cmd === 'plugin:store|set') return null;
        if (cmd === 'plugin:store|save') return null;

        if (cmd === 'plugin:dialog|ask') return true;
        if (cmd === 'plugin:dialog|confirm') return true;
        if (cmd === 'plugin:dialog|message') {
          return String(args?.buttons) === 'OkCancel' ? 'Ok' : 'Yes';
        }

        if (cmd === 'plugin:sql|load') return args.db;
        if (cmd === 'plugin:sql|execute') return [0, 0];
        if (cmd === 'plugin:sql|select') {
          const q = String(args.query);
          if (q.includes('path, title, mode FROM files') || q.includes('FROM files WHERE mode')) {
            return Object.keys(fs)
              .filter(p => !fs[p].isDir && p.startsWith('/test-vault/') && !/(^|\/)(\.plainva|\.git|node_modules|\.obsidian|\.trash|\.smart-env|\.stfolder)/.test(p))
              .map(p => {
                const relativePath = p.replace('/test-vault/', '');
                const isNote = /\.(md|base)$/i.test(relativePath);
                return { path: relativePath, title: relativePath.split('/').pop()!.replace(/\.md$/i, ''), mode: isNote ? 'note' : 'attachment' };
              });
          }
          return [];
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
          const entries: Record<string, { name: string; isDirectory: boolean; isFile: boolean; isSymlink: boolean }> = {};
          for (const path of Object.keys(fs)) {
            if (path !== p && path.startsWith(p + '/')) {
              const relative = path.substring(p.length + 1);
              const name = relative.split('/')[0];
              if (!entries[name]) {
                const childPath = `${p}/${name}`;
                const isDir = !!fs[childPath]?.isDir;
                entries[name] = { name, isDirectory: isDir, isFile: !isDir, isSymlink: false };
              }
            }
          }
          return Object.values(entries);
        }
        if (cmd === 'plugin:fs|read_text_file' || cmd === 'plugin:fs|read_file') {
          const rawPath = options?.headers?.path ? decodeURIComponent(options.headers.path) : (args?.path || '');
          const p = rawPath.endsWith('/') ? rawPath.slice(0, -1) : rawPath;
          const content = fs[p];
          if (content === undefined || content.isDir) throw new Error('File not found');
          return Array.from(new TextEncoder().encode(content));
        }
        if (cmd === 'register_write_root') {
          return 'mock-root:' + String(args.path).replace(/\/$/, '');
        }
        if (cmd === 'write_file_atomic') {
          const root = String(args.rootId).replace(/^mock-root:/, '');
          const rel = String(args.relPath).replace(/^\/+/, '');
          const p = root ? root + '/' + rel : rel;
          fs[p] = args.encoding === 'base64' ? atob(String(args.contents)) : String(args.contents);
          return null;
        }
        if (cmd === 'plugin:fs|write_text_file' || cmd === 'plugin:fs|write_file') {
          const rawPath = options?.headers?.path ? decodeURIComponent(options.headers.path) : (args?.path || '');
          const p = rawPath.endsWith('/') ? rawPath.slice(0, -1) : rawPath;
          let str: string;
          if (cmd === 'plugin:fs|write_text_file') {
            str = new TextDecoder().decode(new Uint8Array(args));
          } else {
            str = new TextDecoder().decode(new Uint8Array(args.data || args));
          }
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

async function openNote(page: Page, title: string) {
  await page.goto('/');
  await expect(page.getByText(title, { exact: true })).toBeVisible({ timeout: 10000 });
  await page.getByText(title, { exact: true }).click();
  await expect(page.locator('.cm-content').first()).toBeVisible({ timeout: 10000 });
}

/** Opens the properties section the way the stale banner's action does. */
const revealProperties = (page: Page) =>
  page.evaluate(() => window.dispatchEvent(new CustomEvent('plainva-reveal-properties')));

test('draft note: the lifecycle badge shows in live and read mode; the trust section derives the level', async ({ page }) => {
  await openNote(page, 'Draft');

  const badge = page.getByTestId('okf-status-badge');
  await expect(badge).toBeVisible({ timeout: 10000 });
  await expect(badge).toHaveAttribute('data-status', 'draft');
  await expect(badge).toHaveText('Draft');

  // Read mode renders the same badge through the React header.
  await page.getByRole('button', { name: 'Read Mode' }).click();
  await expect(page.getByTestId('okf-status-badge')).toBeVisible({ timeout: 10000 });
  await expect(page.getByTestId('okf-status-badge')).toHaveAttribute('data-status', 'draft');

  // Properties panel: derived trust level + provenance card.
  await revealProperties(page);
  const level = page.getByTestId('okf-trust-level');
  await expect(level).toBeVisible({ timeout: 10000 });
  await expect(level).toHaveAttribute('data-level', 'human-reviewed');
  const section = page.getByTestId('okf-trust-section');
  await expect(section).toContainText('plainva-import 0.6.7');
  await expect(section).toContainText('Spec');
});

test('deprecated note: the badge carries the danger tone', async ({ page }) => {
  await openNote(page, 'Deprecated');
  const badge = page.getByTestId('okf-status-badge');
  await expect(badge).toBeVisible({ timeout: 10000 });
  await expect(badge).toHaveAttribute('data-status', 'deprecated');
  await expect(badge).toHaveClass(/pv-chip--danger/);
});

test('stale note: the banner appears and its action opens the properties section; a fresh note shows none', async ({ page }) => {
  await openNote(page, 'Stale');
  const banner = page.getByTestId('okf-stale-banner');
  await expect(banner).toBeVisible({ timeout: 10000 });
  await expect(banner).toContainText('2000');
  await banner.getByRole('button').click();
  await expect(page.getByTestId('okf-trust-section')).toBeVisible({ timeout: 10000 });

  // A note whose `stale_after` lies in the future (or is absent) shows no banner.
  await openNote(page, 'Draft');
  await expect(page.getByTestId('okf-status-badge')).toBeVisible({ timeout: 10000 });
  await expect(page.getByTestId('okf-stale-banner')).toHaveCount(0);
});

test('a task database status is not a lifecycle: no badge, the status stays an ordinary property', async ({ page }) => {
  await openNote(page, 'Task');
  await expect(page.locator('.cm-content').first()).toContainText('Todo');
  await expect(page.getByTestId('okf-status-badge')).toHaveCount(0);
  await expect(page.getByTestId('okf-stale-banner')).toHaveCount(0);

  await revealProperties(page);
  await expect(page.getByTestId('okf-trust-level')).toHaveAttribute('data-level', 'unverified', { timeout: 10000 });
  // `Offen` stays an ordinary, renamable property row (its name textbox is the
  // only enabled one — the pinned lifecycle rows lock their names), and the
  // value is the task's own word, not swallowed by the lifecycle select.
  const props = page.locator('.pv-props');
  await expect(props.getByRole('textbox', { name: 'Name', disabled: false })).toHaveValue('status');
  await expect(props.getByRole('textbox', { name: 'Value…' })).toHaveValue('Offen');
});

test('mark as reviewed: asks for the reviewer once, appends human:<name> to verified and lifts the trust level', async ({ page }) => {
  await openNote(page, 'Stale');
  await revealProperties(page);
  await expect(page.getByTestId('okf-trust-level')).toHaveAttribute('data-level', 'unverified', { timeout: 10000 });

  await page.getByTestId('okf-mark-verified').click();
  // No reviewer name is stored for this vault yet (the mock store returns
  // nothing for verifierName_*), so the app asks once — an in-app prompt.
  const dialog = page.getByRole('dialog').last();
  await expect(dialog).toBeVisible({ timeout: 10000 });
  await dialog.getByRole('textbox').fill('Marco');
  await dialog.getByRole('button', { name: /Confirm|Bestätigen/ }).click();

  await expect(page.getByTestId('okf-trust-level')).toHaveAttribute('data-level', 'human-reviewed', { timeout: 10000 });
  await expect(page.getByTestId('okf-trust-section')).toContainText('Marco');

  // The review reaches the file: a `verified` entry with the human: actor.
  await expect
    .poll(() => page.evaluate(() => (window as any).mockFs['/test-vault/Stale.md'] as string), { timeout: 10000 })
    .toMatch(/verified:[\s\S]*human:Marco/);
});
