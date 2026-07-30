import { describe, expect, it } from "vitest";
import { groupByOrigin, isUnifiedId, mergeInboxes, parseUnifiedId, unifiedId } from "@plainva/ui/mail";

/**
 * The address of a message in a merged list (P9.3b).
 *
 * The danger this exists for is not a crash: a uid is folder- AND account-local,
 * so acting on the wrong one marks, moves or DELETES a different message, quietly.
 * These tests pin exactly that — the identity round-trip, and that a grouped bulk
 * action never hands a uid to an account it does not belong to.
 */

describe("unifiedId", () => {
  it("round-trips an origin", () => {
    const origin = { accountId: "acc-1", mailbox: "INBOX", uid: "1234" };
    const id = unifiedId(origin);
    expect(parseUnifiedId(id)).toEqual(origin);
    expect(isUnifiedId(id)).toBe(true);
  });

  it("survives the folder names people actually have", () => {
    // Spaces, slashes, dots, non-ASCII — the separator must not be any of them.
    for (const mailbox of ["Immobilien Suche", "INBOX/Sub.Folder", "Gesendete Elemente", "受信トレイ"]) {
      const origin = { accountId: "a b c", mailbox, uid: "AAMkAGI2-long==" };
      expect(parseUnifiedId(unifiedId(origin))).toEqual(origin);
    }
  });

  it("treats a plain uid as no origin at all", () => {
    // A single-folder list keeps passing bare ids; that must stay distinguishable
    // from an address, or a fallback would silently act on the wrong folder.
    expect(parseUnifiedId("1234")).toBeNull();
    expect(isUnifiedId("1234")).toBe(false);
    expect(parseUnifiedId("AAMkAGI2LongGraphId==")).toBeNull();
  });

  it("refuses a malformed address instead of guessing", () => {
    expect(parseUnifiedId("acc\u0000INBOX")).toBeNull();
    expect(parseUnifiedId("\u0000INBOX\u00001")).toBeNull();
    expect(parseUnifiedId("acc\u0000INBOX\u0000")).toBeNull();
  });
});

describe("groupByOrigin", () => {
  const a = { id: "acc-a", label: "a@x" };
  const b = { id: "acc-b", label: "b@y" };
  const lookup = (id: string) => [a, b].find((x) => x.id === id) ?? null;

  it("sends every uid to the mailbox it lives in", () => {
    const ids = [
      unifiedId({ accountId: "acc-a", mailbox: "INBOX", uid: "1" }),
      unifiedId({ accountId: "acc-b", mailbox: "Posteingang", uid: "1" }),
      unifiedId({ accountId: "acc-a", mailbox: "INBOX", uid: "2" }),
    ];
    const groups = groupByOrigin(ids, lookup, { account: null, mailbox: "" });
    expect(groups).toHaveLength(2);
    expect(groups.find((g) => g.account === a)).toEqual({ account: a, mailbox: "INBOX", uids: ["1", "2"] });
    // The SAME uid in the other account is a different message. This is the
    // whole point: without the origin both "1"s would have gone to one folder.
    expect(groups.find((g) => g.account === b)).toEqual({ account: b, mailbox: "Posteingang", uids: ["1"] });
  });

  it("separates two folders of the same account", () => {
    const ids = [
      unifiedId({ accountId: "acc-a", mailbox: "INBOX", uid: "7" }),
      unifiedId({ accountId: "acc-a", mailbox: "Sent", uid: "7" }),
    ];
    expect(groupByOrigin(ids, lookup, { account: null, mailbox: "" })).toHaveLength(2);
  });

  it("falls back to the open folder for plain ids", () => {
    expect(groupByOrigin(["5", "6"], lookup, { account: a, mailbox: "Archiv" })).toEqual([
      { account: a, mailbox: "Archiv", uids: ["5", "6"] },
    ]);
  });

  it("drops an id whose account is gone rather than guessing", () => {
    // An account removed while a selection was open. Guessing means acting on
    // someone else's mailbox.
    const ids = [unifiedId({ accountId: "acc-removed", mailbox: "INBOX", uid: "1" })];
    expect(groupByOrigin(ids, lookup, { account: a, mailbox: "INBOX" })).toEqual([]);
  });

  it("drops plain ids when there is no open folder either", () => {
    expect(groupByOrigin(["1"], lookup, { account: null, mailbox: "" })).toEqual([]);
  });
});

describe("mergeInboxes", () => {
  const msg = (id: string, dateTs: number) => ({ id, dateTs });

  it("interleaves accounts newest first", () => {
    const merged = mergeInboxes([
      [msg("a2", 200), msg("a1", 100)],
      [msg("b3", 300), msg("b15", 150)],
    ]);
    expect(merged.map((m) => m.id)).toEqual(["b3", "a2", "b15", "a1"]);
  });

  it("caps PER ACCOUNT, so one busy mailbox cannot crowd the others out", () => {
    const busy = Array.from({ length: 10 }, (_, i) => msg(`busy${i}`, 1000 - i));
    const quiet = [msg("quiet", 1)];
    const merged = mergeInboxes([busy, quiet], 3);
    expect(merged).toHaveLength(4);
    expect(merged.map((m) => m.id)).toContain("quiet");
  });

  it("keeps an empty page harmless", () => {
    expect(mergeInboxes([[], [msg("x", 1)]])).toHaveLength(1);
    expect(mergeInboxes([])).toEqual([]);
  });
});
