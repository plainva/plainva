import { describe, it, expect } from "vitest";
import {
  BUNDLE_COMMENT_CAPABILITIES,
  BundleCommentStore,
  CommentStoreLockedError,
  commentsDevicePath,
  mergeCommentsBundles,
  parseCommentsBundle,
  resolveCommentPath,
  serializeCommentsBundle,
  type LocalMoveRecord,
  type BundleCommentsMode,
  type CommentsCrypto,
  type IVaultAdapter,
} from "../src/index.js";

/**
 * The open store behind the shared `CommentStore` contract (Nachschaerfung, N0).
 *
 * What this pins: the record a post writes, the state a locked device reports
 * instead of an empty list, the named author the KI harness will use, and
 * that retry/discard are typed non-operations rather than missing branches.
 */

const NOW = "2026-09-07T10:00:00Z";

const OWN_PLAIN = commentsDevicePath("laptop", false);
const OWN_SEALED = commentsDevicePath("laptop", true);

class FakeVault implements Partial<IVaultAdapter> {
  files = new Map<string, string>();
  bins = new Map<string, Uint8Array>();
  async exists(path: string) {
    return this.files.has(path) || this.bins.has(path);
  }
  async listDir(dir: string) {
    const names = [...this.files.keys(), ...this.bins.keys()].filter((p) => p.startsWith(dir + "/")).map((p) => p.slice(dir.length + 1)).filter((n) => !n.includes("/"));
    return names.map((name) => ({ path: `${dir}/${name}`, name, isDirectory: false, size: 0, mtime: 0 }));
  }
  async renameItem(from: string, to: string) {
    if (this.files.has(from)) { this.files.set(to, this.files.get(from)!); this.files.delete(from); }
    if (this.bins.has(from)) { this.bins.set(to, this.bins.get(from)!); this.bins.delete(from); }
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
}

const xorCrypto: CommentsCrypto = {
  seal: (plain) => plain.map((byte) => byte ^ 0x5a),
  open: (bytes) => bytes.map((byte) => byte ^ 0x5a),
};

function storeFor(vault: FakeVault, mode: BundleCommentsMode, extra: { authorName?: string; written?: (path: string) => void } = {}) {
  return new BundleCommentStore({
    vault: vault as unknown as IVaultAdapter,
    deviceId: async () => "laptop",
    mode: async () => mode,
    authorName: async () => extra.authorName,
    written: extra.written,
    now: () => NOW,
  });
}

describe("BundleCommentStore", () => {
  it("grants the plain-vault set and reports its mode", async () => {
    const store = storeFor(new FakeVault(), { kind: "plain" });
    expect(await store.capabilities()).toEqual([...BUNDLE_COMMENT_CAPABILITIES]);
    expect(await store.state()).toEqual({ mode: "plain", hasOutbox: false });
    expect(await store.selfId()).toBe("laptop");
  });

  it("writes a record to disk at once, signed with the reviewer name, and says so", async () => {
    const vault = new FakeVault();
    const written: string[] = [];
    const store = storeFor(vault, { kind: "plain" }, { authorName: "Marco", written: (path) => written.push(path) });
    await store.post({ path: "Notes/Plan.md", body: "so far so good" });
    const list = await store.list("Notes/Plan.md");
    expect(list).toHaveLength(1);
    expect(list[0].body).toBe("so far so good");
    // The byline and "is this mine?" read the same field.
    expect(list[0].authorMemberId).toBe(await store.selfId());
    expect((await store.authors()).get("laptop")).toBe("Marco");
    expect(written).toEqual(["Notes/Plan.md"]);
    expect(vault.files.has(OWN_PLAIN)).toBe(true);
  });

  it("seals when a key is present", async () => {
    const vault = new FakeVault();
    const store = storeFor(vault, { kind: "sealed", crypto: xorCrypto });
    await store.post({ path: "Notes/Plan.md", body: "secret remark" });
    expect(vault.files.has(OWN_PLAIN)).toBe(false);
    expect(new TextDecoder().decode(vault.bins.get(OWN_SEALED)!)).not.toContain("secret remark");
    expect((await store.list("Notes/Plan.md")).map((c) => c.body)).toEqual(["secret remark"]);
  });

  it("answers `locked` as a state, lists nothing and refuses to write", async () => {
    // A locked device must not write a plaintext bundle beside the sealed one
    // (D4). Before N3 the surface saw only the empty list; the state is what
    // lets it explain itself instead.
    const vault = new FakeVault();
    const store = storeFor(vault, { kind: "locked" });
    expect((await store.state()).mode).toBe("locked");
    expect(await store.list("Notes/Plan.md")).toEqual([]);
    expect((await store.listAll()).size).toBe(0);
    await expect(store.post({ path: "Notes/Plan.md", body: "x" })).rejects.toBeInstanceOf(CommentStoreLockedError);
    expect(vault.files.size).toBe(0);
    expect(vault.bins.size).toBe(0);
  });

  it("carries a named author in front of the device that wrote for it", async () => {
    // The KI harness (v4) posts as `plainva-ai/<model>`. The record still names
    // the device as its writer, so the person can retract it (K7 judges by
    // device), while the byline and the name map show the assistant.
    const vault = new FakeVault();
    const store = storeFor(vault, { kind: "plain" }, { authorName: "Marco" });
    await store.post({ path: "Notes/Plan.md", body: "", anchor: { markerId: "ab12", quote: "old", before: "", after: "", approximateOffset: 0 }, suggestion: { replacement: "new" }, author: { id: "plainva-ai/gemma-4", displayName: "Gemma 4" } });
    const [record] = await store.list("Notes/Plan.md");
    expect(record.authorMemberId).toBe("plainva-ai/gemma-4");
    expect(record.authorDeviceId).toBe("laptop");
    expect((await store.authors()).get("plainva-ai/gemma-4")).toBe("Gemma 4");
    const raw = parseCommentsBundle(vault.files.get(OWN_PLAIN)!)!;
    expect(Object.values(raw.comments)[0].authorId).toBe("plainva-ai/gemma-4");
    // ...and the person retracts it from their own device.
    await store.post({ path: "Notes/Plan.md", body: "", retractsCommentId: record.commentId });
    expect(await store.list("Notes/Plan.md")).toEqual([]);
  });

  it("treats retry and discard as non-operations: nothing is ever pending here", async () => {
    const store = storeFor(new FakeVault(), { kind: "plain" });
    await expect(store.retry()).resolves.toBeUndefined();
    await expect(store.discard()).resolves.toBeUndefined();
  });

  it("groups the vault-wide list by note and keeps a round's fields", async () => {
    const store = storeFor(new FakeVault(), { kind: "plain" });
    await store.post({ path: "A.md", body: "one" });
    await store.post({ path: "B.md", body: "", anchor: { markerId: "7f3a", quote: "x", before: "", after: "", approximateOffset: 0 }, suggestion: { replacement: "y" }, batch: { batchId: "cd".repeat(16), index: 2, note: "tidy" } });
    const all = await store.listAll();
    expect([...all.keys()].sort()).toEqual(["A.md", "B.md"]);
    const proposal = all.get("B.md")![0];
    expect(proposal.suggestionBatchId).toBe("cd".repeat(16));
    expect(proposal.batchIndex).toBe(2);
    expect(proposal.batchNote).toBe("tidy");
  });
});

/**
 * A renamed note keeps its remarks (Nachschaerfung, N1).
 *
 * Records stay immutable; the move is its own record, and the reader follows
 * the chain. What these pin is the walk: chains, a rename and back, a freed
 * name reused by a new note, a device that remarked under the old name after
 * the rename, and two devices renaming the same note differently.
 */
describe("move markers", () => {
  const move = (over: Partial<LocalMoveRecord>): LocalMoveRecord => ({ moveId: "ab".repeat(16), from: "A.md", to: "B.md", folder: false, deviceId: "laptop", at: "2026-09-07T11:00:00Z", ...over });
  const T0 = "2026-09-07T10:00:00Z";
  const T1 = "2026-09-07T11:00:00Z";
  const T2 = "2026-09-07T12:00:00Z";
  const T3 = "2026-09-07T13:00:00Z";
  const sorted = (moves: LocalMoveRecord[]) => moves.sort((a, b) => (a.at === b.at ? a.moveId.localeCompare(b.moveId) : a.at.localeCompare(b.at)));

  it("follows a chain and a rename-and-back", () => {
    const chain = sorted([move({ moveId: "01".repeat(16), from: "A.md", to: "B.md", at: T1 }), move({ moveId: "02".repeat(16), from: "B.md", to: "C.md", at: T2 })]);
    expect(resolveCommentPath(chain, "A.md", T0)).toBe("C.md");
    const back = sorted([move({ moveId: "01".repeat(16), from: "A.md", to: "B.md", at: T1 }), move({ moveId: "02".repeat(16), from: "B.md", to: "A.md", at: T2 })]);
    expect(resolveCommentPath(back, "A.md", T0)).toBe("A.md");
  });

  it("leaves a note that reuses a freed name alone", () => {
    // A.md was renamed at T1; a NEW A.md was written at T2 and remarked on at
    // T3. That remark belongs to the new note, not to the old one's move.
    const moves = sorted([move({ moveId: "01".repeat(16), from: "A.md", to: "B.md", at: T1 })]);
    expect(resolveCommentPath(moves, "A.md", T3)).toBe("A.md");
  });

  it("carries a late remark along once the old name has no file - and not while it has one", () => {
    const moves = sorted([move({ moveId: "01".repeat(16), from: "A.md", to: "B.md", at: T1 }), move({ moveId: "02".repeat(16), from: "B.md", to: "C.md", at: T3 })]);
    // Remarked at T2 under A.md by a device that had not seen the rename. The
    // data reads like a reused name; only the missing file tells: then the
    // latest earlier marker applies, and the walk continues to C.md.
    expect(resolveCommentPath(moves, "A.md", T2)).toBe("A.md");
    expect(resolveCommentPath(moves, "A.md", T2, new Set(["A.md"]))).toBe("C.md");
  });

  it("asks the vault only about the paths a marker could move on", async () => {
    const vault = new FakeVault();
    let now = T0;
    const store = new BundleCommentStore({ vault: vault as unknown as IVaultAdapter, deviceId: async () => "laptop", mode: async () => ({ kind: "plain" }), now: () => now });
    await store.post({ path: "A.md", body: "early" });
    now = T1;
    await store.recordMoves([{ from: "A.md", to: "B.md" }]);
    now = T2;
    await store.post({ path: "A.md", body: "late or reused?" });
    // No file at A.md: the late remark follows the rename.
    expect((await store.list("B.md")).map((c) => c.body)).toEqual(["early", "late or reused?"]);
    // A new note took the freed name: its remark stays with it.
    vault.files.set("A.md", "# new note");
    expect((await store.list("B.md")).map((c) => c.body)).toEqual(["early"]);
    expect((await store.list("A.md")).map((c) => c.body)).toEqual(["late or reused?"]);
  });

  it("resolves two conflicting renames to the earlier one on every device alike", () => {
    const moves = sorted([move({ moveId: "01".repeat(16), from: "A.md", to: "B.md", at: T1 }), move({ moveId: "02".repeat(16), from: "A.md", to: "C.md", at: T2 })]);
    expect(resolveCommentPath(moves, "A.md", T0)).toBe("B.md");
  });

  it("moves a whole folder by prefix", () => {
    const moves = sorted([move({ moveId: "01".repeat(16), from: "Old", to: "Archive/New", folder: true, at: T1 })]);
    expect(resolveCommentPath(moves, "Old/Deep/Note.md", T0)).toBe("Archive/New/Deep/Note.md");
    expect(resolveCommentPath(moves, "Older/Note.md", T0)).toBe("Older/Note.md");
  });

  it("records a move through the store and lists the remark under the new name, replies included", async () => {
    const vault = new FakeVault();
    let now = T0;
    const store = new BundleCommentStore({ vault: vault as unknown as IVaultAdapter, deviceId: async () => "laptop", mode: async () => ({ kind: "plain" }), now: () => now });
    await store.post({ path: "Notes/Plan.md", body: "root" });
    const [root] = await store.list("Notes/Plan.md");
    now = T1;
    await store.recordMoves([{ from: "Notes/Plan.md", to: "Notes/Roadmap.md" }]);
    now = T2;
    // A reply written after the move, against the new path, joins its thread.
    await store.post({ path: "Notes/Roadmap.md", body: "reply", parentCommentId: root.commentId });
    expect(await store.list("Notes/Plan.md")).toEqual([]);
    expect((await store.list("Notes/Roadmap.md")).map((c) => c.body)).toEqual(["root", "reply"]);
    expect([...(await store.listAll()).keys()]).toEqual(["Notes/Roadmap.md"]);
  });

  it("writes no bundle for a rename in a vault that never carried a remark", async () => {
    const vault = new FakeVault();
    const store = storeFor(vault, { kind: "plain" });
    await store.recordMoves([{ from: "A.md", to: "B.md" }]);
    expect(vault.files.size).toBe(0);
  });

  it("refuses on a locked device rather than writing a plaintext marker", async () => {
    const store = storeFor(new FakeVault(), { kind: "locked" });
    await expect(store.recordMoves([{ from: "A.md", to: "B.md" }])).rejects.toBeInstanceOf(CommentStoreLockedError);
  });

  it("survives the union merge and serializes byte-identically without moves", () => {
    const left = { format: "plainva-comments" as const, version: 1 as const, updatedAt: T0, comments: {}, authors: {}, moves: { ["01".repeat(16)]: move({ moveId: "01".repeat(16) }) } };
    const right = { format: "plainva-comments" as const, version: 1 as const, updatedAt: T0, comments: {}, authors: {}, moves: { ["02".repeat(16)]: move({ moveId: "02".repeat(16), from: "B.md", to: "C.md" }) } };
    const merged = mergeCommentsBundles(left, right, T1);
    expect(Object.keys(merged.moves ?? {}).sort()).toEqual(["01".repeat(16), "02".repeat(16)]);
    // A bundle without moves keeps the pre-N1 shape on disk.
    expect(serializeCommentsBundle({ format: "plainva-comments", version: 1, updatedAt: T0, comments: {}, authors: {} })).not.toContain("moves");
    expect(parseCommentsBundle(serializeCommentsBundle(merged))?.moves?.["02".repeat(16)]?.to).toBe("C.md");
  });
});
