import { describe, expect, it } from "vitest";
import type { WorkspaceCommentRecord } from "@plainva/core";
import {
  commentBaseline,
  planCommentNotifications,
  type CommentNotificationInput,
  type CommentNotificationNote,
} from "@plainva/ui";

/**
 * F1 is the only place this plan can be wrong, and it is the only place that can
 * be checked without a surface (Stufe F, section 8). These pin the rules from
 * section 3 and 4 - what is new, what is mine, what is relevant, what is muted -
 * so neither shell has to rebuild the judgement and drift.
 */
function comment(over: Partial<WorkspaceCommentRecord> & { commentId: string }): WorkspaceCommentRecord {
  return {
    targetObjectId: "notes/a.md",
    targetRevisionId: "",
    parentCommentId: null,
    authorMemberId: "them",
    authorDeviceId: "device-them",
    operationHash: "",
    payloadHash: "",
    body: "a remark",
    anchor: null,
    suggestion: null,
    createdAt: "2026-09-02T10:00:00.000Z",
    resolvedCommentId: null,
    resolvedAt: null,
    ...over,
  } as WorkspaceCommentRecord;
}

const names = new Map([
  ["me", "Ada"],
  ["them", "Bo"],
]);

function plan(
  notes: readonly CommentNotificationNote[],
  over: Partial<CommentNotificationInput> = {},
) {
  return planCommentNotifications({
    notes,
    seen: new Set<string>(),
    selfMemberId: "me",
    selfDeviceId: "device-me",
    names,
    level: "relevant",
    ...over,
  });
}

describe("planCommentNotifications - what never notifies", () => {
  it("never reports my own writing, by member id or by device id", () => {
    const mine = comment({ commentId: "a", authorMemberId: "me", authorDeviceId: "other" });
    // A plain vault has no members at all: there a device IS the author, so the
    // device id has to catch it on its own.
    const mineByDevice = comment({ commentId: "b", authorMemberId: "", authorDeviceId: "device-me" });
    const result = plan([{ path: "n.md", comments: [mine, mineByDevice] }], { level: "all" });
    expect(result.kind).toBe("none");
    // Both are still accounted for - otherwise they would come back as "new"
    // on every following cycle, which is the echo the plan warns about.
    expect(result.seen.sort()).toEqual(["a", "b"]);
  });

  it("reports a foreign comment once and never again", () => {
    const notes = [{ path: "n.md", comments: [comment({ commentId: "a", body: "@Ada look" })] }];
    const first = plan(notes);
    expect(first.kind).toBe("single");
    const second = plan(notes, { seen: new Set(first.seen) });
    expect(second.kind).toBe("none");
  });

  it("stays silent on a muted note but still marks it seen", () => {
    const result = plan([{ path: "quiet.md", comments: [comment({ commentId: "a", body: "@Ada look" })] }], {
      mutedPaths: new Set(["quiet.md"]),
    });
    expect(result.kind).toBe("none");
    // Marking it seen is what makes rule 3 hold: un-muting must not release a
    // backlog of everything that arrived while it was quiet.
    expect(result.seen).toEqual(["a"]);
  });

  it("never reports into a settled thread, however it was settled", () => {
    const resolved = comment({ commentId: "r", resolvedAt: "2026-09-02T11:00:00.000Z" });
    const applied = comment({
      commentId: "s",
      suggestion: { replacement: "x", appliedAt: "2026-09-02T11:00:00.000Z", appliedBy: "me", declinedAt: null },
    });
    const replyToResolved = comment({ commentId: "r2", parentCommentId: "r", body: "@Ada still?" });
    const replyToApplied = comment({ commentId: "s2", parentCommentId: "s", body: "@Ada still?" });
    const result = plan(
      [{ path: "n.md", comments: [resolved, applied, replyToResolved, replyToApplied] }],
      { level: "all" },
    );
    expect(result.kind).toBe("none");
  });
});

describe("planCommentNotifications - the three levels", () => {
  const mention = comment({ commentId: "m", body: "could @Ada check this" });
  const plainRemark = comment({ commentId: "p", body: "a thought" });

  it("level 1 reports mentions and nothing else", () => {
    const result = plan([{ path: "n.md", comments: [mention, plainRemark] }], { level: "mentions" });
    expect(result.kind).toBe("single");
    expect(result.kind === "single" && result.notice.reason).toBe("mention");
  });

  it("level 3 reports every foreign remark", () => {
    const result = plan([{ path: "n.md", comments: [mention, plainRemark] }], { level: "all" });
    expect(result.kind).toBe("bundle");
    expect(result.kind === "bundle" && result.commentCount).toBe(2);
  });

  it("level 2 takes a reply in a thread I wrote in, even joining halfway", () => {
    const root = comment({ commentId: "root" });
    const mine = comment({ commentId: "mine", parentCommentId: "root", authorMemberId: "me" });
    const answer = comment({ commentId: "answer", parentCommentId: "mine" });
    const result = plan([{ path: "n.md", comments: [root, mine, answer] }], { seen: new Set(["root", "mine"]) });
    expect(result.kind).toBe("single");
    expect(result.kind === "single" && result.notice.reason).toBe("reply-to-me");
  });

  it("level 2 takes a remark on a note of mine, and leaves a stranger's note alone", () => {
    const result = plan(
      [
        { path: "mine.md", comments: [comment({ commentId: "a" })] },
        { path: "theirs.md", comments: [comment({ commentId: "b" })] },
      ],
      { ownedPaths: new Set(["mine.md"]) },
    );
    expect(result.kind).toBe("single");
    expect(result.kind === "single" && result.notice.path).toBe("mine.md");
  });

  it("level 2 takes the verdict on a proposal of mine", () => {
    const proposal = comment({
      commentId: "prop",
      authorMemberId: "me",
      suggestion: { replacement: "x", appliedAt: null, appliedBy: null, declinedAt: null },
    });
    const verdict = comment({ commentId: "v", suggestionOutcome: "declined", resolvedCommentId: "prop" });
    const result = plan([{ path: "n.md", comments: [proposal, verdict] }], { seen: new Set(["prop"]) });
    expect(result.kind).toBe("single");
    expect(result.kind === "single" && result.notice.reason).toBe("my-suggestion-decided");
  });

  it("a mention wins the wording over a reply, because it is the stronger claim", () => {
    const root = comment({ commentId: "root", authorMemberId: "me" });
    const reply = comment({ commentId: "r", parentCommentId: "root", body: "@Ada what do you think" });
    const result = plan([{ path: "n.md", comments: [root, reply] }], { seen: new Set(["root"]) });
    expect(result.kind === "single" && result.notice.reason).toBe("mention");
  });
});

describe("planCommentNotifications - what stands outside the levels", () => {
  it("reports a guest remark on the quietest level", () => {
    const result = plan(
      [
        {
          path: "shared.md",
          comments: [comment({ commentId: "g", body: "a question" })],
          source: "publication",
          publicationName: "Quartalsbericht",
        },
      ],
      { level: "mentions" },
    );
    expect(result.kind).toBe("single");
    expect(result.kind === "single" && result.notice.reason).toBe("guest");
    expect(result.kind === "single" && result.notice.publicationName).toBe("Quartalsbericht");
  });

  it("reports a suggestion waiting on my own note, but not one on a stranger's", () => {
    const waiting = (id: string) =>
      comment({ commentId: id, suggestion: { replacement: "x", appliedAt: null, appliedBy: null, declinedAt: null } });
    const onMine = plan([{ path: "mine.md", comments: [waiting("a")] }], {
      level: "mentions",
      ownedPaths: new Set(["mine.md"]),
    });
    expect(onMine.kind === "single" && onMine.notice.reason).toBe("suggestion-awaiting-me");
    // Without ownership it is somebody else's decision to make, so it is not
    // "awaiting me" and falls back to the level - which reports nothing here.
    const onTheirs = plan([{ path: "theirs.md", comments: [waiting("b")] }], { level: "mentions" });
    expect(onTheirs.kind).toBe("none");
  });
});

describe("planCommentNotifications - one message per cycle", () => {
  it("bundles five remarks in two notes into one message", () => {
    const result = plan(
      [
        { path: "a.md", comments: [comment({ commentId: "1" }), comment({ commentId: "2" }), comment({ commentId: "3" })] },
        { path: "b.md", comments: [comment({ commentId: "4" }), comment({ commentId: "5" })] },
      ],
      { level: "all" },
    );
    expect(result).toMatchObject({ kind: "bundle", commentCount: 5, noteCount: 2, catchUp: false });
  });

  it("calls a large return a catch-up, so the wording can differ", () => {
    const many = Array.from({ length: 12 }, (_unused, index) => comment({ commentId: `c${index}` }));
    const result = plan([{ path: "a.md", comments: many }], { level: "all" });
    expect(result.kind === "bundle" && result.catchUp).toBe(true);
  });

  it("names note and person only when exactly one is new", () => {
    const result = plan([{ path: "a.md", comments: [comment({ commentId: "1", body: "the one" })] }], { level: "all" });
    expect(result).toMatchObject({
      kind: "single",
      notice: { path: "a.md", authorMemberId: "them", body: "the one" },
    });
  });
});

describe("commentBaseline", () => {
  it("collects every id present, so switching on reports nothing that predates it", () => {
    const notes = [
      { path: "a.md", comments: [comment({ commentId: "1" }), comment({ commentId: "2" })] },
      { path: "b.md", comments: [comment({ commentId: "3" })] },
    ];
    const baseline = commentBaseline(notes);
    expect(baseline.sort()).toEqual(["1", "2", "3"]);
    // FB3 in one assertion: the cycle right after switching on is silent.
    expect(plan(notes, { seen: new Set(baseline), level: "all" }).kind).toBe("none");
  });
});
