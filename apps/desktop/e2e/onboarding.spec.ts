/* eslint-disable @typescript-eslint/no-explicit-any */
import { test, expect } from '@playwright/test';

/**
 * First-run welcome (P3.1).
 *
 * This screen had no coverage, and that is exactly how it came to be
 * unreachable in dev: a `cancelled` flag from the effect's cleanup and a ref
 * guard cancelled each other out under StrictMode, so neither the welcome nor
 * the what's-new dialog ever appeared outside a production build. The first
 * test below is the regression for that — it fails if the dialog stops
 * appearing on a genuine first run.
 */

/** A machine that has never run Plainva: no seen-marker, no recent vaults. */
function firstRunShell(page: any) {
  return page.addInitScript(() => {
    (window as any).mockFs = { '/somewhere': { isDir: true } };
    const fs = (window as any).mockFs;
    (window as any).__TAURI_INTERNALS__ = {
      plugins: { path: { sep: '/' } },
      transformCallback: () => 1,
      invoke: async (cmd: string, args: any) => {
        if (cmd === 'plugin:path|normalize') {
          let p = String(args.path).replace(/\\/g, '/');
          while (p.includes('//')) p = p.replace('//', '/');
          return p;
        }
        if (cmd === 'plugin:path|join') return args.paths.join('/').replace(/\/+/g, '/');
        if (cmd === 'plugin:store|load') return 1;
        // Every key absent: no whatsNewSeenVersion, no recentVaults.
        if (cmd === 'plugin:store|get') return [null, false];
        if (cmd === 'plugin:store|set' || cmd === 'plugin:store|save') return null;
        if (cmd === 'plugin:dialog|open') return null; // the user cancels the picker
        if (cmd === 'plugin:sql|load') return args.db;
        if (cmd === 'plugin:sql|execute') return [0, 0];
        if (cmd === 'plugin:sql|select') return [];
        if (cmd === 'plugin:sql|select_one') return null;
        if (cmd === 'plugin:fs|exists') return !!fs[String(args.path).replace(/\/$/, '')];
        if (cmd === 'plugin:fs|read_dir') return [];
        if (cmd === 'plugin:fs|watch') return 1;
        return null;
      },
    };
  });
}

/**
 * A machine that HAS run Plainva: a stale seen-marker and a recent vault, which
 * is what makes this an update rather than a first run.
 */
function updatedShell(page: any) {
  return page.addInitScript(() => {
    (window as any).__TAURI_INTERNALS__ = {
      plugins: { path: { sep: '/' } },
      transformCallback: () => 1,
      invoke: async (cmd: string, args: any) => {
        if (cmd === 'plugin:path|normalize') return String(args.path).replace(/\\/g, '/');
        if (cmd === 'plugin:path|join') return args.paths.join('/').replace(/\/+/g, '/');
        if (cmd === 'plugin:store|load') return 1;
        if (cmd === 'plugin:store|get') {
          // An older version was seen, so the highlights are owed; a recent
          // vault proves this user is not new.
          if (args.key === 'whatsNewSeenVersion') return ['0.0.1', true];
          if (args.key === 'recentVaults') return [['/vault'], true];
          return [null, false];
        }
        if (cmd === 'plugin:app|version') return '9.9.9';
        if (cmd === 'plugin:store|set' || cmd === 'plugin:store|save') return null;
        if (cmd === 'plugin:dialog|open') return null;
        if (cmd === 'plugin:sql|load') return args.db;
        if (cmd === 'plugin:sql|execute') return [0, 0];
        if (cmd === 'plugin:sql|select') return [];
        if (cmd === 'plugin:sql|select_one') return null;
        if (cmd === 'plugin:fs|exists') return false;
        if (cmd === 'plugin:fs|read_dir') return [];
        if (cmd === 'plugin:fs|watch') return 1;
        return null;
      },
    };
  });
}

test('welcomes a first-time user with the three ways in', async ({ page }) => {
  await firstRunShell(page);
  await page.goto('/');

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 20000 });
  await expect(dialog.getByText(/Willkommen bei Plainva|Welcome to Plainva/)).toBeVisible();

  // Three actions, not a "next": the welcome is the entry itself.
  await expect(dialog.getByTestId('firstrun-open')).toBeVisible();
  await expect(dialog.getByTestId('firstrun-new')).toBeVisible();
  await expect(dialog.getByTestId('firstrun-import')).toBeVisible();
});

test('the import action opens the import wizard', async ({ page }) => {
  await firstRunShell(page);
  await page.goto('/');

  const dialog = page.getByRole('dialog');
  await expect(dialog.getByTestId('firstrun-import')).toBeVisible({ timeout: 20000 });
  await dialog.getByTestId('firstrun-import').click();

  // The welcome gives way to the flow it started — never both at once.
  await expect(page.getByRole('dialog').getByText(/Import from another app|Import aus/i).first())
    .toBeVisible();
  await expect(page.getByTestId('firstrun-import')).toHaveCount(0);
});

test('"later" leaves the ordinary splash behind', async ({ page }) => {
  await firstRunShell(page);
  await page.goto('/');

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 20000 });
  await dialog.getByRole('button', { name: /Später|Later/ }).click();

  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByTestId('splash-import')).toBeVisible();
});

test('after an update the highlights appear once, weighted, and never with the welcome', async ({ page }) => {
  await updatedShell(page);
  await page.goto('/');

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 20000 });

  // The version the app reports, not the catalog's.
  await expect(dialog.getByText(/9\.9\.9/)).toBeVisible();

  // The lead is one card among rows, not one bullet among equals — and this is
  // an update, so the welcome must stay away.
  await expect(dialog.getByTestId('whatsnew-lead')).toHaveCount(1);
  await expect(page.getByTestId('firstrun-import')).toHaveCount(0);

  await dialog.getByRole('button', { name: /Verstanden|Got it/ }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
