import { describe, expect, it, vi } from "vitest";
import { findMoved, undoMoveToTrash } from "./undoMove";

/**
 * Undoing a move (S30). A move re-assigns the uid, so the old id cannot be
 * used to find the message again — and identifying the WRONG one would be
 * worse than admitting we cannot.
 */
describe("finding a moved message again", () => {
  const ref = { subject: "Rechnung", dateTs: 1000, from: "a@example.com" };
  const row = (over: Partial<typeof ref> & { id: string }) => ({ ...ref, ...over });

  it("matches on subject, date and sender together", () => {
    const hit = findMoved([row({ id: "9" }), row({ id: "8", subject: "Anderes" })], ref);
    expect(hit).toEqual(expect.objectContaining({ id: "9" }));
  });

  it("refuses when two candidates look the same", () => {
    // Two identical-looking messages: moving the wrong one back is worse than
    // telling the user where it is.
    expect(findMoved([row({ id: "9" }), row({ id: "10" })], ref)).toBe("ambiguous");
  });

  it("does not settle for a partial match", () => {
    expect(findMoved([row({ id: "9", dateTs: 999 })], ref)).toBe("notFound");
    expect(findMoved([row({ id: "9", from: "b@example.com" })], ref)).toBe("notFound");
  });

  it("moves it back only when it is certain", async () => {
    const moveMessage = vi.fn(async () => undefined);
    const out = await undoMoveToTrash(
      { listNewest: async () => [row({ id: "42" })], moveMessage },
      ref,
      "Trash",
      "INBOX",
    );
    expect(out).toBe("ok");
    expect(moveMessage).toHaveBeenCalledWith("Trash", "42", "INBOX");
  });

  it("touches nothing when it is not certain", async () => {
    const moveMessage = vi.fn(async () => undefined);
    const out = await undoMoveToTrash(
      { listNewest: async () => [row({ id: "1" }), row({ id: "2" })], moveMessage },
      ref,
      "Trash",
      "INBOX",
    );
    expect(out).toBe("ambiguous");
    expect(moveMessage).not.toHaveBeenCalled();
  });
});
