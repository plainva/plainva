import { describe, expect, it } from "vitest";
import type { WorkspaceCommentRecord } from "@plainva/core";
import {
  commentExcerpt,
  commentNotificationText,
  commentNoteName,
  type CommentNotificationPlan,
  type NewCommentNotice,
} from "@plainva/ui";

/**
 * What a notification is allowed to SAY (Stufe F, §5 and the testplan's
 * "locked vault" row).
 *
 * This is the privacy half of the stage and it had no test at all until the
 * plan was read back against the code. Everything here is about a lock screen:
 * the assertions state what must NOT appear there, which is the half that
 * cannot be checked by looking at a screenshot of the happy case.
 */
function comment(over: Partial<WorkspaceCommentRecord> & { commentId: string }): WorkspaceCommentRecord {
  return {
    targetObjectId: "notes/Quartalsbericht.md",
    targetRevisionId: "",
    parentCommentId: null,
    authorMemberId: "them",
    authorDeviceId: "device-them",
    operationHash: "",
    payloadHash: "",
    body: "The figure in paragraph three does not match the appendix",
    anchor: null,
    suggestion: null,
    createdAt: "2026-09-02T10:00:00.000Z",
    resolvedCommentId: null,
    resolvedAt: null,
    ...over,
  } as WorkspaceCommentRecord;
}

/** Renders key + params, so an assertion can see exactly what was asked for. */
const t = (key: string, params?: Record<string, unknown>) =>
  params ? `${key} ${JSON.stringify(params)}` : key;

const names = new Map([["them", "Anna"]]);

function notice(over: Partial<NewCommentNotice> = {}): NewCommentNotice {
  const record = comment({ commentId: "c1" });
  return {
    commentId: record.commentId,
    path: "Projekte/Quartalsbericht.md",
    authorMemberId: record.authorMemberId,
    authorDeviceId: record.authorDeviceId,
    body: record.body,
    createdAt: record.createdAt,
    source: "vault",
    reason: "mention",
    ...over,
  };
}

const single: CommentNotificationPlan = { kind: "single", notice: notice(), seen: [] };
const bundle: CommentNotificationPlan = { kind: "bundle", commentCount: 5, noteCount: 2, catchUp: false, seen: [] };

describe("commentNotificationText - with the preview suppressed", () => {
  // The suppressed case is the same whether the USER turned the preview off or
  // the VAULT is locked: callers hand in the conjunction, and the locked half
  // is not negotiable.
  const quiet = (plan: CommentNotificationPlan) => commentNotificationText({ plan, preview: false, names, t })!;

  it("names neither the person, nor the note, nor a word of the text", () => {
    const text = quiet(single);
    const whole = `${text.title} ${text.body}`;
    expect(whole).not.toContain("Anna");
    expect(whole).not.toContain("Quartalsbericht");
    expect(whole).not.toContain("paragraph three");
    expect(text.title).toBe("commentNotify.titleOne");
    expect(text.body).toBe("commentNotify.quiet");
  });

  it("still says how many arrived, because a count reveals nothing about them", () => {
    const text = quiet(bundle);
    expect(text.title).toContain('"count":5');
    expect(text.body).toBe("commentNotify.quiet");
  });

  it("does not leak the publication's name either", () => {
    const guest = { ...single, notice: notice({ source: "publication", publicationName: "Quartalsbericht Q3" }) };
    const whole = Object.values(quiet(guest as CommentNotificationPlan)).join(" ");
    expect(whole).not.toContain("Quartalsbericht");
  });

  it("says nothing at all when there is nothing to say", () => {
    expect(commentNotificationText({ plan: { kind: "none", seen: [] }, preview: false, names, t })).toBeNull();
    expect(commentNotificationText({ plan: { kind: "none", seen: [] }, preview: true, names, t })).toBeNull();
  });
});

describe("commentNotificationText - with the preview on", () => {
  const loud = (plan: CommentNotificationPlan) => commentNotificationText({ plan, preview: true, names, t })!;

  it("names the person and the note for a single remark", () => {
    const text = loud(single);
    expect(text.title).toContain('"author":"Anna"');
    expect(text.title).toContain('"note":"Quartalsbericht"');
    expect(text.body).toBe("The figure in paragraph three does not match the appendix");
  });

  it("falls back to 'someone' rather than showing a raw member id", () => {
    const text = loud({ ...single, notice: notice({ authorMemberId: "unknown-member" }) } as CommentNotificationPlan);
    expect(text.title).toContain("commentNotify.someone");
    expect(text.title).not.toContain("unknown-member");
  });

  it("names the publication a guest wrote from", () => {
    const guest = { ...single, notice: notice({ source: "publication", publicationName: "Q3" }) };
    expect(loud(guest as CommentNotificationPlan).title).toContain("commentNotify.titleGuest");
  });

  it("counts rather than names once more than one is new", () => {
    const text = loud(bundle);
    expect(text.title).toContain('"count":5');
    expect(text.body).toContain('"count":2');
    // A bundle never names a note or a person - there is no single one to name.
    expect(`${text.title} ${text.body}`).not.toContain("Anna");
  });

  it("words a large return as a catch-up", () => {
    const text = loud({ ...bundle, catchUp: true } as CommentNotificationPlan);
    expect(text.title).toContain("commentNotify.titleCatchUp");
  });
});

describe("commentExcerpt and commentNoteName", () => {
  it("collapses whitespace, because a notification renders newlines as gaps", () => {
    expect(commentExcerpt("two\n\nlines   here")).toBe("two lines here");
  });

  it("cuts a long body on a word and marks the cut", () => {
    const long = `${"wort ".repeat(40)}ende`;
    const cut = commentExcerpt(long);
    expect(cut.length).toBeLessThanOrEqual(121);
    expect(cut.endsWith("…")).toBe(true);
    expect(cut).not.toContain("wor…");
  });

  it("leaves a short body exactly as written", () => {
    expect(commentExcerpt("kurz")).toBe("kurz");
  });

  it("names a note the way a person would, not by its path", () => {
    expect(commentNoteName("Projekte/2026/Quartalsbericht.md")).toBe("Quartalsbericht");
    expect(commentNoteName("Ohne Endung")).toBe("Ohne Endung");
  });
});
