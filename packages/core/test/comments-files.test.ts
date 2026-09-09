import { describe, it, expect } from "vitest";
import {
  COMMENTS_DEVICES_PATH,
  COMMENTS_ENC_PATH,
  COMMENTS_SYNC_PATH,
  CommentsSyncStep,
  appendLocalComment,
  commentsDevicePath,
  listCommentsFiles,
  parseCommentDevicesRoster,
  parseCommentsBundle,
  parseCommentsFileName,
  readAllComments,
  readOwnComments,
  serializeCommentsBundle,
  type CommentBundleFault,
  type CommentsBundle,
  type CommentsCrypto,
  type IVaultAdapter,
  type ISyncTarget,
  type LocalCommentRecord,
  type PullResult,
  type PushResult,
  type SyncOperation,
} from "../src/index.js";

/**
 * One comment file per device (Nachschaerfung, N2).
 *
 * What these pin: the union over three devices' files, the legacy file read
 * but never written, a foreign file never written up or over, this device's
 * plaintext folded into its sealed file and dropped, the roster that lets the
 * sideband find the others, and a broken file - set aside when it is ours,
 * left exactly where it is when it is not.
 */

const NOW = "2026-09-07T10:00:00Z";
const ID = (n: number) => n.toString(16).padStart(2, "0").repeat(16);

function rec(over: Partial<LocalCommentRecord> = {}): LocalCommentRecord {
  return {
    commentId: ID(1),
    path: "Notes/Plan.md",
    parentCommentId: null,
    resolvedCommentId: null,
    suggestionOutcome: null,
    authorDeviceId: "laptop",
    body: "so far so good",
    anchor: null,
    suggestion: null,
    createdAt: NOW,
    ...over,
  };
}

function bundle(records: LocalCommentRecord[]): CommentsBundle {
  const comments: Record<string, LocalCommentRecord> = {};
  for (const record of records) comments[record.commentId] = record;
  return { format: "plainva-comments", version: 1, updatedAt: NOW, comments, authors: {} };
}

const text = (bundleValue: CommentsBundle) => new TextEncoder().encode(serializeCommentsBundle(bundleValue));

class FakeVault implements Partial<IVaultAdapter> {
  files = new Map<string, string>();
  bins = new Map<string, Uint8Array>();
  async exists(path: string) {
    return this.files.has(path) || this.bins.has(path);
  }
  async readTextFile(path: string) {
    const value = this.files.get(path);
    if (value === undefined) throw new Error("not found");
    return value;
  }
  async writeTextFile(path: string, content: string) {
    this.files.set(path, content);
  }
  async readBinaryFile(path: string) {
    const value = this.bins.get(path);
    if (value === undefined) throw new Error("not found");
    return value;
  }
  async writeBinaryFile(path: string, content: Uint8Array) {
    this.bins.set(path, content);
  }
  async deleteItem(path: string) {
    this.files.delete(path);
    this.bins.delete(path);
  }
  async renameItem(from: string, to: string) {
    if (this.files.has(from)) { this.files.set(to, this.files.get(from)!); this.files.delete(from); }
    if (this.bins.has(from)) { this.bins.set(to, this.bins.get(from)!); this.bins.delete(from); }
  }
  async listDir(dir: string) {
    const names = [...this.files.keys(), ...this.bins.keys()].filter((p) => p.startsWith(dir + "/")).map((p) => p.slice(dir.length + 1)).filter((n) => !n.includes("/"));
    return names.map((name) => ({ path: `${dir}/${name}`, name, isDirectory: false, size: 0, mtime: 0 }));
  }
  as(): IVaultAdapter {
    return this as unknown as IVaultAdapter;
  }
}

class FakeTarget implements Partial<ISyncTarget> {
  remote = new Map<string, Uint8Array>();
  writes: string[] = [];
  deletes: string[] = [];
  async download(path: string): Promise<Uint8Array | null> {
    return this.remote.get(path) ?? null;
  }
  async push(op: SyncOperation): Promise<PushResult | void> {
    if (op.operation === "write" && op.content) {
      this.writes.push(op.file_path);
      this.remote.set(op.file_path, op.content);
    } else if (op.operation === "delete") {
      this.deletes.push(op.file_path);
      this.remote.delete(op.file_path);
    }
  }
  async pull(): Promise<PullResult> {
    return { etagMap: new Map() };
  }
  as(): ISyncTarget {
    return this as unknown as ISyncTarget;
  }
}

const xorCrypto: CommentsCrypto = {
  seal: (plain) => plain.map((byte) => byte ^ 0x5a),
  open: (bytes) => bytes.map((byte) => byte ^ 0x5a),
};

const decodeText = (bytes: Uint8Array) => new TextDecoder().decode(bytes as BufferSource);
const LAPTOP = commentsDevicePath("laptop", false);
const PHONE = commentsDevicePath("phone", false);
const DESK = commentsDevicePath("desk", false);

describe("file names", () => {
  it("tells own, foreign, legacy, roster and set-aside files apart", () => {
    expect(parseCommentsFileName("comments.json")).toEqual({ deviceId: "legacy", sealed: false, legacy: true });
    expect(parseCommentsFileName("comments.enc")).toEqual({ deviceId: "legacy", sealed: true, legacy: true });
    expect(parseCommentsFileName("comments.4f3a-1.json")).toEqual({ deviceId: "4f3a-1", sealed: false, legacy: false });
    expect(parseCommentsFileName("comments.4f3a-1.enc")?.sealed).toBe(true);
    expect(parseCommentsFileName("comments.devices.json")).toBeNull();
    expect(parseCommentsFileName("comments.4f3a.broken-2026-09-07T10-00-00-000Z.json")).toBeNull();
    expect(parseCommentsFileName("settings.json")).toBeNull();
    // An id with characters a file name cannot carry is flattened alike everywhere.
    expect(commentsDevicePath("a/b:c", false)).toBe(".plainva/sync/comments.a_b_c.json");
  });
});

describe("reading the folder", () => {
  it("unites three devices' files and the legacy file, and writes only its own", async () => {
    const vault = new FakeVault();
    vault.files.set(PHONE, serializeCommentsBundle(bundle([rec({ commentId: ID(2), authorDeviceId: "phone", body: "from the phone" })])));
    vault.files.set(DESK, serializeCommentsBundle(bundle([rec({ commentId: ID(3), authorDeviceId: "desk", body: "from the desk" })])));
    vault.files.set(COMMENTS_SYNC_PATH, serializeCommentsBundle(bundle([rec({ commentId: ID(4), authorDeviceId: "old", body: "from before N2" })])));
    const foreignBefore = vault.files.get(PHONE);
    await appendLocalComment(vault.as(), rec(), { deviceId: "laptop", now: NOW });
    const all = await readAllComments(vault.as(), "laptop", undefined);
    expect(Object.keys(all!.comments).sort()).toEqual([ID(1), ID(2), ID(3), ID(4)]);
    expect((await listCommentsFiles(vault.as())).map((f) => f.deviceId).sort()).toEqual(["desk", "laptop", "legacy", "phone"]);
    // Nothing but the own file was touched.
    expect(vault.files.get(PHONE)).toBe(foreignBefore);
    expect(parseCommentsBundle(vault.files.get(COMMENTS_SYNC_PATH)!)!.comments[ID(1)]).toBeUndefined();
    expect(Object.keys(parseCommentsBundle(vault.files.get(LAPTOP)!)!.comments)).toEqual([ID(1)]);
  });

  it("finds the own file by name even when the folder cannot be listed", async () => {
    const vault = new FakeVault();
    vault.listDir = async () => { throw new Error("no listing here"); };
    await appendLocalComment(vault.as(), rec(), { deviceId: "laptop", now: NOW });
    expect(Object.keys((await readAllComments(vault.as(), "laptop", undefined))!.comments)).toEqual([ID(1)]);
  });

  it("skips sealed files it has no key for, and reads them once it has one", async () => {
    const vault = new FakeVault();
    vault.bins.set(commentsDevicePath("phone", true), xorCrypto.seal(text(bundle([rec({ commentId: ID(2), authorDeviceId: "phone" })]))));
    expect(await readAllComments(vault.as(), "laptop", undefined)).toBeNull();
    expect(Object.keys((await readAllComments(vault.as(), "laptop", xorCrypto))!.comments)).toEqual([ID(2)]);
  });

  it("sets its own broken file aside byte for byte and keeps writing; a foreign broken file stays put", async () => {
    const vault = new FakeVault();
    vault.files.set(LAPTOP, "{ not json");
    vault.files.set(PHONE, '{"format":"plainva-comments","version":9}');
    const faults: CommentBundleFault[] = [];
    expect(await readOwnComments(vault.as(), "laptop", undefined, { faults, now: NOW })).toBeNull();
    expect(vault.files.has(LAPTOP)).toBe(false);
    const aside = [...vault.files.keys()].find((p) => p.includes(".broken-"))!;
    expect(aside).toMatch(/^\.plainva\/sync\/comments\.laptop\.broken-2026-09-07T10-00-00Z\.json$/);
    expect(vault.files.get(aside)).toBe("{ not json");
    expect(faults).toEqual([{ path: LAPTOP, reason: "bundle-json", message: expect.stringContaining("JSON"), movedTo: aside }]);
    // The device can write again, and the foreign file is reported, not touched.
    faults.length = 0;
    await appendLocalComment(vault.as(), rec(), { deviceId: "laptop", now: NOW, faults });
    const all = await readAllComments(vault.as(), "laptop", undefined, { faults });
    expect(Object.keys(all!.comments)).toEqual([ID(1)]);
    expect(vault.files.get(PHONE)).toBe('{"format":"plainva-comments","version":9}');
    expect(faults.some((f) => f.path === PHONE && f.reason === "bundle-version")).toBe(true);
    expect((await listCommentsFiles(vault.as())).map((f) => f.path)).not.toContain(aside);
  });
});

describe("CommentsSyncStep (one file per device)", () => {
  const now = () => NOW;
  const step = (deviceId: string, crypto?: CommentsCrypto, onFaults?: (f: CommentBundleFault[]) => void) => new CommentsSyncStep({ deviceId, crypto, now, onFaults });

  it("does nothing at all for a vault without comments, here or there", async () => {
    const vault = new FakeVault();
    const target = new FakeTarget();
    await step("laptop").run(target.as(), vault.as());
    expect(target.writes).toEqual([]);
    expect(vault.files.size).toBe(0);
  });

  it("carries its own file up, announces itself, and mirrors the others down without ever writing them up", async () => {
    const vault = new FakeVault();
    const target = new FakeTarget();
    await appendLocalComment(vault.as(), rec(), { deviceId: "laptop", now: NOW });
    const phoneFile = text(bundle([rec({ commentId: ID(2), authorDeviceId: "phone", body: "from the phone" })]));
    target.remote.set(PHONE, phoneFile);
    target.remote.set(COMMENTS_DEVICES_PATH, new TextEncoder().encode(JSON.stringify({ format: "plainva-comment-devices", version: 1, devices: { phone: { updatedAt: NOW } } })));

    await step("laptop").run(target.as(), vault.as());

    expect(target.writes).toEqual([LAPTOP, COMMENTS_DEVICES_PATH]);
    expect(Object.keys(parseCommentDevicesRoster(decodeText(target.remote.get(COMMENTS_DEVICES_PATH)!))!.devices).sort()).toEqual(["laptop", "phone"]);
    expect(vault.files.get(PHONE)).toBe(decodeText(phoneFile));
    expect(Object.keys((await readAllComments(vault.as(), "laptop", undefined))!.comments).sort()).toEqual([ID(1), ID(2)]);
    // A second cycle with nothing new writes nothing.
    const writes = target.writes.length;
    await step("laptop").run(target.as(), vault.as());
    expect(target.writes.length).toBe(writes);
  });

  it("brings a device into the roster that only the remote knew, over three cycles on three devices", async () => {
    // Three vaults, one target: every device sees the two others after
    // everybody ran once more - and no device ever wrote a file that is not
    // its own.
    const target = new FakeTarget();
    const vaults = { laptop: new FakeVault(), phone: new FakeVault(), desk: new FakeVault() };
    for (const [device, vault] of Object.entries(vaults)) await appendLocalComment(vault.as(), rec({ commentId: ID(Number(device.length)), authorDeviceId: device, body: device }), { deviceId: device, now: NOW });
    for (let round = 0; round < 2; round += 1) for (const [device, vault] of Object.entries(vaults)) await step(device).run(target.as(), vault.as());
    for (const [device, vault] of Object.entries(vaults)) {
      const all = await readAllComments(vault.as(), device, undefined);
      expect(Object.values(all!.comments).map((c) => c.body).sort()).toEqual(["desk", "laptop", "phone"]);
    }
    expect([...new Set(target.writes.filter((p) => p !== COMMENTS_DEVICES_PATH))].sort()).toEqual([DESK, LAPTOP, PHONE]);
    // Recovery records travel in each device's own file. Once all devices
    // hold that union, repeated cycles stop writing again.
    const writes = target.writes.length;
    for (const [device, vault] of Object.entries(vaults)) await step(device).run(target.as(), vault.as());
    expect(target.writes.length).toBe(writes);
  });

  it("reads the legacy file forever and never writes it", async () => {
    const vault = new FakeVault();
    const target = new FakeTarget();
    const legacy = text(bundle([rec({ commentId: ID(4), authorDeviceId: "old", body: "from before N2" })]));
    target.remote.set(COMMENTS_SYNC_PATH, legacy);
    await appendLocalComment(vault.as(), rec(), { deviceId: "laptop", now: NOW });
    await step("laptop").run(target.as(), vault.as());
    expect(target.remote.get(COMMENTS_SYNC_PATH)).toBe(legacy);
    expect(target.writes).not.toContain(COMMENTS_SYNC_PATH);
    expect(vault.files.get(COMMENTS_SYNC_PATH)).toBe(decodeText(legacy));
    expect(Object.keys((await readAllComments(vault.as(), "laptop", undefined))!.comments).sort()).toEqual([ID(1), ID(4)]);
  });

  it("folds its own plaintext and the legacy plaintext into its sealed file, then drops both - and leaves a foreign plaintext alone", async () => {
    const vault = new FakeVault();
    const target = new FakeTarget();
    // Written before the passphrase: the own plaintext file, here and there.
    await appendLocalComment(vault.as(), rec(), { deviceId: "laptop", now: NOW });
    target.remote.set(LAPTOP, text(bundle([rec({ commentId: ID(5), body: "own, uploaded earlier" })])));
    target.remote.set(COMMENTS_SYNC_PATH, text(bundle([rec({ commentId: ID(4), authorDeviceId: "old", body: "legacy plaintext" })])));
    const foreign = text(bundle([rec({ commentId: ID(2), authorDeviceId: "phone", body: "phone, still plain" })]));
    target.remote.set(PHONE, foreign);
    target.remote.set(COMMENTS_DEVICES_PATH, new TextEncoder().encode(JSON.stringify({ format: "plainva-comment-devices", version: 1, devices: { phone: { updatedAt: NOW } } })));

    await step("laptop", xorCrypto).run(target.as(), vault.as());

    const sealedPath = commentsDevicePath("laptop", true);
    const own = parseCommentsBundle(decodeText(xorCrypto.open(target.remote.get(sealedPath)!)))!;
    expect(Object.keys(own.comments).sort()).toEqual([ID(1), ID(2), ID(4), ID(5)]);
    expect(target.deletes.sort()).toEqual([LAPTOP, COMMENTS_SYNC_PATH].sort());
    expect(vault.files.has(LAPTOP)).toBe(false);
    expect(vault.files.has(COMMENTS_SYNC_PATH)).toBe(false);
    // The phone controls its remote plaintext. Here its records are already
    // inside the sealed file, so no new plaintext mirror is written.
    expect(target.remote.get(PHONE)).toBe(foreign);
    expect(vault.files.has(PHONE)).toBe(false);
    expect(Object.keys((await readAllComments(vault.as(), "laptop", xorCrypto))!.comments).sort()).toEqual([ID(1), ID(2), ID(4), ID(5)]);
  });

  it("preserves received comments when a foreign file is absent remotely", async () => {
    const vault = new FakeVault();
    const target = new FakeTarget();
    await appendLocalComment(vault.as(), rec(), { deviceId: "laptop", now: NOW });
    vault.files.set(PHONE, serializeCommentsBundle(bundle([rec({ commentId: ID(2), authorDeviceId: "phone" })])));
    vault.files.set(COMMENTS_DEVICES_PATH, JSON.stringify({ format: "plainva-comment-devices", version: 1, devices: { phone: { updatedAt: NOW } } }));
    await step("laptop").run(target.as(), vault.as());
    expect(vault.files.has(PHONE)).toBe(true);
    expect(Object.keys(parseCommentsBundle(decodeText(target.remote.get(LAPTOP)!))!.comments).sort()).toEqual([ID(1), ID(2)]);
  });

  it("never overwrites a file it cannot read: a broken foreign remote leaves the local mirror, a broken own remote holds the upload", async () => {
    const vault = new FakeVault();
    const target = new FakeTarget();
    const faults: CommentBundleFault[] = [];
    await appendLocalComment(vault.as(), rec(), { deviceId: "laptop", now: NOW });
    const good = serializeCommentsBundle(bundle([rec({ commentId: ID(2), authorDeviceId: "phone" })]));
    vault.files.set(PHONE, good);
    target.remote.set(PHONE, new TextEncoder().encode("{ broken on the way"));
    target.remote.set(COMMENTS_DEVICES_PATH, new TextEncoder().encode(JSON.stringify({ format: "plainva-comment-devices", version: 1, devices: { phone: { updatedAt: NOW } } })));
    target.remote.set(LAPTOP, new Uint8Array([1, 2, 3]));
    await step("laptop", undefined, (f) => faults.push(...f)).run(target.as(), vault.as());
    expect(vault.files.get(PHONE)).toBe(good);
    expect(target.remote.get(PHONE)).toEqual(new TextEncoder().encode("{ broken on the way"));
    expect(target.remote.get(LAPTOP)).toEqual(new Uint8Array([1, 2, 3]));
    expect(faults.map((f) => [f.path, f.reason]).sort()).toEqual([[`remote:${LAPTOP}`, "bundle-json"], [`remote:${PHONE}`, "bundle-json"]].sort());
  });

  it("on the wrong key, leaves a sealed remote exactly as it was", async () => {
    const vault = new FakeVault();
    const target = new FakeTarget();
    const faults: CommentBundleFault[] = [];
    const sealedPath = commentsDevicePath("laptop", true);
    target.remote.set(sealedPath, new Uint8Array([1, 2, 3]));
    target.remote.set(COMMENTS_ENC_PATH, new Uint8Array([4, 5, 6]));
    const angry: CommentsCrypto = { seal: (p) => p, open: () => { throw new Error("wrong key"); } };
    await appendLocalComment(vault.as(), rec(), { deviceId: "laptop", crypto: angry, now: NOW });
    await step("laptop", angry, (f) => faults.push(...f)).run(target.as(), vault.as());
    expect(target.remote.get(sealedPath)).toEqual(new Uint8Array([1, 2, 3]));
    expect(target.remote.get(COMMENTS_ENC_PATH)).toEqual(new Uint8Array([4, 5, 6]));
    expect(faults.map((f) => f.reason)).toContain("bundle-sealed");
  });
});
