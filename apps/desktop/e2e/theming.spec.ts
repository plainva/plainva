/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * Theming platform + LCARS easter egg (Gesamtplan Themes/LCARS 2026-07-04).
 * Same Tauri mock as smoke.spec.ts, EXCEPT the store plugin is backed by
 * localStorage so theme unlocks/choices survive page.reload() like the real
 * plainva-settings.json would.
 */
test.beforeEach(async ({ page }) => {
  page.on('pageerror', err => console.log('PAGE ERROR:', err.message));
  await page.addInitScript(() => {
    (window as any).mockFs = {
      '/test-vault': { isDir: true },
      '/test-vault/.plainva': { isDir: true },
      '/test-vault/Welcome.md': "# Hello\nWelcome to the mock vault!",
      // Second note so the tab-drag scenario has two tabs to reorder.
      '/test-vault/Second.md': "# Second\nAnother note."
    };

    // localStorage-backed store — survives reloads within the test.
    const STORE_LS_KEY = 'pvE2EStore';
    const readStore = (): Record<string, any> => JSON.parse(localStorage.getItem(STORE_LS_KEY) || '{}');
    const writeStore = (s: Record<string, any>) => localStorage.setItem(STORE_LS_KEY, JSON.stringify(s));
    if (!localStorage.getItem(STORE_LS_KEY)) {
      writeStore({
        lastVaultPath: '/test-vault',
        recentVaults: ['/test-vault'],
        autoOpenLastVault: true,
      });
    }

    (window as any).__TAURI_INTERNALS__ = {
      plugins: { path: { sep: '/' } },
      transformCallback: (_cb: any) => 1,
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

        // --- STORE PLUGIN (persistent within the test via localStorage) ---
        if (cmd === 'plugin:store|load') return 1;
        if (cmd === 'plugin:store|get') {
          const store = readStore();
          if (args.key in store) return [store[args.key], true];
          if (String(args.key || '').startsWith('okfPromptDismissed_')) return [true, true];
          if (String(args.key || '').startsWith('backupZipEnabled_')) return [false, true];
          return [null, false];
        }
        if (cmd === 'plugin:store|set') {
          const store = readStore();
          store[args.key] = args.value;
          writeStore(store);
          return null;
        }
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
              .filter(p => !fs[p].isDir && p.startsWith('/test-vault/'))
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
          const entries: Record<string, {name: string, isDirectory: boolean, isFile: boolean, isSymlink: boolean}> = {};
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
          // Atomic-write root handle (hardening P2): the mock id carries the path.
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
      }
    };
  });
});

const openApp = async (page: any) => {
  await page.goto('/');
  await expect(page.getByText('Welcome', { exact: true })).toBeVisible({ timeout: 10000 });
};

test('Hailing frequencies: 4 logo clicks do nothing, 5 open the dialog; wrong lines get no response', async ({ page }) => {
  await openApp(page);
  const logo = page.getByTestId('titlebar-logo');

  for (let i = 0; i < 4; i++) await logo.click();
  await expect(page.getByTestId('hailing-dialog')).toHaveCount(0);

  await logo.click();
  await expect(page.getByTestId('hailing-dialog')).toBeVisible();

  // Wrong line: canonical "no response", theme unchanged.
  await page.getByTestId('hailing-input').fill('hello world');
  await page.getByTestId('hailing-send').click();
  await expect(page.getByTestId('hailing-feedback')).toContainText(/No response, Captain|Keine Antwort, Captain/);
  await expect(page.locator('html')).not.toHaveAttribute('data-theme-name', 'lcars');

  // Second failure in a row surfaces the Tamarian shrug.
  await page.getByTestId('hailing-input').fill('open sesame');
  await page.getByTestId('hailing-send').click();
  await expect(page.getByTestId('hailing-feedback')).toContainText(/Shaka/);

  // Escape closes the dialog.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('hailing-dialog')).toHaveCount(0);
});

test('A canonical German dub line unlocks LCARS with its variant — in the English app', async ({ page }) => {
  await openApp(page);
  const logo = page.getByTestId('titlebar-logo');
  for (let i = 0; i < 5; i++) await logo.click();

  await page.getByTestId('hailing-input').fill('Machen Sie es so.');
  await page.getByTestId('hailing-send').click();

  await expect(page.getByTestId('hailing-feedback')).toContainText(/Aye, Captain/);
  await expect(page.locator('html')).toHaveAttribute('data-theme-name', 'lcars');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme-variant', 'make-it-so');
  await expect(page.getByTestId('hailing-progress')).toContainText(/1 .* 13|1 von 13|1 of 13/);

  // Collecting a second frequency: red alert switches the palette variant.
  await page.getByTestId('hailing-input').fill('Roter Alarm');
  await page.getByTestId('hailing-send').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme-variant', 'red-alert');
  await expect(page.getByTestId('hailing-progress')).toContainText(/2 .* 13|2 von 13|2 of 13/);

  // Collected variants show as chips; clicking one switches back.
  await page.getByTestId('hailing-chip-make-it-so').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme-variant', 'make-it-so');

  // The unlock and the active theme survive a reload (persisted store).
  await page.reload();
  await expect(page.getByText('Welcome', { exact: true })).toBeVisible({ timeout: 10000 });
  await expect(page.locator('html')).toHaveAttribute('data-theme-name', 'lcars');
  await expect(page.locator('html')).toHaveAttribute('data-theme-variant', 'make-it-so');

  // The theme picker now lists the LCARS card; light/dark quick toggle is pinned.
  // (Settings open via the ribbon button; the modal starts on the vault
  // section, so navigate to General where the theme cards live.)
  await page.getByRole('button', { name: /^(Open settings|Einstellungen öffnen)$/ }).click();
  await expect(page.getByRole('heading', { name: /Einstellungen|Settings/ })).toBeVisible();
  await page.getByRole('dialog', { name: /Einstellungen|Settings/ }).getByRole('button', { name: /^(Appearance|Erscheinungsbild)$/ }).click();
  await expect(page.getByTestId('theme-card-lcars')).toBeVisible();
  await expect(page.getByRole('button', { name: /Toggle light\/dark|Hell\/Dunkel umschalten|Mode fixed|Modus vom Theme/ })).toBeDisabled();

  // Accessibility smoke under LCARS (settings open on purpose — worst case).
  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations.filter(v => ['critical', 'serious'].includes(v.impact ?? ''))).toEqual([]);
});

test('Theme cards switch bundled themes; single-mode themes pin the mode', async ({ page }) => {
  await openApp(page);
  await page.getByRole('button', { name: /^(Open settings|Einstellungen öffnen)$/ }).click();
  await expect(page.getByRole('heading', { name: /Einstellungen|Settings/ })).toBeVisible();
  await page.getByRole('dialog', { name: /Einstellungen|Settings/ }).getByRole('button', { name: /^(Appearance|Erscheinungsbild)$/ }).click();
  await expect(page.getByTestId('theme-card-petrol')).toBeVisible();

  // LCARS stays hidden while locked.
  await expect(page.getByTestId('theme-card-lcars')).toHaveCount(0);

  // Nord: theme-name flips and the background token actually changes.
  await page.getByTestId('theme-card-nord').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme-name', 'nord');
  const bg = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg-primary').trim());
  expect(['#eceff4', '#2e3440']).toContain(bg.toLowerCase());

  // Midnight is dark-only: mode gets pinned even though the pref may be light.
  await page.getByTestId('theme-card-midnight').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme-name', 'midnight');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  // Windows 95 is easter-egg gated since 2026-07-06: no card while locked
  // (unlock flow + light pinning covered by the "Hello computer" test below).
  await expect(page.getByTestId('theme-card-win95')).toHaveCount(0);

  // Back to Petrol: the pin is released.
  await page.getByTestId('theme-card-petrol').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme-name', 'petrol');
});

test("Scotty's line to the mouse unlocks Windows 95 as the LAST picker card", async ({ page }) => {
  await openApp(page);
  const logo = page.getByTestId('titlebar-logo');
  for (let i = 0; i < 5; i++) await logo.click();

  // The German dub line works in the English app (canonical lines are
  // language-independent, like the LCARS quotes).
  await page.getByTestId('hailing-input').fill('Hallo Computer!');
  await page.getByTestId('hailing-send').click();

  // Feedback nods to the movie scene; the theme flips to win95, light pinned.
  await expect(page.getByTestId('hailing-feedback')).toContainText(/How quaint|Wie rückständig/);
  await expect(page.locator('html')).toHaveAttribute('data-theme-name', 'win95');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  const accent = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent-color').trim());
  expect(accent.toLowerCase()).toBe('#000080');
  // The authentic-rework tokens are live: teal desktop + navy title bar.
  const canvas = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--canvas-bg').trim());
  expect(canvas.toLowerCase()).toBe('#008080');
  const titlebar = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--titlebar-bg').trim());
  expect(titlebar.toLowerCase()).toBe('#000080');

  // A theme unlock is a bonus find — it does NOT join the 13-variant
  // LCARS collection (no progress line appears).
  await expect(page.getByTestId('hailing-progress')).toHaveCount(0);

  // Unlock + active theme survive a reload; the picker lists Windows 95 as
  // the LAST card.
  await page.reload();
  await expect(page.getByText('Welcome', { exact: true })).toBeVisible({ timeout: 10000 });
  await expect(page.locator('html')).toHaveAttribute('data-theme-name', 'win95');
  await page.getByRole('button', { name: /^(Open settings|Einstellungen öffnen)$/ }).click();
  await page.getByRole('dialog', { name: /Einstellungen|Settings/ }).getByRole('button', { name: /^(Appearance|Erscheinungsbild)$/ }).click();
  await expect(page.getByTestId('theme-card-win95')).toBeVisible();
  const ids = await page.locator('[data-testid^="theme-card-"]').evaluateAll(
    (els) => els.map((e) => e.getAttribute('data-testid')),
  );
  expect(ids[ids.length - 1]).toBe('theme-card-win95');
});

test('LCARS: tab drag shows a visible drop indicator and reorders the tabs', async ({ page }) => {
  await openApp(page);

  // Unlock + activate LCARS via the hailing dialog (same path as above).
  const logo = page.getByTestId('titlebar-logo');
  for (let i = 0; i < 5; i++) await logo.click();
  await page.getByTestId('hailing-input').fill('Machen Sie es so.');
  await page.getByTestId('hailing-send').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme-name', 'lcars');
  await page.keyboard.press('Escape');

  // Two tabs: Welcome (click) + Second (middle-click = open in new tab).
  const tree = page.getByLabel('Left Sidebar');
  await tree.getByText('Welcome', { exact: true }).click();
  await tree.getByText('Second', { exact: true }).click({ button: 'middle' });
  const tabs = page.locator('[data-pv-tabstrip] [role="tab"]');
  await expect(tabs).toHaveCount(2);
  await expect(tabs.nth(0)).toContainText('Welcome');
  await expect(tabs.nth(1)).toContainText('Second');

  // Drag "Second" onto the left half of "Welcome". Mid-drag the target tab must
  // carry the inset drop indicator — under LCARS the old blanket
  // `box-shadow: none !important` swallowed it (regression pin).
  const from = await tabs.nth(1).boundingBox();
  const to = await tabs.nth(0).boundingBox();
  if (!from || !to) throw new Error('tab bounding boxes unavailable');
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 12, from.y + from.height / 2, { steps: 3 });
  await page.mouse.move(to.x + to.width * 0.25, to.y + to.height / 2, { steps: 6 });
  const midDragShadow = await tabs.nth(0).evaluate((el) => getComputedStyle(el).boxShadow);
  expect(midDragShadow).not.toBe('none');
  await page.mouse.up();

  await expect(tabs.nth(0)).toContainText('Second');
  await expect(tabs.nth(1)).toContainText('Welcome');
});
