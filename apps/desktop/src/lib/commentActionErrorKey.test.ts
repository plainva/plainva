import { describe, expect, it } from "vitest";
import { CommentOperationError, OPEN_CONFLICT_MESSAGE, OpenConflictError } from "@plainva/core";
import { commentActionErrorKey } from "@plainva/ui";

/**
 * A remark at a note with an open conflict (Sammelplan § 3.87 no. 2): the
 * chain writes no whole text over the user's own version, and the comment
 * operation ends as a storage failure. It read "The operation was not fully
 * saved. Retrying continues its pending steps." — no retry gets past the
 * conflict. Both shells take the key from here.
 */
describe("commentActionErrorKey: a remark refused by an open conflict", () => {
  it("names the open conflict, whether the cause kept its class or only its text", () => {
    expect(commentActionErrorKey(new CommentOperationError("op", "prepared", "storage", { cause: new OpenConflictError("Note.CONFLICT-1.md") }))).toBe("writeFailed.openConflict");
    expect(commentActionErrorKey(new CommentOperationError("op", "prepared", "storage", { cause: OPEN_CONFLICT_MESSAGE }))).toBe("writeFailed.openConflict");
  });

  it("leaves every other storage failure to the sentence of a retry", () => {
    expect(commentActionErrorKey(new CommentOperationError("op", "prepared", "storage", { cause: new Error("disk full") }))).toBe("comments.operationSaveFailed");
    expect(commentActionErrorKey(new CommentOperationError("op", "prepared", "needs-review"))).toBe("comments.operationNeedsReview");
  });
});
