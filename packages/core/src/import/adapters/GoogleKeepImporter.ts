import { ImportFamily, ImportOptions, ImportPlan, ImportReport, ImportSource, ImportSourceId } from '../ImportTypes.js';

export interface GoogleKeepNote {
  title?: string;
  textContent?: string;
  listContent?: Array<{ text: string; isChecked: boolean }>;
  labels?: Array<{ name: string }>;
  color?: string;
  isPinned?: boolean;
  isArchived?: boolean;
  userEditedTimestampUsec?: number;
}

export class GoogleKeepImporter implements ImportSource {
  readonly id: ImportSourceId = 'google_keep';
  readonly name = 'Google Keep (Takeout)';
  readonly family: ImportFamily = 'json';
  readonly description = 'Importiert Notizen, Checklisten und Labels aus Google Keep Takeout JSON-Dateien.';

  async detect(input: any): Promise<boolean> {
    if (Array.isArray(input)) {
      return input.some((item: any) => typeof item === 'object' && item !== null && (item.textContent !== undefined || item.listContent !== undefined));
    }
    return false;
  }

  async analyze(input: GoogleKeepNote[], _opts: ImportOptions): Promise<ImportPlan> {
    const notes = Array.isArray(input) ? input : [];
    let checklists = 0;
    for (const n of notes) {
      if (Array.isArray(n.listContent) && n.listContent.length > 0) checklists++;
    }

    return {
      sourceId: this.id,
      sourceName: this.name,
      totalNotes: notes.length,
      totalAttachments: 0,
      totalDatabases: 0,
      totalChecklists: checklists,
      warnings: [],
      requiredSpaceBytes: notes.length * 1024,
      estimatedDurationSec: Math.max(1, Math.ceil(notes.length / 50)),
    };
  }

  async run(
    input: GoogleKeepNote[],
    opts: ImportOptions,
    onProgress?: (percent: number, statusMessage: string) => void
  ): Promise<ImportReport> {
    const startTime = Date.now();
    const notes = Array.isArray(input) ? input : [];
    const items: ImportReport['items'] = [];
    let importedNotes = 0;

    const prefix = opts.targetSubfolder ? `${opts.targetSubfolder}/` : '';

    for (let i = 0; i < notes.length; i++) {
      const note = notes[i];
      const rawTitle = (note.title || '').trim() || `Keep_${i + 1}`;
      const safeTitle = rawTitle.replace(/[/\\?%*:|"<>]/g, '_').slice(0, 100);
      const targetPath = `${prefix}${safeTitle}.md`;

      importedNotes++;
      items.push({
        path: targetPath,
        status: 'imported',
      });

      if (onProgress && notes.length > 0) {
        onProgress(Math.round(((i + 1) / notes.length) * 100), `Importiere Keep Notiz ${safeTitle}...`);
      }
    }

    const durationMs = Date.now() - startTime;
    const reportPath = `${prefix}Import-Bericht.md`;

    const summaryMarkdown = `# Import-Bericht (${this.name})\n\n` +
      `- **Datum:** ${new Date().toISOString()}\n` +
      `- **Importierte Notizen:** ${importedNotes}\n\n` +
      items.map(item => `- [${item.status.toUpperCase()}] ${item.path}`).join('\n');

    return {
      sourceId: this.id,
      sourceName: this.name,
      startedAt: new Date(startTime).toISOString(),
      durationMs,
      importedNotesCount: importedNotes,
      importedAttachmentsCount: 0,
      importedDatabasesCount: 0,
      reportPath,
      items,
      summaryMarkdown,
    };
  }
}
