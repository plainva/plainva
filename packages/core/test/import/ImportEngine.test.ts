import { describe, expect, it } from 'vitest';
import {
  defaultImportRegistry,
  GenericMarkdownImporter,
  GoogleKeepImporter,
  EvernoteEnexImporter,
  NotionImporter,
} from '../../src/import/index.js';

describe('PKM Import Engine', () => {
  it('registers and lists all core importers', () => {
    const list = defaultImportRegistry.list();
    expect(list.length).toBeGreaterThanOrEqual(6);
    const ids = list.map(i => i.id);
    expect(ids).toContain('generic_markdown');
    expect(ids).toContain('simplenote');
    expect(ids).toContain('google_keep');
    expect(ids).toContain('evernote');
    expect(ids).toContain('logseq');
    expect(ids).toContain('notion_file');
  });

  it('detects Simplenote JSON payload correctly', async () => {
    const simplenotePayload = {
      activeNotes: [{ id: '1', content: 'Test Note' }],
    };
    const detected = await defaultImportRegistry.detect(simplenotePayload);
    expect(detected).toBeDefined();
    expect(detected?.id).toBe('simplenote');
  });

  it('runs GenericMarkdownImporter and generates a valid report', async () => {
    const importer = new GenericMarkdownImporter();
    const input = [
      { relativePath: 'NoteA.md', content: '# Note A' },
      { relativePath: 'Images/Logo.png', content: 'binary' },
    ];
    const plan = await importer.analyze(input, { targetVaultPath: '/tmp/vault' });
    expect(plan.totalNotes).toBe(1);
    expect(plan.totalAttachments).toBe(1);

    const report = await importer.run(input, { targetVaultPath: '/tmp/vault', targetSubfolder: 'Imported' });
    expect(report.importedNotesCount).toBe(1);
    expect(report.importedAttachmentsCount).toBe(1);
    expect(report.summaryMarkdown).toContain('# Import-Bericht');
  });

  it('runs GoogleKeepImporter and parses notes', async () => {
    const importer = new GoogleKeepImporter();
    const keepNotes = [
      { title: 'Shopping', listContent: [{ text: 'Milk', isChecked: false }] },
      { title: 'Idea', textContent: 'Brainstorm' },
    ];
    const plan = await importer.analyze(keepNotes, { targetVaultPath: '/tmp/vault' });
    expect(plan.totalNotes).toBe(2);
    expect(plan.totalChecklists).toBe(1);

    const report = await importer.run(keepNotes, { targetVaultPath: '/tmp/vault' });
    expect(report.importedNotesCount).toBe(2);
  });

  it('runs EvernoteEnexImporter with XML structures', async () => {
    const importer = new EvernoteEnexImporter();
    const enexNotes = [
      { title: 'Evernote Meeting', contentXml: '<en-note>Discussion</en-note>' },
    ];
    const report = await importer.run(enexNotes, { targetVaultPath: '/tmp/vault' });
    expect(report.importedNotesCount).toBe(1);
  });

  it('runs NotionImporter with database pages', async () => {
    const importer = new NotionImporter();
    const notionPayload = {
      pages: [
        { id: '1', title: 'Projects', isDatabase: true, markdownContent: '' },
        { id: '2', title: 'Task 1', isDatabase: false, markdownContent: '# Task 1' },
      ],
    };
    const plan = await importer.analyze(notionPayload, { targetVaultPath: '/tmp/vault' });
    expect(plan.totalDatabases).toBe(1);
    expect(plan.totalNotes).toBe(1);

    const report = await importer.run(notionPayload, { targetVaultPath: '/tmp/vault' });
    expect(report.importedDatabasesCount).toBe(1);
    expect(report.importedNotesCount).toBe(1);
  });
});
