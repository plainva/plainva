/* eslint-disable @typescript-eslint/no-explicit-any */
import { test, expect, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { summarizeFixture } from '../../../packages/core/scripts/perf/fixtureVault';
import { installStandIn as install, sqlBridge, standInFiles } from '../e2e/fixtures/sqliteStandIn';

/**
 * The browser measurement of the performance plan (Gesamtplan Leistung L0,
 * § 4, decision E4: a report, not a gate). The production bundle runs in
 * Chromium against a stand-in for the Tauri side: the vault is the fixture
 * vault held in memory, and every SQL statement goes to a REAL SQLite in the
 * test process (`node:sqlite`), so the index, the search and the editor run
 * their own code on real data.
 *
 * Measured:
 * - time to an editable note: from navigation until a note opened from the
 *   file tree takes typing — on an empty index (the first start) and on a
 *   warm one (the same index, the page loaded again);
 * - typing latency in the long note with tables: from each key's event to
 *   the frame after it, 95th percentile of about 60 keys. The note is the
 *   fixture's note of 80 tables cut to its first `PERF_LONG_SECTIONS`
 *   sections (default 8, about 2 000 lines): at its full 19 600 lines the
 *   page did not answer a key for ten minutes (Performance_Notes.md, "Many
 *   tables in one note"). Saves go to the stand-in, so the time includes the
 *   app's own save and re-index of the note;
 * - search: from typing a term into the sidebar search to the first hit.
 *
 * Not measured: Tauri IPC and the Rust side (the stand-in answers at once),
 * a real disk, WebView2/WKWebView instead of Chromium. The numbers are a
 * lower bound for the app, comparable from run to run on one machine.
 */

const COUNT = Number(process.env.PERF_BROWSER_COUNT || 1000);
const LONG_SECTIONS = Number(process.env.PERF_LONG_SECTIONS || 8);
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'test-results', 'perf', 'browser-perf.json');

function vaultFiles(): Record<string, string> {
  return standInFiles(COUNT, LONG_SECTIONS);
}

const percentile = (values: number[], p: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? Number(sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)].toFixed(1)) : null;
};

async function openFromTree(page: Page, title: string, heading: string): Promise<{ treeMs: number; editableMs: number }> {
  const started = Date.now();
  await page.goto('/');
  const item = page.getByText(title, { exact: true }).first();
  await expect(item).toBeVisible({ timeout: 300_000 });
  const treeMs = Date.now() - started;
  await item.click();
  const editor = page.locator('.cm-content[contenteditable="true"]').first();
  await expect(editor.getByText(heading).first()).toBeVisible({ timeout: 120_000 });
  return { treeMs, editableMs: Date.now() - started };
}

test('browser measurement at the built bundle (report)', async ({ page }, testInfo) => {
  const files = vaultFiles();
  const sql = sqlBridge();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await install(page, files, sql);
  const report: Record<string, unknown> = {
    date: new Date().toISOString(),
    fixture: { ...summarizeFixture({ count: COUNT }), inBrowser: Object.keys(files).length, longNoteLines: files['Long table note.md'].split('\n').length, longNoteTables: LONG_SECTIONS },
    boundary: 'Production bundle in Chromium; Tauri replaced by an in-page stand-in whose SQL runs on node:sqlite. No IPC, no Rust, no WebView2/WKWebView.',
  };

  const startHeading = (files['Start note.md'].match(/^# (.+)$/m) ?? [])[1] ?? 'Start note';
  const save = () => {
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');
  };
  report.firstStart = await openFromTree(page, 'Start note', startHeading);
  save();
  // The index is built in the background after the tree shows; the warm
  // start comes once it holds every note.
  await expect.poll(async () => Number((sql('plugin:sql|select', { query: 'SELECT count(*) AS n FROM fts_notes' }) as any)[0].n), { timeout: 300_000, intervals: [1000] })
    .toBeGreaterThanOrEqual(COUNT);
  report.warmStart = await openFromTree(page, 'Start note', startHeading);
  save();

  // Typing in the long note with tables.
  await openFromTree(page, 'Long table note', 'Long table note');
  const editor = page.locator('.cm-content').first();
  await editor.click({ position: { x: 10, y: 10 } });
  await page.keyboard.press('Control+End');
  for (let i = 0; i < 12; i++) await page.keyboard.press('ArrowUp');
  await page.keyboard.press('End');
  await page.evaluate(() => {
    (window as any).__keyLatency = [];
    document.addEventListener('keydown', (event) => {
      const at = event.timeStamp;
      requestAnimationFrame(() => setTimeout(() => (window as any).__keyLatency.push(performance.now() - at), 0));
    }, true);
  });
  await page.keyboard.type(' typing in a table row with measured keys', { delay: 40 });
  for (let i = 0; i < 18; i++) await page.keyboard.press('ArrowLeft', { delay: 40 });
  await page.waitForTimeout(300);
  const latency: number[] = await page.evaluate(() => (window as any).__keyLatency);
  report.typing = { keys: latency.length, p50Ms: percentile(latency, 50), p95Ms: percentile(latency, 95), maxMs: percentile(latency, 100) };
  save();

  // Search from the sidebar.
  const searches: Record<string, number> = {};
  for (const term of ['project', 'review meeting', 'Müller', 'garden']) {
    const field = page.locator('aside[aria-label="Left Sidebar"] input').first();
    await field.fill('');
    const started = Date.now();
    await field.fill(term);
    await expect(page.locator('[data-search-occurrence]').first()).toBeVisible({ timeout: 60_000 });
    searches[term] = Date.now() - started;
  }
  report.searchMs = searches;
  // A save the stand-in refused would leave the typing above without its save and re-index.
  report.saveFailedShown = await page.getByText(/Save failed|Speichern fehlgeschlagen/).count();
  report.pageErrors = errors;

  save();
  await testInfo.attach('browser-perf.json', { path: OUT, contentType: 'application/json' });
  if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: testInfo.outputPath('browser-perf.png') });
  console.log(JSON.stringify(report, null, 2));
});
