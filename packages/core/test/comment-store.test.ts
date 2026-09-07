import { describe, it, expect } from "vitest";
import {
  BUNDLE_COMMENT_CAPABILITIES,
  BundleCommentStore,
  COMMENTS_ENC_PATH,
  COMMENTS_SYNC_PATH,
  CommentStoreLockedError,
  parseCommentsBundle,
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
    expect(vault.files.has(COMMENTS_SYNC_PATH)).toBe(true);
  });

  it("seals when a key is present", async () => {
    const vault = new FakeVault();
    const store = storeFor(vault, { kind: "sealed", crypto: xorCrypto });
    await store.post({ path: "Notes/Plan.md", body: "secret remark" });
    expect(vault.files.has(COMMENTS_SYNC_PATH)).toBe(false);
    expect(new TextDecoder().decode(vault.bins.get(COMMENTS_ENC_PATH)!)).not.toContain("secret remark");
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
    const raw = parseCommentsBundle(vault.files.get(COMMENTS_SYNC_PATH)!)!;
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
