import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LocalVaultAdapter } from '../src/vault/LocalVaultAdapter.js';
import { BundleCommentStore, type BundleCommentsMode } from '../src/comments/store.js';
import { CommentsSyncStep, commentsDevicePath, type CommentBundleFault, type CommentsCrypto } from '../src/comments/CommentsSyncStep.js';
import { emptyCommentsBundle, parseCommentsBundle, serializeCommentsBundle, type LocalCommentRecord } from '../src/comments/commentsBundle.js';
import { persistCommentMoves } from '../src/comments/commentMoveJournal.js';
import type { ISyncTarget } from '../src/sync/ISyncTarget.js';
import { COMMENTS_DEVICES_PATH } from '../src/settingsSync/paths.js';

const BEFORE = '2026-09-10T10:00:00.000Z';
const MOVED = '2026-09-10T10:01:00.000Z';
const AFTER = '2026-09-10T10:02:00.000Z';
const id = (n: number) => n.toString(16).padStart(32, '0');
const own = commentsDevicePath('local', false);
const crypto: CommentsCrypto = { seal: b => b.map(v => v ^ 91), open: b => b.map(v => v ^ 91) };
const record = (n: number, createdAt = BEFORE, path = 'A.md'): LocalCommentRecord => ({
  commentId: id(n), path, createdAt, body: `remark ${n}`, authorDeviceId: 'remote',
  parentCommentId: null, resolvedCommentId: null, suggestionOutcome: null, anchor: null, suggestion: null,
});
const bundleText = (...records: LocalCommentRecord[]) => serializeCommentsBundle({
  ...emptyCommentsBundle(AFTER), comments: Object.fromEntries(records.map(r => [r.commentId, r])),
});

describe('durable comment moves before history arrives', () => {
  let root: string;
  let vault: LocalVaultAdapter;
  let faults: CommentBundleFault[];
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'plainva-move-journal-'));
    vault = new LocalVaultAdapter(root); await vault.initialize(); faults = [];
  });
  afterEach(async () => { vi.restoreAllMocks(); await rm(root, { recursive: true, force: true }); });
  const store = (mode: BundleCommentsMode = { kind: 'plain' }, now = MOVED, adapter = vault) => new BundleCommentStore({
    vault: adapter, vaultKey: root, mode: async () => mode, deviceId: async () => 'local', now: () => now,
    faulted: values => faults.push(...values),
  });
  const journals = async () => (await vault.listDir('.plainva', false)).filter(f => f.name.startsWith('comment-moves.')).map(f => f.path);
  async function rename(from = 'A.md', to = 'B.md', mode: BundleCommentsMode = { kind: 'plain' }) {
    await vault.writeTextFile(from, 'the actual note');
    await vault.renameItem(from, to);
    await store(mode).recordMoves([{ from, to }]);
  }

  it('reopens without history, routes late old remarks, and keeps a newly reused filename separate', async () => {
    await rename();
    const saved = await vault.readTextFile((await journals())[0]);
    const reopened = new LocalVaultAdapter(root); await reopened.initialize();
    await reopened.writeTextFile('A.md', 'new note using the old filename');
    await reopened.writeTextFile(commentsDevicePath('remote', false), bundleText(record(1), record(2, AFTER)));
    const next = store({ kind: 'plain' }, AFTER, reopened);
    expect((await next.list('B.md')).map(r => r.body)).toEqual(['remark 1']);
    expect((await next.list('A.md')).map(r => r.body)).toEqual(['remark 2']);
    expect((await next.legacySnapshot())?.bundle.moves).toEqual(parseCommentsBundle(saved)!.moves);
    expect(await vault.readTextFile((await journals())[0])).toBe(saved);
  });

  it('replays a locked rename through sealed sync after restart without opening a comment view', async () => {
    await rename('A.md', 'B.md', { kind: 'locked' });
    expect(await vault.exists(own)).toBe(false);
    const proof = await vault.readTextFile((await journals())[0]);
    const journal = parseCommentsBundle(proof)!;
    expect(journal.comments).toEqual({}); expect(journal.authors).toEqual({});
    const remote = new Map<string, Uint8Array>(); const pushed: string[] = [];
    remote.set(COMMENTS_DEVICES_PATH, new TextEncoder().encode(JSON.stringify({ format: 'plainva-comment-devices', version: 1, devices: { remote: { updatedAt: BEFORE } } })));
    remote.set(commentsDevicePath('remote', true), crypto.seal(new TextEncoder().encode(bundleText(record(1)))));
    const target: ISyncTarget = {
      async download(path) { return remote.get(path) ?? null; },
      async push(op) { pushed.push(op.file_path); if (op.operation === 'write' && op.content) remote.set(op.file_path, op.content); },
      async pull() { return { etagMap: new Map() }; },
    };
    const reopened = new LocalVaultAdapter(root); await reopened.initialize();
    await new CommentsSyncStep({ deviceId: 'local', vaultKey: root, crypto, now: () => AFTER }).run(target, reopened);
    const uploaded = parseCommentsBundle(new TextDecoder().decode(crypto.open(remote.get(commentsDevicePath('local', true))!)))!;
    expect(uploaded.moves).toEqual(journal.moves);
    expect(uploaded.comments[id(1)].body).toBe('remark 1');
    expect(pushed).toEqual(expect.arrayContaining([commentsDevicePath('local', true)]));
    expect(pushed.every(p => p === COMMENTS_DEVICES_PATH || p.endsWith('.enc'))).toBe(true);
    expect(await vault.exists(own)).toBe(false);
    expect((await store({ kind: 'sealed', crypto }, AFTER, reopened).list('B.md')).map(r => r.body)).toEqual(['remark 1']);
    expect(await vault.readTextFile((await journals())[0])).toBe(proof);
  });

  it('retains a rename when a broken own bundle cannot be backed up, and recovers on retry', async () => {
    await vault.writeTextFile(own, '{ broken history');
    const write = vault.writeTextFile.bind(vault);
    const fault = vi.spyOn(vault, 'writeTextFile').mockImplementation(async (path, text) => {
      if (path.includes('.broken-')) throw new Error('backup refused'); return write(path, text);
    });
    await expect(rename()).rejects.toThrow('backup refused');
    const saved = await vault.readTextFile((await journals())[0]);
    expect(await vault.readTextFile(own)).toBe('{ broken history');
    await write(commentsDevicePath('remote', false), bundleText(record(1)));
    expect((await store().list('B.md')).map(r => r.body)).toEqual(['remark 1']);
    fault.mockRestore();
    const next = store(); await next.post({ path: 'B.md', body: 'after recovery' });
    expect((await next.list('B.md')).map(r => r.body)).toEqual(expect.arrayContaining(['remark 1', 'after recovery']));
    expect(await vault.readTextFile((await journals())[0])).toBe(saved);
    expect(faults.some(f => f.reason === 'bundle-backup')).toBe(true);
  });

  it('preserves earlier batches when an external writer acknowledges a truncated new journal', async () => {
    await rename();
    const first = (await journals())[0]; const saved = await vault.readTextFile(first);
    const write = vault.writeTextFile.bind(vault);
    vi.spyOn(vault, 'writeTextFile').mockImplementation(async (path, text) => write(path, path.includes('comment-moves.') ? text.slice(0, 15) : text));
    await expect(store().recordMoves([{ from: 'B.md', to: 'C.md' }])).rejects.toThrow('could not be verified');
    const files = await journals(); expect(files).toHaveLength(2);
    expect(await vault.readTextFile(first)).toBe(saved);
    await write(commentsDevicePath('remote', false), bundleText(record(1)));
    expect((await store().list('B.md')).map(r => r.body)).toEqual(['remark 1']);
    expect(faults.some(f => f.path !== first && f.reason === 'bundle-schema')).toBe(true);
  });

  it('recovers all local markers after the transport bundle is lost, including a folder chain', async () => {
    await vault.writeTextFile('Final/Note.md', 'note');
    await store({ kind: 'locked' }).recordMoves([{ from: 'Old', to: 'Middle', folder: true }]);
    await store({ kind: 'locked' }, AFTER).recordMoves([{ from: 'Middle', to: 'Final', folder: true }]);
    await vault.writeTextFile(own, bundleText());
    await vault.writeTextFile(commentsDevicePath('remote', false), bundleText(record(1, BEFORE, 'Old/Note.md')));
    const reopened = store({ kind: 'plain' }, AFTER);
    expect((await reopened.list('Final/Note.md')).map(r => r.body)).toEqual(['remark 1']);
    expect(Object.keys((await reopened.legacySnapshot())!.bundle.moves!)).toHaveLength(2);
  });

  it('keeps concurrent batches from separate store instances and replays them idempotently', async () => {
    const other = new LocalVaultAdapter(root); await other.initialize();
    await Promise.all([
      store({ kind: 'locked' }).recordMoves([{ from: 'A.md', to: 'B.md' }]),
      store({ kind: 'locked' }, AFTER, other).recordMoves([{ from: 'B.md', to: 'C.md' }]),
    ]);
    const paths = await journals(); expect(paths).toHaveLength(2);
    const proof = parseCommentsBundle(await vault.readTextFile(paths[0]))!;
    await persistCommentMoves(vault, Object.values(proof.moves!), { deviceId: 'local', vaultKey: root, now: proof.updatedAt });
    expect(await journals()).toHaveLength(2);
    await vault.writeTextFile('C.md', 'note');
    await vault.writeTextFile(commentsDevicePath('remote', false), bundleText(record(1)));
    expect((await store().list('C.md')).map(r => r.body)).toEqual(['remark 1']);
  });

  it('captures time before awaiting device identity and preserves a forwarded event timestamp', async () => {
    let release!: () => void; const waiting = new Promise<void>(resolve => { release = resolve; });
    let now = MOVED;
    const delayed = new BundleCommentStore({ vault, mode: async () => ({ kind: 'locked' }), now: () => now,
      deviceId: async () => { await waiting; return 'local'; },
    });
    const work = delayed.recordMoves([{ from: 'A.md', to: 'B.md' }, { from: 'X.md', to: 'Y.md', at: BEFORE }]);
    now = AFTER; release(); await work;
    const moves = Object.values(parseCommentsBundle(await vault.readTextFile((await journals())[0]))!.moves!);
    expect(moves.find(m => m.from === 'A.md')!.at).toBe(MOVED);
    expect(moves.find(m => m.from === 'X.md')!.at).toBe(BEFORE);
  });

  it('reports a refused journal listing without removing any recovery proof', async () => {
    await rename(); const path = (await journals())[0]; const saved = await vault.readTextFile(path);
    const list = vault.listDir.bind(vault);
    vi.spyOn(vault, 'listDir').mockImplementation(async (dir, recursive) => {
      if (dir === '.plainva') throw new Error('listing refused'); return list(dir, recursive);
    });
    await store().listAll();
    expect(faults).toContainEqual({ path: '.plainva', reason: 'bundle-read', message: 'listing refused' });
    expect(await vault.readTextFile(path)).toBe(saved);
  });
});
