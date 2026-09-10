import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebDavSyncTarget } from '../../src/sync/WebDavSyncTarget.js';
import { DropboxSyncTarget } from '../../src/sync/DropboxSyncTarget.js';
import { OneDriveSyncTarget } from '../../src/sync/OneDriveSyncTarget.js';
import { S3SyncTarget } from '../../src/sync/S3SyncTarget.js';
import { DriveSyncTarget } from '../../src/sync/DriveSyncTarget.js';
import { fetchWithRetry } from '../../src/sync/httpRetry.js';
import { fetchWithTransferTimeout, TransferCancelledError } from '../../src/sync/transferTimeout.js';

const providers = ['WebDAV', 'Dropbox', 'OneDrive', 'S3', 'Drive'] as const;
type Provider = typeof providers[number];
function targetFor(provider: Provider, content: (init: RequestInit) => Response) {
  const signals: AbortSignal[] = [];
  const fetchFn: typeof fetch = async (input, init = {}) => {
    const url = String(input);
    if (provider === 'Drive' && !url.includes('alt=media')) {
      const name = decodeURIComponent(url).match(/name='([^']*)'/)?.[1] ?? '';
      return Response.json({ files: [{ id: name === 'Plainva' ? 'root' : 'file', name, mimeType: name === 'Plainva' ? 'application/vnd.google-apps.folder' : 'text/plain' }] });
    }
    signals.push(init.signal!);
    return content(init);
  };
  const timeout = 50;
  const target = provider === 'WebDAV' ? new WebDavSyncTarget({ url: 'https://dav.example/', user: 'u', pass: 'p' }, fetchFn, timeout)
    : provider === 'Dropbox' ? new DropboxSyncTarget({ appKey: 'key', accessToken: 'token', refreshToken: 'refresh' }, fetchFn, timeout)
    : provider === 'OneDrive' ? new OneDriveSyncTarget({ clientId: 'id', accessToken: 'token', refreshToken: 'refresh' }, fetchFn, timeout)
    : provider === 'S3' ? new S3SyncTarget({ endpoint: 'https://s3.example', region: 'eu', bucket: 'bucket', accessKeyId: 'key', secretAccessKey: 'secret' }, fetchFn, timeout)
    : new DriveSyncTarget({ clientId: 'id', clientSecret: 'secret', accessToken: 'token', refreshToken: 'refresh' }, fetchFn, timeout);
  return { target, signals };
}
function stalled(cancel: () => void, prefix = false, status = 200): Response {
  return new Response(new ReadableStream<Uint8Array>({
    start(c) { if (prefix) c.enqueue(new Uint8Array([99])); }, cancel,
  }), { status });
}
const settleTimers = async <T>(pending: Promise<T>): Promise<T | Error> => {
  let settled = false;
  const observed = pending.then(value => { settled = true; return value; }, error => { settled = true; return error as Error; });
  // S3 signs on the real WebCrypto worker before creating a request timer.
  // Yield to that worker between clock drains instead of assuming it is a microtask.
  await vi.waitFor(async () => { await vi.runAllTimersAsync(); expect(settled).toBe(true); }, { interval: 10, timeout: 1000 });
  return observed;
};

beforeEach(() => { vi.useFakeTimers(); vi.spyOn(Math, 'random').mockReturnValue(0); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe.each(providers)('%s complete downloads', provider => {
  it.each([false, true])('bounds a stalled response, including partial bytes (%s), and exhausts exactly four fresh attempts', async prefix => {
    const cancel = vi.fn();
    const { target, signals } = targetFor(provider, () => stalled(cancel, prefix));
    const result = await settleTimers(target.download('a.md'));
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toContain('timed out');
    expect(signals).toHaveLength(4);
    expect(new Set(signals).size).toBe(4);
    expect(signals.every(s => s.aborted)).toBe(true);
    expect(cancel).toHaveBeenCalledTimes(4);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('discards a partial failed response and returns only the next complete response', async () => {
    const cancel = vi.fn(); let attempts = 0;
    const { target, signals } = targetFor(provider, () => ++attempts === 1 ? stalled(cancel, true) : new Response(new Uint8Array([1, 2, 3])));
    expect(await settleTimers(target.download('a.md'))).toEqual(new Uint8Array([1, 2, 3]));
    expect(signals).toHaveLength(2);
    expect(signals[0].aborted).toBe(true); expect(signals[1].aborted).toBe(false);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps a healthy stream alive beyond the base timeout while bytes continue arriving', async () => {
    const cancel = vi.fn();
    const { target, signals } = targetFor(provider, () => {
      let index = 0;
      return new Response(new ReadableStream<Uint8Array>({
        async pull(c) {
          if (index === 4) { c.close(); return; }
          await new Promise(resolve => setTimeout(resolve, 30));
          c.enqueue(new Uint8Array([++index]));
        }, cancel,
      }));
    });
    const began = Date.now();
    expect(await settleTimers(target.download('a.md'))).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(Date.now() - began).toBeGreaterThanOrEqual(120);
    expect(signals).toHaveLength(1); expect(signals[0].aborted).toBe(false);
    expect(cancel).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
});

describe('complete transfer lifetime', () => {
  it('keeps an uncertain actual WebDAV PUT in the queue instead of issuing another PUT', async () => {
    const cancel = vi.fn(); const { target, signals } = targetFor('WebDAV', () => stalled(cancel, true));
    const result = await settleTimers(target.push({ id: 1, file_path: 'a.md', operation: 'write', content: new Uint8Array([1]), retry_count: 0, next_retry_at: 0, queued_at: 0 }));
    expect(result).toBeInstanceOf(Error); expect(signals).toHaveLength(1); expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('preserves redirected URLs, headers, JSON bytes and clone metadata', async () => {
    const bytes = new TextEncoder().encode('{"title":"Grüße 東京"}');
    const source = new Response(new ReadableStream({ start(c) { c.enqueue(bytes.slice(0, 13)); c.enqueue(bytes.slice(13)); c.close(); } }), { headers: { ETag: 'etag' } });
    Object.defineProperty(source, 'url', { value: 'https://dav.example/redirected/' });
    Object.defineProperty(source, 'redirected', { value: true });
    const response = await fetchWithTransferTimeout(async () => source, 'https://dav.example/', {}, 50);
    const clone = response.clone();
    expect(response.url).toBe('https://dav.example/redirected/'); expect(clone.url).toBe(response.url);
    expect(clone.redirected).toBe(true); expect(response.headers.get('etag')).toBe('etag');
    expect(await response.json()).toEqual({ title: 'Grüße 東京' });
    expect(await clone.text()).toBe('{"title":"Grüße 東京"}');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not retry a write whose response stopped after the server may have committed it', async () => {
    const cancel = vi.fn(); let requests = 0;
    const result = await settleTimers(fetchWithRetry(() => fetchWithTransferTimeout(async () => { requests++; return stalled(cancel, true); }, 'https://server/', { method: 'PUT', body: 'x' }, 50), 'write'));
    expect(result).toBeInstanceOf(Error); expect(requests).toBe(1); expect(cancel).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops before headers even when the transport ignores its signal, and cancels a late body', async () => {
    let answer!: (response: Response) => void;
    const cancel = vi.fn(); const source = new Promise<Response>(resolve => { answer = resolve; });
    const pending = fetchWithTransferTimeout(() => source, 'https://server/', {}, 50);
    const result = await settleTimers(pending);
    expect(result).toBeInstanceOf(Error);
    answer(stalled(cancel)); await Promise.resolve(); await Promise.resolve();
    expect(cancel).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
  });

  it('removes its parent listener and does not repeat a cancelled read', async () => {
    const parent = new AbortController(); const removed = vi.spyOn(parent.signal, 'removeEventListener');
    const cancel = vi.fn(); let requests = 0;
    const pending = fetchWithRetry(() => fetchWithTransferTimeout(async () => { requests++; return stalled(cancel); }, 'https://server/', { signal: parent.signal }, 50), 'read').catch(e => e);
    await Promise.resolve(); await Promise.resolve();
    parent.abort('stopped');
    expect(await pending).toBeInstanceOf(TransferCancelledError);
    expect(requests).toBe(1); expect(cancel).toHaveBeenCalledTimes(1);
    expect(removed).toHaveBeenCalledWith('abort', expect.any(Function)); expect(vi.getTimerCount()).toBe(0);
  });

  it('removes all timers and its parent listener after an immediate success or fetch failure', async () => {
    for (const fail of [false, true]) {
      const parent = new AbortController(); const removed = vi.spyOn(parent.signal, 'removeEventListener');
      const result = await fetchWithTransferTimeout(async () => { if (fail) throw new Error('offline'); return new Response(null, { status: 204 }); }, 'https://server/', { signal: parent.signal }, 50).catch(e => e);
      if (fail) expect(result).toMatchObject({ message: 'offline' }); else expect(result.status).toBe(204);
      expect(removed).toHaveBeenCalledWith('abort', expect.any(Function)); expect(vi.getTimerCount()).toBe(0);
    }
  });

  it('does not let an empty chunk postpone the inactivity deadline', async () => {
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    const cancel = vi.fn();
    const pending = fetchWithTransferTimeout(async () => new Response(new ReadableStream({ start(c) { stream = c; }, cancel })), 'https://server/', {}, 50).catch(e => e);
    await vi.advanceTimersByTimeAsync(40); stream.enqueue(new Uint8Array());
    await vi.advanceTimersByTimeAsync(11);
    expect(await pending).toMatchObject({ name: 'AbortError' }); expect(cancel).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('retries a stalled Drive 403 body before classifying the next complete permission error', async () => {
    let requests = 0; const cancel = vi.fn();
    const { target } = targetFor('Drive', () => ++requests === 1 ? stalled(cancel, false, 403) : Response.json({ error: { errors: [{ reason: 'insufficientPermissions' }] } }, { status: 403 }));
    const result = await settleTimers(target.download('a.md'));
    expect((result as Error).message).toContain('insufficientPermissions');
    expect(requests).toBe(2); expect(cancel).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
  });
});
