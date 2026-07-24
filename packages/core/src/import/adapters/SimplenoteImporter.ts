import { ImportFamily, ImportOptions, ImportPlan, ImportReport, ImportSource, ImportSourceId } from '../ImportTypes.js';

export interface SimplenoteExportNote {
  id: string;
  content: string;
  tags?: string[];
  deleted?: boolean;
  creationDate?: string;
  lastModified?: string;
}

export interface SimplenoteExportPayload {
  activeNotes?: SimplenoteExportNote[];
  trashedNotes?: SimplenoteExportNote[];
}

export class SimplenoteImporter implements ImportSource {
  readonly id: ImportSourceId = 'simplenote';
  readonly name = 'Simplenote JSON';
  readonly family: ImportFamily = 'json';
  readonly description = 'Importiert Notizen und Tags aus dem Simplenote JSON-Export.';

  async detect(input: any): Promise<boolean> {
    if (typeof input === 'object' && input !== null) {
      return Array.isArray(input.activeNotes) || Array.isArray(input.trashedNotes);
    }
    return false;
  }

  async analyze(input: SimplenoteExportPayload, _opts: ImportOptions): Promise<ImportPlan> {
    const active = Array.isArray(input.activeNotes) ? input.activeNotes : [];
    const totalBytes = active.reduce((acc, n) => acc + (n.content ? n.content.length : 0), 0);

    return {
      sourceId: this.id,
      sourceName: this.name,
      totalNotes: active.length,
      totalAttachments: 0,
      totalDatabases: 0,
      totalChecklists: 0,
      warnings: [],
      requiredSpaceBytes: totalBytes,
      estimatedDurationSec: Math.max(1, Math.ceil(active.length / 50)),
    };
  }

  async run(
    input: SimplenoteExportPayload,
    opts: ImportOptions,
    onProgress?: (percent: number, statusMessage: string) => void
  ): Promise<ImportReport> {
    const startTime = Date.now();
    const active = Array.isArray(input.activeNotes) ? input.activeNotes : [];
    const items: ImportReport['items'] = [];
    let importedNotes = 0;

    const prefix = opts.targetSubfolder ? `${opts.targetSubfolder}/` : '';

    for (let i = 0; i < active.length; i++) {
      const note = active[i];
      const lines = (note.content || '').split('\n');
      const rawTitle = lines[0] ? lines[0].replace(/^[#\s]+/, '').trim() : `Notiz_${note.id}`;
      const safeTitle = (rawTitle || 'Unbenannte Notiz').replace(/[/\\?%*:|"<>]/g, '_').slice(0, 100);
      const targetPath = `${prefix}${safeTitle}.md`;

      importedNotes++;
      items.push({
        path: targetPath,
        status: 'imported',
      });

      if (onProgress && active.length > 0) {
        onProgress(Math.round(((i + 1) / active.length) * 100), `Importiere ${safeTitle}...`);
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
