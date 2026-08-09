import { describe, expect, it, vi } from "vitest";
import { applyJunk, isJunkFolder, pickJunkFolder, planJunkAction, type JunkItem } from "@plainva/ui/mail";

/**
 * Spam and not-spam (S12).
 *
 * Two properties carry this feature, and both are easy to get quietly wrong:
 * the keyword must be set BEFORE the move (afterwards the uid is gone), and a
 * server refusing the keyword must not cost the move. Everything else is which
 * folder the button points at.
 */

const boxes = [
  { name: "INBOX", role: "inbox" },
  { name: "Junk", delimiter: "/" },
  { name: "Papierkorb" },
];

describe("finding the junk folder", () => {
  it("prefers a stated role over the name", () => {
    // Graph localizes its folder names, so a name list would miss them.
    expect(pickJunkFolder([{ name: "Unerwünschte E-Mail", role: "junk" }, { name: "Junk" }])).toBe("Unerwünschte E-Mail");
  });

  it("falls back to the localized name", () => {
    expect(pickJunkFolder([{ name: "INBOX", role: "inbox" }, { name: "Posta indesiderata" }])).toBe("Posta indesiderata");
  });

  it("reports nothing rather than guessing a name", () => {
    // The moment the UI offers to create one — moving mail into an invented
    // folder name would just produce a server error.
    expect(pickJunkFolder([{ name: "INBOX", role: "inbox" }])).toBeNull();
  });

  it("does not mistake a user folder for the junk folder", () => {
    expect(pickJunkFolder([{ name: "INBOX" }, { name: "Junker" }])).toBeNull();
  });
});

describe("which way the button points", () => {
  it("reports spam from an ordinary folder", () => {
    expect(planJunkAction("INBOX", boxes)).toEqual({ direction: "report", target: "Junk" });
  });

  it("takes it back from inside the junk folder", () => {
    expect(planJunkAction("Junk", boxes)).toEqual({ direction: "notJunk", target: "INBOX" });
  });

  it("recognizes the junk folder by its stated role too", () => {
    const graph = [{ name: "Posteingang", role: "inbox" }, { name: "Unerwünschte E-Mail", role: "junk" }];
    expect(isJunkFolder("Unerwünschte E-Mail", graph)).toBe(true);
    expect(planJunkAction("Unerwünschte E-Mail", graph).direction).toBe("notJunk");
  });

  it("offers no target when the account has no junk folder", () => {
    expect(planJunkAction("INBOX", [{ name: "INBOX", role: "inbox" }])).toEqual({ direction: "report", target: null });
  });
});

describe("applying it", () => {
  const items: JunkItem[] = [{ mailbox: "INBOX", uid: "7" }];

  it("marks before it moves", async () => {
    // After the move the message carries a NEW uid in the target mailbox and
    // the old one no longer exists — marking afterwards would mark nothing.
    const order: string[] = [];
    await applyJunk(items, "Junk", true, {
      setJunk: async () => void order.push("mark"),
      move: async () => void order.push("move"),
    });
    expect(order).toEqual(["mark", "move"]);
  });

  it("moves even when the server refuses the keyword", async () => {
    const move = vi.fn(async () => {});
    const result = await applyJunk(items, "Junk", true, {
      setJunk: async () => {
        throw new Error("BAD Invalid system flag");
      },
      move,
    });
    expect(move).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ moved: 1, flagged: 0 });
  });

  it("counts what actually stuck", async () => {
    // The number the caller needs to tell "moved" from "trained".
    const result = await applyJunk(items, "Junk", true, { setJunk: async () => {}, move: async () => {} });
    expect(result).toEqual({ moved: 1, flagged: 1 });
  });

  it("works without a keyword backend at all", async () => {
    // Microsoft Graph: no custom keywords, the move is the whole signal.
    const result = await applyJunk(items, "Junk", true, { move: async () => {} });
    expect(result).toEqual({ moved: 1, flagged: 0 });
  });

  it("lets a failing move surface", async () => {
    // The keyword is decoration; the move is the action. Swallowing this would
    // report success for a message that never left the folder.
    await expect(
      applyJunk(items, "Junk", true, { move: async () => { throw new Error("no such mailbox"); } })
    ).rejects.toThrow("no such mailbox");
  });

  it("passes the direction through to the keyword", async () => {
    const setJunk = vi.fn(async () => {});
    await applyJunk(items, "INBOX", false, { setJunk, move: async () => {} });
    expect(setJunk).toHaveBeenCalledWith({ mailbox: "INBOX", uid: "7" }, false);
  });

  it("carries a whole selection", async () => {
    const many: JunkItem[] = [
      { mailbox: "INBOX", uid: "1" },
      { mailbox: "INBOX", uid: "2" },
      { mailbox: "Andere", uid: "3" },
    ];
    const move = vi.fn(async () => {});
    expect(await applyJunk(many, "Junk", true, { setJunk: async () => {}, move })).toEqual({ moved: 3, flagged: 3 });
    expect(move).toHaveBeenNthCalledWith(3, { mailbox: "Andere", uid: "3" }, "Junk");
  });
});
