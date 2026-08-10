import { describe, expect, it, vi } from "vitest";
import { actionsFor, matchesCondition, matchesRule, needsBody, runRules, sanitizeRules, type MailRule } from "@plainva/ui/mail";

/**
 * Mail rules (S14).
 *
 * The properties worth pinning are the ones that decide whether a rule can be
 * trusted with someone's mail: an unknown field never counts as a match, a
 * message that leaves the folder is not acted on twice, and one failure does
 * not cost the rest of the run.
 */

const rule = (over: Partial<MailRule> = {}): MailRule => ({
  id: "r1",
  name: "Newsletter",
  enabled: true,
  match: "all",
  conditions: [{ field: "from", op: "contains", value: "newsletter@" }],
  actions: [{ kind: "moveTo", mailbox: "Lesen/Newsletter" }],
  ...over,
});

describe("matching one condition", () => {
  it("ignores case, because addresses and subjects do", () => {
    expect(matchesCondition({ field: "from", op: "contains", value: "NEWSLETTER@" }, { from: "newsletter@example.org" })).toBe(true);
  });

  it("does not match a field the message does not carry", () => {
    expect(matchesCondition({ field: "subject", op: "contains", value: "x" }, {})).toBe(false);
  });

  it("does not match NEGATIVELY on a field it never saw either", () => {
    // "the subject does not contain X" on a subject that was never loaded is
    // not true, it is unknown — and acting on unknown files mail nobody asked
    // it to file.
    expect(matchesCondition({ field: "subject", op: "notContains", value: "x" }, {})).toBe(false);
  });

  it("reads a named header", () => {
    expect(
      matchesCondition({ field: "header", op: "contains", value: "plainva", header: "List-Id" }, { headers: { "list-id": "<dev.plainva.org>" } })
    ).toBe(true);
  });

  it("treats an empty search value as no condition at all", () => {
    expect(matchesCondition({ field: "subject", op: "contains", value: "" }, { subject: "anything" })).toBe(false);
  });
});

describe("matching a rule", () => {
  it("needs every condition with 'all'", () => {
    const r = rule({ conditions: [
      { field: "from", op: "contains", value: "newsletter@" },
      { field: "subject", op: "notContains", value: "Rechnung" },
    ] });
    expect(matchesRule(r, { from: "newsletter@x.org", subject: "Neues" })).toBe(true);
    expect(matchesRule(r, { from: "newsletter@x.org", subject: "Ihre Rechnung" })).toBe(false);
  });

  it("needs only one with 'any'", () => {
    const r = rule({ match: "any", conditions: [
      { field: "from", op: "contains", value: "a@" },
      { field: "subject", op: "contains", value: "Bericht" },
    ] });
    expect(matchesRule(r, { from: "z@x.org", subject: "Bericht Q3" })).toBe(true);
  });

  it("never fires while switched off", () => {
    expect(matchesRule(rule({ enabled: false }), { from: "newsletter@x.org" })).toBe(false);
  });

  it("never fires without conditions", () => {
    // An empty condition list would otherwise mean "every message", which
    // nobody means and which would empty an inbox on the first run.
    expect(matchesRule(rule({ conditions: [] }), { from: "anyone@x.org" })).toBe(false);
  });
});

describe("collecting actions", () => {
  it("keeps the order the rules are in", () => {
    const rules = [
      rule({ id: "a", actions: [{ kind: "markRead" }] }),
      rule({ id: "b", actions: [{ kind: "flag" }] }),
    ];
    expect(actionsFor(rules, { from: "newsletter@x.org" })).toEqual([{ kind: "markRead" }, { kind: "flag" }]);
  });

  it("stops at a stop", () => {
    const rules = [
      rule({ id: "a", actions: [{ kind: "markRead" }, { kind: "stop" }] }),
      rule({ id: "b", actions: [{ kind: "flag" }] }),
    ];
    expect(actionsFor(rules, { from: "newsletter@x.org" })).toEqual([{ kind: "markRead" }]);
  });

  it("says when a rule needs a body Plainva has not fetched", () => {
    expect(needsBody([rule({ conditions: [{ field: "body", op: "contains", value: "x" }] })])).toBe(true);
    expect(needsBody([rule()])).toBe(false);
  });
});

describe("running them", () => {
  const ops = () => ({
    moveTo: vi.fn(async () => {}),
    markRead: vi.fn(async () => {}),
    flag: vi.fn(async () => {}),
    junk: vi.fn(async () => {}),
    trash: vi.fn(async () => {}),
  });

  it("acts on the messages that match and leaves the rest alone", async () => {
    const o = ops();
    const result = await runRules([rule()], [
      { id: "1", from: "newsletter@x.org" },
      { id: "2", from: "chef@x.org" },
    ], o);
    expect(result.acted).toEqual(["1"]);
    expect(result.removed).toEqual(["1"]);
    expect(o.moveTo).toHaveBeenCalledTimes(1);
  });

  it("does not touch a message again after it has left the folder", async () => {
    // The uid here no longer means what it meant a moment ago — on IMAP it can
    // be a DIFFERENT message.
    const o = ops();
    await runRules([rule({ actions: [{ kind: "moveTo", mailbox: "X" }, { kind: "markRead" }] })], [{ id: "1", from: "newsletter@x.org" }], o);
    expect(o.moveTo).toHaveBeenCalledTimes(1);
    expect(o.markRead).not.toHaveBeenCalled();
  });

  it("lets one message's failure cost only that message", async () => {
    const o = ops();
    o.moveTo.mockImplementationOnce(async () => { throw new Error("no such mailbox"); });
    const result = await runRules([rule()], [
      { id: "1", from: "newsletter@x.org" },
      { id: "2", from: "newsletter@x.org" },
    ], o);
    expect(o.moveTo).toHaveBeenCalledTimes(2);
    expect(result.acted).toContain("2");
  });

  it("does nothing at all when every rule is switched off", async () => {
    const o = ops();
    expect(await runRules([rule({ enabled: false })], [{ id: "1", from: "newsletter@x.org" }], o)).toEqual({ acted: [], removed: [] });
    expect(o.moveTo).not.toHaveBeenCalled();
  });
});

describe("reading them back", () => {
  it("drops what is not a rule instead of failing", () => {
    // A settings file from a newer version must not stop mail from loading.
    expect(sanitizeRules([rule(), null, { id: 1 }, "nope"])).toHaveLength(1);
    expect(sanitizeRules("garbage")).toEqual([]);
  });
});
