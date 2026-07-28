import { describe, expect, it } from 'vitest';
import { DEFAULT_IMPORT_LABELS, NotionApiImporter, NotionHttp } from '../../src/import/index.js';

/**
 * In-memory stand-in for IVaultAdapter, recording text and binary writes.
 *
 * Binary matters here: an attachment written through the text path would be a
 * corrupt image, and the report would still call it imported.
 */
function fakeVault() {
  const files = new Map<string, string>();
  const binaries = new Map<string, Uint8Array>();
  return {
    files,
    binaries,
    async exists(path: string) {
      return files.has(path) || binaries.has(path);
    },
    async writeTextFile(path: string, content: string) {
      files.set(path, content);
    },
    async writeBinaryFile(path: string, content: Uint8Array) {
      binaries.set(path, content);
    },
    async createFolder() {
      // Folders are implicit in the maps.
    },
  };
}

interface MockResponse {
  status?: number;
  body?: unknown;
  /** Raw bytes, for the attachment host. */
  bytes?: Uint8Array;
  headers?: Record<string, string>;
}

/**
 * Routes fetches by URL fragment and records every call.
 *
 * A handler may be a queue: the same endpoint answers differently on the second
 * attempt, which is how a retry is observed at all.
 */
function mockFetch(routes: Array<[string, MockResponse | MockResponse[]]>) {
  const calls: string[] = [];
  const authHeaders: Array<string | undefined> = [];
  const queues = new Map<string, MockResponse[]>();
  for (const [key, value] of routes) {
    queues.set(key, Array.isArray(value) ? [...value] : [value]);
  }

  const fetchFn = (async (input: any, init?: any) => {
    const url = String(input);
    calls.push(url);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    authHeaders.push(headers.Authorization);

    const key = [...queues.keys()].find((k) => url.includes(k));
    const queue = key ? queues.get(key)! : undefined;
    const entry = queue && (queue.length > 1 ? queue.shift()! : queue[0]);
    const res: MockResponse = entry ?? { status: 404, body: { message: 'not routed' } };
    const status = res.status ?? 200;

    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: `status ${status}`,
      headers: { get: (name: string) => res.headers?.[name] ?? null },
      json: async () => res.body,
      text: async () => JSON.stringify(res.body ?? ''),
      arrayBuffer: async () => (res.bytes ?? new Uint8Array()).buffer,
    };
  }) as unknown as typeof fetch;

  return { fetchFn, calls, authHeaders };
}

const page = (id: string, title: string) => ({
  object: 'page',
  id,
  created_time: '2024-01-02T03:04:05.000Z',
  last_edited_time: '2024-02-03T04:05:06.000Z',
  properties: { Name: { type: 'title', title: [{ plain_text: title }] } },
});

const searchResult = (results: unknown[]) => ({ results, has_more: false, next_cursor: null });

const blockList = (results: unknown[]) => ({ results, has_more: false, next_cursor: null });

const imageBlock = (url: string, hosted: boolean) => ({
  id: 'block-img',
  type: 'image',
  image: hosted ? { type: 'file', file: { url } } : { type: 'external', external: { url } },
});

const opts = (vaultAdapter: ReturnType<typeof fakeVault>, fetchFn: typeof fetch) => ({
  targetVaultPath: '/v',
  targetSubfolder: 'Import Notion',
  vaultAdapter,
  httpFetch: fetchFn,
  labels: DEFAULT_IMPORT_LABELS,
  serializeBase: (config: any) => JSON.stringify(config),
});

describe('NotionHttp — rate limits and retries', () => {
  it('honours Retry-After on a 429 and succeeds on the retry', async () => {
    const slept: number[] = [];
    const { fetchFn, calls } = mockFetch([
      [
        'api.notion.com',
        [
          { status: 429, headers: { 'Retry-After': '2' } },
          { status: 200, body: { results: [] } },
        ],
      ],
    ]);

    const http = new NotionHttp({
      fetchFn,
      token: 'secret',
      sleep: async (ms) => {
        slept.push(ms);
      },
      now: () => 0,
    });

    const res = await http.json('https://api.notion.com/v1/search', { method: 'POST' });

    expect(res.ok).toBe(true);
    expect(calls).toHaveLength(2);
    expect(slept).toContain(2000);
  });

  it('does not retry an authentication failure and reports Notion\'s own message', async () => {
    const { fetchFn, calls } = mockFetch([
      ['api.notion.com', { status: 401, body: { message: 'API token is invalid.' } }],
    ]);
    const http = new NotionHttp({ fetchFn, token: 'bad', sleep: async () => {}, now: () => 0 });

    const res = await http.json('https://api.notion.com/v1/search');

    expect(res.ok).toBe(false);
    expect(calls).toHaveLength(1);
    if (!res.ok) {
      expect(res.error).toContain('API token is invalid.');
      expect(res.status).toBe(401);
    }
  });

  it('never sends the integration token to the attachment host', async () => {
    const { fetchFn, authHeaders } = mockFetch([
      ['files.example.com', { bytes: new Uint8Array([1, 2, 3]) }],
    ]);
    const http = new NotionHttp({ fetchFn, token: 'secret', sleep: async () => {}, now: () => 0 });

    const bytes = await http.bytes('https://files.example.com/a.png?sig=1');

    expect(bytes).toEqual(new Uint8Array([1, 2, 3]));
    expect(authHeaders).toEqual([undefined]);
  });
});

describe('NotionApiImporter — attachments', () => {
  it('downloads a Notion-hosted image and embeds the path it was actually written to', async () => {
    const vault = fakeVault();
    const { fetchFn, calls } = mockFetch([
      ['/v1/search', { body: searchResult([page('p1', 'Trip')]) }],
      [
        '/blocks/p1/children',
        { body: blockList([imageBlock('https://files.notion.so/x/photo.png?sig=1', true)]) },
      ],
      ['files.notion.so', { bytes: new Uint8Array([137, 80, 78, 71]) }],
    ]);

    const importer = new NotionApiImporter();
    const report = await importer.run([{ token: 'secret' }], opts(vault, fetchFn));

    expect(vault.binaries.get('Import Notion/Attachments/photo.png')).toEqual(
      new Uint8Array([137, 80, 78, 71])
    );
    expect(vault.files.get('Import Notion/Trip.md')).toContain(
      '![[Import Notion/Attachments/photo.png]]'
    );
    expect(report.importedAttachmentsCount).toBe(1);
    expect(calls.some((c) => c.includes('files.notion.so'))).toBe(true);
  });

  it('leaves an external image as a link instead of fetching a foreign host', async () => {
    const vault = fakeVault();
    const { fetchFn, calls } = mockFetch([
      ['/v1/search', { body: searchResult([page('p1', 'Trip')]) }],
      [
        '/blocks/p1/children',
        { body: blockList([imageBlock('https://cdn.example.com/pic.png', false)]) },
      ],
    ]);

    const importer = new NotionApiImporter();
    const report = await importer.run([{ token: 'secret' }], opts(vault, fetchFn));

    expect(vault.files.get('Import Notion/Trip.md')).toContain(
      '![pic.png](https://cdn.example.com/pic.png)'
    );
    expect(calls.some((c) => c.includes('cdn.example.com'))).toBe(false);
    expect(report.importedAttachmentsCount).toBe(0);
  });

  it('says so when an attachment could not be downloaded', async () => {
    const vault = fakeVault();
    const { fetchFn } = mockFetch([
      ['/v1/search', { body: searchResult([page('p1', 'Trip')]) }],
      [
        '/blocks/p1/children',
        { body: blockList([imageBlock('https://files.notion.so/x/gone.png?sig=1', true)]) },
      ],
      ['files.notion.so', { status: 403, body: {} }],
    ]);

    const importer = new NotionApiImporter();
    const report = await importer.run([{ token: 'secret' }], opts(vault, fetchFn));

    expect(report.importedAttachmentsCount).toBe(0);
    expect(report.skippedCount).toBeGreaterThan(0);
    expect(report.summaryMarkdown).toContain('gone.png');
    const note = report.items.find((i) => i.path === 'Import Notion/Trip.md');
    expect(note?.status).toBe('degraded');
  });
});

describe('NotionApiImporter — one workspace listing, one row query', () => {
  it('reuses the listing from the preview instead of walking the workspace twice', async () => {
    const vault = fakeVault();
    const { fetchFn, calls } = mockFetch([
      ['/v1/search', { body: searchResult([page('p1', 'Trip')]) }],
      ['/blocks/p1/children', { body: blockList([]) }],
    ]);

    const importer = new NotionApiImporter();
    const options = opts(vault, fetchFn);
    await importer.analyze([{ token: 'secret' }], options);
    await importer.run([{ token: 'secret' }], options);

    expect(calls.filter((c) => c.includes('/v1/search'))).toHaveLength(1);
  });

  it('queries a database\'s rows once, not once per pass', async () => {
    const vault = fakeVault();
    const database = {
      object: 'database',
      id: 'db1',
      title: [{ plain_text: 'Tasks' }],
      created_time: '2024-01-02T03:04:05.000Z',
    };
    const row = {
      id: 'row1',
      created_time: '2024-01-02T03:04:05.000Z',
      last_edited_time: '2024-01-03T03:04:05.000Z',
      properties: { Name: { type: 'title', title: [{ plain_text: 'Write it up' }] } },
    };
    const { fetchFn, calls } = mockFetch([
      ['/v1/search', { body: searchResult([database]) }],
      ['/databases/db1/query', { body: { results: [row], has_more: false, next_cursor: null } }],
      ['/v1/databases/db1', { body: { properties: {} } }],
      ['/blocks/row1/children', { body: blockList([]) }],
    ]);

    const importer = new NotionApiImporter();
    await importer.run([{ token: 'secret' }], opts(vault, fetchFn));

    expect(calls.filter((c) => c.includes('/databases/db1/query'))).toHaveLength(1);
    expect(vault.files.has('Import Notion/Tasks/Write it up.md')).toBe(true);
  });
});

describe('NotionApiImporter — an incomplete database says so', () => {
  it('marks a database whose rows the API stopped answering', async () => {
    const vault = fakeVault();
    const database = { object: 'database', id: 'db1', title: [{ plain_text: 'Tasks' }] };
    const { fetchFn } = mockFetch([
      ['/v1/search', { body: searchResult([database]) }],
      [
        '/databases/db1/query',
        [
          { body: { results: [], has_more: true, next_cursor: 'cursor-2' } },
          { status: 400, body: { message: 'Bad cursor.' } },
        ],
      ],
      ['/v1/databases/db1', { body: { properties: {} } }],
    ]);

    const importer = new NotionApiImporter();
    const report = await importer.run([{ token: 'secret' }], opts(vault, fetchFn));

    const base = report.items.find((i) => i.path === 'Import Notion/Tasks.base');
    expect(base?.status).toBe('degraded');
    expect(base?.details).toContain(DEFAULT_IMPORT_LABELS.degradedNotionRowsTruncated);
    expect(report.summaryMarkdown).toContain(DEFAULT_IMPORT_LABELS.degradedNotionRowsTruncated);
  });
});
