import { describe, expect, it } from 'vitest';
import {
  BackupVaultAdapter,
  ConflictAwareVaultAdapter,
  EvernoteEnexImporter,
  GoogleKeepImporter,
  NotionFileImporter,
  QueueingVaultAdapter,
  normalizePath,
  relativeFrom,
  resolveFrom,
  rewriteNotionLinks,
} from '../../src/index.js';

/**
 * The source-specific findings of P1.3: each one is a way an import quietly
 * produced something wrong rather than failing, so each gets a test that fails
 * loudly if the behaviour comes back.
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

const opts = (vaultAdapter: unknown) => ({
  targetVaultPath: '/v',
  targetSubfolder: 'Imported',
  vaultAdapter,
});

describe('B1 — a Notion file export keeps its internal links', () => {
  it('resolves and re-points a relative link between two exported pages', () => {
    const map = new Map([
      ['Parent abc/Child def.md', 'Parent/Child.md'],
      ['Parent abc/Notes ghi.md', 'Parent/Notes.md'],
    ]);

    const result = rewriteNotionLinks(
      'See [Notes](Notes%20ghi.md) for details.',
      'Parent abc/Child def.md',
      'Parent/Child.md',
      map
    );

    expect(result.content).toBe('See [Notes](Notes.md) for details.');
    expect(result.rewritten).toBe(1);
  });

  it('walks up out of a subfolder when the target lives elsewhere', () => {
    const map = new Map([
      ['Root abc/Sub def/Deep ghi.md', 'Root/Sub/Deep.md'],
      ['Root abc/Top jkl.md', 'Root/Top.md'],
    ]);

    const result = rewriteNotionLinks(
      '[Top](../Top%20jkl.md)',
      'Root abc/Sub def/Deep ghi.md',
      'Root/Sub/Deep.md',
      map
    );

    expect(result.content).toBe('[Top](../Top.md)');
  });

  it('leaves external links, anchors and unknown targets alone', () => {
    const map = new Map([['A abc.md', 'A.md']]);
    const source = [
      '[web](https://example.com/a%20b)',
      '[jump](#section)',
      '[image](Page%20abc/photo.png)',
      '[mail](mailto:a@b.c)',
    ].join('\n');

    const result = rewriteNotionLinks(source, 'A abc.md', 'A.md', map);

    expect(result.content).toBe(source);
    expect(result.rewritten).toBe(0);
    // The image is an internal target that no imported note answers to.
    expect(result.unresolved).toBe(1);
  });

  it('keeps an anchor on a rewritten link', () => {
    const map = new Map([['B def.md', 'B.md']]);
    const result = rewriteNotionLinks('[B](B%20def.md#part-2)', 'A abc.md', 'A.md', map);
    expect(result.content).toBe('[B](B.md#part-2)');
  });

  it('normalizes and relativizes paths without touching disk', () => {
    expect(normalizePath('a//b/./c')).toBe('a/b/c');
    expect(resolveFrom('a/b', '../c/d.md')).toBe('a/c/d.md');
    expect(relativeFrom('a/b', 'a/c/d.md')).toBe('../c/d.md');
    expect(relativeFrom('', 'a/b.md')).toBe('a/b.md');
  });

  it('scopes a generated database filter to the import subfolder', async () => {
    const vaultAdapter = fakeVault();
    await new NotionFileImporter().run(
      [{ relativePath: 'Tasks abcdef01234567890123456789012345.csv', content: 'a,b' }],
      opts(vaultAdapter)
    );

    // `file.folder` is vault-relative: without the prefix the database could
    // never see its own rows after an import into a subfolder.
    const base = JSON.parse(vaultAdapter.files.get('Imported/Tasks.base')!);
    expect(base.filters.and).toEqual(['file.folder == "Imported/Tasks"']);
  });

  it('rewrites through the importer, end to end', async () => {
    const vaultAdapter = fakeVault();
    await new NotionFileImporter().run(
      [
        { relativePath: 'Parent abcdef01234567890123456789012345.md', content: '# Parent\n\n[Child](Parent%20abcdef01234567890123456789012345/Child%20fedcba09876543210987654321098765.md)' },
        { relativePath: 'Parent abcdef01234567890123456789012345/Child fedcba09876543210987654321098765.md', content: '# Child' },
      ],
      opts(vaultAdapter)
    );

    const parent = vaultAdapter.files.get('Imported/Parent.md')!;
    expect(parent).toContain('[Child](Parent/Child.md)');
    // The hex IDs must be gone from the body, not only from the file name.
    expect(parent).not.toMatch(/[a-f0-9]{32}/);
    expect(vaultAdapter.files.has('Imported/Parent/Child.md')).toBe(true);
  });
});

describe('B5 — Google Keep does not hand back the trash', () => {
  it('skips a trashed note and names it in the report', async () => {
    const vaultAdapter = fakeVault();
    const report = await new GoogleKeepImporter().run(
      [
        { title: 'Keep me', textContent: 'yes' },
        { title: 'Deleted', textContent: 'no', isTrashed: true },
      ],
      opts(vaultAdapter)
    );

    expect(vaultAdapter.files.has('Imported/Keep me.md')).toBe(true);
    expect(vaultAdapter.files.has('Imported/Deleted.md')).toBe(false);
    expect(report.importedNotesCount).toBe(1);
    // A skipped note has no vault path — it is named the way the source did.
    expect(report.items.find((i) => i.path === 'Deleted.md')?.status).toBe('skipped');
  });

  it('brings the trash across when the run asks for it', async () => {
    const vaultAdapter = fakeVault();
    await new GoogleKeepImporter().run([{ title: 'Deleted', textContent: 'no', isTrashed: true }], {
      ...opts(vaultAdapter),
      includeTrashed: true,
    });

    expect(vaultAdapter.files.has('Imported/Deleted.md')).toBe(true);
  });

  it('counts only importable notes in the preview', async () => {
    const plan = await new GoogleKeepImporter().analyze(
      [
        { title: 'A', textContent: 'a' },
        { title: 'B', textContent: 'b', isTrashed: true },
      ],
      { targetVaultPath: '/v' }
    );

    expect(plan.totalNotes).toBe(1);
    expect(plan.warnings.some((w) => w.includes('trash'))).toBe(true);
  });
});

describe('B7 — Evernote checklists survive in both syntaxes', () => {
  const run = async (contentXml: string) => {
    const vaultAdapter = fakeVault();
    await new EvernoteEnexImporter().run([{ title: 'List', contentXml }], opts(vaultAdapter));
    return vaultAdapter.files.get('Imported/List.md')!;
  };

  it('keeps an unchecked classic en-todo, which used to vanish', async () => {
    const note = await run('<en-todo checked="false"/>Open task<br/><en-todo checked="true"/>Done task');
    expect(note).toContain('- [ ] Open task');
    expect(note).toContain('- [x] Done task');
  });

  it('reads the bare marker as open', async () => {
    expect(await run('<en-todo/>Bare')).toContain('- [ ] Bare');
  });

  it('reads the Evernote 10 list form', async () => {
    const note = await run(
      '<ul style="--en-todo:true;"><li style="--en-checked:true;"><div>First</div></li>' +
        '<li style="--en-checked:false;"><div>Second</div></li></ul>'
    );
    expect(note).toContain('- [x] First');
    expect(note).toContain('- [ ] Second');
  });

  it('counts checklist notes in the preview', async () => {
    const plan = await new EvernoteEnexImporter().analyze(
      [
        { title: 'A', contentXml: '<en-todo/>x' },
        { title: 'B', contentXml: '<ul style="--en-todo:true;"><li style="--en-checked:false;">y</li></ul>' },
        { title: 'C', contentXml: 'plain text' },
      ],
      { targetVaultPath: '/v' }
    );
    expect(plan.totalChecklists).toBe(2);
  });
});

describe('B6 — a renamed note keeps its relation links pointing at itself', () => {
  it('gives two same-named notes their own name, in reservation order', async () => {
    const { ImportWriter } = await import('../../src/import/ImportWriter.js');
    const { DEFAULT_IMPORT_LABELS } = await import('../../src/import/ImportTypes.js');
    const vaultAdapter = fakeVault();
    const writer = new ImportWriter(opts(vaultAdapter) as any, DEFAULT_IMPORT_LABELS);

    // Two Notion pages both called "Meeting": each has to learn the name it
    // will actually get, or its relation link points at the other one.
    const first = await writer.reserve('Meeting.md');
    const second = await writer.reserve('Meeting.md');
    expect(first).toBe('Imported/Meeting.md');
    expect(second).toBe('Imported/Meeting (2).md');

    // The writes consume those reservations instead of numbering again.
    expect(await writer.writeNote('Meeting.md', '# Meeting')).toBe('Imported/Meeting.md');
    expect(await writer.writeNote('Meeting.md', '# Meeting')).toBe('Imported/Meeting (2).md');
  });

  it('numbers around a note that already exists in the vault', async () => {
    const { ImportWriter } = await import('../../src/import/ImportWriter.js');
    const { DEFAULT_IMPORT_LABELS } = await import('../../src/import/ImportTypes.js');
    const vaultAdapter = fakeVault();
    vaultAdapter.files.set('Imported/Meeting.md', 'the user wrote this');
    const writer = new ImportWriter(opts(vaultAdapter) as any, DEFAULT_IMPORT_LABELS);

    expect(await writer.reserve('Meeting.md')).toBe('Imported/Meeting (2).md');
    expect(vaultAdapter.files.get('Imported/Meeting.md')).toBe('the user wrote this');
  });
});

describe('BS2 — an import into an encrypted workspace goes through the workspace queue', () => {
  /**
   * Import and encrypted workspaces shipped in the same version and had never
   * been exercised together. The vault on disk is plain Markdown by design —
   * what matters is that every imported note is ENQUEUED as a workspace
   * mutation, because that is what gets sealed before it leaves the device. An
   * import that wrote past the queue would put plaintext in the cloud.
   */
  it('enqueues every note the import writes', async () => {
    const { WorkspaceQueueingVaultAdapter } = await import('../../src/workspace/queueingVaultAdapter.js');
    const files = new Map<string, string>();
    const enqueued: Array<{ kind: string; path: string }> = [];
    const raw: any = {
      async exists(path: string) {
        return files.has(path);
      },
      async writeTextFile(path: string, content: string) {
        files.set(path, content);
      },
      async createDir() {
        /* implicit */
      },
      async getFileInfo() {
        return { isDirectory: false, size: 0, mtime: 0, path: '' };
      },
    };
    const state: any = {
      async enqueue(kind: string, path: string) {
        enqueued.push({ kind, path });
      },
      async getObjectByPath() {
        return null;
      },
    };
    const adapter: any = new WorkspaceQueueingVaultAdapter(raw, state);
    // The adapter calls createFolder on the writer's behalf via createDir.
    adapter.createFolder = (path: string) => adapter.createDir(path);

    await new GoogleKeepImporter().run([{ title: 'Secret', textContent: 'confidential' }], opts(adapter));

    expect(files.get('Imported/Secret.md')).toContain('confidential');
    const writes = enqueued.filter((e) => e.kind === 'write').map((e) => e.path);
    expect(writes).toContain('Imported/Secret.md');
    // The report is a vault file too and must not slip past the queue either.
    expect(writes.some((p) => p.startsWith('Imported/Import report'))).toBe(true);
  });
});

describe('the wrappers the app actually hands out forward setFileTimes', () => {
  /**
   * The writer stamps file dates through `adapter.setFileTimes`, but the app
   * never passes the raw adapter — it passes a stack of wrappers. A wrapper
   * that does not forward the call turns the whole feature into a silent no-op
   * in the real app while every unit test keeps passing.
   */
  it('reaches the raw adapter through backup, queue and conflict wrappers', async () => {
    const stamped: Array<{ path: string; times: unknown }> = [];
    const raw: any = {
      async exists() {
        return false;
      },
      async writeTextFile() {
        /* not used here */
      },
      async createDir() {
        /* not used here */
      },
      async getFileInfo() {
        return { isDirectory: false, size: 0, mtime: 0 };
      },
      async setFileTimes(path: string, times: unknown) {
        stamped.push({ path, times });
      },
    };

    const chain: any = new ConflictAwareVaultAdapter(
      new QueueingVaultAdapter(new BackupVaultAdapter(raw, { policy: undefined as any }), {
        queueWrite: async () => {},
        queueDelete: async () => {},
        queueRename: async () => {},
        queueMkdir: async () => {},
      } as any),
      { getState: async () => null, upsert: async () => {} } as any
    );

    await chain.setFileTimes('Note.md', { modifiedMs: 1 });
    expect(stamped).toEqual([{ path: 'Note.md', times: { modifiedMs: 1 } }]);
  });
});
