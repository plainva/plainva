/* eslint-disable @typescript-eslint/no-explicit-any */
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test, expect } from '../e2e/fixtures/clockedTest';

/**
 * Every chunk of the production bundle loads without throwing (stability
 * plan R10, 2026-11-10).
 *
 * Rolldown splits the app into chunks that import each other. Without
 * `strictExecutionOrder` (vite.config.ts) a module could run before one it
 * imports and read its exports as undefined: the keychain slot builders of
 * the desktop did, and a module of the shared UI read a list as "not
 * iterable" when its chunk was loaded first. The app's own start covers only
 * the chunks it loads at boot; this loads each one on its own, in an order
 * the app never uses, the way a lazy screen or a second window does.
 */
const ASSETS = fileURLToPath(new URL('../dist/assets/', import.meta.url));

test('every chunk of the production bundle loads on its own without throwing', async ({ page }) => {
  test.setTimeout(240_000);
  // The worker entries run in a worker, not on a page; everything else is a chunk the page may load.
  const chunks = readdirSync(ASSETS).filter((f) => f.endsWith('.js') && !/worker/i.test(f));
  expect(chunks.length, 'the bundle was built (dist/assets)').toBeGreaterThan(10);
  // A bare page of the app's origin: nothing of the app runs before the chunk.
  await page.route('**/__chunk_probe', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body><div id="root"></div></body></html>' }));
  // What the WebView has around the app: a Tauri bridge that answers nothing.
  await page.addInitScript(() => {
    (window as any).__TAURI_INTERNALS__ = {
      invoke: async () => null,
      transformCallback: () => 1,
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' } },
      plugins: { path: { sep: '/' } },
    };
  });
  const failed: string[] = [];
  for (const chunk of chunks) {
    // A fresh page per chunk: each starts from nothing, as a lazy load does.
    await page.goto('/__chunk_probe');
    const error = await page.evaluate(async (url) => {
      try {
        await import(url);
        return null;
      } catch (e) {
        return String((e as Error)?.stack || e).slice(0, 300);
      }
    }, `/assets/${chunk}`);
    if (error) failed.push(`${chunk}: ${error}`);
  }
  expect(failed, failed.join('\n')).toEqual([]);
});
