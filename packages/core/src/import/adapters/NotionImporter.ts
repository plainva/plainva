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
  readonly name = 'Notion (ZIP & Export)';
  readonly family: ImportFamily = 'markdown';
  readonly description = 'Importiert Notion Workspaces, Seiten, HTML/Markdown-Exporte und Datenbanken mit .base Relationen.';

  private parsePages(input: any): NotionPagePayload[] {
    if (Array.isArray(input?.pages)) return input.pages;
    if (!Array.isArray(input)) return [];

    const pages: NotionPagePayload[] = [];
    for (let i = 0; i < input.length; i++) {
      const item = input[i];
      if (typeof item === 'object' && item !== null) {
        if (item.title && item.markdownContent !== undefined) {
          pages.push(item as NotionPagePayload);
        } else if (typeof item.relativePath === 'string' && (item.relativePath.endsWith('.md') || item.relativePath.endsWith('.html') || item.relativePath.endsWith('.csv'))) {
          const rawName = item.relativePath.split(/[/\\]/).pop() || `Page_${i + 1}`;
          const title = rawName.replace(/\.(md|html|csv)$/i, '').replace(/ [a-f0-9]{32}$/i, '');
          const isDb = item.relativePath.endsWith('.csv');
          pages.push({
            id: `notion_${i + 1}`,
            title,
            markdownContent: item.content || `# ${title}`,
            isDatabase: isDb,
          });
        }
      }
    }
    return pages;
  }

  async detect(input: any): Promise<boolean> {
    const pages = this.parsePages(input);
    return pages.length > 0;
  }

  async analyze(input: any, _opts: ImportOptions): Promise<ImportPlan> {
    const pages = this.parsePages(input);
    const databases = pages.filter(p => p.isDatabase).length;
    const notes = pages.filter(p => !p.isDatabase).length;

    return {
      sourceId: this.id,
      sourceName: this.name,
      totalNotes: notes,
      totalAttachments: 0,
      totalDatabases: databases,
      totalChecklists: 0,
      warnings: pages.length === 0 ? ['Keine Notion-Seiten oder Datenbanken in der Auswahl gefunden.'] : [],
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
    const pages = this.parsePages(input);
    const items: ImportReport['items'] = [];
    let importedNotes = 0;
    let importedDatabases = 0;

    const prefix = opts.targetSubfolder ? `${opts.targetSubfolder}/` : '';

    if (opts.vaultAdapter && prefix) {
      try {
        await opts.vaultAdapter.createFolder(prefix.replace(/\/$/, ''));
      } catch {
        // Folder already exists
      }
    }

    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      const safeTitle = (page.title || `Notion_${page.id}`).replace(/[/\\?%*:|"<>]/g, '_').slice(0, 100);
      const isDb = !!page.isDatabase;

      if (isDb) {
        importedDatabases++;
        const dbFolderPath = `${prefix}${safeTitle}`;
        const dbPath = `${dbFolderPath}/${safeTitle}.base`;

        if (opts.vaultAdapter) {
          try { await opts.vaultAdapter.createFolder(dbFolderPath); } catch {}
          try { await opts.vaultAdapter.createFolder(dbPath); } catch {}
          await opts.vaultAdapter.writeTextFile(`${dbPath}/schema.json`, JSON.stringify({ name: safeTitle, properties: [] }, null, 2));
        }

        items.push({ path: dbPath, status: 'imported' });
      } else {
        importedNotes++;
        const notePath = `${prefix}${safeTitle}.md`;
        const content = page.markdownContent.startsWith('#') ? page.markdownContent : `# ${safeTitle}\n\n${page.markdownContent}`;

        if (opts.vaultAdapter) {
          await opts.vaultAdapter.writeTextFile(notePath, content);
        }

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

    if (opts.vaultAdapter) {
      await opts.vaultAdapter.writeTextFile(reportPath, summaryMarkdown);
    }

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
