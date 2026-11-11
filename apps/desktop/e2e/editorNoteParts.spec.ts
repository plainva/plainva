import { test, expect, type Page } from './fixtures/clockedTest';
import { installMenuVault } from './fixtures/menuVault';

// Three readings of a note the editor shared with nobody (bug-clearing plan, P9).
//
// - A picture written the way Obsidian writes it without wiki links,
//   `![a](Zoom%20one.svg)`, stayed empty in the live view while the reading
//   view showed it (open-items plan 3.42).
// - A value in the properties block that opens a code fence made the rest of
//   the note code to the editor: no heading, no bold, no tag pill (3.46).
// - `[[Note\|alias]]`, a wiki link as a table cell writes it (and as it stays
//   when the row moves out of the table), was drawn as a link to "Note\" that
//   does not exist (3.133 no. 1).

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="80"><rect width="160" height="80" fill="cornflowerblue"/></svg>';
const PARTS = [
  '---',
  'snippet: |',
  '  ```',
  '  code',
  '---',
  '# Parts heading',
  '',
  'Some **bold** words and #parttag here.',
  '',
  'Moved out of a table: [[Target\\|the target]].',
  '',
  '![Zoom](Zoom%20one.svg)',
  '',
  'The end.',
  '',
].join('\n');

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (err) => console.log('PAGE ERROR:', err.message));
  await page.addInitScript(installMenuVault);
  await page.addInitScript(({ parts, svg }) => {
    const fs = (window as unknown as { mockFs: Record<string, unknown> }).mockFs;
    fs['/test-vault/Parts.md'] = parts;
    fs['/test-vault/Target.md'] = '# Target\n';
    fs['/test-vault/Zoom one.svg'] = svg;
  }, { parts: PARTS, svg: SVG });
  await page.setViewportSize({ width: 1400, height: 1000 });
});

async function openParts(page: Page) {
  await page.goto('/');
  const entry = page.getByTestId('file-tree').getByText('Parts', { exact: true });
  await expect(entry).toBeVisible({ timeout: 20000 });
  await entry.click();
  await expect(page.locator('.cm-content').getByText('The end.')).toBeVisible();
}

test('the live view shows the picture, formats the text behind a fence in the properties, and links to the note a cell names', async ({ page }, testInfo) => {
  await openParts(page);
  const content = page.locator('.cm-content');

  // 3.46: the text behind the block is Markdown again.
  await expect(content.locator('.pv-tag-pill', { hasText: 'parttag' })).toBeVisible();
  const bold = content.getByText('bold', { exact: true });
  await expect.poll(() => bold.evaluate((el) => Number(getComputedStyle(el).fontWeight))).toBeGreaterThanOrEqual(600);

  // 3.42: the encoded name finds `Zoom one.svg`.
  const picture = content.locator('img[alt="Zoom one.svg"]');
  await picture.scrollIntoViewIfNeeded();
  await expect(picture).toHaveAttribute('src', /^blob:/);
  await expect.poll(() => picture.evaluate((el) => (el as HTMLImageElement).complete ? (el as HTMLImageElement).naturalWidth : 0)).toBe(160);

  // 3.133 no. 1: the link names the note, without the backslash, and shows its alias.
  await expect(content.locator('[data-link-target="Target"]')).toHaveText('the target');
  // (This vault's index is fixed and does not list Target, so the link is drawn as not created yet.)
  await expect(content.locator('[data-link-target$="\\\\"]')).toHaveCount(0);

  if (process.env.PLAINVA_EVIDENCE) await page.screenshot({ path: testInfo.outputPath('editor-note-parts.png') });
});
