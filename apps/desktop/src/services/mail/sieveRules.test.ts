import { describe, expect, it } from "vitest";
import { applySieve, buildRulesSection, buildVacationBody, type MailRule } from "@plainva/ui/mail";

/**
 * Translating rules into Sieve (S15).
 *
 * The properties worth pinning are the ones where a wrong answer costs mail: a
 * rule that cannot be expressed must stay local rather than be uploaded and
 * rejected, a glob metacharacter in a search value must not become a wildcard,
 * and — the reason this step exists — the two halves of Plainva's section must
 * not delete each other.
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

describe("translating a rule", () => {
  it("matches an address on the address, not the raw header", () => {
    // `header :is "from" "chef@firma.de"` could never match `"Chef" <chef@…>`.
    // A comparison that can never be true is worse than a narrow one.
    const out = buildRulesSection([rule({ conditions: [{ field: "from", op: "is", value: "chef@firma.de" }] })]);
    expect(out.body).toContain('address :all :is "from" "chef@firma.de"');
  });

  it("uses the header test for free text", () => {
    const out = buildRulesSection([rule({ conditions: [{ field: "subject", op: "contains", value: "Rechnung" }] })]);
    expect(out.body).toContain('header :contains "subject" "Rechnung"');
  });

  it("turns 'begins with' into a glob, because Sieve has no :startswith", () => {
    const out = buildRulesSection([rule({ conditions: [{ field: "subject", op: "startsWith", value: "Re:" }] })]);
    expect(out.body).toContain('header :matches "subject" "Re:*"');
  });

  it("does not let a star in the search value become a wildcard", () => {
    // The value must reach the server as the two characters \* — written \\* in
    // a quoted string. Getting the escaping order wrong here turns "5*" into a
    // rule that matches everything starting with 5.
    const out = buildRulesSection([rule({ conditions: [{ field: "subject", op: "startsWith", value: "5*" }] })]);
    expect(out.body).toContain('"5\\\\**"');
  });

  it("negates with not, not with a second test", () => {
    const out = buildRulesSection([rule({ conditions: [{ field: "subject", op: "notContains", value: "x" }] })]);
    expect(out.body).toContain("not header :contains");
  });

  it("writes anyof for 'any' and a bare test for a single condition", () => {
    expect(buildRulesSection([rule()]).body).toMatch(/if address/);
    const any = buildRulesSection([
      rule({
        match: "any",
        conditions: [
          { field: "from", op: "contains", value: "a@" },
          { field: "subject", op: "contains", value: "b" },
        ],
      }),
    ]);
    expect(any.body).toContain("anyof(");
  });

  it("puts the junk keyword before the move, as the interactive path does", () => {
    const out = buildRulesSection([rule({ actions: [{ kind: "junk" }] })], { junk: "Junk" });
    expect(out.body.indexOf('addflag "$Junk"')).toBeLessThan(out.body.indexOf("fileinto"));
  });
});

describe("what cannot go server-side stays local", () => {
  it("skips a rule whose extension the server does not have", () => {
    // Uploading it would make the server reject the script as a WHOLE — taking
    // the out-of-office notice down with the rule that caused it.
    const bodyRule = rule({ conditions: [{ field: "body", op: "contains", value: "Rechnung" }] });
    const out = buildRulesSection([bodyRule], {}, ["fileinto", "imap4flags"]);
    expect(out.body).toBe("");
    expect(out.skipped).toEqual([{ id: "r1", reason: "unsupported" }]);
  });

  it("translates that same rule when the server does have the extension", () => {
    const bodyRule = rule({ conditions: [{ field: "body", op: "contains", value: "Rechnung" }] });
    const out = buildRulesSection([bodyRule], {}, ["fileinto", "body"]);
    expect(out.body).toContain("body :text :contains");
    expect(out.skipped).toEqual([]);
  });

  it("translates everything when the server reported nothing", () => {
    // An unknown capability list must not silently disable every rule: a loud
    // rejection on upload is recoverable, a rule that quietly never existed is
    // not.
    expect(buildRulesSection([rule()], {}, undefined).body).not.toBe("");
  });

  it("skips a junk rule when the account has no junk folder", () => {
    const out = buildRulesSection([rule({ actions: [{ kind: "junk" }] })], {});
    expect(out.skipped).toEqual([{ id: "r1", reason: "noMailbox" }]);
  });

  it("skips a rule whose conditions carry no value", () => {
    const out = buildRulesSection([rule({ conditions: [{ field: "from", op: "contains", value: "  " }] })]);
    expect(out.skipped).toEqual([{ id: "r1", reason: "empty" }]);
  });

  it("leaves a switched-off rule out without calling it skipped", () => {
    const out = buildRulesSection([rule({ enabled: false })]);
    expect(out.body).toBe("");
    expect(out.skipped).toEqual([]);
  });
});

describe("the one section both features share", () => {
  const vacation = { enabled: true, message: "Bin weg." };

  it("keeps the notice when the rules are written", () => {
    // This is the bug the step exists to prevent: composing one half alone
    // would let saving a rule delete the out-of-office notice.
    const script = applySieve("", {
      vacationBody: buildVacationBody(vacation)!.body,
      rulesBody: buildRulesSection([rule()]).body,
      extensions: ["vacation", "fileinto"],
    })!;
    expect(script).toContain("vacation");
    expect(script).toContain("fileinto");
  });

  it("requires every extension once, before anything else", () => {
    const script = applySieve("", {
      vacationBody: buildVacationBody(vacation)!.body,
      rulesBody: buildRulesSection([rule()]).body,
      extensions: ["vacation", "fileinto", "fileinto"],
    })!;
    const requires = script.match(/^require .*$/gm) ?? [];
    expect(requires).toHaveLength(1);
    expect(requires[0]).toBe('require ["fileinto", "vacation"];');
    // Sieve allows require only before any other command.
    expect(script.indexOf("require")).toBeLessThan(script.indexOf("vacation "));
  });

  it("leaves a hand-written script above and below untouched", () => {
    const own = 'if header :contains "from" "chef" { fileinto "Wichtig"; }';
    const script = applySieve(`require ["fileinto"];\n${own}\n`, {
      vacationBody: null,
      rulesBody: buildRulesSection([rule()]).body,
      extensions: ["fileinto"],
    })!;
    expect(script).toContain(own);
  });

  it("refuses to write when the markers are in a state Plainva did not produce", () => {
    const broken = "# --- BEGIN PLAINVA (do not edit this section) ---\nvacation \"x\";";
    expect(applySieve(broken, { vacationBody: null, rulesBody: "x", extensions: [] })).toBeNull();
  });

  it("removes the section entirely when neither half has anything to say", () => {
    const script = applySieve("# --- BEGIN PLAINVA (do not edit this section) ---\nvacation \"x\";\n# --- END PLAINVA ---\n", {
      vacationBody: null,
      rulesBody: null,
      extensions: [],
    })!;
    expect(script).not.toContain("BEGIN PLAINVA");
  });
});
