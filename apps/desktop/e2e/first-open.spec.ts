import { test, expect } from './fixtures/clockedTest';
import { installStandIn, releaseIndexReads, sqlBridge, standInFiles } from './fixtures/sqliteStandIn';

/**
 * The first open of a vault on an empty index does not wait for the index
 * (performance plan L3, finding B4). The desktop used to show a splash bar
 * until every note was read — about a minute for 10 000 notes. Now the vault
 * opens at once: the tree draws its files from the folder listing, a note
 * opens and takes typing, and a strip on top says that search, tags and
 * databases are not whole yet, until they are.
 *
 * The index's reads are held here (the stand-in answers `read_files_for_index`
 * only once released), so what the app shows while its first index is being
 * built can be looked at for as long as the test needs. SQL runs on a real
 * SQLite in the test process (`fixtures/sqliteStandIn.ts`).
 */
const COUNT = 300;

test('a vault opens before its first index is built, says so, and has the index once it is', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const files = standInFiles(COUNT, 2);
  const sql = sqlBridge();
  await installStandIn(page, files, sql, { holdIndexReads: true });
  await page.goto('/');

  // The tree, from the disk listing, while not one note is indexed.
  const tree = page.locator('aside[aria-label="Left Sidebar"]');
  await expect(tree.getByText('Start note', { exact: true }).first()).toBeVisible({ timeout: 60_000 });
  const notice = page.getByTestId('index-build-notice');
  await expect(notice).toBeVisible();
  await expect(notice).toContainText(/search index/i);
  const indexed = () => Number((sql('plugin:sql|select', { query: 'SELECT count(*) AS n FROM fts_notes WHERE rowid <> 0' }) as { n: number }[])[0].n);
  expect(indexed()).toBe(0);

  // A note opens and takes typing while the index is being built.
  await tree.getByText('Start note', { exact: true }).first().click();
  const heading = (files['Start note.md'].match(/^# (.+)$/m) ?? [])[1] ?? 'Start note';
  const editor = page.locator('.cm-content[contenteditable="true"]').first();
  await expect(editor.getByText(heading).first()).toBeVisible({ timeout: 30_000 });
  // The counts in the status bar come from the note, not from the index: they are
  // there while the index is built (the first photo of this test caught them
  // inside their 250 ms debounce).
  await expect(page.locator('footer').getByText(/[1-9][\d,.\s]* words/).first()).toBeVisible({ timeout: 10_000 });
  if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: testInfo.outputPath('first-open-building.png') });

  // Folders of the fixture are in the tree as well, from the same listing.
  await expect(tree.getByText('Projects', { exact: true }).first()).toBeVisible();

  await releaseIndexReads(page);
  await expect(notice).toBeHidden({ timeout: 120_000 });
  const notes = Object.keys(files).filter((p) => p.endsWith('.md')).length;
  expect(indexed()).toBe(notes);

  // Search answers from the whole index now.
  const field = page.locator('aside[aria-label="Left Sidebar"] input').first();
  await field.fill('project');
  await expect(page.locator('[data-search-occurrence]').first()).toBeVisible({ timeout: 30_000 });
  if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: testInfo.outputPath('first-open-whole.png') });
});

test('the same with a host that reads one file per call (an older native side)', async ({ page }) => {
  test.setTimeout(180_000);
  const files = standInFiles(120, 1);
  const sql = sqlBridge();
  await installStandIn(page, files, sql, { manyAtOnce: false });
  await page.goto('/');
  await expect(page.locator('aside[aria-label="Left Sidebar"]').getByText('Start note', { exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('index-build-notice')).toBeHidden({ timeout: 120_000 });
  const notes = Object.keys(files).filter((p) => p.endsWith('.md')).length;
  expect(Number((sql('plugin:sql|select', { query: 'SELECT count(*) AS n FROM fts_notes WHERE rowid <> 0' }) as { n: number }[])[0].n)).toBe(notes);
});

test.afterEach(async ({ page }) => {
  // A test that failed while the reads were held leaves nothing waiting.
  await releaseIndexReads(page).catch(() => undefined);
});
