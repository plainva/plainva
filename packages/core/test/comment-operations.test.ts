import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, mkdir, readdir, readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { BundleCommentStore, createWorkspaceObjectId, commentsDevicePath, parseCommentsBundle } from "../src/index.js";
import { LocalVaultAdapter } from "../src/vault/LocalVaultAdapter.js";
import { createCommentOperationService } from "../src/comments/commentOperationService.js";
import {
  CommentOperationRunner, FileCommentOperationJournal, prepareCommentOperation, parseCommentOperation,
  type CommentOperation, type CommentOperationDeps, type CommentOperationFiles,
} from "../src/comments/commentOperations.js";

let roots: string[];
beforeEach(() => { roots = []; });
afterEach(async () => { await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true }))); });

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "plainva-comment-operation-")); roots.push(root);
  const vault = new LocalVaultAdapter(root); await vault.initialize();
  await vault.writeTextFile("note.md", "Old sentence.\nKeep this line.\n");
  const dir = join(root, "local-journal"); await mkdir(dir);
  const files: CommentOperationFiles = {
    read: async (file) => {
      try { return await readFile(join(dir, file), "utf8"); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
    },
    writeAtomic: async (file, text) => {
      const part = join(dir, `${file}.${createWorkspaceObjectId()}.part`);
      await writeFile(part, text); await rename(part, join(dir, file));
    },
    list: () => readdir(dir),
  };
  const store = () => new BundleCommentStore({ vault, vaultKey: root, deviceId: async () => "desktop", mode: async () => ({ kind: "plain" as const }) });
  const journal = new FileCommentOperationJournal(files);
  let tail = Promise.resolve();
  let noteWrites = 0, posts = 0;
  const deps: CommentOperationDeps = {
    contextKey: root, journal, authorKey: async () => "bundle:desktop",
    withNoteLock: async (_path, work) => { const run = tail.catch(() => {}).then(work); tail = run; await run; },
    readText: (path) => vault.readTextFile(path),
    writeText: async (path, text) => { noteWrites += 1; await vault.writeTextFile(path, text); },
    post: async (marker) => { posts += 1; await store().post(marker); },
  };
  const proposal = () => prepareCommentOperation({
    contextKey: root, authorKey: "bundle:desktop", notePath: "note.md", kind: "apply",
    text: { before: "Old sentence.\nKeep this line.\n", intended: "New sentence.\nKeep this line.\n" },
    markers: [0, 1].map(() => ({ path: "note.md", body: "", resolvedCommentId: createWorkspaceObjectId(), suggestionOutcome: "applied" as const })),
  });
  const markerCount = async () => {
    if (!await vault.exists(commentsDevicePath("desktop", false))) return 0;
    const parsed = parseCommentsBundle(await vault.readTextFile(commentsDevicePath("desktop", false)));
    return Object.keys(parsed?.comments ?? {}).length;
  };
  return { root, vault, dir, files, journal, store, deps, proposal, markerCount, counts: () => ({ noteWrites, posts }), runner: () => new CommentOperationRunner(deps) };
}

describe("durable comment operation recovery with real files", () => {
  it("the shared service follows a renamed target and never shows it on the reused old pathname", async () => {
    const f = await setup();
    await f.store().post({ path: "note.md", body: "Existing discussion" });
    const service = createCommentOperationService({ ...f.deps,
      resolvePath: (operation) => f.store().resolvePath(operation.notePath, operation.createdAt),
    });
    const op = await service.prepare({ notePath: "note.md", kind: "apply", text: f.proposal().text, markers: f.proposal().markers });
    await f.journal.write(op);
    await f.vault.renameItem("note.md", "renamed.md");
    await f.store().recordMoves([{ from: "note.md", to: "renamed.md" }]);
    await f.vault.writeTextFile("note.md", "A different new note.");
    expect(await service.pending("note.md")).toEqual([]);
    expect((await service.pending("renamed.md"))[0].operationId).toBe(op.operationId);
    expect((await service.run(op)).phase).toBe("completed");
    expect(await f.vault.readTextFile("note.md")).toBe("A different new note.");
    expect(await f.vault.readTextFile("renamed.md")).toBe(op.text!.intended);
    expect((await service.read(op.operationId))?.receipt?.confirmedText).toBe(op.text!.intended);
    expect(await service.pending()).toEqual([]);
  });

  it("the service captures its input before waiting for author setup and rejects a changed writer", async () => {
    const f = await setup();
    const op = f.proposal();
    const input = { notePath: op.notePath, kind: op.kind, text: op.text, markers: op.markers };
    let release!: () => void;
    const wait = new Promise<void>((resolve) => { release = resolve; });
    const service = createCommentOperationService({ ...f.deps, resolvePath: async (operation) => operation.notePath,
      prepareMarkers: async (captured) => { await wait; return captured.markers; },
    });
    const preparing = service.prepare(input);
    input.markers[0].body = "Changed outside the operation";
    release();
    expect((await preparing).markers[0].body).toBe("");
    const changed = createCommentOperationService({ ...f.deps, resolvePath: async (operation) => operation.notePath,
      prepareMarkers: async (captured) => { f.deps.authorKey = async () => "another"; return captured.markers; },
      authorKey: () => f.deps.authorKey(),
    });
    await expect(changed.prepare(input)).rejects.toThrow("writer changed");
    expect(await f.journal.list()).toEqual([]);
  });

  it("keeps the prepared journal when a target moves while its physical write lane is acquired", async () => {
    const f = await setup(); let location = "note.md";
    const service = createCommentOperationService({ ...f.deps, resolvePath: async () => location,
      withNoteLock: async (_path, work) => { location = "renamed.md"; await work(); },
    });
    const op = f.proposal();
    await expect(service.run(op)).rejects.toMatchObject({ reason: "storage", phase: "prepared" });
    expect((await service.read(op.operationId))?.phase).toBe("prepared");
    expect(f.counts()).toEqual({ noteWrites: 0, posts: 0 });
  });

  it("completes a round only after confirmed text and both markers, including concurrent retries", async () => {
    const f = await setup(); const op = f.proposal();
    const phases: string[] = []; f.deps.changed = (state) => { phases.push(state.phase); };
    const results = await Promise.all(Array.from({ length: 6 }, () => f.runner().run(op)));
    expect(results.every((result) => result.phase === "completed")).toBe(true);
    expect(f.counts()).toEqual({ noteWrites: 1, posts: 2 });
    expect(await f.markerCount()).toBe(2);
    expect(phases).toEqual(["prepared", "text-confirmed", "markers-pending", "markers-pending", "markers-pending", "completed"]);
    expect(await f.runner().pending()).toEqual([]);
    expect((await f.journal.read(op.operationId))?.receipt?.confirmedText).toBe(op.text?.intended);
  });

  it("a failed initial journal write leaves the note and comments untouched", async () => {
    const f = await setup(); const op = f.proposal();
    f.files.writeAtomic = async () => { throw new Error("disk full"); };
    await expect(f.runner().run(op)).rejects.toMatchObject({ phase: "prepared", reason: "storage" });
    expect(f.counts()).toEqual({ noteWrites: 0, posts: 0 });
    expect(await f.vault.readTextFile("note.md")).toBe(op.text?.before);
  });

  it("an unconfirmed journal write cannot start changing the note", async () => {
    const f = await setup(); const op = f.proposal();
    f.files.writeAtomic = async () => {};
    await expect(f.runner().run(op)).rejects.toMatchObject({ reason: "storage" });
    expect(f.counts()).toEqual({ noteWrites: 0, posts: 0 });
  });

  it("a rejected text write keeps the prepared operation and writes no resolution", async () => {
    const f = await setup(); const op = f.proposal(); const write = f.deps.writeText;
    f.deps.writeText = async () => { throw new Error("note denied"); };
    await expect(f.runner().run(op)).rejects.toMatchObject({ phase: "prepared" });
    expect(await f.markerCount()).toBe(0);
    expect((await f.runner().pending())[0].operationId).toBe(op.operationId);
    f.deps.writeText = write;
    expect((await f.runner().run(op)).phase).toBe("completed");
  });

  it("recovers an ambiguous write acknowledgement without writing the text twice", async () => {
    const f = await setup(); const op = f.proposal(); const write = f.deps.writeText;
    f.deps.writeText = async (path, text) => { await write(path, text); throw new Error("native acknowledgement lost"); };
    await expect(f.runner().run(op)).rejects.toMatchObject({ phase: "prepared" });
    expect(await f.markerCount()).toBe(0);
    f.deps.writeText = write;
    expect((await f.runner().run(op)).phase).toBe("completed");
    expect(f.counts().noteWrites).toBe(1);
  });

  it("does not confirm a returned note that omits the intended change", async () => {
    const f = await setup(); const op = f.proposal();
    f.deps.writeText = async () => { await f.vault.writeTextFile("note.md", "Another sentence.\nKeep this line.\n"); };
    await expect(f.runner().run(op)).rejects.toMatchObject({ phase: "needs-review", reason: "needs-review" });
    expect(await f.markerCount()).toBe(0);
    expect((await f.journal.read(op.operationId))?.phase).toBe("needs-review");
  });

  it("accepts a confirmed adapter merge with additional compatible text", async () => {
    const f = await setup(); const op = f.proposal();
    f.deps.writeText = async () => { await f.vault.writeTextFile("note.md", "New sentence.\nKeep this line.\nAnother writer's paragraph.\n"); };
    const result = await f.runner().run(op);
    expect(result.phase).toBe("completed");
    expect(result.receipt?.confirmedText).toContain("Another writer's paragraph.");
    expect(await f.markerCount()).toBe(2);
  });

  it("a changed disk base requires review and is never overwritten by the prepared snapshot", async () => {
    const f = await setup(); const op = f.proposal();
    await f.vault.writeTextFile("note.md", "Someone changed the sentence.\nKeep this line.\n");
    await expect(f.runner().run(op)).rejects.toMatchObject({ reason: "needs-review" });
    expect(f.counts()).toEqual({ noteWrites: 0, posts: 0 });
    expect(await f.vault.readTextFile("note.md")).toContain("Someone changed");
  });

  it("a failed receipt journal write holds every marker and recovers from the actual text", async () => {
    const f = await setup(); const op = f.proposal(); const write = f.files.writeAtomic;
    f.files.writeAtomic = async (file, text) => {
      if (JSON.parse(text).phase === "text-confirmed") throw new Error("receipt storage denied");
      await write(file, text);
    };
    await expect(f.runner().run(op)).rejects.toMatchObject({ reason: "storage" });
    expect(await f.markerCount()).toBe(0);
    expect((await f.journal.read(op.operationId))?.phase).toBe("prepared");
    f.files.writeAtomic = write;
    expect((await f.runner().run(op)).phase).toBe("completed");
    expect(f.counts().noteWrites).toBe(1);
  });

  it("a partial round retries only missing markers and preserves later note edits", async () => {
    const f = await setup(); const op = f.proposal(); const post = f.deps.post;
    f.deps.post = async (marker) => { if (marker.identity.commentId === op.markers[1].identity.commentId) throw new Error("marker denied"); await post(marker); };
    await expect(f.runner().run(op)).rejects.toMatchObject({ phase: "markers-pending" });
    expect(await f.markerCount()).toBe(1);
    await f.vault.writeTextFile("note.md", "My later text replaces the whole note.\n");
    f.deps.post = post;
    expect((await f.runner().run(op)).phase).toBe("completed");
    expect(await f.vault.readTextFile("note.md")).toBe("My later text replaces the whole note.\n");
    expect(await f.markerCount()).toBe(2);
    expect(f.counts()).toEqual({ noteWrites: 1, posts: 2 });
  });

  it("an ambiguous marker acknowledgement reuses its ID after a new runner starts", async () => {
    const f = await setup(); const op = f.proposal(); const post = f.deps.post;
    f.deps.post = async (marker) => { await post(marker); throw new Error("marker acknowledgement lost"); };
    await expect(f.runner().run(op)).rejects.toMatchObject({ phase: "markers-pending" });
    expect(await f.markerCount()).toBe(1);
    f.deps.post = post;
    expect((await f.runner().run(op)).phase).toBe("completed");
    expect(await f.markerCount()).toBe(2);
    expect(f.counts()).toEqual({ noteWrites: 1, posts: 3 });
  });

  it("derives exactly the same decision proof from the durable receipt after a lost acknowledgement", async () => {
    const f = await setup(); const op = f.proposal(); const post = f.deps.post;
    const reviewed = [createWorkspaceObjectId(), `legacy:${"a".repeat(64)}`];
    op.markers[0].reviewedDecisionIds = reviewed;
    const sent: unknown[] = [];
    f.deps.post = async (marker) => {
      sent.push(structuredClone(marker)); await post(marker); throw new Error("acknowledgement lost");
    };
    await expect(f.runner().run(op)).rejects.toMatchObject({ phase: "markers-pending" });
    const saved = (await f.journal.read(op.operationId))!;
    expect(saved.markers).toEqual(op.markers);
    expect(saved.markers[0].decisionProof).toBeUndefined();
    f.deps.post = async (marker) => { sent.push(structuredClone(marker)); await post(marker); };
    await f.runner().run(op);
    expect(sent[1]).toEqual(sent[0]);
    expect(sent[0]).not.toHaveProperty("reviewedDecisionIds");
    expect(sent[0]).toMatchObject({ decisionProof: { operationId: op.operationId, supersedes: reviewed,
      text: { beforeHash: saved.receipt!.beforeHash, intendedHash: saved.receipt!.intendedHash,
        confirmedHash: saved.receipt!.confirmedHash, confirmedAt: saved.receipt!.confirmedAt } } });
    expect(await f.markerCount()).toBe(2);
  });

  it("cannot claim a reviewed decision without text confirmation or accept a caller-supplied proof", async () => {
    const f = await setup(); const op = f.proposal();
    op.kind = "decline"; op.markers = [{ ...op.markers[0], suggestionOutcome: "declined", reviewedDecisionIds: [createWorkspaceObjectId()] }];
    expect(() => parseCommentOperation(JSON.stringify({ ...op, text: null }))).toThrow();
    expect(() => parseCommentOperation(JSON.stringify({ ...op, markers: [{ ...op.markers[0], reviewedDecisionIds: ["guessed"] }] }))).toThrow();
    expect(() => parseCommentOperation(JSON.stringify({ ...op, markers: [{ ...op.markers[0], decisionProof: {} }] }))).toThrow();
    expect(() => parseCommentOperation(JSON.stringify({ ...op, markers: [{ ...op.markers[0], targetObjectId: "../wrong" }] }))).toThrow();
  });

  it.each(["marker-progress", "completed"])("recovers a failed %s journal update without duplicating comments", async (stage) => {
    const f = await setup(); const op = f.proposal(); const write = f.files.writeAtomic;
    f.files.writeAtomic = async (file, text) => {
      const state = JSON.parse(text) as CommentOperation;
      if ((stage === "marker-progress" && state.postedIds.length > 0) || (stage === "completed" && state.phase === "completed")) throw new Error("journal denied");
      await write(file, text);
    };
    await expect(f.runner().run(op)).rejects.toMatchObject({ reason: "storage" });
    f.files.writeAtomic = write;
    expect((await f.runner().run(op)).phase).toBe("completed");
    expect(await f.markerCount()).toBe(2);
    expect(f.counts().noteWrites).toBe(1);
  });

  it("rejects a different author before preparing or completing someone else's operation", async () => {
    const f = await setup(); const op = f.proposal();
    f.deps.authorKey = async () => "workspace:another-device";
    await expect(f.runner().run(op)).rejects.toMatchObject({ reason: "context" });
    expect(await f.journal.read(op.operationId)).toBeNull();
    expect(f.counts()).toEqual({ noteWrites: 0, posts: 0 });
  });

  it("a context change during note writing holds the markers until the original author returns", async () => {
    const f = await setup(); const op = f.proposal(); const write = f.deps.writeText;
    f.deps.writeText = async (path, text) => { await write(path, text); f.deps.authorKey = async () => "another"; };
    await expect(f.runner().run(op)).rejects.toMatchObject({ reason: "context" });
    expect(await f.markerCount()).toBe(0);
    f.deps.authorKey = async () => op.authorKey;
    expect((await f.runner().run(op)).phase).toBe("completed");
    expect(f.counts().noteWrites).toBe(1);
  });

  it("pure comment rounds are durable without reading or rewriting the note", async () => {
    const f = await setup();
    const op = prepareCommentOperation({ contextKey: f.root, authorKey: "bundle:desktop", notePath: "note.md", kind: "post", markers: ["First", "Second"].map((body) => ({ path: "note.md", body })) });
    f.deps.readText = async () => { throw new Error("must not read"); };
    expect((await f.runner().run(op)).phase).toBe("completed");
    expect(f.counts()).toEqual({ noteWrites: 0, posts: 2 });
  });

  it("malformed, mismatched, or altered journals cannot become a fresh operation", async () => {
    const f = await setup(); const op = f.proposal();
    await writeFile(join(f.dir, `${op.operationId}.json`), "{broken");
    await expect(f.runner().run(op)).rejects.toMatchObject({ reason: "storage" });
    await expect(f.runner().pending()).rejects.toThrow();
    await writeFile(join(f.dir, `${op.operationId}.json`), JSON.stringify({ ...op, operationId: createWorkspaceObjectId() }));
    await expect(f.runner().run(op)).rejects.toMatchObject({ reason: "storage" });
    await f.journal.write({ ...op, markers: [{ ...op.markers[0], body: "Different payload" }, op.markers[1]] });
    await expect(f.runner().run(op)).rejects.toMatchObject({ reason: "storage" });
    expect(f.counts()).toEqual({ noteWrites: 0, posts: 0 });
  });

  it("refuses an applied marker without a text receipt path and forged completed state", async () => {
    const f = await setup(); const op = f.proposal();
    expect(() => parseCommentOperation(JSON.stringify({ ...op, text: null }))).toThrow();
    expect(() => parseCommentOperation(JSON.stringify({ ...op, phase: "completed", postedIds: op.markers.map((m) => m.identity.commentId) }))).toThrow();
    expect(() => parseCommentOperation(JSON.stringify({ ...op, notePath: "../note.md" }))).toThrow();
  });

  it("an unchanged-text review cannot confirm a different note through an empty delta", async () => {
    const f = await setup(); const op = f.proposal();
    op.text = { before: op.text!.before, intended: op.text!.before };
    await f.vault.writeTextFile("note.md", "Text changed after the decision was prepared.\n");
    await expect(f.runner().run(op)).rejects.toMatchObject({ reason: "needs-review" });
    expect(await f.markerCount()).toBe(0);
    expect(f.counts().noteWrites).toBe(0);
  });
});
