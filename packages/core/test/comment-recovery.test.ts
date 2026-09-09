import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LocalVaultAdapter } from "../src/vault/LocalVaultAdapter.js";
import { BackupVaultAdapter } from "../src/vault/BackupVaultAdapter.js";
import { BundleCommentStore, type BundleCommentsMode } from "../src/comments/store.js";
import { CommentsSyncStep, appendLocalComment, appendLocalMoves, commentsDevicePath, readAllComments, readOwnComments, type CommentBundleFault, type CommentsCrypto } from "../src/comments/CommentsSyncStep.js";
import { emptyCommentsBundle, parseCommentsBundle, serializeCommentsBundle, type CommentsBundle, type LocalCommentRecord } from "../src/comments/commentsBundle.js";
import { COMMENTS_DEVICES_PATH, COMMENTS_SYNC_PATH } from "../src/settingsSync/paths.js";
import type { ISyncTarget, SyncOperation } from "../src/sync/ISyncTarget.js";

const NOW = "2026-09-09T10:00:00Z";
const id = (n: number) => n.toString(16).padStart(32, "0");
const own = commentsDevicePath("laptop", false);
const foreign = commentsDevicePath("phone", false);
const enc = new TextEncoder();
const dec = new TextDecoder();
const crypto: CommentsCrypto = { seal: (v) => v.map((n) => n ^ 91), open: (v) => v.map((n) => n ^ 91) };
const record = (n: number, device = "laptop"): LocalCommentRecord => ({
  commentId: id(n), path: "Note.md", authorDeviceId: device, body: "remark " + n,
  parentCommentId: null, resolvedCommentId: null, suggestionOutcome: null,
  anchor: null, suggestion: null, createdAt: NOW,
});
const bundle = (...records: LocalCommentRecord[]): CommentsBundle => ({
  ...emptyCommentsBundle(NOW), comments: Object.fromEntries(records.map((r) => [r.commentId, r])),
});
const bytes = (b: CommentsBundle) => enc.encode(serializeCommentsBundle(b));
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("durable comment files across stores, sync cycles and recovery", () => {
  let roots: string[];
  let raw: LocalVaultAdapter;
  let root: string;
  let remote: Map<string, Uint8Array>;
  let target: ISyncTarget;
  let writes: string[];
  beforeEach(async () => {
    roots = [];
    root = await mkdtemp(join(tmpdir(), "plainva-comment-recovery-"));
    roots.push(root);
    raw = new LocalVaultAdapter(root);
    await raw.initialize();
    remote = new Map();
    writes = [];
    target = {
      async download(path) { return remote.get(path) ?? null; },
      async push(op) {
        if (op.operation === "write" && op.content) { remote.set(op.file_path, op.content); writes.push(op.file_path); }
        if (op.operation === "delete") remote.delete(op.file_path);
      },
      async pull() { return { etagMap: new Map() }; },
    };
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    for (const path of roots) await rm(path, { recursive: true, force: true });
  });
  function store(mode: () => Promise<BundleCommentsMode> = async () => ({ kind: "plain" }), faults: CommentBundleFault[] = []) {
    // Two genuinely different wrappers, just like the surface and the worker.
    return new BundleCommentStore({
      vault: new BackupVaultAdapter(raw), vaultKey: root, deviceId: async () => "laptop",
      mode, now: () => NOW, authorName: async () => "Reviewer",
      faulted: (value) => faults.push(...value),
    });
  }
  function sync(sealed = false, faults: CommentBundleFault[] = []) {
    return new CommentsSyncStep({ deviceId: "laptop", vaultKey: root, crypto: sealed ? crypto : undefined, now: () => NOW, onFaults: (value) => faults.push(...value) })
      .run(target, new BackupVaultAdapter(raw));
  }
  async function local(sealed = false) {
    return parseCommentsBundle(sealed
      ? dec.decode(crypto.open(await raw.readBinaryFile(commentsDevicePath("laptop", true))))
      : await raw.readTextFile(own))!;
  }
  async function receiver() {
    const path = await mkdtemp(join(tmpdir(), "plainva-comment-recovery-"));
    roots.push(path);
    const vault = new LocalVaultAdapter(path);
    await vault.initialize();
    await new CommentsSyncStep({ deviceId: "receiver", vaultKey: path }).run(target, vault);
    return readAllComments(vault, "receiver", undefined, { vaultKey: path });
  }

  it("retains concurrent posts, author names and moves through different wrappers", async () => {
    const a = store(), b = store();
    await a.post({ path: "Note.md", body: "seed" });
    const move = { moveId: id(99), from: "Note.md", to: "Renamed.md", folder: false, deviceId: "laptop", at: NOW };
    await Promise.all([
      ...Array.from({ length: 20 }, (_, n) => (n % 2 ? a : b).post({ path: "Note.md", body: "parallel " + n })),
      appendLocalMoves(new BackupVaultAdapter(raw), [move], { deviceId: "laptop", vaultKey: root, now: NOW }),
    ]);
    const saved = await local();
    expect(Object.keys(saved.comments)).toHaveLength(21);
    expect(new Set(Object.values(saved.comments).map((r) => r.body)).size).toBe(21);
    expect(saved.authors.laptop.name).toBe("Reviewer");
    expect(saved.moves?.[id(99)]).toEqual(move);
  });

  it("rechecks a queued writer after the vault becomes locked", async () => {
    await raw.writeTextFile(own, serializeCommentsBundle(bundle(record(1))));
    let mode: BundleCommentsMode = { kind: "plain" };
    const active = store(async () => mode);
    const entered = deferred(), release = deferred();
    const read = raw.readTextFile.bind(raw);
    let paused = false;
    vi.spyOn(raw, "readTextFile").mockImplementation(async (path) => {
      const value = await read(path);
      if (path === own && !paused) { paused = true; entered.resolve(); await release.promise; }
      return value;
    });
    const first = active.post({ path: "Note.md", body: "already writing" });
    await entered.promise;
    const queued = active.post({ path: "Note.md", body: "must stay unsent" }).then(() => "written", (error: Error) => error.message);
    await new Promise<void>((done) => setImmediate(done));
    mode = { kind: "locked" };
    release.resolve();
    await first;
    expect(await queued).toBe("comment-store-locked");
    expect(Object.values((await local()).comments).map((r) => r.body)).not.toContain("must stay unsent");
  });

  it("lets a reply finish while a download waits and merges that reply before uploading", async () => {
    await store().post({ path: "Note.md", body: "before" });
    const entered = deferred(), release = deferred();
    const download = target.download.bind(target);
    vi.spyOn(target, "download").mockImplementation(async (path) => {
      if (path === own) { entered.resolve(); await release.promise; }
      return download(path);
    });
    const running = sync();
    await entered.promise;
    await store().post({ path: "Note.md", body: "during download" });
    expect(Object.values((await local()).comments).map((r) => r.body)).toContain("during download");
    release.resolve();
    await running;
    expect(Object.values(parseCommentsBundle(dec.decode(remote.get(own)!))!.comments).map((r) => r.body).sort()).toEqual(["before", "during download"]);
  });

  it("orders separate transport instances without blocking disk writes during an upload", async () => {
    await store().post({ path: "Note.md", body: "first" });
    const entered = deferred(), release = deferred();
    const push = target.push.bind(target);
    let uploads = 0;
    vi.spyOn(target, "push").mockImplementation(async (op: SyncOperation) => {
      if (op.file_path === own && ++uploads === 1) { entered.resolve(); await release.promise; }
      return push(op);
    });
    const first = sync();
    await entered.promise;
    await store().post({ path: "Note.md", body: "second" });
    const second = sync();
    await new Promise<void>((done) => setImmediate(done));
    expect(uploads).toBe(1);
    release.resolve();
    await Promise.all([first, second]);
    expect(Object.values(parseCommentsBundle(dec.decode(remote.get(own)!))!.comments).map((r) => r.body).sort()).toEqual(["first", "second"]);
  });

  it.each(["read", "write-backup", "verify-backup", "remove-source"] as const)("blocks replacement when %s fails and reports the actual failure", async (failure) => {
    await raw.writeTextFile(own, "{ irreplaceable damaged bytes");
    const faults: CommentBundleFault[] = [];
    const read = raw.readTextFile.bind(raw), write = raw.writeTextFile.bind(raw), remove = raw.deleteItem.bind(raw);
    if (failure === "read") vi.spyOn(raw, "readTextFile").mockImplementation(async (path) => { if (path === own) throw new Error("read denied"); return read(path); });
    if (failure === "write-backup") vi.spyOn(raw, "writeTextFile").mockImplementation(async (path, value) => { if (path.includes(".broken-")) throw new Error("backup denied"); return write(path, value); });
    if (failure === "verify-backup") vi.spyOn(raw, "readTextFile").mockImplementation(async (path) => path.includes(".broken-") ? "truncated backup" : read(path));
    if (failure === "remove-source") vi.spyOn(raw, "deleteItem").mockImplementation(async (path, recursive) => { if (path === own) throw new Error("remove denied"); return remove(path, recursive); });
    await expect(store(undefined, faults).post({ path: "Note.md", body: "new" })).rejects.toThrow();
    expect(await read(own)).toBe("{ irreplaceable damaged bytes");
    expect(faults).toContainEqual(expect.objectContaining({ path: own, reason: failure === "read" ? "bundle-read" : "bundle-backup" }));
    expect(faults.every((fault) => !fault.movedTo)).toBe(true);
    vi.restoreAllMocks();
    await store().post({ path: "Note.md", body: "after repair" });
    expect(Object.values((await local()).comments).map((r) => r.body)).toEqual(["after repair"]);
  });

  it("keeps earlier recovery copies and verifies the new one before removing the original", async () => {
    const firstBackup = own.replace(".json", ".broken-2026-09-09T10-00-00Z.json");
    await raw.writeTextFile(firstBackup, "earlier recovery");
    await raw.writeTextFile(own, "{ later recovery");
    const faults: CommentBundleFault[] = [];
    await readOwnComments(raw, "laptop", undefined, { faults, now: NOW, vaultKey: root });
    expect(await raw.readTextFile(firstBackup)).toBe("earlier recovery");
    expect(faults[0].movedTo).toContain("-1.json");
    expect(await raw.readTextFile(faults[0].movedTo!)).toBe("{ later recovery");
    expect(await raw.exists(own)).toBe(false);
  });

  it("lists healthy comments when a foreign file cannot be read and leaves its bytes untouched", async () => {
    await store().post({ path: "Note.md", body: "healthy" });
    await raw.writeTextFile(foreign, serializeCommentsBundle(bundle(record(2, "phone"))));
    const read = raw.readTextFile.bind(raw);
    vi.spyOn(raw, "readTextFile").mockImplementation(async (path) => { if (path === foreign) throw new Error("access denied"); return read(path); });
    const faults: CommentBundleFault[] = [];
    expect((await store(undefined, faults).list("Note.md")).map((r) => r.body)).toEqual(["healthy"]);
    expect(faults).toContainEqual(expect.objectContaining({ path: foreign, reason: "bundle-read" }));
    expect(parseCommentsBundle(await read(foreign))!.comments[id(2)]).toEqual(record(2, "phone"));
  });

  it.each(["missing", "empty", "older"] as const)("preserves received records when a remote mirror is %s and carries them to a new device", async (state) => {
    await raw.writeTextFile(foreign, serializeCommentsBundle(bundle(record(1, "phone"), record(2, "phone"))));
    if (state === "empty") remote.set(foreign, new Uint8Array());
    if (state === "older") remote.set(foreign, bytes(bundle(record(1, "phone"))));
    await sync();
    expect(Object.keys(parseCommentsBundle(await raw.readTextFile(foreign))!.comments).sort()).toEqual([id(1), id(2)]);
    expect(Object.keys((await receiver())!.comments).sort()).toEqual([id(1), id(2)]);
    expect(writes).not.toContain(foreign);
  });

  it("migrates a local-only legacy file including authors and moves to an empty target", async () => {
    const legacy = bundle(record(7, "old-device"));
    legacy.authors["old-device"] = { name: "Original author", updatedAt: NOW };
    legacy.moves = { [id(9)]: { moveId: id(9), from: "Note.md", to: "New.md", folder: false, deviceId: "old-device", at: NOW } };
    await raw.writeTextFile(COMMENTS_SYNC_PATH, serializeCommentsBundle(legacy));
    await sync();
    await sync();
    const received = (await receiver())!;
    expect(received.comments).toEqual(legacy.comments);
    expect(received.authors).toEqual(legacy.authors);
    expect(received.moves).toEqual(legacy.moves);
    expect(writes).not.toContain(COMMENTS_SYNC_PATH);
    expect(await raw.readTextFile(COMMENTS_SYNC_PATH)).toBe(serializeCommentsBundle(legacy));
  });

  it("reports a refused directory listing while still reading the known own file", async () => {
    await store().post({ path: "Note.md", body: "still readable" });
    vi.spyOn(raw, "listDir").mockRejectedValue(new Error("directory access denied"));
    const faults: CommentBundleFault[] = [];
    expect((await store(undefined, faults).list("Note.md")).map((r) => r.body)).toEqual(["still readable"]);
    expect(faults).toContainEqual(expect.objectContaining({ path: ".plainva/sync", reason: "bundle-read" }));
  });

  it.each(["corrupt", "empty"] as const)("keeps plaintext when the sealed destination is %s", async (state) => {
    await raw.writeTextFile(own, serializeCommentsBundle(bundle(record(1))));
    remote.set(own, bytes(bundle(record(2))));
    const sealedPath = commentsDevicePath("laptop", true);
    const original = state === "empty" ? new Uint8Array() : enc.encode("{ damaged");
    remote.set(sealedPath, original);
    await sync(true);
    expect(await raw.exists(own)).toBe(true);
    expect(remote.has(own)).toBe(true);
    expect(remote.get(sealedPath)).toBe(original);
    expect(Object.keys((await local(true)).comments).sort()).toEqual([id(1), id(2)]);
  });

  it.each(["upload-failed", "ack-without-readable-copy"] as const)("retains plaintext after %s", async (failure) => {
    await raw.writeTextFile(own, serializeCommentsBundle(bundle(record(1))));
    const push = target.push.bind(target);
    vi.spyOn(target, "push").mockImplementation(async (op) => {
      if (op.file_path === commentsDevicePath("laptop", true)) {
        if (failure === "upload-failed") throw new Error("offline");
        return;
      }
      return push(op);
    });
    if (failure === "upload-failed") await expect(sync(true)).rejects.toThrow("offline");
    else await sync(true);
    expect(await raw.exists(own)).toBe(true);
    expect(Object.keys((await local(true)).comments)).toEqual([id(1)]);
  });

  it("preserves a plaintext source changed during upload, then completes the fold on retry", async () => {
    await raw.writeTextFile(own, serializeCommentsBundle(bundle(record(1))));
    remote.set(own, bytes(bundle(record(1))));
    const push = target.push.bind(target);
    let changed = false;
    vi.spyOn(target, "push").mockImplementation(async (op) => {
      await push(op);
      if (op.file_path === commentsDevicePath("laptop", true) && !changed) {
        changed = true;
        await raw.writeTextFile(own, serializeCommentsBundle(bundle(record(1), record(2))));
        remote.set(own, bytes(bundle(record(1), record(2))));
      }
    });
    await sync(true);
    expect(await raw.exists(own)).toBe(true);
    expect(remote.has(own)).toBe(true);
    await sync(true);
    expect(await raw.exists(own)).toBe(false);
    expect(remote.has(own)).toBe(false);
    expect(Object.keys((await local(true)).comments).sort()).toEqual([id(1), id(2)]);
  });

  it("keeps an unreadable foreign local file when a healthy remote version arrives", async () => {
    await raw.writeTextFile(foreign, "{ local damaged original");
    remote.set(foreign, bytes(bundle(record(3, "phone"))));
    const faults: CommentBundleFault[] = [];
    await sync(false, faults);
    expect(await raw.readTextFile(foreign)).toBe("{ local damaged original");
    expect((await local()).comments[id(3)]).toEqual(record(3, "phone"));
    expect(faults).toContainEqual(expect.objectContaining({ path: foreign, reason: "bundle-json" }));
  });

  it("unions a migration on two devices without changing IDs or duplicating remarks", async () => {
    const secondRoot = await mkdtemp(join(tmpdir(), "plainva-comment-recovery-"));
    roots.push(secondRoot);
    const second = new LocalVaultAdapter(secondRoot);
    await second.initialize();
    const legacy = serializeCommentsBundle(bundle(record(4, "legacy")));
    await raw.writeTextFile(COMMENTS_SYNC_PATH, legacy);
    await second.writeTextFile(COMMENTS_SYNC_PATH, legacy);
    await appendLocalComment(raw, record(1), { deviceId: "laptop", vaultKey: root, now: NOW });
    await appendLocalComment(second, record(2, "phone"), { deviceId: "phone", vaultKey: secondRoot, now: NOW });
    const secondSync = () => new CommentsSyncStep({ deviceId: "phone", vaultKey: secondRoot }).run(target, second);
    await Promise.all([sync(), secondSync()]);
    for (let round = 0; round < 3; round++) { await sync(); await secondSync(); }
    for (const [vault, device] of [[raw, "laptop"], [second, "phone"]] as const) {
      expect(Object.keys((await readAllComments(vault, device, undefined))!.comments).sort()).toEqual([id(1), id(2), id(4)]);
    }
    const roster = JSON.parse(dec.decode(remote.get(COMMENTS_DEVICES_PATH)!));
    expect(Object.keys(roster.devices).sort()).toEqual(["laptop", "phone"]);
  });
});
