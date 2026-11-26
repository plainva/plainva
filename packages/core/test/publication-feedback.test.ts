import { afterEach, describe, expect, it } from "vitest";
import {
  createCommentOperationService,
  FileCommentOperationJournal,
  planCommentDecision,
  projectCommentRecords,
  WorkspaceCommentStore,
} from "../src/index.js";
import {
  buildCommentAnchor,
  projectPublicationFeedbackForOwner,
  publicationReviewCommentId,
  type PublicationComment,
  type WorkspaceCommentRecord,
} from "../src/workspace/index.js";
import { commentShellWorkspace } from "./helpers/commentShellWorkspace.js";

const id = (n: number) => n.toString(16).padStart(32, "0");
const now = "2026-09-15T08:00:00.000Z";
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });
function feedback(objectId = id(10)): PublicationComment {
  return { publicationId: id(1), path: "note.md", authorDisplayName: "Reviewer", authorActive: true, suggestionApplicable: true,
    comment: { commentId: id(2), targetObjectId: objectId, targetRevisionId: id(3), parentCommentId: null,
      authorMemberId: id(4), authorDeviceId: id(5), operationHash: "a".repeat(64), payloadHash: "b".repeat(64),
      createdAt: now, body: "Please review", anchor: buildCommentAnchor("Original note.", 0, 8, "abcd"),
      suggestion: { replacement: "Reviewed", appliedAt: null, appliedBy: null, declinedAt: null }, resolvedCommentId: null, resolvedAt: null } };
}
function decision(root: WorkspaceCommentRecord, n: number, outcome: "applied" | "declined"): WorkspaceCommentRecord {
  return { ...root, commentId: id(n), body: "", suggestion: null, anchor: null, resolvedCommentId: root.commentId, suggestionOutcome: outcome };
}

describe("publication review in the original note", () => {
  it("keeps two publications and the local comment namespace separate without changing sealed facts", () => {
    const first = feedback(), second = { ...feedback(), publicationId: id(6) }, before = structuredClone(first);
    const roots = projectPublicationFeedbackForOwner([first, second], []);
    const applied = decision(roots[0].comment, 7, "applied");
    const wrongObject = { ...applied, commentId: id(8), targetObjectId: id(99), suggestionOutcome: "declined" as const };
    const result = projectPublicationFeedbackForOwner([first, second], [applied, wrongObject, decision(first.comment, 9, "declined")]);
    expect(result[0].comment.suggestionDecision?.status).toBe("applied");
    expect(result[1].comment.suggestion?.appliedAt).toBeNull();
    expect(new Set([first.comment.commentId, ...result.map(entry => entry.comment.commentId)]).size).toBe(3);
    expect(first).toEqual(before);
  });

  it("retains conflicting published decisions through projection and an explicit local review", () => {
    const entry = feedback(), a = decision(entry.comment, 21, "applied"), b = decision(entry.comment, 22, "declined");
    entry.comment = projectCommentRecords([entry.comment, a, b])[0];
    const imported = projectPublicationFeedbackForOwner([entry], [])[0].comment;
    expect(imported.suggestionDecision?.status).toBe("conflict");
    expect(imported.suggestionDecision?.knownIds).toEqual([21, 22].map(n => publicationReviewCommentId(entry.publicationId, id(n))).sort());
    const local = decision(imported, 23, "applied");
    local.decisionProof = { operationId: id(24), supersedes: imported.suggestionDecision!.knownIds,
      text: { beforeHash: "a".repeat(64), intendedHash: "b".repeat(64), confirmedHash: "b".repeat(64), confirmedAt: now } };
    expect(projectPublicationFeedbackForOwner([entry], [local])[0].comment.suggestionDecision?.status).toBe("applied");
    const projected = projectCommentRecords([entry.comment, a, b]);
    expect(projected[0].suggestionDecision).toEqual(entry.comment.suggestionDecision);
  });

  it("uses the durable source-write completion, survives failed save and lost marker acknowledgement, and does not write twice", async () => {
    const ctx = await commentShellWorkspace(); cleanups.push(ctx.cleanup);
    const object = (await ctx.state.getObjectByPath("note.md"))!, entry = feedback(object.objectId);
    const review = projectPublicationFeedbackForOwner([entry], [])[0].comment;
    const store = new WorkspaceCommentStore({ plane: () => ({ runtime: ctx.runtime, workspaceState: ctx.state }), worker: () => null, changed: () => {} });
    const files = new Map<string, string>();
    const journal = new FileCommentOperationJournal({ read: async key => files.get(key) ?? null,
      writeAtomic: async (key, value) => { files.set(key, value); }, list: async () => [...files.keys()] });
    let failSave = true, failAck = true, writes = 0;
    const service = () => createCommentOperationService({ contextKey: ctx.root, authorKey: () => store.writerKey(), journal,
      resolvePath: async () => "note.md", withNoteLock: async (_path, work) => work(), readText: path => ctx.raw.readTextFile(path),
      writeText: async (path, text) => { if (failSave) throw Error("disk unavailable"); writes++; await ctx.raw.writeTextFile(path, text); },
      post: async marker => { await store.post(marker); if (failAck) { failAck = false; throw Error("acknowledgement lost"); } } });
    const op = await service().prepare(planCommentDecision("note.md", "Original note.", [review], "applied"));
    await expect(service().run(op)).rejects.toThrow();
    expect(await ctx.raw.readTextFile("note.md")).toBe("Original note.");
    expect(await ctx.state.listCommentOutbox()).toEqual([]);
    failSave = false;
    await expect(service().run(op)).rejects.toThrow();
    expect(await ctx.raw.readTextFile("note.md")).toBe("Reviewed note.");
    expect((await service().run(op)).phase).toBe("completed");
    expect(writes).toBe(1);
    await ctx.worker.runCycle();
    const reviewed = projectPublicationFeedbackForOwner([entry], await ctx.state.listRawComments())[0];
    expect(reviewed.comment.suggestionDecision?.status).toBe("applied");
    expect(reviewed.comment.suggestionDecision?.decisions[0].proof?.text.confirmedHash).toBeTruthy();
    expect((await ctx.state.listRawComments()).filter(record => record.resolvedCommentId === review.commentId)).toHaveLength(1);
    expect((await service().run(op)).phase).toBe("completed");
    expect(writes).toBe(1);
  });
});
