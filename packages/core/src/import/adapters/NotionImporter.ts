import { ImportFamily, ImportOptions, ImportPlan, ImportReport, ImportSource, ImportSourceId } from '../ImportTypes.js';

export interface NotionPagePayload {
  id: string;
  title: string;
  relativePath?: string;
  markdownContent: string;
  properties?: Record<string, any>;
  isDatabase?: boolean;
}

interface NotionWorkspaceItem {
  id: string;
  title: string;
  type: 'page' | 'database';
  parentId?: string;
  parentType?: string;
  properties?: Record<string, any>;
}

function convertNotionRichTextToMarkdown(richTextArray: any[], itemMap?: Map<string, NotionWorkspaceItem>): string {
  if (!Array.isArray(richTextArray) || richTextArray.length === 0) return '';

  return richTextArray.map((t: any) => {
    let plain = t.plain_text || '';

    if (t.type === 'mention' && t.mention?.type === 'page' && t.mention.page?.id) {
      const pageId = t.mention.page.id;
      const targetItem = itemMap?.get(pageId);
      const title = targetItem ? targetItem.title : plain || 'Notion-Seite';
      return `[[${title}]]`;
    }

    if (t.href) {
      if (t.href.startsWith('http://') || t.href.startsWith('https://')) {
        plain = `[${plain}](${t.href})`;
      } else if (t.href.startsWith('/')) {
        const targetId = t.href.split('/').pop()?.split('#')[0] || '';
        const targetItem = itemMap?.get(targetId);
        if (targetItem) plain = `[[${targetItem.title}]]`;
      }
    }

    if (t.annotations) {
      if (t.annotations.code) plain = `\`${plain}\``;
      if (t.annotations.bold) plain = `**${plain}**`;
      if (t.annotations.italic) plain = `*${plain}*`;
      if (t.annotations.strikethrough) plain = `~~${plain}~~`;
    }

    return plain;
  }).join('');
}

export class NotionFileImporter implements ImportSource {
  readonly id: ImportSourceId = 'notion_file';
  readonly name = 'Notion (ZIP & Export)';
  readonly family: ImportFamily = 'markdown';
  readonly description = 'Importiert Notion Workspaces, Seiten, Ordnerstrukturen und Datenbanken aus ZIP-Archiven oder Export-Ordnern.';

  private cleanNotionPath(relPath: string): string {
    return relPath
      .split('/')
      .map(part => part.replace(/ [a-f0-9]{32}/gi, '').trim())
      .join('/');
  }

  private parsePages(input: any): NotionPagePayload[] {
    if (Array.isArray(input?.pages)) return input.pages;
    if (!Array.isArray(input)) return [];

    const pages: NotionPagePayload[] = [];
    for (let i = 0; i < input.length; i++) {
      const item = input[i];
      if (typeof item === 'object' && item !== null) {
        if (item.title && item.markdownContent !== undefined) {
          pages.push(item as NotionPagePayload);
        } else if (typeof item.relativePath === 'string') {
          const isMd = item.relativePath.endsWith('.md');
          const isHtml = item.relativePath.endsWith('.html');
          const isCsv = item.relativePath.endsWith('.csv');

          if (isMd || isHtml || isCsv) {
            const cleanedPath = this.cleanNotionPath(item.relativePath);
            const rawName = cleanedPath.split(/[/\\]/).pop() || `Page_${i + 1}`;
            const title = rawName.replace(/\.(md|html|csv)$/i, '');
            pages.push({
              id: `notion_${i + 1}`,
              title,
              relativePath: cleanedPath,
              markdownContent: item.content || `# ${title}`,
              isDatabase: isCsv,
            });
          }
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
      try { await opts.vaultAdapter.createFolder(prefix.replace(/\/$/, '')); } catch {}
    }

    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      const rel = page.relativePath || `${page.title}.md`;
      const targetPath = `${prefix}${rel}`;
      const isDb = !!page.isDatabase;

      if (opts.vaultAdapter) {
        if (targetPath.includes('/')) {
          const folderPart = targetPath.substring(0, targetPath.lastIndexOf('/'));
          try { await opts.vaultAdapter.createFolder(folderPart); } catch {}
        }

        if (isDb) {
          importedDatabases++;
          const baseFilePath = targetPath.endsWith('.csv') ? targetPath.replace(/\.csv$/, '.base') : `${targetPath}.base`;
          const baseConfig = {
            filters: { and: [{ field: 'file.folder', operator: 'includes', value: page.title }] },
            columns: {},
            views: [{ type: 'table', name: 'Tabelle', order: ['file.name'] }],
          };
          await opts.vaultAdapter.writeTextFile(baseFilePath, JSON.stringify(baseConfig, null, 2));
          items.push({ path: baseFilePath, status: 'imported' });
        } else {
          importedNotes++;
          const content = page.markdownContent.startsWith('#') ? page.markdownContent : `# ${page.title}\n\n${page.markdownContent}`;
          await opts.vaultAdapter.writeTextFile(targetPath, content);
          items.push({ path: targetPath, status: 'imported' });
        }
      }

      if (onProgress && pages.length > 0) {
        onProgress(Math.round(((i + 1) / pages.length) * 100), `Importiere Notion ${page.title}...`);
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
  readonly description = 'Synchronisiert Notion Notizen, verschachtelte Ordnerstrukturen & Datenbank-Schemas (.base JSON) per Integration Token.';

  private extractToken(input: any): string {
    if (Array.isArray(input) && input[0]?.notionToken) return input[0].notionToken;
    if (typeof input === 'object' && input !== null && input.notionToken) return input.notionToken;
    return '';
  }

  private async fetchNotionWorkspace(token: string, opts?: ImportOptions): Promise<{ items: NotionWorkspaceItem[]; error?: string }> {
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

      const results: NotionWorkspaceItem[] = [];
      for (const item of data.results) {
        const id = item.id;
        const type: 'page' | 'database' = item.object === 'database' ? 'database' : 'page';
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

        let parentId: string | undefined;
        let parentType: string | undefined;
        if (item.parent && typeof item.parent.type === 'string') {
          parentType = item.parent.type;
          parentId = (item.parent as any)[parentType as string];
        }

        results.push({
          id,
          title: title || `Notion_${type}_${id.slice(0, 6)}`,
          type,
          parentId,
          parentType,
          properties: item.properties,
        });
      }

      return { items: results };
    } catch (e) {
      console.warn('[NotionAPI] fetch exception:', e);
      return { items: [], error: 'Netzwerkfehler beim Aufruf der Notion API: ' + (e instanceof Error ? e.message : String(e)) };
    }
  }

  private buildFolderPath(itemId: string, itemMap: Map<string, NotionWorkspaceItem>): string {
    const item = itemMap.get(itemId);
    if (!item || !item.parentId || !item.parentType) return '';

    if (item.parentType === 'page_id' && itemMap.has(item.parentId)) {
      const parentObj = itemMap.get(item.parentId)!;
      const safeParentTitle = parentObj.title.replace(/[/\\?%*:|"<>]/g, '_').slice(0, 60);
      const parentDir = this.buildFolderPath(item.parentId, itemMap);
      return parentDir ? `${parentDir}/${safeParentTitle}` : safeParentTitle;
    }

    if (item.parentType === 'database_id' && itemMap.has(item.parentId)) {
      const parentDb = itemMap.get(item.parentId)!;
      const safeDbTitle = parentDb.title.replace(/[/\\?%*:|"<>]/g, '_').slice(0, 60);
      const parentDir = this.buildFolderPath(item.parentId, itemMap);
      return parentDir ? `${parentDir}/${safeDbTitle}` : safeDbTitle;
    }

    return '';
  }

  private async fetchDatabaseDetails(dbId: string, token: string, fetchFn: typeof fetch): Promise<Record<string, any>> {
    try {
      const res = await fetchFn(`https://api.notion.com/v1/databases/${dbId}`, {
        headers: {
          'Authorization': `Bearer ${token.trim()}`,
          'Notion-Version': '2022-06-28',
        },
      });
      if (!res.ok) return {};
      return await res.json();
    } catch {
      return {};
    }
  }

  private async fetchDatabaseRows(dbId: string, token: string, fetchFn: typeof fetch): Promise<any[]> {
    try {
      const res = await fetchFn(`https://api.notion.com/v1/databases/${dbId}/query`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token.trim()}`,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ page_size: 100 }),
      });
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data.results) ? data.results : [];
    } catch {
      return [];
    }
  }

  private async fetchPageBlocksToMarkdown(
    pageId: string,
    token: string,
    fetchFn: typeof fetch,
    itemMap?: Map<string, NotionWorkspaceItem>
  ): Promise<string> {
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
        const info = (block as any)[type];
        if (!info) continue;

        let text = '';
        if (Array.isArray(info.rich_text)) {
          text = convertNotionRichTextToMarkdown(info.rich_text, itemMap);
        }

        switch (type) {
          case 'heading_1': if (text) lines.push(`# ${text}`); break;
          case 'heading_2': if (text) lines.push(`## ${text}`); break;
          case 'heading_3': if (text) lines.push(`### ${text}`); break;
          case 'bulleted_list_item': if (text) lines.push(`- ${text}`); break;
          case 'numbered_list_item': if (text) lines.push(`1. ${text}`); break;
          case 'to_do': if (text) lines.push(info.checked ? `- [x] ${text}` : `- [ ] ${text}`); break;
          case 'quote': if (text) lines.push(`> ${text}`); break;
          case 'code': if (text) lines.push(`\`\`\`\n${text}\n\`\`\``); break;
          case 'callout': if (text) lines.push(`> [!NOTE]\n> ${text}`); break;
          case 'toggle': if (text) lines.push(`> ${text}`); break;
          case 'child_page': {
            const childTitle = info.title || 'Seite';
            lines.push(`📄 [[${childTitle}]]`);
            break;
          }
          case 'child_database': {
            const dbTitle = info.title || 'Datenbank';
            lines.push(`📊 [[${dbTitle}.base]]`);
            break;
          }
          case 'link_to_page': {
            const targetId = info.page_id || info.database_id;
            const targetObj = itemMap?.get(targetId);
            if (targetObj) lines.push(`🔗 [[${targetObj.title}]]`);
            break;
          }
          case 'bookmark': {
            if (info.url) lines.push(`🔖 [${info.url}](${info.url})`);
            break;
          }
          case 'divider': lines.push('---'); break;
          case 'paragraph': if (text) lines.push(text); break;
          default: if (text) lines.push(text); break;
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
      estimatedDurationSec: Math.max(1, Math.ceil(res.items.length / 5)),
    };
  }

  async run(
    input: any,
    opts: ImportOptions,
    onProgress?: (percent: number, statusMessage: string) => void
  ): Promise<ImportReport> {
    const startTime = Date.now();
    const token = this.extractToken(input);
    const fetchFn = opts?.httpFetch || globalThis.fetch;
    const prefix = opts.targetSubfolder ? `${opts.targetSubfolder}/` : '';

    if (opts.vaultAdapter && prefix) {
      try { await opts.vaultAdapter.createFolder(prefix.replace(/\/$/, '')); } catch {}
    }

    if (onProgress) onProgress(10, 'Lade Notion Workspace-Struktur...');
    const res = await this.fetchNotionWorkspace(token, opts);
    const items = res.items;

    const itemMap = new Map<string, NotionWorkspaceItem>();
    for (const item of items) {
      itemMap.set(item.id, item);
    }

    const reportItems: ImportReport['items'] = [];
    let importedNotes = 0;
    let importedDatabases = 0;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const safeTitle = (item.title || `Notion_${item.id}`).replace(/[/\\?%*:|"<>]/g, '_').slice(0, 100);
      const folderRelPath = this.buildFolderPath(item.id, itemMap);
      const currentFolder = folderRelPath ? `${prefix}${folderRelPath}` : prefix.replace(/\/$/, '');

      if (opts.vaultAdapter && currentFolder) {
        try { await opts.vaultAdapter.createFolder(currentFolder); } catch {}
      }

      if (item.type === 'database') {
        importedDatabases++;
        const dbFolderPath = currentFolder ? `${currentFolder}/${safeTitle}` : safeTitle;
        const baseFilePath = `${dbFolderPath}.base`;

        if (opts.vaultAdapter) {
          try { await opts.vaultAdapter.createFolder(dbFolderPath); } catch {}

          const dbDetails = await this.fetchDatabaseDetails(item.id, token, fetchFn);
          const columnsConfig: Record<string, { input: string; options?: string[] }> = {};
          const columnOrder: string[] = ['file.name'];

          if (dbDetails.properties) {
            for (const [propName, propObj] of Object.entries(dbDetails.properties as Record<string, any>)) {
              const pType = propObj.type;
              columnOrder.push(propName);

              if (pType === 'select' && propObj.select?.options) {
                columnsConfig[propName] = { input: 'select', options: propObj.select.options.map((o: any) => o.name) };
              } else if (pType === 'multi_select' && propObj.multi_select?.options) {
                columnsConfig[propName] = { input: 'multi_select', options: propObj.multi_select.options.map((o: any) => o.name) };
              } else if (pType === 'date') columnsConfig[propName] = { input: 'date' };
              else if (pType === 'number') columnsConfig[propName] = { input: 'number' };
              else if (pType === 'checkbox') columnsConfig[propName] = { input: 'checkbox' };
              else if (pType === 'relation') columnsConfig[propName] = { input: 'relation' };
            }
          }

          const baseConfig = {
            filters: { and: [{ field: 'file.folder', operator: 'includes', value: safeTitle }] },
            columns: columnsConfig,
            views: [{ type: 'table', name: 'Tabelle', order: columnOrder }],
          };

          await opts.vaultAdapter.writeTextFile(baseFilePath, JSON.stringify(baseConfig, null, 2));

          const dbRows = await this.fetchDatabaseRows(item.id, token, fetchFn);
          for (const row of dbRows) {
            let rowTitle = 'Eintrag';
            const rowFrontmatter: Record<string, any> = {};

            if (row.properties) {
              for (const [pKey, pVal] of Object.entries(row.properties as Record<string, any>)) {
                if (pVal.type === 'title' && Array.isArray(pVal.title) && pVal.title[0]?.plain_text) {
                  rowTitle = pVal.title[0].plain_text;
                } else if (pVal.type === 'select' && pVal.select?.name) {
                  rowFrontmatter[pKey] = pVal.select.name;
                } else if (pVal.type === 'multi_select' && Array.isArray(pVal.multi_select)) {
                  rowFrontmatter[pKey] = pVal.multi_select.map((m: any) => m.name);
                } else if (pVal.type === 'date' && pVal.date?.start) {
                  rowFrontmatter[pKey] = pVal.date.start;
                } else if (pVal.type === 'checkbox') {
                  rowFrontmatter[pKey] = pVal.checkbox;
                } else if (pVal.type === 'number') {
                  rowFrontmatter[pKey] = pVal.number;
                } else if (pVal.type === 'relation' && Array.isArray(pVal.relation)) {
                  const relLinks: string[] = [];
                  for (const rItem of pVal.relation) {
                    const targetObj = itemMap.get(rItem.id);
                    if (targetObj) {
                      relLinks.push(`[[${targetObj.title}]]`);
                    }
                  }
                  if (relLinks.length > 0) {
                    rowFrontmatter[pKey] = relLinks;
                  }
                }
              }
            }

            const safeRowTitle = rowTitle.replace(/[/\\?%*:|"<>]/g, '_').slice(0, 80);
            const rowBody = await this.fetchPageBlocksToMarkdown(row.id, token, fetchFn, itemMap);

            let rowMdContent = '';
            if (Object.keys(rowFrontmatter).length > 0) {
              rowMdContent += `---\n${Object.entries(rowFrontmatter).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join('\n')}\n---\n\n`;
            }
            rowMdContent += `# ${rowTitle}\n\n${rowBody || '*Keine Textinhalte in dieser Zeile vorhanden.*'}\n`;

            await opts.vaultAdapter.writeTextFile(`${dbFolderPath}/${safeRowTitle}.md`, rowMdContent);
            importedNotes++;
          }
        }

        reportItems.push({ path: baseFilePath, status: 'imported' });
      } else {
        importedNotes++;
        const safeNoteTitle = safeTitle.endsWith('.md') ? safeTitle : `${safeTitle}.md`;
        const notePath = currentFolder ? `${currentFolder}/${safeNoteTitle}` : safeNoteTitle;
        const bodyMd = await this.fetchPageBlocksToMarkdown(item.id, token, fetchFn, itemMap);
        const fullContent = `# ${item.title}\n\n${bodyMd || '*Keine Textinhalte in dieser Notion-Seite vorhanden.*'}\n`;

        if (opts.vaultAdapter) {
          await opts.vaultAdapter.writeTextFile(notePath, fullContent);
        }
        reportItems.push({ path: notePath, status: 'imported' });
      }

      if (onProgress) {
        onProgress(Math.round(((i + 1) / items.length) * 100), `Importiere ${safeTitle}...`);
      }
    }

    const durationMs = Date.now() - startTime;
    const reportPath = `${prefix}Import-Bericht.md`;
    const summaryMarkdown = `# Import-Bericht (${this.name})\n\n` +
      `- **Datum:** ${new Date().toISOString()}\n` +
      `- **Importierte Notizen & Einträge:** ${importedNotes}\n` +
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
