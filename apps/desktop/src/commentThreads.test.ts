import { describe, expect, it } from "vitest";
import type { WorkspaceCommentRecord } from "@plainva/core";
import { buildCommentOverview, buildCommentThreads, buildPropertyCommentCells, isCommentThreadOpen } from "@plainva/ui";

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
