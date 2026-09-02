import { describe, expect, it, beforeEach } from "vitest";
import { clearCommentJump, requestCommentJump, takeCommentJump } from "@plainva/ui";

/**
 * The jump had to exist before three surfaces could use it (Stufe F, §6): the
 * overview, a notification and the phone's sheet all want to land ON a card
 * rather than merely in the note. These pin the two rules that make it safe to
 * park a request rather than call into a component tree.
 */
describe("comment jump", () => {
  beforeEach(() => clearCommentJump());

  it("hands the request to the note it names, and to no other", () => {
    requestCommentJump({ path: "a.md", commentId: "c1" });
    expect(takeCommentJump("b.md")).toBeNull();
    expect(takeCommentJump("a.md")).toEqual({ path: "a.md", commentId: "c1" });
  });

  it("fires once, so a re-render cannot re-select the card", () => {
    requestCommentJump({ path: "a.md", commentId: "c1" });
    expect(takeCommentJump("a.md")).not.toBeNull();
    // A card that re-selects itself on every render could never be deselected
    // by clicking it - which is what a surviving request would cause.
    expect(takeCommentJump("a.md")).toBeNull();
  });

  it("answers nothing when no note is open", () => {
    requestCommentJump({ path: "a.md", commentId: "c1" });
    expect(takeCommentJump(null)).toBeNull();
  });

  it("keeps only the newest request", () => {
    requestCommentJump({ path: "a.md", commentId: "c1" });
    requestCommentJump({ path: "b.md", commentId: "c2" });
    expect(takeCommentJump("a.md")).toBeNull();
    expect(takeCommentJump("b.md")).toEqual({ path: "b.md", commentId: "c2" });
  });
});
