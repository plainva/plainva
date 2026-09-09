import { describe, it, expect } from "vitest";
import { commentAuthorLabel } from "@plainva/ui";

/**
 * Who a card says wrote it (finding 2026-09-09: "Unknown member" on every own
 * remark in a plain vault whose name field was empty).
 */
const t = (key: string) => key;
const names = new Map([["laptop", "Marco"], ["member-1", "Anna"]]);

describe("commentAuthorLabel", () => {
  it("says 'you' for the reader's own remark, before any name", () => {
    expect(commentAuthorLabel({ authorMemberId: "laptop" }, names, "laptop", t)).toBe("comments.commentAuthorYou");
    expect(commentAuthorLabel({ authorMemberId: "member-1", targetRevisionId: "r1" }, names, "member-1", t)).toBe("comments.commentAuthorYou");
  });

  it("uses the stated name for everybody else", () => {
    expect(commentAuthorLabel({ authorMemberId: "laptop" }, names, "phone", t)).toBe("Marco");
    expect(commentAuthorLabel({ authorMemberId: "member-1", targetRevisionId: "r1" }, names, null, t)).toBe("Anna");
  });

  it("falls back honestly to the store the record came from", () => {
    // An open-path record carries no revision: its author is a device that
    // has not said its name - never an "unknown member".
    expect(commentAuthorLabel({ authorMemberId: "phone" }, names, "laptop", t)).toBe("comments.commentUnnamedDevice");
    // A sealed-path record does: a member the policy does not name.
    expect(commentAuthorLabel({ authorMemberId: "member-9", targetRevisionId: "r1" }, names, "laptop", t)).toBe("comments.commentUnknownAuthor");
  });
});
