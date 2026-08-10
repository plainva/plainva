import { describe, expect, it } from "vitest";
import { buildGraphRules, GRAPH_RULE_PREFIX, isPlainvaRule, type MailRule } from "@plainva/ui/mail";

/**
 * Translating rules into Microsoft message rules (S16).
 *
 * Graph is the narrower of the two targets, and every place it is narrower is a
 * place where approximating would file mail the user never pointed at. What is
 * pinned here is that those places produce a NAMED skip, not a near-miss.
 */

const folders = new Map([
  ["Lesen", "AAA-lesen"],
  ["Junk", "AAA-junk"],
]);

const rule = (over: Partial<MailRule> = {}): MailRule => ({
  id: "r1",
  name: "Newsletter",
  enabled: true,
  match: "all",
  conditions: [{ field: "from", op: "contains", value: "newsletter@" }],
  actions: [{ kind: "moveTo", mailbox: "Lesen" }],
  ...over,
});

describe("translating", () => {
  it("maps a sender rule onto senderContains and the folder id", () => {
    const out = buildGraphRules([rule()], folders);
    expect(out.rules[0].conditions).toEqual({ senderContains: ["newsletter@"] });
    expect(out.rules[0].actions).toEqual({ moveToFolder: "AAA-lesen" });
    expect(out.rules[0].displayName).toBe(`${GRAPH_RULE_PREFIX}Newsletter`);
  });

  it("puts a negated condition into exceptions, not into conditions", () => {
    // Folding it into `conditions` would invert the rule — Graph models the
    // negative case as an exception, which is exactly what this is.
    const out = buildGraphRules(
      [
        rule({
          conditions: [
            { field: "from", op: "contains", value: "newsletter@" },
            { field: "subject", op: "notContains", value: "Rechnung" },
          ],
        }),
      ],
      folders
    );
    expect(out.rules[0].conditions).toEqual({ senderContains: ["newsletter@"] });
    expect(out.rules[0].exceptions).toEqual({ subjectContains: ["Rechnung"] });
  });

  it("collapses 'any' over one field into a single array", () => {
    const out = buildGraphRules(
      [
        rule({
          match: "any",
          conditions: [
            { field: "from", op: "contains", value: "a@" },
            { field: "from", op: "contains", value: "b@" },
          ],
        }),
      ],
      folders
    );
    expect(out.rules[0].conditions).toEqual({ senderContains: ["a@", "b@"] });
  });

  it("runs after the rules the user wrote by hand", () => {
    // Someone who wrote a rule meant it to come first; a translated rule
    // overtaking it would change behaviour nobody asked to change.
    const out = buildGraphRules([rule()], folders, {}, 7);
    expect(out.rules[0].sequence).toBe(7);
  });
});

describe("what Graph cannot express stays local", () => {
  it("skips 'is exactly', because Graph only compares with contains", () => {
    // Widening "is" to "contains" would file mail the user never pointed at.
    const out = buildGraphRules([rule({ conditions: [{ field: "from", op: "is", value: "chef@firma.de" }] })], folders);
    expect(out.rules).toEqual([]);
    expect(out.skipped).toEqual([{ id: "r1", reason: "unsupported" }]);
  });

  it("skips a cc rule, because recipientContains also matches To", () => {
    const out = buildGraphRules([rule({ conditions: [{ field: "cc", op: "contains", value: "team@" }] })], folders);
    expect(out.skipped).toEqual([{ id: "r1", reason: "unsupported" }]);
  });

  it("skips 'flag', which Graph message rules cannot set", () => {
    const out = buildGraphRules([rule({ actions: [{ kind: "flag" }] })], folders);
    expect(out.skipped).toEqual([{ id: "r1", reason: "unsupported" }]);
  });

  it("skips 'any' across DIFFERENT fields, which Graph ANDs", () => {
    const out = buildGraphRules(
      [
        rule({
          match: "any",
          conditions: [
            { field: "from", op: "contains", value: "a@" },
            { field: "subject", op: "contains", value: "b" },
          ],
        }),
      ],
      folders
    );
    expect(out.skipped).toEqual([{ id: "r1", reason: "unsupported" }]);
  });

  it("skips a rule that would have only exceptions", () => {
    // A rule with nothing to match would apply to every message.
    const out = buildGraphRules([rule({ conditions: [{ field: "subject", op: "notContains", value: "x" }] })], folders);
    expect(out.skipped).toEqual([{ id: "r1", reason: "empty" }]);
  });

  it("skips a move into a folder the account does not have", () => {
    const out = buildGraphRules([rule({ actions: [{ kind: "moveTo", mailbox: "Nirgendwo" }] })], folders);
    expect(out.skipped).toEqual([{ id: "r1", reason: "noMailbox" }]);
  });

  it("translates trash as a move to Deleted Items, never a permanent delete", () => {
    const out = buildGraphRules([rule({ actions: [{ kind: "trash" }] })], folders);
    expect(out.rules[0].actions).toEqual({ delete: true });
  });
});

describe("ownership", () => {
  it("recognises only what Plainva named", () => {
    // Everything else in the mailbox is somebody else's and is never touched.
    expect(isPlainvaRule(`${GRAPH_RULE_PREFIX}Newsletter`)).toBe(true);
    expect(isPlainvaRule("Meine eigene Regel")).toBe(false);
  });
});
