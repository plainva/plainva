/* eslint-disable @typescript-eslint/no-explicit-any */
import { test, expect, type Page } from '@playwright/test';

/**
 * What the shared components can ask an auxiliary window for (finding
 * 2026-09-07).
 *
 * The aux shell is a URL variant of the same bundle (`?win=aux…`), so the
 * single browser page Playwright drives CAN be an auxiliary window — what it
 * cannot be is the central window at the same time. The owner is therefore a
 * stub inside the Tauri mock: it answers the RPCs the client sends over the
 * event plugin (`pv:rpc` → `pv:rpc-reply`), records what it was asked, and
 * "writes" delegated saves into the mock file system. That is exactly the
 * seam the finding sat on: the editor's ⋮ entries fired events that nothing
 * in this window answered.
 *
 * The fixture is the version-history one from backup.spec.ts.
 */

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (err) => console.log('PAGE ERROR:', err.message));
  page.on('console', (msg) => { if (msg.type() === 'error' || msg.type() === 'warning') console.log('PAGE ' + msg.type().toUpperCase() + ':', msg.text().slice(0, 300)); });
  await page.addInitScript(() => {
    (window as any).mockFs = {
      '/test-vault': { isDir: true },
      '/test-vault/.plainva': { isDir: true },
      '/test-vault/.plainva/backups': { isDir: true },
      '/test-vault/.plainva/backups/Doc.md.1751700000000.bak': '# Doc\n\nalte Fassung eins',
      '/test-vault/.plainva/backups/Doc.md.1751700500000.bak': '# Doc\n\nalte Fassung zwei',
      '/test-vault/Doc.md': '# Doc\n\naktuelle Fassung',
      '/test-vault/Welcome.md': '# Hello\nWelcome to the mock vault!',
    };
    /** What the stub owner was asked over the bus, in order. */
    (window as any).__rpc = [] as Array<{ kind: string; args: any }>;

    // --- the event plugin, with a stub owner behind it -----------------------
    const callbacks = new Map<number, (e: unknown) => void>();
    const listeners = new Map<string, number>();
    let nextId = 0;
    const answer = (kind: string, args: any): unknown => {
      const fs = (window as any).mockFs;
      if (kind === 'write') {
        const p = String(args.path).startsWith('/') ? String(args.path) : '/test-vault/' + String(args.path);
        fs[p] = String(args.content);
        return null;
      }
      if (kind === 'reveal-in-tree') return { where: 'owner' };
      if (kind === 'open-content') return { where: 'caller' };
      if (kind === 'focus-content') return false;
      if (kind === 'workspace-status') return null;
      return null;
    };

    // `unlisten` goes through the event plugin's own internals, not invoke.
    (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
    (window as any).__TAURI_INTERNALS__ = {
      plugins: { path: { sep: '/' } },
      // `getCurrentWindow()` reads its label from here — the bus transport
      // needs it before anything else in a client window.
      metadata: { currentWindow: { label: 'aux-1' }, currentWebview: { label: 'aux-1', windowLabel: 'aux-1' } },
      transformCallback: (cb: (e: unknown) => void) => {
        nextId += 1;
        callbacks.set(nextId, cb);
        return nextId;
      },
      invoke: async (cmd: string, args: any, options: any) => {
        const fs = (window as any).mockFs;

        if (cmd === 'plugin:event|listen') {
          listeners.set(String(args.event), Number(args.handler));
          return Number(args.handler);
        }
        if (cmd === 'plugin:event|unlisten') return null;
        if (cmd === 'plugin:event|emit_to' || cmd === 'plugin:event|emit') {
          if (String(args.event) === 'pv:rpc') {
            const env = args.payload;
            (window as any).__rpc.push({ kind: env.kind, args: env.args });
            const reply = { id: env.id, ok: true, value: answer(env.kind, env.args) };
            const id = listeners.get('pv:rpc-reply');
            const cb = id ? callbacks.get(id) : undefined;
            if (cb) setTimeout(() => cb({ event: 'pv:rpc-reply', id: 0, payload: reply }), 0);
          }
          return null;
        }
        if (String(cmd).startsWith('plugin:window|')) return null;

        if (cmd === 'plugin:path|normalize') {
          let p = args.path.replace(/\\/g, '/');
          while (p.includes('//')) p = p.replace('//', '/');
          return p;
        }
        if (cmd === 'plugin:path|join') return args.paths.join('/').replace(/\\/g, '/').replace(/\/+/g, '/');
        if (cmd === 'plugin:path|resolve_directory') return '/appdata';

        if (cmd === 'plugin:store|load') return 1;
        if (cmd === 'plugin:app|version') return '9.9.9';
        if (cmd === 'plugin:store|get') {
          if (args.key === 'whatsNewSeenVersion') return ['9.9.9', true];
          return [null, false];
        }
        if (cmd === 'plugin:store|set' || cmd === 'plugin:store|save') return null;

        if (cmd === 'plugin:dialog|ask' || cmd === 'plugin:dialog|confirm') return true;
        if (cmd === 'plugin:dialog|message') return String(args?.buttons) === 'OkCancel' ? 'Ok' : 'Yes';

        if (cmd === 'plugin:sql|load') return args.db;
        if (cmd === 'plugin:sql|execute') return [0, 0];
        if (cmd === 'plugin:sql|select') {
          const q = String(args.query);
          if (q.includes('path, title, mode FROM files') || q.includes('FROM files WHERE mode')) {
            return Object.keys(fs)
              .filter((p) => !fs[p].isDir && p.startsWith('/test-vault/') && !p.startsWith('/test-vault/.plainva'))
              .map((p) => {
                const rel = p.replace('/test-vault/', '');
                return { path: rel, title: rel.split('/').pop()!.replace(/\.md$/i, ''), mode: 'note' };
              });
          }
          return [];
        }
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
          const rawPath = options?.headers?.path ? decodeURIComponent(options.headers.path) : (args?.path || '');
          const p = rawPath.endsWith('/') ? rawPath.slice(0, -1) : rawPath;
          const content = fs[p];
          if (content === undefined || content.isDir) throw new Error('File not found');
          return Array.from(new TextEncoder().encode(content));
        }
        // A client window never writes locally — every save goes over the bus
        // to the stub owner above. Should one slip through, it fails loudly.
        if (cmd === 'plugin:fs|write_text_file' || cmd === 'plugin:fs|write_file' || cmd === 'write_file_atomic') {
          throw new Error('a client window wrote locally: ' + cmd);
        }
        if (cmd === 'plugin:fs|watch') return 1;
        if (cmd === 'plugin:fs|unwatch') return null;

        return null;
      },
    };
  });
});

const AUX_URL = '/?win=aux&vault=%2Ftest-vault&content=Doc.md&label=aux-1';

async function openAuxNote(page: Page) {
  await page.goto(AUX_URL);
  await expect(page.getByTestId('aux-titlebar')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('.cm-content').first()).toContainText('aktuelle Fassung', { timeout: 15000 });
}

const rpc = (page: Page) => page.evaluate(() => (window as any).__rpc as Array<{ kind: string; args: any }>);

test('the version history opens in the auxiliary window and a restore writes over the bus', async ({ page }) => {
  await openAuxNote(page);

  await page.getByTestId('editor-menu-btn').click();
  await page.getByTestId('editor-menu-version-history').click();

  // The modal is HERE — the finding was that nothing happened.
  const modal = page.getByTestId('version-history-modal');
  await expect(modal).toBeVisible();
  await expect(page.getByTestId('version-item')).toHaveCount(2);
  await expect(page.getByTestId('version-diff-host')).toContainText('alte Fassung zwei');

  await page.getByTestId('version-item').nth(1).click();
  await expect(page.getByTestId('version-diff-host')).toContainText('alte Fassung eins');
  await page.getByTestId('version-restore').click();
  await page.locator('.pv-modal-footer button.pv-btn--primary').click();

  await expect(modal).not.toBeVisible({ timeout: 10000 });
  // The editor adopted the restored text...
  await expect(page.locator('.cm-content').first()).toContainText('alte Fassung eins', { timeout: 10000 });
  // ...and the write travelled the bus to the owner rather than the local disk.
  const writes = (await rpc(page)).filter((r) => r.kind === 'write');
  expect(writes.some((w) => String(w.args.path).endsWith('Doc.md') && String(w.args.content).includes('alte Fassung eins'))).toBe(true);
});

test('"reveal in file tree" asks the owner for the window with a tree', async ({ page }) => {
  await openAuxNote(page);

  await page.getByTestId('editor-menu-btn').click();
  await page.getByTestId('editor-menu-reveal-tree').click();

  await expect.poll(async () => (await rpc(page)).filter((r) => r.kind === 'reveal-in-tree').map((r) => r.args.path)).toEqual(['Doc.md']);
});
