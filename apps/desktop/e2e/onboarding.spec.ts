/* eslint-disable @typescript-eslint/no-explicit-any */
import { test, expect } from './fixtures/clockedTest';

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

interface FirstRunOptions {
  /** Looking into Documents is refused, as when macOS access was declined. */
  denyDocuments?: boolean;
  /** What the folder dialog returns; null is a cancel. */
  pick?: string | null;
  /** Each vault write waits this long, so the welcome's progress can be seen. */
  writeDelayMs?: number;
}

/** A machine that has never run Plainva: no seen-marker, no recent vaults. */
function firstRunShell(page: any, opts: FirstRunOptions = {}) {
  return page.addInitScript((o: FirstRunOptions) => {
    (window as any).mockFs = { '/somewhere': { isDir: true } };
    const fs = (window as any).mockFs;
    // What the welcome's actions did to the disk, for the tour tests (O8).
    const calls: Array<{ cmd: string; path: string }> = ((window as any).__fsCalls = []);
    (window as any).__TAURI_INTERNALS__ = {
      plugins: { path: { sep: '/' } },
      transformCallback: () => 1,
      invoke: async (cmd: string, args: any, options?: any) => {
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
        if (cmd === 'plugin:dialog|open') return o.pick ?? null; // null: the user cancels the picker
        if (cmd === 'plugin:sql|load') return args.db;
        if (cmd === 'plugin:sql|execute') return [0, 0];
        if (cmd === 'plugin:sql|select') return [];
        if (cmd === 'plugin:sql|select_one') return null;
        if (cmd === "register_write_root") return "mock-root:" + String(args.path).replace(/\/$/, "");
        // Checked native reads use the same files as the plugin fixture.
        if (cmd === "checked_path_exists" || cmd === "checked_read_text_file" || cmd === "checked_read_dir") {
          const root = String(args.rootId).replace(/^mock-root:/, "").replace(/\/$/, "");
          const rel = String(args.relPath).replace(/^\/+/, "");
          const path = rel ? `${root}/${rel}` : root;
          const present = await (window as any).__TAURI_INTERNALS__.invoke("plugin:fs|exists", { path });
          if (cmd === "checked_path_exists") return present;
          if (!present) return null;
          if (cmd === "checked_read_dir") {
            const entries = await (window as any).__TAURI_INTERNALS__.invoke("plugin:fs|read_dir", { path });
            return entries.map((entry: any) => ({ name: entry.name, isDirectory: !!entry.isDirectory, isFile: entry.isFile ?? (!entry.isDirectory && !entry.isSymlink), isSymlink: !!entry.isSymlink }));
          }
          const bytes = await (window as any).__TAURI_INTERNALS__.invoke("plugin:fs|read_text_file", { path });
          return typeof bytes === "string" ? bytes : new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes));
        }
        // The tour goes into Documents (O8): a fixed place for the test.
        if (cmd === 'plugin:path|resolve_directory') return '/home/u/Documents';
        if (cmd === 'plugin:fs|mkdir' || cmd === 'plugin:fs|write_text_file' || cmd === 'plugin:fs|write_file') {
          const path = String(args?.path ?? options?.headers?.path ?? '');
          calls.push({ cmd, path: decodeURIComponent(path) });
          if (cmd === 'plugin:fs|mkdir') fs[decodeURIComponent(path).replace(/\/$/, '')] = { isDir: true };
          return null;
        }
        // The vault adapter writes through the checked native command.
        if (cmd === 'write_file_atomic') {
          if (o.writeDelayMs) await new Promise((r) => setTimeout(r, o.writeDelayMs));
          const root = String(args.rootId).replace(/^mock-root:/, '').replace(/\/$/, '');
          calls.push({ cmd: 'write', path: `${root}/${String(args.relPath).replace(/^\/+/, '')}` });
          return null;
        }
        if (cmd === 'plugin:fs|exists' || cmd === 'plugin:fs|read_dir') {
          // Every look at the disk, for "nothing is looked at before the click".
          calls.push({ cmd, path: String(args.path) });
          if (o.denyDocuments && String(args.path).startsWith('/home/u/Documents')) throw 'forbidden path: ' + String(args.path);
        }
        if (cmd === 'plugin:fs|exists') return !!fs[String(args.path).replace(/\/$/, '')];
        if (cmd === 'plugin:fs|read_dir') {
          const dir = String(args.path).replace(/\/$/, '');
          const kids = (fs[dir] && fs[dir].children) || [];
          return kids.map((name: string) => ({ name, isDirectory: false, isFile: true, isSymlink: false }));
        }
        if (cmd === 'plugin:fs|watch') return 1;
        return null;
      },
    };
  }, opts);
}

/** The folders the tour made, in order. */
/** The tour folders made (their roots — the template's own subfolders follow inside). */
const madeFolders = (page: any): Promise<string[]> => page.evaluate(() =>
  (window as any).__fsCalls
    .filter((c: any) => c.cmd === 'plugin:fs|mkdir' && /\/Plainva[ -]Tour(?: \d+)?$/.test(c.path))
    .map((c: any) => c.path));

/** Folders that already exist in Documents, some with notes in them. */
function documentsHolding(page: any, folders: Record<string, string[]>) {
  return page.addInitScript((f: Record<string, string[]>) => {
    const fs = (window as any).mockFs;
    for (const [name, children] of Object.entries(f)) fs[`/home/u/Documents/${name}`] = { isDir: true, children };
  }, folders);
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

test('welcomes a first-time user with the tour as the main way in (O8, mockup M8)', async ({ page }, testInfo) => {
  await firstRunShell(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 20000 });
  await expect(dialog.getByText(/Willkommen bei Plainva|Welcome to Plainva/)).toBeVisible();

  // The tour is THE action; the folder of notes one already has sits beside
  // it; empty and import are links underneath, not buttons of equal weight.
  await expect(dialog.getByTestId('firstrun-tour')).toHaveClass(/pv-btn--primary/);
  await expect(dialog.getByTestId('firstrun-open')).toHaveClass(/pv-btn--secondary/);
  await expect(dialog.getByTestId('firstrun-new')).toHaveClass(/pv-linkbtn/);
  await expect(dialog.getByTestId('firstrun-import')).toHaveClass(/pv-linkbtn/);
  // "Later" is the way out, apart from the offers; the website and the guide are links.
  await expect(dialog.getByTestId('firstrun-later')).toHaveClass(/pv-btn--ghost/);
  await expect(dialog.getByTestId('firstrun-more')).toContainText('plainva.com');
  await expect(dialog.getByTestId('firstrun-more').getByRole('button', { name: /Handbuch|User guide/ })).toBeVisible();

  // The tour card names the folder BEFORE the click — and nothing was looked
  // at to name it: a look into Documents is what makes macOS ask for access.
  await expect(dialog.getByTestId('firstrun-tour-where')).toContainText('/home/u/Documents/Plainva');
  const looks = await page.evaluate(() => (window as any).__fsCalls.filter((c: any) => c.path.startsWith('/home/u/Documents')));
  expect(looks).toEqual([]);

  // Nothing cut off at 1440 px (finding D3: a chip was truncated here).
  const clipped = await dialog.evaluate((el) =>
    [...el.querySelectorAll('button, strong, span, h3, p')].some((n) => (n as HTMLElement).scrollWidth > (n as HTMLElement).clientWidth + 1));
  expect(clipped).toBe(false);
  // Let the dialog's entrance finish: a photo mid-fade shows the splash through it.
  await page.waitForTimeout(500);
  if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: testInfo.outputPath('firstrun-1440.png') });
  await page.setViewportSize({ width: 1024, height: 700 });
  await page.waitForTimeout(300);
  if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: testInfo.outputPath('firstrun-1024.png') });
});

test('the tour is one click: it makes the named folder in Documents and writes the tour into it', async ({ page }) => {
  await firstRunShell(page, { writeDelayMs: 40 });
  await page.goto('/');

  const dialog = page.getByRole('dialog');
  const where = dialog.getByTestId('firstrun-tour-where');
  await expect(where).toBeVisible({ timeout: 20000 });
  const named = (await where.textContent()) ?? '';
  const tour = dialog.getByTestId('firstrun-tour');
  await tour.click();

  // While it is written the welcome stays and says so, and a second click
  // makes no second vault.
  await expect(tour).toBeDisabled();
  await expect(tour).toContainText(/Die Tour wird angelegt|Creating the tour/);
  await expect(dialog.getByTestId('firstrun-later')).toBeDisabled();
  await tour.click({ force: true });

  // The welcome gives way, and the folder it named is the one that was made.
  await expect(page.getByTestId('firstrun-tour')).toHaveCount(0, { timeout: 30000 });
  expect(await madeFolders(page)).toHaveLength(1);
  await expect.poll(async () => page.evaluate(() => (window as any).__fsCalls.filter((c: any) => c.cmd === 'plugin:fs|mkdir').map((c: any) => c.path)), { timeout: 15000 })
    .toContainEqual(expect.stringMatching(/^\/home\/u\/Documents\/Plainva[ -]Tour$/));
  const made = await page.evaluate(() => (window as any).__fsCalls.find((c: any) => c.cmd === 'plugin:fs|mkdir').path);
  expect(named).toContain(made);
  // And the tour's notes went into it, nowhere else.
  const notes = () => page.evaluate(() => (window as any).__fsCalls
    .filter((c: any) => (c.cmd === 'write' || c.cmd === 'plugin:fs|write_text_file') && /\.(md|base)$/.test(c.path)).map((c: any) => c.path));
  await expect.poll(async () => (await notes()).length, { timeout: 15000 }).toBeGreaterThan(10);
  const outside = (await notes()).filter((path: string) => !path.startsWith(`${made}/`));
  expect(outside).toEqual([]);
});

test('a tour folder that already holds notes is never written into — the next name is used', async ({ page }) => {
  await firstRunShell(page);
  await documentsHolding(page, { 'Plainva Tour': ['Mine.md'], 'Plainva-Tour': ['Mine.md'] });
  await page.goto('/');

  const dialog = page.getByRole('dialog');
  await expect(dialog.getByTestId('firstrun-tour-where')).toBeVisible({ timeout: 20000 });
  await dialog.getByTestId('firstrun-tour').click();
  await expect.poll(() => madeFolders(page), { timeout: 15000 }).toEqual([expect.stringMatching(/\/Plainva[ -]Tour 2$/)]);
});

test('the place of a vault Plainva still remembers is skipped, even when its folder is gone', async ({ page }) => {
  await firstRunShell(page);
  // A tour vault deleted from the disk whose layout Plainva kept: a new tour
  // there would have inherited it.
  await page.addInitScript(() => {
    for (const name of ['Plainva Tour', 'Plainva-Tour']) localStorage.setItem(`plainva-layout-/home/u/Documents/${name}`, '{}');
  });
  await page.goto('/');

  const dialog = page.getByRole('dialog');
  await expect(dialog.getByTestId('firstrun-tour')).toBeVisible({ timeout: 20000 });
  await dialog.getByTestId('firstrun-tour').click();
  await expect.poll(() => madeFolders(page), { timeout: 15000 }).toEqual([expect.stringMatching(/\/Plainva[ -]Tour 2$/)]);
});

test('a refused Documents folder is said in words, with another place as the way on', async ({ page }) => {
  await firstRunShell(page, { denyDocuments: true, pick: '/media/stick' });
  await page.goto('/');

  const dialog = page.getByRole('dialog');
  await expect(dialog.getByTestId('firstrun-tour')).toBeVisible({ timeout: 20000 });
  await dialog.getByTestId('firstrun-tour').click();

  const failed = dialog.getByTestId('firstrun-tour-failed');
  await expect(failed).toBeVisible();
  await expect(failed).toContainText('/home/u/Documents');
  await expect(failed).not.toContainText('forbidden');
  expect(await madeFolders(page)).toEqual([]);

  await failed.getByTestId('firstrun-tour-elsewhere').click();
  await expect.poll(() => madeFolders(page), { timeout: 15000 }).toEqual([expect.stringMatching(/^\/media\/stick\/Plainva[ -]Tour$/)]);
  await expect(page.getByTestId('firstrun-tour')).toHaveCount(0, { timeout: 30000 });
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

test('"Later" leaves the ordinary splash behind', async ({ page }) => {
  await firstRunShell(page);
  await page.goto('/');

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 20000 });
  await dialog.getByTestId('firstrun-later').click();

  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByTestId('splash-import')).toBeVisible();
});

test('the ✕ leaves the ordinary splash behind', async ({ page }) => {
  await firstRunShell(page);
  await page.goto('/');

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 20000 });
  await dialog.getByRole('button', { name: /Schließen|Close/ }).click();

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

// Finding X7 (review 2026-11-10): a dialog that took the focus wore the global
// teal focus ring around its whole frame — it read like an error state. The
// frame keeps no ring; its controls keep theirs.
test('a dialog that takes the focus wears no ring, its buttons still do', async ({ page }) => {
  await firstRunShell(page);
  await page.goto('/');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 20000 });
  // A keyboard user: the last input was a key, so a focus set by code counts
  // as :focus-visible — the case in which the ring appeared.
  await page.keyboard.press('Shift');
  await dialog.evaluate((el) => (el as HTMLElement).focus());
  const frame = await dialog.evaluate((el) => ({
    focused: document.activeElement === el,
    visible: el.matches(':focus-visible'),
    outline: getComputedStyle(el).outlineStyle,
  }));
  expect(frame.focused).toBe(true);
  expect(frame.visible).toBe(true);
  expect(frame.outline, 'the dialog frame carries a focus ring').toBe('none');
  if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: test.info().outputPath('dialog-focus-frame.png') });

  // Positive control: Tab moves to a control, and that one shows its ring.
  await page.keyboard.press('Tab');
  const control = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    return { inDialog: !!el?.closest('[role="dialog"]'), outline: el ? getComputedStyle(el).outlineStyle : '' };
  });
  expect(control.inDialog).toBe(true);
  expect(control.outline).toBe('solid');
  if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: test.info().outputPath('dialog-focus-control.png') });
});
