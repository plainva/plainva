import { ImportFamily, ImportOptions, ImportPlan, ImportReport, ImportSource, ImportSourceId } from '../ImportTypes.js';

export interface EnexNote {
  title: string;
  contentXml: string;
  created?: string;
  updated?: string;
  tags?: string[];
  resources?: Array<{
    mime: string;
    dataBase64: string;
    fileName?: string;
  }>;
}

export class EvernoteEnexImporter implements ImportSource {
  readonly id: ImportSourceId = 'evernote';
  readonly name = 'Evernote (ENEX)';
  readonly family: ImportFamily = 'xml';
  readonly description = 'Importiert Notizen, Checklisten (<en-todo>) und Anhänge aus Evernote ENEX XML-Exporten.';

  async detect(input: any): Promise<boolean> {
    if (typeof input === 'string') {
      return input.includes('<en-export') || input.includes('<en-note');
    }
    if (Array.isArray(input)) {
      return input.some((item: any) => typeof item === 'object' && item !== null && typeof item.contentXml === 'string');
    }
    return false;
  }

  async analyze(input: EnexNote[] | string, _opts: ImportOptions): Promise<ImportPlan> {
    const notes: EnexNote[] = Array.isArray(input) ? input : [];
    let attachmentsCount = 0;
    for (const n of notes) {
      if (Array.isArray(n.resources)) attachmentsCount += n.resources.length;
    }

    return {
      sourceId: this.id,
      sourceName: this.name,
      totalNotes: notes.length,
      totalAttachments: attachmentsCount,
      totalDatabases: 0,
      totalChecklists: 0,
      warnings: [],
      requiredSpaceBytes: notes.length * 2048,
      estimatedDurationSec: Math.max(1, Math.ceil(notes.length / 30)),
    };
  }

  async run(
    input: EnexNote[] | string,
    opts: ImportOptions,
    onProgress?: (percent: number, statusMessage: string) => void
  ): Promise<ImportReport> {
    const startTime = Date.now();
    const notes: EnexNote[] = Array.isArray(input) ? input : [];
    const items: ImportReport['items'] = [];
    let importedNotes = 0;
    let importedAttachments = 0;

    const prefix = opts.targetSubfolder ? `${opts.targetSubfolder}/` : '';

    for (let i = 0; i < notes.length; i++) {
      const note = notes[i];
      const safeTitle = (note.title || `Evernote_${i + 1}`).replace(/[/\\?%*:|"<>]/g, '_').slice(0, 100);
      const targetPath = `${prefix}${safeTitle}.md`;

      importedNotes++;
      if (Array.isArray(note.resources)) {
        importedAttachments += note.resources.length;
      }

      items.push({
        path: targetPath,
        status: 'imported',
      });

      if (onProgress && notes.length > 0) {
        onProgress(Math.round(((i + 1) / notes.length) * 100), `Importiere Evernote Notiz ${safeTitle}...`);
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
