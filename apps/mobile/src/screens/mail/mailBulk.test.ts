import { describe, expect, it } from "vitest";
import { unifiedId, type MailEnvelope } from "@plainva/ui/mail";
import { bulkSeenTarget, bulkTargets, runBulk, selectedRows, toggleSelected } from "./mailBulk";

const env = (id: string, seen: boolean): MailEnvelope => ({
  id,
  subject: `s${id}`,
  from: "a@b.c",
  dateTs: 0,
  seen,
  flagged: false,
});

describe("mail bulk selection (G3a)", () => {
  const rows = [env("1", false), env("2", true), env("3", true)];

  it("toggles without mutating the previous selection", () => {
    const first = toggleSelected(new Set<string>(), "2");
    const second = toggleSelected(first, "3");
    expect([...first]).toEqual(["2"]);
    expect([...second]).toEqual(["2", "3"]);
    expect([...toggleSelected(second, "2")]).toEqual(["3"]);
  });

  it("keeps the list order when collecting the selection", () => {
    expect(selectedRows(rows, new Set(["3", "1"])).map((r) => r.id)).toEqual(["1", "3"]);
  });

  it("offers 'mark read' while anything unread is selected, 'mark unread' otherwise", () => {
    expect(bulkSeenTarget(rows, new Set(["1", "2"]))).toBe(true);
    expect(bulkSeenTarget(rows, new Set(["2", "3"]))).toBe(false);
  });

  it("runs one at a time and reports what failed instead of stopping", async () => {
    const order: string[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const outcome = await runBulk(["1", "2", "3"], async (id) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      order.push(id);
      inFlight--;
      if (id === "2") throw new Error("server said no");
    });

    expect(order).toEqual(["1", "2", "3"]); // sequential, and #3 still ran
    expect(maxInFlight).toBe(1); // never two requests at once (the 429 lesson)
    expect(outcome.done).toEqual(["1", "3"]);
    expect(outcome.failed).toEqual(["2"]);
    expect(outcome.error).toBe("server said no");
  });
});

describe("bulkTargets (P9.3c)", () => {
  it("uses the open folder for a flat selection", () => {
    expect(bulkTargets(["12", "13"], "INBOX")).toEqual([
      { box: "INBOX", uid: "12" },
      { box: "INBOX", uid: "13" },
    ]);
  });

  it("follows the message's own folder in a conversation", () => {
    // A thread mixes INBOX and Sent: acting on the open folder would use a uid
    // that means a DIFFERENT message there.
    const sent = unifiedId({ accountId: "a1", mailbox: "Sent", uid: "7" });
    expect(bulkTargets(["12", sent], "INBOX")).toEqual([
      { box: "INBOX", uid: "12" },
      { box: "Sent", uid: "7" },
    ]);
  });

  it("keeps a folder name that contains spaces or slashes intact", () => {
    const id = unifiedId({ accountId: "a1", mailbox: "INBOX/Immobilien Suche", uid: "9" });
    expect(bulkTargets([id], "INBOX")).toEqual([{ box: "INBOX/Immobilien Suche", uid: "9" }]);
  });
});
