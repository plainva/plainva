import { describe, expect, it } from "vitest";
import type { WorkspaceCommentRecord } from "@plainva/core";
import { buildCommentOverview, buildCommentThreads, buildPropertyCommentCells, findPropertyCommentThread, groupSuggestionRounds, isCommentThreadOpen } from "@plainva/ui";

/**
 * The thread rules used to live twice - once in the desktop column, once in the
 * phone sheet. These pin the lifted version (D9); the two surfaces' own tests
 * stayed untouched, which is what proves the lift changed no behaviour.
 */
function comment(over: Partial<WorkspaceCommentRecord> & { commentId: string }): WorkspaceCommentRecord {
  return {
    targetObjectId: "notes/a.md",
    targetRevisionId: "",
    parentCommentId: null,
    authorMemberId: "m1",
    authorDeviceId: "d1",
    operationHash: "",
    payloadHash: "",
    body: "",
    anchor: null,
    suggestion: null,
    createdAt: "2026-08-26T10:00:00.000Z",
    resolvedCommentId: null,
    resolvedAt: null,
    ...over,
  } as WorkspaceCommentRecord;
}

const names = new Map([["m2", "Ada"]]);

describe("buildCommentThreads", () => {
  it("keeps a reply whose root has not synced yet reachable as its own thread", () => {
    const threads = buildCommentThreads([comment({ commentId: "b", parentCommentId: "missing" })], null, names);
    expect(threads.map((thread) => thread.root.commentId)).toEqual(["b"]);
  });

  it("floats a thread that names you and never counts a resolved one as addressed", () => {
    const open = comment({ commentId: "a", body: "@Ada please look" });
    const quiet = comment({ commentId: "b", createdAt: "2026-08-26T09:00:00.000Z" });
    const settled = comment({ commentId: "c", body: "@Ada done?", resolvedAt: "2026-08-26T11:00:00.000Z" });
    const threads = buildCommentThreads([quiet, open, settled], "m2", names);
    expect(threads[0].root.commentId).toBe("a");
    expect(threads.find((thread) => thread.root.commentId === "c")?.addressed).toBe(false);
  });
});

describe("isCommentThreadOpen", () => {
  it("treats a decided suggestion as done even before its resolution folds in", () => {
    const applied = comment({ commentId: "a", suggestion: { replacement: "x", appliedAt: "2026-08-26T10:01:00.000Z", appliedBy: "m1", declinedAt: null } });
    const declined = comment({ commentId: "b", suggestion: { replacement: "x", appliedAt: null, appliedBy: null, declinedAt: "2026-08-26T10:01:00.000Z" } });
    const pending = comment({ commentId: "c", suggestion: { replacement: "x", appliedAt: null, appliedBy: null, declinedAt: null } });
    expect(isCommentThreadOpen(applied)).toBe(false);
    expect(isCommentThreadOpen(declined)).toBe(false);
    expect(isCommentThreadOpen(pending)).toBe(true);
  });
});

describe("buildCommentOverview", () => {
  const entries = [
    { path: "zeta.md", comments: [comment({ commentId: "a" })] },
    { path: "alpha.md", comments: [comment({ commentId: "b", resolvedAt: "2026-08-26T11:00:00.000Z" })] },
    { path: "mid.md", comments: [comment({ commentId: "c", body: "@Ada hier" })] },
  ];

  it("drops notes whose threads are all settled and puts the ones naming you first", () => {
    const notes = buildCommentOverview(entries, "m2", names);
    expect(notes.map((note) => note.path)).toEqual(["mid.md", "zeta.md"]);
    expect(notes[0].addressedCount).toBe(1);
  });

  it("keeps the count honest when the filter narrows the list", () => {
    const [note, ...rest] = buildCommentOverview(entries, "m2", names, { onlyAddressed: true });
    expect(rest).toEqual([]);
    expect(note.path).toBe("mid.md");
  });

  it("narrows to the threads a notification announced, by root or reply (C30)", () => {
    const withReply = [
      ...entries,
      { path: "reply.md", comments: [comment({ commentId: "root" }), comment({ commentId: "answer", parentCommentId: "root" })] },
    ];
    const byRoot = buildCommentOverview(withReply, "m2", names, { onlyIds: new Set(["a"]) });
    expect(byRoot.map((n) => n.path)).toEqual(["zeta.md"]);
    const byReply = buildCommentOverview(withReply, "m2", names, { onlyIds: new Set(["answer"]) });
    expect(byReply.map((n) => n.path)).toEqual(["reply.md"]);
    expect(buildCommentOverview(withReply, "m2", names, { onlyIds: new Set(["nobody"]) })).toEqual([]);
  });
});

describe("buildPropertyCommentCells", () => {
  const propAnchor = (key: string) =>
    ({
      markerId: "ab12",
      quote: "",
      before: "",
      after: "",
      approximateOffset: 0,
      display: { kind: "property", key },
    }) as WorkspaceCommentRecord["anchor"];

  it("counts one dot per open thread on the column that carries the key today", () => {
    const cells = buildPropertyCommentCells(
      [
        {
          path: "a.md",
          comments: [
            comment({ commentId: "1", anchor: propAnchor("status") }),
            comment({ commentId: "2", anchor: propAnchor("status") }),
            comment({ commentId: "3", anchor: propAnchor("due") }),
          ],
        },
      ],
      (key) => key === "status" || key === "due",
    );
    expect(cells.get("a.md")?.get("status")).toBe(2);
    expect(cells.get("a.md")?.get("due")).toBe(1);
  });

  it("follows a rename and drops a key no column claims any more", () => {
    const cells = buildPropertyCommentCells(
      [{ path: "a.md", comments: [comment({ commentId: "1", anchor: propAnchor("state") }), comment({ commentId: "2", anchor: propAnchor("gone") })] }],
      (key) => key === "status",
      (former) => (former === "state" ? "status" : null),
    );
    expect(cells.get("a.md")?.get("status")).toBe(1);
    expect(cells.get("a.md")?.has("gone")).toBe(false);
  });

  it("ignores replies and settled threads - a dot that never leaves is a dot nobody reads", () => {
    const cells = buildPropertyCommentCells(
      [
        {
          path: "a.md",
          comments: [
            comment({ commentId: "root", anchor: propAnchor("status"), resolvedAt: "2026-08-26T11:00:00.000Z" }),
            comment({ commentId: "reply", parentCommentId: "root", anchor: null }),
          ],
        },
      ],
      () => true,
    );
    expect(cells.size).toBe(0);
  });
});

describe("groupSuggestionRounds (V3)", () => {
  const anchor = { markerId: "7f3a", quote: "old", before: "", after: "", approximateOffset: 0 };
  const proposal = (id: string, batch: string | null, index: number, over: Partial<WorkspaceCommentRecord> = {}) =>
    comment({ commentId: id, anchor, suggestion: { replacement: "new", appliedAt: null, appliedBy: null, declinedAt: null }, suggestionBatchId: batch, batchIndex: index, ...over });

  it("keeps the blocks of one send together, in note order, and leaves lone threads alone", () => {
    const threads = buildCommentThreads([
      proposal("b2", "r1", 1, { createdAt: "2026-09-03T10:00:01.000Z" }),
      proposal("b1", "r1", 0, { batchNote: "From the PDF", createdAt: "2026-09-03T10:00:00.000Z" }),
      proposal("single", null, 0),
      comment({ commentId: "plain", body: "hi" }),
      proposal("done", "r1", 2, { createdAt: "2026-09-03T10:00:02.000Z", suggestion: { replacement: "x", appliedAt: "2026-09-03T11:00:00.000Z", appliedBy: "m1", declinedAt: null }, resolvedAt: "2026-09-03T11:00:00.000Z" }),
    ], null, names);
    const { rounds, threads: rest } = groupSuggestionRounds(threads);
    // A lone proposal is a round of one (V4): the proposals tab lists rounds only.
    expect(rounds.map((round) => round.batchId).sort()).toEqual(["r1", "single:single"]);
    expect(rounds.find((round) => round.batchId === "r1")!.blocks).toHaveLength(3);
    expect(rounds[0].batchId).toBe("r1");
    expect(rounds[0].note).toBe("From the PDF");
    expect(rounds[0].createdAt).toBe("2026-09-03T10:00:00.000Z");
    expect(rounds[0].blocks.map((b) => b.root.commentId)).toEqual(["b1", "b2", "done"]);
    expect(rounds[0].open).toBe(2);
    expect(rest.map((thread) => thread.root.commentId)).toEqual(["plain"]);
  });
});

/**
 * The way back from a cell to its thread (finding 2026-09-04): the dot used to
 * say a remark exists and nothing more, so reading one meant opening the entry
 * and hunting for the property by hand.
 */
describe("findPropertyCommentThread", () => {
  const propAnchor = (key: string) =>
    ({
      markerId: "ab12",
      quote: "",
      before: "",
      after: "",
      approximateOffset: 0,
      display: { kind: "property", key },
    }) as WorkspaceCommentRecord["anchor"];

  it("names the oldest open thread on that column and ignores other columns", () => {
    const id = findPropertyCommentThread(
      [
        comment({ commentId: "due-1", anchor: propAnchor("due") }),
        comment({ commentId: "status-2", anchor: propAnchor("status"), createdAt: "2026-09-01T10:00:00.000Z" }),
        comment({ commentId: "status-1", anchor: propAnchor("status"), createdAt: "2026-08-30T10:00:00.000Z" }),
      ],
      "status",
    );
    expect(id).toBe("status-1");
  });

  it("follows a rename exactly as the dot does", () => {
    const comments = [comment({ commentId: "1", anchor: propAnchor("state") })];
    expect(findPropertyCommentThread(comments, "status", (former) => (former === "state" ? "status" : null))).toBe("1");
    expect(findPropertyCommentThread(comments, "status")).toBeNull();
  });

  it("prefers an open thread but still lands on a settled one when nothing is open", () => {
    const settled = comment({ commentId: "old", anchor: propAnchor("status"), resolvedAt: "2026-09-02T10:00:00.000Z" });
    expect(findPropertyCommentThread([settled], "status")).toBe("old");
    expect(findPropertyCommentThread([settled, comment({ commentId: "live", anchor: propAnchor("status") })], "status")).toBe("live");
  });

  it("answers nothing for a column without a remark, and never picks a reply", () => {
    expect(findPropertyCommentThread([comment({ commentId: "1", anchor: propAnchor("status") })], "due")).toBeNull();
    // A reply inherits its thread's anchor and carries none: it has no key.
    expect(findPropertyCommentThread([comment({ commentId: "r", parentCommentId: "1", anchor: null })], "status")).toBeNull();
  });
});
