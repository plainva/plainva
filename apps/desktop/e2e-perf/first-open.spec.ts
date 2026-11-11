/* eslint-disable @typescript-eslint/no-explicit-any */
import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installStandIn, sqlBridge, standInFiles } from '../e2e/fixtures/sqliteStandIn';

/**
 * The first open of a large vault on an empty index (performance plan L3, a
 * report like `browser-perf.spec.ts`): from navigation to the first picture
 * a person can use — the file tree showing a note, and that note open and
 * taking typing — and to the index being whole. Before L3 the desktop showed
 * a splash bar until the whole first index was built.
 *
 *   PERF_BROWSER_COUNT=10000 pnpm --filter desktop exec playwright test --config playwright.perf.config.ts first-open
 */
const COUNT = Number(process.env.PERF_BROWSER_COUNT || 1000);
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'test-results', 'perf', 'first-open.json');

test('first open of a vault on an empty index (report)', async ({ page }, testInfo) => {
  test.setTimeout(1_800_000);
  const files = standInFiles(COUNT, 8);
  const sql = sqlBridge();
  await installStandIn(page, files, sql);
  const started = Date.now();
  await page.goto('/');
  const item = page.getByText('Start note', { exact: true }).first();
  await expect(item).toBeVisible({ timeout: 1_500_000 });
  const treeMs = Date.now() - started;
  await item.click();
  const heading = (files['Start note.md'].match(/^# (.+)$/m) ?? [])[1] ?? 'Start note';
  await expect(page.locator('.cm-content[contenteditable="true"]').first().getByText(heading).first()).toBeVisible({ timeout: 600_000 });
  const editableMs = Date.now() - started;
  if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: testInfo.outputPath('first-open.png') });
  await expect.poll(async () => Number((sql('plugin:sql|select', { query: 'SELECT count(*) AS n FROM fts_notes WHERE rowid <> 0' }) as any)[0].n), { timeout: 1_500_000, intervals: [500] })
    .toBeGreaterThanOrEqual(Object.keys(files).filter((p) => p.endsWith('.md')).length);
  const wholeMs = Date.now() - started;
  const report = { date: new Date().toISOString(), count: COUNT, treeMs, editableMs, wholeMs };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
});
