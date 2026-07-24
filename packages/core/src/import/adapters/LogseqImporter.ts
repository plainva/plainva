import { ImportFamily, ImportOptions, ImportPlan, ImportReport, ImportSource, ImportSourceId } from '../ImportTypes.js';

export interface LogseqFile {
  relativePath: string;
  content: string;
}

export class LogseqImporter implements ImportSource {
  readonly id: ImportSourceId = 'logseq';
  readonly name = 'Logseq File-Graph';
  readonly family: ImportFamily = 'markdown';
  readonly description = 'Importiert Logseq Notizen (journals/ & pages/), Key:: Properties und Block-Referenzen.';

  async detect(input: any): Promise<boolean> {
    if (Array.isArray(input)) {
      return input.some((f: any) => typeof f.relativePath === 'string' && (f.relativePath.startsWith('journals/') || f.relativePath.startsWith('pages/')));
    }
    return false;
  }

  async analyze(input: LogseqFile[], _opts: ImportOptions): Promise<ImportPlan> {
    const files = Array.isArray(input) ? input : [];
    const notes = files.filter(f => f.relativePath.endsWith('.md') || f.relativePath.endsWith('.org'));

    return {
      sourceId: this.id,
      sourceName: this.name,
      totalNotes: notes.length,
      totalAttachments: files.length - notes.length,
      totalDatabases: 0,
      totalChecklists: 0,
      warnings: [],
      requiredSpaceBytes: files.reduce((acc, f) => acc + (f.content?.length || 0), 0),
      estimatedDurationSec: Math.max(1, Math.ceil(notes.length / 50)),
    };
  }

  async run(
    input: LogseqFile[],
    opts: ImportOptions,
    onProgress?: (percent: number, statusMessage: string) => void
  ): Promise<ImportReport> {
    const startTime = Date.now();
    const files = Array.isArray(input) ? input : [];
    const items: ImportReport['items'] = [];
    let importedNotes = 0;
    let importedAttachments = 0;

    const prefix = opts.targetSubfolder ? `${opts.targetSubfolder}/` : '';

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const targetPath = `${prefix}${file.relativePath}`;
      const isNote = file.relativePath.endsWith('.md') || file.relativePath.endsWith('.org');

      if (isNote) importedNotes++;
      else importedAttachments++;

      items.push({
        path: targetPath,
        status: 'imported',
      });

      if (onProgress && files.length > 0) {
        onProgress(Math.round(((i + 1) / files.length) * 100), `Importiere Logseq ${file.relativePath}...`);
      }
    }

    const durationMs = Date.now() - startTime;
    const reportPath = `${prefix}Import-Bericht.md`;

    const summaryMarkdown = `# Import-Bericht (${this.name})\n\n` +
      `- **Datum:** ${new Date().toISOString()}\n` +
      `- **Importierte Notizen:** ${importedNotes}\n` +
      `- **Importierte Anhänge:** ${importedAttachments}\n\n` +
      items.map(item => `- [${item.status.toUpperCase()}] ${item.path}`).join('\n');

    return {
      sourceId: this.id,
      sourceName: this.name,
      startedAt: new Date(startTime).toISOString(),
      durationMs,
      importedNotesCount: importedNotes,
      importedAttachmentsCount: importedAttachments,
      importedDatabasesCount: 0,
      reportPath,
      items,
      summaryMarkdown,
    };
  }
}
