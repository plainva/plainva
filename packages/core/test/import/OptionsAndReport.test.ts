import { describe, expect, it } from 'vitest';
import {
  DEFAULT_IMPORT_LABELS,
  GoogleKeepImporter,
  SimplenoteImporter,
  defaultImportRegistry,
  type ImportOptionKey,
} from '../../src/index.js';

/**
 * The wizard's source-dependent options, and what the report promises.
 *
 * Two properties matter here and neither is visible in a screenshot: an option
 * a source offers must actually change that source's behaviour, and the report
 * has to say how the whole import is undone — there is no undo command, the
 * folder IS the undo.
 */

function fakeVault() {
  const files = new Map<string, string>();
  return {
    files,
    async exists(path: string) {
      return files.has(path);
    },
    async writeTextFile(path: string, content: string) {
      files.set(path, content);
    },
    async createFolder() {
      /* implicit */
    },
  };
}

const keepNote = (title: string, isTrashed = false) => ({
  title,
  textContent: `Body of ${title}`,
  isTrashed,
  createdTimestampUsec: 1_700_000_000_000_000,
  userEditedTimestampUsec: 1_700_000_100_000_000,
});

const keepPayload = (notes: unknown[]) =>
  notes.map((note, i) => ({ relativePath: `Keep/note-${i}.json`, content: JSON.stringify(note) }));

describe('every offered option is one the importer reads', () => {
  it('declares only keys the engine understands', () => {
    const known: ImportOptionKey[] = ['preserveTimestamps', 'includeTrashed'];
    for (const source of defaultImportRegistry.list()) {
      for (const option of source.options ?? []) {
        expect(known).toContain(option.key);
      }
    }
  });

  it('offers the trash switch exactly where a trash exists', () => {
    const offers = (id: string) =>
      (defaultImportRegistry.get(id as never)?.options ?? []).some((o) => o.key === 'includeTrashed');
    // Keep and Simplenote ship their deleted notes inside the export.
    expect(offers('google_keep')).toBe(true);
    expect(offers('simplenote')).toBe(true);
    // An ENEX has no trash of its own — a switch there would do nothing.
    expect(offers('evernote')).toBe(false);
    expect(offers('generic_markdown')).toBe(false);
  });

  it('lets every source keep the source dates, on by default', () => {
    for (const source of defaultImportRegistry.list()) {
      const dates = (source.options ?? []).find((o) => o.key === 'preserveTimestamps');
      expect(dates, `${source.id} should offer the date switch`).toBeDefined();
      expect(dates?.defaultValue).toBe(true);
    }
  });
});

describe('the trash switch changes what lands in the vault', () => {
  it('skips Keep trash by default and imports it when asked', async () => {
    const importer = new GoogleKeepImporter();
    const input = keepPayload([keepNote('Kept'), keepNote('Deleted', true)]);

    const off = fakeVault();
    const defaultReport = await importer.run(input, { targetVaultPath: '/v', vaultAdapter: off });
    expect(defaultReport.importedNotesCount).toBe(1);
    expect([...off.files.keys()].some((p) => p.includes('Deleted'))).toBe(false);

    const on = fakeVault();
    const withTrash = await importer.run(input, {
      targetVaultPath: '/v',
      vaultAdapter: on,
      includeTrashed: true,
    });
    expect(withTrash.importedNotesCount).toBe(2);
    expect([...on.files.keys()].some((p) => p.includes('Deleted'))).toBe(true);
  });

  it('does the same for Simplenote, which only ever counted its trash', async () => {
    const importer = new SimplenoteImporter();
    const input = {
      activeNotes: [{ id: 'a', content: 'Active note' }],
      trashedNotes: [{ id: 'b', content: 'Trashed note' }],
    };

    const off = fakeVault();
    const plan = await importer.analyze(input, { targetVaultPath: '/v' });
    expect(plan.totalNotes).toBe(1);
    const skipped = await importer.run(input, { targetVaultPath: '/v', vaultAdapter: off });
    expect(skipped.importedNotesCount).toBe(1);

    const on = fakeVault();
    const planWithTrash = await importer.analyze(input, {
      targetVaultPath: '/v',
      includeTrashed: true,
    });
    expect(planWithTrash.totalNotes).toBe(2);
    // The preview promised two, so the run has to deliver two.
    const imported = await importer.run(input, {
      targetVaultPath: '/v',
      vaultAdapter: on,
      includeTrashed: true,
    });
    expect(imported.importedNotesCount).toBe(2);
    expect([...on.files.keys()].some((p) => p.includes('Trashed'))).toBe(true);
  });

  it('stops warning about the trash once it is being imported', async () => {
    const importer = new GoogleKeepImporter();
    const input = keepPayload([keepNote('Kept'), keepNote('Deleted', true)]);
    const warned = await importer.analyze(input, { targetVaultPath: '/v' });
    expect(warned.warnings.some((w) => w.includes(DEFAULT_IMPORT_LABELS.limitKeepTrashed))).toBe(true);
    const silent = await importer.analyze(input, { targetVaultPath: '/v', includeTrashed: true });
    expect(silent.warnings.some((w) => w.includes(DEFAULT_IMPORT_LABELS.limitKeepTrashed))).toBe(false);
  });
});

describe('the report says how to undo the import', () => {
  it('names the subfolder to delete', async () => {
    const vault = fakeVault();
    await new GoogleKeepImporter().run(keepPayload([keepNote('One')]), {
      targetVaultPath: '/v',
      targetSubfolder: 'Imported Keep',
      vaultAdapter: vault,
    });
    const report = vault.files.get('Imported Keep/Import report.md') ?? '';
    expect(report).toContain(DEFAULT_IMPORT_LABELS.reportUndoHeading);
    expect(report).toContain('`Imported Keep`');
  });

  it('points at the vault folder when the import made its own vault', async () => {
    const vault = fakeVault();
    await new GoogleKeepImporter().run(keepPayload([keepNote('One')]), {
      targetVaultPath: '/fresh',
      vaultAdapter: vault,
    });
    const report = vault.files.get('Import report.md') ?? '';
    expect(report).toContain(DEFAULT_IMPORT_LABELS.reportUndoVault);
  });

  it('is a regular note, and stays out of the task view', async () => {
    const vault = fakeVault();
    await new GoogleKeepImporter().run(keepPayload([keepNote('One')]), {
      targetVaultPath: '/v',
      vaultAdapter: vault,
    });
    const report = vault.files.get('Import report.md') ?? '';
    // Without frontmatter this would be the one file a freshly imported vault's
    // OKF check complains about.
    expect(report.startsWith('---\n')).toBe(true);
    expect(report).toContain('type:');
    expect(report).not.toContain('okf_version');
    expect(report).toMatch(/plainva:\s*\n\s+tasks: false/);
    // The summary itself still starts at the heading.
    expect(report).toContain(`# ${DEFAULT_IMPORT_LABELS.reportTitle}`);
  });
});
