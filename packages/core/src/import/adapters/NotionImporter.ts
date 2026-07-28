import {
  DEFAULT_IMPORT_LABELS,
  ImportFamily,
  ImportOptions,
  ImportPlan,
  ImportReport,
  ImportSource,
  ImportSourceId,
} from '../ImportTypes.js';
import { ImportWriter } from '../ImportWriter.js';
import { normalizePath, rewriteNotionLinks } from '../notionFileLinks.js';
import { msFromIso, timesFromFile, timesOrUndefined } from '../sourceTimes.js';

/**
 * Renders a `.base` config using the shell's canonical serializer when one was
 * supplied, so imported databases match app-created ones byte for byte.
 * Falls back to JSON (valid YAML, but without the `note.` prefixing Obsidian
 * expects) — callers mark that case as degraded.
 */
function serializeBaseFile(config: any, opts: ImportOptions): string {
  if (typeof opts.serializeBase === 'function') return opts.serializeBase(config);
  return JSON.stringify(config, null, 2);
}

export interface NotionPagePayload {
  id: string;
  title: string;
  relativePath?: string;
  markdownContent: string;
  properties?: Record<string, any>;
  isDatabase?: boolean;
  /** Modification time of the export file this page came out of, if known. */
  mtimeMs?: number;
  /**
   * The path this page had inside the export, IDs and all.
   *
   * Kept because that is what the export's own links address; without it the
   * internal links cannot be pointed at the notes that were written.
   */
  originalPath?: string;
}

interface NotionWorkspaceItem {
  id: string;
  title: string;
  type: 'page' | 'database';
  parentId?: string;
  parentType?: string;
  properties?: Record<string, any>;
  /** ISO instants the API states on every object. */
  createdTime?: string;
  lastEditedTime?: string;
  /**
   * The note name this item actually got, once the writer had a say.
   *
   * A second page called "Meeting" lands as `Meeting (2).md`, so a relation
   * emitted as `[[Meeting]]` used to resolve to the first one — silently, and
   * in every direction. Wiki links are written from this field; the display
   * title stays `title`, because the note is still called "Meeting".
   */
  linkTitle?: string;
}

/** The name to put inside `[[…]]` for an item — never the raw title. */
function linkTargetOf(item: NotionWorkspaceItem): string {
  return item.linkTitle ?? item.title;
}

function normId(id: string): string {
  if (!id) return '';
  return id.replace(/-/g, '').toLowerCase();
}

function resolveDatabaseTitle(
  blockId: string,
  rawTitle: string | undefined,
  databaseId: string | undefined,
  currentPageTitle: string,
  currentSectionHeading: string,
  itemMap?: Map<string, NotionWorkspaceItem>
): string {
  if (databaseId && itemMap?.has(normId(databaseId))) {
    return itemMap.get(normId(databaseId))!.title;
  }
  if (blockId && itemMap?.has(normId(blockId))) {
    return itemMap.get(normId(blockId))!.title;
  }

  if (rawTitle && itemMap) {
    const cleanRaw = rawTitle.trim().toLowerCase();
    for (const item of itemMap.values()) {
      if (item.type === 'database' && item.title.trim().toLowerCase() === cleanRaw) {
        return item.title;
      }
    }
  }

  if (currentSectionHeading && itemMap) {
    const cleanHeading = currentSectionHeading.trim().toLowerCase();
    for (const item of itemMap.values()) {
      if (item.type === 'database') {
        const cleanDb = item.title.trim().toLowerCase();
        if (cleanDb.includes(cleanHeading) || cleanHeading.includes(cleanDb.replace(/^alle\s+/, ''))) {
          return item.title;
        }
      }
    }
  }

  if (currentPageTitle && itemMap) {
    const cleanPage = currentPageTitle.trim().toLowerCase();
    for (const item of itemMap.values()) {
      if (item.type === 'database') {
        const cleanDb = item.title.trim().toLowerCase();
        if (cleanDb.includes(cleanPage) || cleanPage.includes(cleanDb.replace(/^alle\s+/, ''))) {
          return item.title;
        }
      }
    }
  }

  return rawTitle && rawTitle.toLowerCase() !== 'untitled' ? rawTitle : (currentPageTitle ? `${currentPageTitle}_Database` : 'Database');
}

function convertNotionRichTextToMarkdown(richTextArray: any[], itemMap?: Map<string, NotionWorkspaceItem>): string {
  if (!Array.isArray(richTextArray) || richTextArray.length === 0) return '';

  return richTextArray.map((t: any) => {
    let plain = t.plain_text || '';

    if (t.type === 'mention' && t.mention?.type === 'page' && t.mention.page?.id) {
      const pageId = normId(t.mention.page.id);
      const targetItem = itemMap?.get(pageId);
      const title = targetItem ? linkTargetOf(targetItem) : plain || 'Notion page';
      return `[[${title}]]`;
    }

    if (t.href) {
      if (t.href.startsWith('http://') || t.href.startsWith('https://')) {
        plain = `[${plain}](${t.href})`;
      } else if (t.href.startsWith('/')) {
        const rawTargetId = t.href.split('/').pop()?.split('#')[0] || '';
        const targetId = normId(rawTargetId);
        const targetItem = itemMap?.get(targetId);
        if (targetItem) plain = `[[${linkTargetOf(targetItem)}]]`;
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

function extractNotionPropertyValue(pVal: any, itemMap?: Map<string, NotionWorkspaceItem>): any {
  if (!pVal || typeof pVal !== 'object') return undefined;

  const type = pVal.type;
  switch (type) {
    case 'title':
      if (Array.isArray(pVal.title) && pVal.title.length > 0) {
        return pVal.title.map((t: any) => t.plain_text || '').join('');
      }
      return undefined;
    case 'select':
      return pVal.select?.name ?? undefined;
    case 'status':
      return pVal.status?.name ?? undefined;
    case 'multi_select':
      if (Array.isArray(pVal.multi_select)) {
        return pVal.multi_select.map((m: any) => m.name).filter(Boolean);
      }
      return undefined;
    case 'people':
      if (Array.isArray(pVal.people)) {
        return pVal.people.map((p: any) => p.name || p.id).filter(Boolean).join(', ');
      }
      return undefined;
    case 'rich_text':
      if (Array.isArray(pVal.rich_text)) {
        return convertNotionRichTextToMarkdown(pVal.rich_text, itemMap);
      }
      return undefined;
    case 'date':
      if (!pVal.date) return undefined;
      if (pVal.date.start && pVal.date.end) {
        return `${pVal.date.start} -> ${pVal.date.end}`;
      }
      return pVal.date.start ?? undefined;
    case 'number':
      return pVal.number ?? undefined;
    case 'checkbox':
      return pVal.checkbox ?? false;
    case 'url':
      return pVal.url ?? undefined;
    case 'email':
      return pVal.email ?? undefined;
    case 'phone_number':
      return pVal.phone_number ?? undefined;
    case 'unique_id':
      if (pVal.unique_id) {
        const pfx = pVal.unique_id.prefix ? `${pVal.unique_id.prefix}-` : '';
        return `${pfx}${pVal.unique_id.number}`;
      }
      return undefined;
    case 'files':
      if (Array.isArray(pVal.files)) {
        return pVal.files.map((f: any) => f.name || f.file?.url || f.external?.url).filter(Boolean).join(', ');
      }
      return undefined;
    case 'formula': {
      const f = pVal.formula;
      if (!f) return undefined;
      return f.string ?? f.number ?? f.boolean ?? (f.date?.start ? (f.date.end ? `${f.date.start} -> ${f.date.end}` : f.date.start) : undefined);
    }
    case 'rollup': {
      const r = pVal.rollup;
      if (!r) return undefined;
      if (r.number !== undefined) return r.number;
      if (r.string !== undefined) return r.string;
      if (r.date?.start) return r.date.end ? `${r.date.start} -> ${r.date.end}` : r.date.start;
      if (Array.isArray(r.array)) {
        const extracted = r.array.map((item: any) => extractNotionPropertyValue(item, itemMap)).filter(Boolean);
        return extracted.join(', ');
      }
      return undefined;
    }
    case 'relation': {
      if (Array.isArray(pVal.relation) && pVal.relation.length > 0) {
        const relLinks: string[] = [];
        for (const rItem of pVal.relation) {
          const targetObj = itemMap?.get(normId(rItem.id));
          if (targetObj && targetObj.title) {
            relLinks.push(`[[${linkTargetOf(targetObj)}]]`);
          }
        }
        if (relLinks.length > 0) {
          return relLinks;
        }
      }
      return undefined;
    }
    case 'created_time': return pVal.created_time ?? undefined;
    case 'created_by': return pVal.created_by?.name || pVal.created_by?.id || undefined;
    case 'last_edited_time': return pVal.last_edited_time ?? undefined;
    case 'last_edited_by': return pVal.last_edited_by?.name || pVal.last_edited_by?.id || undefined;
    default:
      return undefined;
  }
}

/**
 * Imports a Notion export (ZIP or unpacked folder).
 *
 * Pages and their folder structure come across. Databases exported as CSV are
 * created as empty `.base` shells — the export gives us rows without the schema
 * or page IDs needed to turn them into linked notes. That is reported per
 * database rather than presented as a complete import; the API importer is the
 * path that carries database contents.
 */
export class NotionFileImporter implements ImportSource {
  readonly id: ImportSourceId = 'notion_file';
  readonly name = 'Notion (ZIP export)';
  readonly family: ImportFamily = 'markdown';
  readonly description = 'Imports Notion pages and folder structures from a ZIP archive or export folder.';

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
              mtimeMs: typeof item.mtimeMs === 'number' ? item.mtimeMs : undefined,
              originalPath: item.relativePath,
            });
          }
        }
      }
    }
    return pages;
  }

  /** Above the Markdown fallback: the export carries a recognisable id. */
  readonly detectPriority = 30;

  /**
   * A Notion export is recognised by the 32-character page id Notion appends
   * to every file and folder name.
   *
   * Accepting "has .md or .csv files" would have matched any Markdown folder,
   * which is exactly what the generic importer is for.
   */
  async detect(input: any): Promise<boolean> {
    if (!Array.isArray(input)) return this.parsePages(input).length > 0;
    return input.some(
      (item: any) => typeof item?.relativePath === 'string' && /[a-f0-9]{32}/i.test(item.relativePath)
    );
  }

  async analyze(input: any, opts: ImportOptions): Promise<ImportPlan> {
    const labels = opts.labels ?? DEFAULT_IMPORT_LABELS;
    const pages = this.parsePages(input);
    const databases = pages.filter(p => p.isDatabase).length;
    const notes = pages.filter(p => !p.isDatabase).length;

    const warnings: string[] = [];
    if (pages.length === 0) warnings.push('No Notion pages or CSV databases found in the selection.');
    if (databases > 0) warnings.push(labels.limitNotionFileDatabaseRows);
    warnings.push(labels.limitBinaryFilesInZip);

    return {
      sourceId: this.id,
      sourceName: this.name,
      totalNotes: notes,
      totalAttachments: 0,
      totalDatabases: databases,
      totalChecklists: 0,
      warnings,
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
    const labels = opts.labels ?? DEFAULT_IMPORT_LABELS;
    const pages = this.parsePages(input);
    const writer = new ImportWriter(opts, labels);

    await writer.ensureRoot();
    writer.noteLimitation(labels.limitBinaryFilesInZip);

    // PASS 1: claim every note name, and remember which export path became
    // which vault path. The export's own links address the ID-carrying paths,
    // so without this table every internal link would keep pointing at a file
    // that no longer exists under that name.
    const finalPaths: string[] = [];
    const linkMap = new Map<string, string>();
    for (const page of pages) {
      const rel = page.relativePath || `${page.title}.md`;
      const intended = page.isDatabase
        ? rel.endsWith('.csv')
          ? rel.replace(/\.csv$/, '.base')
          : `${rel}.base`
        : rel;
      const claimed = await writer.reserve(intended);
      // Reservations are vault paths; the links are written relative to the
      // import folder, so drop the prefix again.
      const importRelative = writer.prefix && claimed.startsWith(writer.prefix)
        ? claimed.slice(writer.prefix.length)
        : claimed;
      finalPaths.push(importRelative);
      if (page.originalPath) linkMap.set(normalizePath(page.originalPath), importRelative);
    }

    return writer.runGuarded(this, startTime, async () => {
    for (let i = 0; i < pages.length; i++) {
      writer.abortIfRequested();
      const page = pages[i];
      const rel = page.relativePath || `${page.title}.md`;
      const isDb = !!page.isDatabase;
      const times = timesFromFile({ mtimeMs: page.mtimeMs });

      try {
      if (isDb) {
        const baseRel = rel.endsWith('.csv') ? rel.replace(/\.csv$/, '.base') : `${rel}.base`;
        // `file.folder` is vault-relative, so the import subfolder belongs in
        // the filter. Without the prefix the database could never match its
        // own rows once the import went anywhere but the vault root — the
        // API path already builds it this way.
        const folderName = `${writer.prefix}${baseRel.replace(/\.base$/, '')}`;
        const baseConfig = {
          filters: { and: [`file.folder == "${folderName}"`] },
          columns: {},
          views: [
            { type: 'table', name: labels.viewTable, order: ['file.name'] },
            { type: 'list', name: labels.viewList, order: ['file.name'] },
          ],
        };

        // A CSV export carries rows but no schema or page IDs, so the database
        // is created empty. Say so on the file instead of counting it as done.
        await writer.writeFile(
          baseRel,
          serializeBaseFile(baseConfig, opts),
          'database',
          labels.limitNotionFileDatabaseRows,
          times
        );
        writer.noteLimitation(labels.limitNotionFileDatabaseRows);
      } else {
        const raw = page.markdownContent.startsWith('#')
          ? page.markdownContent
          : `# ${page.title}\n\n${page.markdownContent}`;
        const rewrite = page.originalPath
          ? rewriteNotionLinks(raw, page.originalPath, finalPaths[i], linkMap)
          : { content: raw, rewritten: 0, unresolved: 0 };
        await writer.writeNote(rel, rewrite.content, { times });
      }
      } catch (error) {
        writer.recordFailure(rel, error);
      }

      if (onProgress && pages.length > 0) {
        onProgress(Math.round(((i + 1) / pages.length) * 100), `Importing Notion ${page.title}...`);
      }
    }
    });
  }
}

/**
 * Imports a Notion workspace through the official REST API.
 *
 * The richer of the two Notion paths: it sees page hierarchy, database schemas
 * and row properties, so databases become real `.base` files with one note per
 * row and relations as wiki links.
 */
export class NotionApiImporter implements ImportSource {
  readonly id: ImportSourceId = 'notion_api';
  readonly name = 'Notion (API, integration token)';
  readonly family: ImportFamily = 'api';
  readonly description = 'Imports Notion pages, nested folders and databases (with rows and relations) via an integration token.';

  private extractToken(input: any): string {
    if (Array.isArray(input) && input[0]?.notionToken) return input[0].notionToken;
    if (typeof input === 'object' && input !== null && input.notionToken) return input.notionToken;
    return '';
  }

  private async fetchNotionWorkspace(token: string, opts?: ImportOptions): Promise<{ items: NotionWorkspaceItem[]; error?: string }> {
    if (!token) return { items: [], error: 'No integration token provided.' };

    const fetchFn = opts?.httpFetch || globalThis.fetch;
    const results: NotionWorkspaceItem[] = [];
    let hasMore = true;
    let startCursor: string | undefined;

    try {
      while (hasMore) {
        const bodyPayload: Record<string, any> = { page_size: 100 };
        if (startCursor) bodyPayload.start_cursor = startCursor;

        const res = await fetchFn('https://api.notion.com/v1/search', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token.trim()}`,
            'Notion-Version': '2022-06-28',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(bodyPayload),
        });

        if (!res.ok) {
          const errText = await res.text();
          console.warn('[NotionAPI] search failed:', res.status, res.statusText, errText);
          let errorMsg = `Notion API HTTP ${res.status}: ${res.statusText}`;
          try {
            const errJson = JSON.parse(errText);
            if (errJson?.message) errorMsg = `Notion API: ${errJson.message}`;
          } catch { /* ignore JSON parse error */ }
          return { items: results, error: errorMsg };
        }

        const data = await res.json();
        if (!Array.isArray(data.results)) break;

        for (const item of data.results) {
          const id = item.id;
          const type: 'page' | 'database' = item.object === 'database' ? 'database' : 'page';
          let title = '';

          if (item.properties) {
            for (const key of Object.keys(item.properties)) {
              const prop = item.properties[key];
              if (prop?.type === 'title' && Array.isArray(prop.title) && prop.title.length > 0) {
                title = prop.title.map((t: any) => t.plain_text || '').join('');
                if (title) break;
              }
            }
          }
          if (!title && item.title && Array.isArray(item.title) && item.title.length > 0) {
            title = item.title.map((t: any) => t.plain_text || '').join('');
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
            createdTime: typeof item.created_time === 'string' ? item.created_time : undefined,
            lastEditedTime: typeof item.last_edited_time === 'string' ? item.last_edited_time : undefined,
          });
        }

        hasMore = !!data.has_more;
        startCursor = data.next_cursor || undefined;
      }

      return { items: results };
    } catch (e) {
      console.warn('[NotionAPI] fetch exception:', e);
      return { items: results, error: 'Netzwerkfehler beim Aufruf der Notion API: ' + (e instanceof Error ? e.message : String(e)) };
    }
  }

  private buildFolderPath(itemId: string, itemMap: Map<string, NotionWorkspaceItem>): string {
    const item = itemMap.get(normId(itemId));
    if (!item || !item.parentId || !item.parentType) return '';

    if (item.parentType === 'page_id' && itemMap.has(normId(item.parentId))) {
      const parentObj = itemMap.get(normId(item.parentId))!;
      const safeParentTitle = parentObj.title.replace(/[/\\?%*:|"<>]/g, '_').slice(0, 60);
      const parentDir = this.buildFolderPath(item.parentId, itemMap);
      return parentDir ? `${parentDir}/${safeParentTitle}` : safeParentTitle;
    }

    if (item.parentType === 'database_id' && itemMap.has(normId(item.parentId))) {
      const parentDb = itemMap.get(normId(item.parentId))!;
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
    const allRows: any[] = [];
    let hasMore = true;
    let startCursor: string | undefined;

    try {
      while (hasMore) {
        const bodyPayload: Record<string, any> = { page_size: 100 };
        if (startCursor) bodyPayload.start_cursor = startCursor;

        const res = await fetchFn(`https://api.notion.com/v1/databases/${dbId}/query`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token.trim()}`,
            'Notion-Version': '2022-06-28',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(bodyPayload),
        });
        if (!res.ok) break;
        const data = await res.json();
        if (Array.isArray(data.results)) {
          allRows.push(...data.results);
        }
        hasMore = !!data.has_more;
        startCursor = data.next_cursor || undefined;
      }
      return allRows;
    } catch {
      return allRows;
    }
  }

  /**
   * Reads a page's blocks as Markdown.
   *
   * Notion returns at most 100 blocks per call, so this follows `next_cursor`
   * until the page is exhausted — without it, long pages were silently cut off.
   * Blocks that carry children (toggles, columns, nested lists) are counted but
   * not descended into; the caller reports that as an incomplete import.
   */
  private async fetchPageBlocksToMarkdown(
    pageId: string,
    token: string,
    fetchFn: typeof fetch,
    itemMap?: Map<string, NotionWorkspaceItem>,
    currentPageTitle: string = ''
  ): Promise<{ markdown: string; nestedBlocksSkipped: number; failed: boolean }> {
    const blocks: any[] = [];
    let nestedBlocksSkipped = 0;

    try {
      let cursor: string | undefined;
      let hasMore = true;
      // Bounded so a cursor loop that never terminates cannot hang the import.
      let guard = 0;

      while (hasMore && guard < 200) {
        guard += 1;
        const url = new URL(`https://api.notion.com/v1/blocks/${pageId}/children`);
        url.searchParams.set('page_size', '100');
        if (cursor) url.searchParams.set('start_cursor', cursor);

        const res = await fetchFn(url.toString(), {
          headers: {
            'Authorization': `Bearer ${token.trim()}`,
            'Notion-Version': '2022-06-28',
          },
        });
        if (!res.ok) return { markdown: '', nestedBlocksSkipped, failed: true };

        const data = await res.json();
        if (!Array.isArray(data.results)) break;
        blocks.push(...data.results);

        hasMore = !!data.has_more;
        cursor = data.next_cursor || undefined;
        if (!cursor) hasMore = false;
      }

      const lines: string[] = [];
      let currentSectionHeading = '';

      for (const block of blocks) {
        if (block?.has_children) nestedBlocksSkipped += 1;
        const type = block.type;
        const info = (block as any)[type];
        if (!info) continue;

        let text = '';
        if (Array.isArray(info.rich_text)) {
          text = convertNotionRichTextToMarkdown(info.rich_text, itemMap);
        }

        switch (type) {
          case 'heading_1':
            if (text) {
              currentSectionHeading = text;
              lines.push(`# ${text}`);
            }
            break;
          case 'heading_2':
            if (text) {
              currentSectionHeading = text;
              lines.push(`## ${text}`);
            }
            break;
          case 'heading_3':
            if (text) {
              currentSectionHeading = text;
              lines.push(`### ${text}`);
            }
            break;
          case 'bulleted_list_item': if (text) lines.push(`- ${text}`); break;
          case 'numbered_list_item': if (text) lines.push(`1. ${text}`); break;
          case 'to_do': if (text) lines.push(info.checked ? `- [x] ${text}` : `- [ ] ${text}`); break;
          case 'quote': if (text) lines.push(`> ${text}`); break;
          case 'code': if (text) lines.push(`\`\`\`\n${text}\n\`\`\``); break;
          case 'callout': if (text) lines.push(`> [!NOTE]\n> ${text}`); break;
          case 'toggle': if (text) lines.push(`> ${text}`); break;
          case 'child_page': {
            const childTitle = info.title || 'Page';
            lines.push(`[[${childTitle}]]`);
            break;
          }
          case 'child_database': {
            const resolvedTitle = resolveDatabaseTitle(block.id, info.title, undefined, currentPageTitle, currentSectionHeading, itemMap);
            const safeDbTitle = resolvedTitle.replace(/[/\\?%*:|"<>]/g, '_').slice(0, 60);
            lines.push(`![[${safeDbTitle}.base]]`);
            break;
          }
          case 'link_to_page': {
            const linkType = info.type || (info.database_id ? 'database_id' : 'page_id');
            const rawTargetId = info.page_id || info.database_id || info[linkType];
            const targetId = normId(rawTargetId);
            const targetObj = itemMap?.get(targetId);

            if (targetObj) {
              if (targetObj.type === 'database') {
                lines.push(`![[${linkTargetOf(targetObj)}.base]]`);
              } else {
                lines.push(`[[${linkTargetOf(targetObj)}]]`);
              }
            } else if (rawTargetId) {
              const resolvedTitle = resolveDatabaseTitle(block.id, undefined, rawTargetId, currentPageTitle, currentSectionHeading, itemMap);
              const safeDbTitle = resolvedTitle.replace(/[/\\?%*:|"<>]/g, '_').slice(0, 60);
              lines.push(`![[${safeDbTitle}.base]]`);
            }
            break;
          }
          case 'bookmark': {
            if (info.url) lines.push(`[${info.url}](${info.url})`);
            break;
          }
          case 'divider': lines.push('---'); break;
          case 'paragraph': if (text) lines.push(text); break;
          default: if (text) lines.push(text); break;
        }
      }
      return { markdown: lines.join('\n\n'), nestedBlocksSkipped, failed: false };
    } catch {
      return { markdown: '', nestedBlocksSkipped, failed: true };
    }
  }

  /** A token is unambiguous — nothing else in the wizard looks like one. */
  readonly detectPriority = 50;

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
      warnings.push('No integration token provided.');
    } else if (res.error) {
      warnings.push(res.error);
    } else if (res.items.length === 0) {
      warnings.push('No shared Notion pages found. In Notion, open each page you want to import, choose "..." at the top right, then "Connections", and add your integration.');
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
    const labels = opts.labels ?? DEFAULT_IMPORT_LABELS;
    const token = this.extractToken(input);
    const fetchFn = opts?.httpFetch || globalThis.fetch;
    const writer = new ImportWriter(opts, labels);
    const prefix = writer.prefix;

    await writer.ensureRoot();
    if (typeof opts.serializeBase !== 'function') writer.noteLimitation(labels.degradedBaseSerializer);

    if (onProgress) onProgress(10, 'Loading Notion workspace structure...');
    const res = await this.fetchNotionWorkspace(token, opts);
    const items = res.items;

    const itemMap = new Map<string, NotionWorkspaceItem>();
    for (const item of items) {
      itemMap.set(normId(item.id), item);
    }

    // PASS 1: Pre-fetch all database rows and register every row ID -> title in itemMap
    const cachedDbRows = new Map<string, any[]>();
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type === 'database') {
        if (onProgress) onProgress(15 + Math.round((i / items.length) * 20), `Indexing database ${item.title}...`);
        const dbRows = await this.fetchDatabaseRows(item.id, token, fetchFn);
        cachedDbRows.set(item.id, dbRows);

        for (const row of dbRows) {
          let rowTitle = '';
          if (row.properties) {
            for (const [_pKey, pVal] of Object.entries(row.properties as Record<string, any>)) {
              if (pVal.type === 'title' && Array.isArray(pVal.title) && pVal.title.length > 0) {
                rowTitle = pVal.title.map((t: any) => t.plain_text || '').join('');
                if (rowTitle) break;
              }
            }
          }
          if (!rowTitle) rowTitle = `Entry_${row.id.slice(0, 6)}`;
          itemMap.set(normId(row.id), {
            id: row.id,
            title: rowTitle,
            type: 'page',
            parentId: item.id,
            parentType: 'database_id',
          });
        }
      }
    }

    // PASS 1b: Decide every final note name before a single link is written.
    //
    // Relations, mentions and page links are emitted as `[[Title]]` while the
    // content is built. If a second item carries the same title, the writer
    // numbers it (`Meeting (2).md`) — and every link that named it pointed at
    // the first note instead. Reserving the names here, in exactly the order
    // PASS 2 writes them, lets the link carry the name the note will have.
    const nameOf = (path: string): string => {
      const base = path.slice(path.lastIndexOf('/') + 1);
      const dot = base.lastIndexOf('.');
      return dot > 0 ? base.slice(0, dot) : base;
    };
    for (const item of items) {
      const safeTitle = (item.title || `Notion_${item.id}`).replace(/[/\\?%*:|"<>]/g, '_').slice(0, 100);
      const relFolder = this.buildFolderPath(item.id, itemMap) || '';

      if (item.type === 'database') {
        const dbFolderRel = relFolder ? `${relFolder}/${safeTitle}` : safeTitle;
        // Reserved for the `.base` itself, so `![[Name.base]]` embeds match.
        item.linkTitle = nameOf(await writer.reserve(`${dbFolderRel}.base`));

        for (const row of cachedDbRows.get(item.id) || []) {
          const rowItem = itemMap.get(normId(row.id));
          if (!rowItem) continue;
          const safeRowTitle = rowItem.title.replace(/[/\\?%*:|"<>]/g, '_').slice(0, 80);
          rowItem.linkTitle = nameOf(await writer.reserve(`${dbFolderRel}/${safeRowTitle}.md`));
        }
      } else {
        const safeNoteTitle = safeTitle.endsWith('.md') ? safeTitle : `${safeTitle}.md`;
        const noteRel = relFolder ? `${relFolder}/${safeNoteTitle}` : safeNoteTitle;
        item.linkTitle = nameOf(await writer.reserve(noteRel));
      }
    }

    // PASS 2: Execution & Writing files
    return writer.runGuarded(this, startTime, async () => {
    for (let i = 0; i < items.length; i++) {
      writer.abortIfRequested();
      const item = items[i];
      const safeTitle = (item.title || `Notion_${item.id}`).replace(/[/\\?%*:|"<>]/g, '_').slice(0, 100);
      const folderRelPath = this.buildFolderPath(item.id, itemMap);
      // Paths handed to the writer are relative to the import subfolder; the
      // writer prefixes them and creates the folders it needs.
      const relFolder = folderRelPath || '';
      const itemTimes = timesOrUndefined({
        createdMs: msFromIso(item.createdTime),
        modifiedMs: msFromIso(item.lastEditedTime),
      });

      try {
      if (item.type === 'database') {
        const dbFolderRel = relFolder ? `${relFolder}/${safeTitle}` : safeTitle;
        const dbFolderPath = `${prefix}${dbFolderRel}`;

        {
          const dbDetails = await this.fetchDatabaseDetails(item.id, token, fetchFn);
          const columnsConfig: Record<string, { input: string; options?: string[] }> = {};
          const columnOrder: string[] = ['file.name'];

          let boardProp: string | undefined;
          let dateProp: string | undefined;

          if (dbDetails.properties) {
            for (const [propName, propObj] of Object.entries(dbDetails.properties as Record<string, any>)) {
              const pType = propObj.type;
              columnOrder.push(propName);

              if (!boardProp && (pType === 'status' || pType === 'select')) {
                boardProp = propName;
              }
              if (!dateProp && pType === 'date') {
                dateProp = propName;
              }

              if ((pType === 'select' || pType === 'status') && (propObj.select?.options || propObj.status?.options)) {
                const rawOptions = propObj.select?.options || propObj.status?.options || [];
                columnsConfig[propName] = { input: 'select', options: rawOptions.map((o: any) => o.name) };
              } else if (pType === 'multi_select' && propObj.multi_select?.options) {
                columnsConfig[propName] = { input: 'multi_select', options: propObj.multi_select.options.map((o: any) => o.name) };
              } else if (pType === 'date') columnsConfig[propName] = { input: 'date' };
              else if (pType === 'number') columnsConfig[propName] = { input: 'number' };
              else if (pType === 'checkbox') columnsConfig[propName] = { input: 'checkbox' };
              else if (pType === 'relation') columnsConfig[propName] = { input: 'relation' };
              else if (pType === 'url') columnsConfig[propName] = { input: 'url' };
              else if (pType === 'email') columnsConfig[propName] = { input: 'email' };
              else columnsConfig[propName] = { input: 'text' };
            }
          }

          const viewsConfig: any[] = [
            { type: 'table', name: labels.viewTable, order: columnOrder },
          ];
          if (boardProp) {
            viewsConfig.push({ type: 'board', name: labels.viewBoard, groupBy: boardProp });
          }
          if (dateProp) {
            viewsConfig.push({ type: 'calendar', name: labels.viewCalendar, dateField: dateProp });
          }
          viewsConfig.push({ type: 'list', name: labels.viewList, order: ['file.name'] });

          const baseConfig = {
            filters: { and: [`file.folder == "${dbFolderPath}"`] },
            columns: columnsConfig,
            views: viewsConfig,
          };

          await writer.writeFile(
            `${dbFolderRel}.base`,
            serializeBaseFile(baseConfig, opts),
            'database',
            typeof opts.serializeBase === 'function' ? undefined : labels.degradedBaseSerializer
          );

          const dbRows = cachedDbRows.get(item.id) || await this.fetchDatabaseRows(item.id, token, fetchFn);
          for (const row of dbRows) {
            let rowTitle = 'Entry';
            const rowFrontmatter: Record<string, any> = {};

            if (row.properties) {
              for (const [pKey, pVal] of Object.entries(row.properties as Record<string, any>)) {
                if (pVal.type === 'title' && Array.isArray(pVal.title) && pVal.title.length > 0) {
                  const tStr = pVal.title.map((t: any) => t.plain_text || '').join('');
                  if (tStr) rowTitle = tStr;
                } else {
                  const val = extractNotionPropertyValue(pVal, itemMap);
                  if (val !== undefined) {
                    rowFrontmatter[pKey] = val;
                  }
                }
              }
            }

            const safeRowTitle = rowTitle.replace(/[/\\?%*:|"<>]/g, '_').slice(0, 80);
            const rowBlocks = await this.fetchPageBlocksToMarkdown(row.id, token, fetchFn, itemMap, rowTitle);

            let rowMdContent = '';
            if (Object.keys(rowFrontmatter).length > 0) {
              rowMdContent += `---\n${Object.entries(rowFrontmatter).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join('\n')}\n---\n\n`;
            }
            rowMdContent += `# ${rowTitle}\n\n${rowBlocks.markdown || '*This row has no page content.*'}\n`;

            await writer.writeNote(`${dbFolderRel}/${safeRowTitle}.md`, rowMdContent, {
              details: rowBlocks.nestedBlocksSkipped > 0
                ? `${labels.degradedNotionNestedBlocks} (${rowBlocks.nestedBlocksSkipped})`
                : undefined,
              times: timesOrUndefined({
                createdMs: msFromIso((row as any).created_time),
                modifiedMs: msFromIso((row as any).last_edited_time),
              }),
            });
            if (rowBlocks.nestedBlocksSkipped > 0) writer.noteLimitation(labels.degradedNotionNestedBlocks);
          }
        }
      } else {
        const safeNoteTitle = safeTitle.endsWith('.md') ? safeTitle : `${safeTitle}.md`;
        const noteRel = relFolder ? `${relFolder}/${safeNoteTitle}` : safeNoteTitle;
        const blocks = await this.fetchPageBlocksToMarkdown(item.id, token, fetchFn, itemMap, item.title);
        const fullContent = `# ${item.title}\n\n${blocks.markdown || '*This Notion page has no text content.*'}\n`;

        const notes: string[] = [];
        if (blocks.failed) notes.push(labels.degradedNotionBlockLimit);
        if (blocks.nestedBlocksSkipped > 0) {
          notes.push(`${labels.degradedNotionNestedBlocks} (${blocks.nestedBlocksSkipped})`);
          writer.noteLimitation(labels.degradedNotionNestedBlocks);
        }

        await writer.writeNote(noteRel, fullContent, {
          details: notes.length > 0 ? notes.join(' · ') : undefined,
          times: itemTimes,
        });
      }
      } catch (error) {
        writer.recordFailure(safeTitle, error);
      }

      if (onProgress) {
        onProgress(35 + Math.round(((i + 1) / items.length) * 65), `Importing ${safeTitle}...`);
      }
    }
    });
  }
}

export { NotionFileImporter as NotionImporter };
