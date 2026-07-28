import { describe, expect, it } from 'vitest';
import {
  DEFAULT_IMPORT_LABELS,
  HtmlFolderImporter,
  htmlTitleAndBody,
  resolveRelative,
} from '../../src/import/index.js';

function fakeVault() {
  const files = new Map<string, string>();
  const binaries = new Map<string, Uint8Array>();
  return {
    files,
    binaries,
    async exists(path: string) {
      return files.has(path) || binaries.has(path);
    },
    async writeTextFile(path: string, content: string) {
      files.set(path, content);
    },
    async writeBinaryFile(path: string, content: Uint8Array) {
      binaries.set(path, content);
    },
    async createFolder() {},
  };
}

const opts = (vaultAdapter: ReturnType<typeof fakeVault>) => ({
  targetVaultPath: '/v',
  targetSubfolder: 'Import',
  vaultAdapter,
  labels: DEFAULT_IMPORT_LABELS,
});

describe('HTML — where the title comes from', () => {
  it('prefers the heading over the site title and takes it out of the body', () => {
    // A Confluence export writes "Space : Page" into <title>; the <h1> is the
    // page itself.
    const { title, body } = htmlTitleAndBody(
      '<html><head><title>Team wiki : Onboarding</title></head><body><h1 id="title-heading">Onboarding</h1><p>Hi</p></body></html>',
      'fallback'
    );
    expect(title).toBe('Onboarding');
    expect(body).not.toContain('<h1');
    expect(body).toContain('<p>Hi</p>');
  });

  it('falls back to the site title, and then to the file name', () => {
    expect(htmlTitleAndBody('<title>Just this</title><p>x</p>', 'fb').title).toBe('Just this');
    expect(htmlTitleAndBody('<p>no titles here</p>', 'fb').title).toBe('fb');
  });

  it('resolves a relative href against the folder the link sits in', () => {
    expect(resolveRelative('space/pages/12345.html', '67890.html')).toBe('space/pages/67890.html');
    expect(resolveRelative('space/pages/12345.html', '../index.html')).toBe('space/index.html');
  });
});

describe('HTML folder — a Confluence-shaped export', () => {
  const files = [
    {
      relativePath: 'space/index.html',
      content: '<html><head><title>Team wiki : Home</title></head><body><h1>Home</h1><p>Start at <a href="pages/12345.html">Onboarding</a>.</p></body></html>',
    },
    {
      relativePath: 'space/pages/12345.html',
      content:
        '<html><body><h1>Onboarding</h1><p>Read the <a href="../index.html">home page</a> and <a href="https://example.com">the web</a>.</p><img src="../attachments/logo.png"></body></html>',
    },
    { relativePath: 'space/attachments/logo.png', content: undefined, isText: false, sourcePath: '/tmp/logo.png' },
  ];

  const readSourceBytes = async () => new Uint8Array([9, 9]);

  it('writes the pages as notes and repoints the links between them', async () => {
    const vault = fakeVault();
    const report = await new HtmlFolderImporter().run(files as any, opts(vault));

    const home = vault.files.get('Import/space/Home.md') ?? '';
    // The link resolves through the file it points at, not by guessing a title.
    expect(home).toContain('[[Onboarding]]');

    const page = vault.files.get('Import/space/pages/Onboarding.md') ?? '';
    // The link text differs from the target's title, so it is kept as an alias.
    expect(page).toContain('[[Home|home page]]');
    // A link out of the selection is a link, and stays one.
    expect(page).toContain('(https://example.com)');
    // The heading is the note's title and must not appear twice.
    expect(page.match(/# Onboarding/g)?.length).toBe(1);

    expect(report.importedNotesCount).toBe(2);
  });

  it('carries the attachment at its old place so the image link still resolves', async () => {
    const vault = fakeVault();
    await new HtmlFolderImporter().run(files as any, { ...opts(vault), readSourceBytes });

    expect(vault.binaries.get('Import/space/attachments/logo.png')).toEqual(new Uint8Array([9, 9]));
    expect(vault.files.get('Import/space/pages/Onboarding.md')).toContain('../attachments/logo.png');
  });

  it('says when a table lost its structure instead of letting the reader find out', async () => {
    const vault = fakeVault();
    const report = await new HtmlFolderImporter().run(
      [
        {
          relativePath: 'p.html',
          content: '<h1>Numbers</h1><table><tr><td>Q1</td><td>12</td></tr></table>',
        },
      ] as any,
      opts(vault)
    );

    expect(report.summaryMarkdown).toContain(DEFAULT_IMPORT_LABELS.degradedHtmlStructure);
    expect(report.degradedCount).toBe(1);
  });

  it('never claims a selection on its own', async () => {
    // Half a dozen tools export "HTML in a folder"; claiming one of those
    // exports would be worse than letting the user pick the tile.
    expect(await new HtmlFolderImporter().detect()).toBe(false);
  });

  it('keeps two pages of the same name apart', async () => {
    const vault = fakeVault();
    await new HtmlFolderImporter().run(
      [
        { relativePath: 'a.html', content: '<h1>Notes</h1><p>one</p>' },
        { relativePath: 'b.html', content: '<h1>Notes</h1><p>two</p>' },
      ] as any,
      opts(vault)
    );

    expect(vault.files.get('Import/Notes.md')).toContain('one');
    expect(vault.files.get('Import/Notes (2).md')).toContain('two');
  });
});
