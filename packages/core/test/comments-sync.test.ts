import { describe, it, expect } from "vitest";
import {
  COMMENTS_ENC_PATH,
  COMMENTS_SYNC_PATH,
  CommentBundleError,
  CommentsSyncStep,
  appendLocalComment,
  assertCommentsBundleStructure,
  emptyCommentsBundle,
  mergeCommentsBundles,
  parseCommentsBundle,
  readLocalComments,
  serializeCommentsBundle,
  type CommentsBundle,
  type CommentsCrypto,
  type LocalCommentRecord,
} from "../src/index.js";
import type { ISyncTarget, SyncOperation, PushResult, PullResult } from "../src/index.js";
import type { IVaultAdapter } from "../src/index.js";

const NOW = "2026-08-25T10:00:00Z";
const ID_A = "aa".repeat(16);
const ID_B = "bb".repeat(16);

function rec(over: Partial<LocalCommentRecord> = {}): LocalCommentRecord {
  return {
    commentId: ID_A,
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

const ANCHOR = { markerId: "ab12", quote: "bis Ende des Jahres", before: "Wir liefern ", after: " aus.", approximateOffset: 12 };

function bundle(records: LocalCommentRecord[], authors: Record<string, { name: string; updatedAt: string }> = {}): CommentsBundle {
  const comments: Record<string, LocalCommentRecord> = {};
  for (const record of records) comments[record.commentId] = record;
  return { format: "plainva-comments", version: 1, updatedAt: NOW, comments, authors };
}

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
}

class FakeTarget implements Partial<ISyncTarget> {
  remote = new Map<string, Uint8Array>();
  writes = 0;
  deletes: string[] = [];
  async download(path: string): Promise<Uint8Array | null> {
    return this.remote.get(path) ?? null;
  }
  async push(op: SyncOperation): Promise<PushResult | void> {
    if (op.operation === "write" && op.content) {
      this.writes += 1;
      this.remote.set(op.file_path, op.content);
    } else if (op.operation === "delete") {
      this.deletes.push(op.file_path);
      this.remote.delete(op.file_path);
    }
  }
  async pull(): Promise<PullResult> {
    return { etagMap: new Map() };
  }
}

/** Reversible stand-in for the sealed path: the step must not care what seal does. */
const xorCrypto: CommentsCrypto = {
  seal: (plain) => plain.map((byte) => byte ^ 0x5a),
  open: (bytes) => bytes.map((byte) => byte ^ 0x5a),
};

const asText = (bytes: Uint8Array) => new TextDecoder().decode(bytes as BufferSource);

describe("commentsBundle merge", () => {
  it("keeps what both devices wrote", () => {
    const merged = mergeCommentsBundles(bundle([rec()]), bundle([rec({ commentId: ID_B, body: "one more thing" })]), NOW);
    expect(Object.keys(merged.comments).sort()).toEqual([ID_A, ID_B]);
  });

  it("cannot lose a record just because one side never saw it", () => {
    // Grow-only is the whole design: a record is immutable, so absence on one
    // side means "not yet received", never "deleted". If this ever flips to a
    // last-writer rule, a reply typed offline disappears on the next cycle.
    const merged = mergeCommentsBundles(bundle([]), bundle([rec()]), NOW);
    expect(merged.comments[ID_A]?.body).toBe("so far so good");
  });

  it("resolves a colliding id the same way on both devices", () => {
    // Two devices minting one 128-bit id should not happen. If it does, what
    // matters is that both pick the SAME record - otherwise the pair never
    // converges and every cycle rewrites the file.
    const mine = rec({ body: "left" });
    const theirs = rec({ body: "right" });
    const here = mergeCommentsBundles(bundle([mine]), bundle([theirs]), NOW);
    const there = mergeCommentsBundles(bundle([theirs]), bundle([mine]), NOW);
    expect(here.comments[ID_A]).toEqual(there.comments[ID_A]);
  });

  it("lets a device rename itself but not anybody else", () => {
    const mine = bundle([], { laptop: { name: "Marco", updatedAt: "2026-08-25T09:00:00Z" }, phone: { name: "Phone", updatedAt: NOW } });
    const theirs = bundle([], { laptop: { name: "Marco K.", updatedAt: "2026-08-25T11:00:00Z" } });
    const merged = mergeCommentsBundles(mine, theirs, NOW);
    expect(merged.authors.laptop.name).toBe("Marco K.");
    expect(merged.authors.phone.name).toBe("Phone");
  });
});

describe("commentsBundle validation", () => {
  it("refuses a suggestion without a passage to replace", () => {
    // A proposal names the text it replaces. Without an anchor the reader has
    // nothing to strike through and no place to apply it.
    expect(() => assertCommentsBundleStructure(bundle([rec({ suggestion: { replacement: "x" }, anchor: null })]))).toThrow(CommentBundleError);
    expect(() => assertCommentsBundleStructure(bundle([rec({ suggestion: { replacement: "x" }, anchor: ANCHOR })]))).not.toThrow();
  });

  it("refuses a record that says nothing and marks nothing", () => {
    expect(() => assertCommentsBundleStructure(bundle([rec({ body: "" })]))).toThrow(/no content/);
    expect(() => assertCommentsBundleStructure(bundle([rec({ body: "", resolvedCommentId: ID_B })]))).not.toThrow();
  });

  it("refuses an oversized body and a malformed id", () => {
    expect(() => assertCommentsBundleStructure(bundle([rec({ body: "x".repeat(64 * 1024 + 1) })]))).toThrow(/too large/);
    const bad = bundle([rec()]);
    bad.comments["not-hex"] = bad.comments[ID_A];
    expect(() => assertCommentsBundleStructure(bad)).toThrow(/id is malformed/);
  });

  it("refuses an anchor that is out of bounds", () => {
    const wide = { ...ANCHOR, quote: "x".repeat(600) };
    expect(() => assertCommentsBundleStructure(bundle([rec({ anchor: wide })]))).toThrow(/anchor is invalid/);
  });

  it("round-trips byte-identically regardless of insertion order", () => {
    // Key order must not depend on how the records arrived, or a converged pair
    // of devices would rewrite the file on every single cycle.
    const one = serializeCommentsBundle(bundle([rec(), rec({ commentId: ID_B, body: "two" })]));
    const other = serializeCommentsBundle(bundle([rec({ commentId: ID_B, body: "two" }), rec()]));
    expect(one).toBe(other);
    expect(serializeCommentsBundle(parseCommentsBundle(one)!)).toBe(one);
  });

  it("treats an empty document as no comments, a broken one as an error", () => {
    expect(parseCommentsBundle("   ")).toBeNull();
    expect(() => parseCommentsBundle("{oops")).toThrow(CommentBundleError);
  });
});

describe("appendLocalComment", () => {
  it("puts the record on disk immediately, with this device's name", async () => {
    // Pressing send must not wait for the network: the reply has to be visible
    // in the thread before the next cycle runs.
    const vault = new FakeVault();
    await appendLocalComment(vault as unknown as IVaultAdapter, rec(), { authorName: "Marco", now: NOW });
    const stored = await readLocalComments(vault as unknown as IVaultAdapter);
    expect(stored?.comments[ID_A]?.body).toBe("so far so good");
    expect(stored?.authors.laptop.name).toBe("Marco");
    expect(vault.files.has(COMMENTS_SYNC_PATH)).toBe(true);
  });

  it("seals the file when a key is present", async () => {
    const vault = new FakeVault();
    await appendLocalComment(vault as unknown as IVaultAdapter, rec(), { crypto: xorCrypto, now: NOW });
    expect(vault.files.has(COMMENTS_SYNC_PATH)).toBe(false);
    expect(asText(vault.bins.get(COMMENTS_ENC_PATH)!)).not.toContain("so far so good");
    expect((await readLocalComments(vault as unknown as IVaultAdapter, xorCrypto))?.comments[ID_A]).toBeTruthy();
  });
});

describe("CommentsSyncStep.run", () => {
  const now = () => NOW;

  it("carries local comments up and remote comments down", async () => {
    const vault = new FakeVault();
    const target = new FakeTarget();
    await appendLocalComment(vault as unknown as IVaultAdapter, rec(), { now: NOW });
    target.remote.set(COMMENTS_SYNC_PATH, new TextEncoder().encode(serializeCommentsBundle(bundle([rec({ commentId: ID_B, body: "from the phone" })]))));

    await new CommentsSyncStep({ now }).run(target as unknown as ISyncTarget, vault as unknown as IVaultAdapter);

    const local = await readLocalComments(vault as unknown as IVaultAdapter);
    expect(Object.keys(local!.comments).sort()).toEqual([ID_A, ID_B]);
    expect(Object.keys(parseCommentsBundle(asText(target.remote.get(COMMENTS_SYNC_PATH)!))!.comments).sort()).toEqual([ID_A, ID_B]);
  });

  it("writes nothing once both sides agree", async () => {
    // The timestamp changes on every merge. If it were part of the comparison,
    // a quiet vault would push a new file every fifteen seconds forever.
    const vault = new FakeVault();
    const target = new FakeTarget();
    await appendLocalComment(vault as unknown as IVaultAdapter, rec(), { now: NOW });
    const step = new CommentsSyncStep({ now: () => new Date().toISOString() });
    await step.run(target as unknown as ISyncTarget, vault as unknown as IVaultAdapter);
    const after = target.writes;
    await step.run(target as unknown as ISyncTarget, vault as unknown as IVaultAdapter);
    await step.run(target as unknown as ISyncTarget, vault as unknown as IVaultAdapter);
    expect(target.writes).toBe(after);
  });

  it("never overwrites a bundle it cannot open", async () => {
    // On the wrong key, replacing the remote with local data would erase every
    // comment the other devices ever wrote.
    const vault = new FakeVault();
    const target = new FakeTarget();
    target.remote.set(COMMENTS_ENC_PATH, new Uint8Array([1, 2, 3]));
    const angry: CommentsCrypto = { seal: (p) => p, open: () => { throw new Error("wrong key"); } };
    await expect(new CommentsSyncStep({ crypto: angry, now }).run(target as unknown as ISyncTarget, vault as unknown as IVaultAdapter)).rejects.toThrow(/cannot be opened/);
    expect(target.remote.get(COMMENTS_ENC_PATH)).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("takes along what a still-locked device wrote, then clears the plaintext copy", async () => {
    // A device without the key keeps writing the plaintext file. Deleting it
    // unread would drop those comments; a union makes taking them along safe.
    const vault = new FakeVault();
    const target = new FakeTarget();
    target.remote.set(COMMENTS_SYNC_PATH, new TextEncoder().encode(serializeCommentsBundle(bundle([rec({ commentId: ID_B, body: "written while locked" })]))));
    await appendLocalComment(vault as unknown as IVaultAdapter, rec(), { crypto: xorCrypto, now: NOW });

    await new CommentsSyncStep({ crypto: xorCrypto, now }).run(target as unknown as ISyncTarget, vault as unknown as IVaultAdapter);

    const sealed = await readLocalComments(vault as unknown as IVaultAdapter, xorCrypto);
    expect(Object.keys(sealed!.comments).sort()).toEqual([ID_A, ID_B]);
    expect(target.remote.has(COMMENTS_SYNC_PATH)).toBe(false);
    expect(target.deletes).toContain(COMMENTS_SYNC_PATH);
  });

  it("does nothing at all for a vault without comments", async () => {
    const vault = new FakeVault();
    const target = new FakeTarget();
    await new CommentsSyncStep({ now }).run(target as unknown as ISyncTarget, vault as unknown as IVaultAdapter);
    expect(target.writes).toBe(0);
    expect(await vault.exists(COMMENTS_SYNC_PATH)).toBe(false);
  });
});

describe("emptyCommentsBundle", () => {
  it("is valid on its own", () => {
    expect(() => assertCommentsBundleStructure(emptyCommentsBundle(NOW))).not.toThrow();
  });
});
