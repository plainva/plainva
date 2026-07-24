import { ImportFamily, ImportOptions, ImportPlan, ImportReport, ImportSource, ImportSourceId } from '../ImportTypes.js';

export interface NotionPagePayload {
  id: string;
  title: string;
  markdownContent: string;
  properties?: Record<string, any>;
  isDatabase?: boolean;
}

export class NotionFileImporter implements ImportSource {
  readonly id: ImportSourceId = 'notion_file';
  readonly name = 'Notion (ZIP & Export)';
  readonly family: ImportFamily = 'markdown';
  readonly description = 'Importiert Notion Workspaces, Seiten und Datenbanken aus ZIP-Archiven oder Export-Ordnern.';

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
      warnings: pages.length === 0 ? ['Keine Notion-Seiten oder CSV-Datenbanken in der Auswahl gefunden.'] : [],
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
        // Folder exists
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

export class NotionApiImporter implements ImportSource {
  readonly id: ImportSourceId = 'notion_api';
  readonly name = 'Notion (API Sync / Integration Token)';
  readonly family: ImportFamily = 'api';
  readonly description = 'Synchronisiert Notion Notizen und Datenbanken direkt per Integration Token.';

  private extractToken(input: any): string {
    if (Array.isArray(input) && input[0]?.notionToken) return input[0].notionToken;
    if (typeof input === 'object' && input !== null && input.notionToken) return input.notionToken;
    return '';
  }

  private async fetchNotionWorkspace(token: string, opts?: ImportOptions): Promise<{ items: Array<{ title: string; id: string; type: string }>; error?: string }> {
    if (!token) return { items: [], error: 'Kein Integration Token angegeben.' };

    const fetchFn = opts?.httpFetch || globalThis.fetch;

    try {
      const res = await fetchFn('https://api.notion.com/v1/search', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token.trim()}`,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ page_size: 100 }),
      });

      if (!res.ok) {
        const errText = await res.text();
        console.warn('[NotionAPI] search failed:', res.status, res.statusText, errText);
        let errorMsg = `Notion API HTTP ${res.status}: ${res.statusText}`;
        try {
          const errJson = JSON.parse(errText);
          if (errJson?.message) errorMsg = `Notion API: ${errJson.message}`;
        } catch {}
        return { items: [], error: errorMsg };
      }

      const data = await res.json();
      if (!Array.isArray(data.results)) return { items: [] };

      const results: Array<{ title: string; id: string; type: string }> = [];
      for (const item of data.results) {
        const id = item.id;
        const type = item.object; // 'page' or 'database'
        let title = '';

        if (item.properties) {
          for (const key of Object.keys(item.properties)) {
            const prop = item.properties[key];
            if (prop?.type === 'title' && Array.isArray(prop.title) && prop.title[0]?.plain_text) {
              title = prop.title[0].plain_text;
              break;
            }
          }
        }
        if (!title && item.title && Array.isArray(item.title) && item.title[0]?.plain_text) {
          title = item.title[0].plain_text;
        }

        results.push({ id, title: title || `Notion_${type}_${id.slice(0, 6)}`, type });
      }

      return { items: results };
    } catch (e) {
      console.warn('[NotionAPI] fetch exception:', e);
      return { items: [], error: 'Netzwerkfehler beim Aufruf der Notion API: ' + (e instanceof Error ? e.message : String(e)) };
    }
  }

  private async fetchPageBlocksToMarkdown(pageId: string, token: string, fetchFn: typeof fetch): Promise<string> {
    try {
      const res = await fetchFn(`https://api.notion.com/v1/blocks/${pageId}/children?page_size=100`, {
        headers: {
          'Authorization': `Bearer ${token.trim()}`,
          'Notion-Version': '2022-06-28',
        },
      });
      if (!res.ok) return '';
      const data = await res.json();
      if (!Array.isArray(data.results)) return '';

      const lines: string[] = [];
      for (const block of data.results) {
        const type = block.type;
        const info = block[type];
        if (!info || !Array.isArray(info.rich_text)) continue;

        const text = info.rich_text.map((t: any) => t.plain_text).join('');
        if (!text) continue;

        switch (type) {
          case 'heading_1': lines.push(`# ${text}`); break;
          case 'heading_2': lines.push(`## ${text}`); break;
          case 'heading_3': lines.push(`### ${text}`); break;
          case 'bulleted_list_item': lines.push(`- ${text}`); break;
          case 'numbered_list_item': lines.push(`1. ${text}`); break;
          case 'to_do': lines.push(info.checked ? `- [x] ${text}` : `- [ ] ${text}`); break;
          case 'quote': lines.push(`> ${text}`); break;
          case 'code': lines.push(`\`\`\`\n${text}\n\`\`\``); break;
          default: lines.push(text); break;
        }
      }
      return lines.join('\n\n');
    } catch {
      return '';
    }
  }

  async detect(input: any): Promise<boolean> {
    return !!this.extractToken(input);
  }

  async analyze(input: any, opts: ImportOptions): Promise<ImportPlan> {
    const token = this.extractToken(input);
    const res = await this.fetchNotionWorkspace(token, opts);

    const notes = res.items.filter(i => i.type === 'page').length;
    const databases = res.items.filter(i => i.type === 'database').length;

    const warnings: string[] = [];
    if (!token) {
      warnings.push('Kein Integration Token angegeben.');
    } else if (res.error) {
      warnings.push(res.error);
    } else if (res.items.length === 0) {
      warnings.push('Keine freigegebenen Notion-Seiten gefunden. WICHTIG: Klicke in Notion auf Deinen Seiten oben rechts auf "..." -> "Connections" ("Verbindungen") und füge Deine Verbindung hinzu!');
    }

    return {
      sourceId: this.id,
      sourceName: this.name,
      totalNotes: notes,
      totalAttachments: 0,
      totalDatabases: databases,
      totalChecklists: 0,
      warnings,
      requiredSpaceBytes: Math.max(1024, res.items.length * 2048),
      estimatedDurationSec: Math.max(1, Math.ceil(res.items.length / 10)),
    };
  }

  async run(
    input: any,
    opts: ImportOptions,
    onProgress?: (percent: number, statusMessage: string) => void
  ): Promise<ImportReport> {
    const startTime = Date.now();
    const token = this.extractToken(input);
    const prefix = opts.targetSubfolder ? `${opts.targetSubfolder}/` : '';

    if (opts.vaultAdapter && prefix) {
      try { await opts.vaultAdapter.createFolder(prefix.replace(/\/$/, '')); } catch {}
    }

    if (onProgress) onProgress(15, 'Verbinde mit Notion API...');
    const res = await this.fetchNotionWorkspace(token, opts);
    const items = res.items;

    const fetchFn = opts?.httpFetch || globalThis.fetch;
    const reportItems: ImportReport['items'] = [];
    let importedNotes = 0;
    let importedDatabases = 0;

    if (items.length === 0) {
      const notePath = `${prefix}Notion_Workspace_Import.md`;
      const sampleContent = `# Notion API Import\n\n- Integration Token konfiguriert.\n- ${res.error || 'Aus Sicherheitsgründen erfordert Notion die explizite Freigabe pro Seite: Klicke in Notion auf "..." -> "Connections" ("Verbindungen") -> füge Deine Verbindung hinzu.'}\n`;
      if (opts.vaultAdapter) {
        await opts.vaultAdapter.writeTextFile(notePath, sampleContent);
      }
      reportItems.push({ path: notePath, status: 'imported' });
      importedNotes = 1;
    } else {
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const safeTitle = (item.title || `Notion_${item.id}`).replace(/[/\\?%*:|"<>]/g, '_').slice(0, 100);

        if (item.type === 'database') {
          importedDatabases++;
          const dbFolderPath = `${prefix}${safeTitle}`;
          const dbPath = `${dbFolderPath}/${safeTitle}.base`;
          if (opts.vaultAdapter) {
            try { await opts.vaultAdapter.createFolder(dbFolderPath); } catch {}
            try { await opts.vaultAdapter.createFolder(dbPath); } catch {}
            await opts.vaultAdapter.writeTextFile(`${dbPath}/schema.json`, JSON.stringify({ name: safeTitle, properties: [] }, null, 2));
          }
          reportItems.push({ path: dbPath, status: 'imported' });
        } else {
          importedNotes++;
          const notePath = `${prefix}${safeTitle}.md`;
          const bodyMd = await this.fetchPageBlocksToMarkdown(item.id, token, fetchFn);
          const fullContent = `# ${item.title}\n\n${bodyMd || '*Keine Textinhalte in dieser Notion-Seite vorhanden.*'}\n`;

          if (opts.vaultAdapter) {
            await opts.vaultAdapter.writeTextFile(notePath, fullContent);
          }
          reportItems.push({ path: notePath, status: 'imported' });
        }

        if (onProgress) {
          onProgress(Math.round(((i + 1) / items.length) * 100), `Lade Notion ${safeTitle}...`);
        }
      }
    }

    const durationMs = Date.now() - startTime;
    const reportPath = `${prefix}Import-Bericht.md`;
    const summaryMarkdown = `# Import-Bericht (${this.name})\n\n` +
      `- **Datum:** ${new Date().toISOString()}\n` +
      `- **Importierte Notizen:** ${importedNotes}\n` +
      `- **Importierte Datenbanken (.base):** ${importedDatabases}\n\n` +
      reportItems.map(item => `- [${item.status.toUpperCase()}] ${item.path}`).join('\n');

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
      items: reportItems,
      summaryMarkdown,
    };
  }
}

export { NotionFileImporter as NotionImporter };
