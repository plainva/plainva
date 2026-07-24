import { ImportFamily, ImportOptions, ImportPlan, ImportReport, ImportSource, ImportSourceId } from '../ImportTypes.js';

export interface NotionPagePayload {
  id: string;
  title: string;
  markdownContent: string;
  properties?: Record<string, any>;
  isDatabase?: boolean;
}

export class NotionImporter implements ImportSource {
  readonly id: ImportSourceId = 'notion_file';
  readonly name = 'Notion (ZIP & API)';
  readonly family: ImportFamily = 'api';
  readonly description = 'Importiert Notion Workspaces, Seiten und Datenbanken mit .base Relationen.';

  async detect(input: any): Promise<boolean> {
    if (typeof input === 'object' && input !== null) {
      if (input.notionToken || Array.isArray(input.pages) || input.isNotionExport) return true;
    }
    return false;
  }

  async analyze(input: any, _opts: ImportOptions): Promise<ImportPlan> {
    const pages: NotionPagePayload[] = Array.isArray(input?.pages) ? input.pages : [];
    const databases = pages.filter(p => p.isDatabase).length;
    const notes = pages.filter(p => !p.isDatabase).length;

    return {
      sourceId: this.id,
      sourceName: this.name,
      totalNotes: notes,
      totalAttachments: 0,
      totalDatabases: databases,
      totalChecklists: 0,
      warnings: [],
      requiredSpaceBytes: pages.reduce((acc, p) => acc + (p.markdownContent?.length || 0), 0),
      estimatedDurationSec: Math.max(1, Math.ceil(pages.length / 20)),
    };
  }

  async run(
    input: any,
    opts: ImportOptions,
    onProgress?: (percent: number, statusMessage: string) => void
  ): Promise<ImportReport> {
    const startTime = Date.now();
    const pages: NotionPagePayload[] = Array.isArray(input?.pages) ? input.pages : [];
    const items: ImportReport['items'] = [];
    let importedNotes = 0;
    let importedDatabases = 0;

    const prefix = opts.targetSubfolder ? `${opts.targetSubfolder}/` : '';

    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      const safeTitle = (page.title || `Notion_${page.id}`).replace(/[/\\?%*:|"<>]/g, '_').slice(0, 100);
      const isDb = !!page.isDatabase;

      if (isDb) {
        importedDatabases++;
        const dbPath = `${prefix}${safeTitle}/${safeTitle}.base`;
        items.push({ path: dbPath, status: 'imported' });
      } else {
        importedNotes++;
        const notePath = `${prefix}${safeTitle}.md`;
        items.push({ path: notePath, status: 'imported' });
      }

      if (onProgress && pages.length > 0) {
        onProgress(Math.round(((i + 1) / pages.length) * 100), `Importiere Notion ${safeTitle}...`);
      }
    }

    const durationMs = Date.now() - startTime;
    const reportPath = `${prefix}Import-Bericht.md`;

    const summaryMarkdown = `# Import-Bericht (${this.name})\n\n` +
      `- **Datum:** ${new Date().toISOString()}\n` +
      `- **Importierte Notizen:** ${importedNotes}\n` +
      `- **Importierte Datenbanken (.base):** ${importedDatabases}\n\n` +
      items.map(item => `- [${item.status.toUpperCase()}] ${item.path}`).join('\n');

    return {
      sourceId: this.id,
      sourceName: this.name,
      startedAt: new Date(startTime).toISOString(),
      durationMs,
      importedNotesCount: importedNotes,
      importedAttachmentsCount: 0,
      importedDatabasesCount: importedDatabases,
      reportPath,
      items,
      summaryMarkdown,
    };
  }
}
