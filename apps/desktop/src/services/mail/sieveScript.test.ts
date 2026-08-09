import { describe, expect, it } from "vitest";
import { SIEVE_BEGIN, SIEVE_END, applyVacation, buildVacationSection, splitSieve, writeSieveSection } from "@plainva/ui/mail";

/**
 * Plainva's section inside someone else's Sieve script (S13, E4).
 *
 * The guarantee worth testing is not that the vacation rule is pretty — it is
 * that everything Plainva did not write survives untouched, and that a script
 * it cannot parse is refused rather than overwritten. A server-side filter is
 * where a silently lost line costs real mail.
 */

const FOREIGN = `require ["fileinto"];

# my own rule, written by hand
if header :contains "from" "chef@example.org" {
  fileinto "Wichtig";
  stop;
}`;

describe("splitting a script", () => {
  it("treats a script without markers as entirely foreign", () => {
    expect(splitSieve(FOREIGN)).toEqual({ before: FOREIGN, section: null, after: "" });
  });

  it("refuses a script whose section was never closed", () => {
    // Guessing where the section ends would eat whatever follows it.
    expect(splitSieve(`${FOREIGN}\n${SIEVE_BEGIN}\nvacation "hi";`)).toBeNull();
  });

  it("keeps what stands before and after the section", () => {
    const script = `${FOREIGN}\n\n${SIEVE_BEGIN}\nvacation "hi";\n${SIEVE_END}\n\n# trailing rule\nkeep;`;
    const split = splitSieve(script);
    expect(split?.before.trim()).toBe(FOREIGN);
    expect(split?.section).toBe('vacation "hi";');
    expect(split?.after.trim()).toBe("# trailing rule\nkeep;");
  });
});

describe("writing the section back", () => {
  it("leaves a foreign script byte-for-byte when the notice is off", () => {
    // Nothing to add and nothing of Plainva's in there: the file must come back
    // as it went in, apart from a trailing newline.
    expect(writeSieveSection(FOREIGN, null)).toBe(FOREIGN + "\n");
  });

  it("carries foreign rules through an update", () => {
    const first = writeSieveSection(FOREIGN, 'vacation "away";') ?? "";
    const second = writeSieveSection(first, 'vacation "still away";') ?? "";
    expect(second).toContain("chef@example.org");
    expect(second).toContain("still away");
    expect(second).not.toContain('vacation "away";');
    // ...and exactly one section, not two.
    expect(second.split(SIEVE_BEGIN)).toHaveLength(2);
  });

  it("removes the section without taking the neighbours with it", () => {
    const withSection = `${FOREIGN}\n\n${SIEVE_BEGIN}\nvacation "away";\n${SIEVE_END}\n\nkeep;`;
    const cleared = writeSieveSection(withSection, null) ?? "";
    expect(cleared).toContain("chef@example.org");
    expect(cleared).toContain("keep;");
    expect(cleared).not.toContain(SIEVE_BEGIN);
  });

  it("refuses to write into a script it cannot parse", () => {
    expect(writeSieveSection(`${SIEVE_BEGIN}\nvacation "x";`, 'vacation "y";')).toBeNull();
  });
});

describe("the vacation rule", () => {
  const base = { enabled: true, message: "Ich bin bis Montag nicht da." };

  it("is nothing at all when switched off", () => {
    expect(buildVacationSection({ ...base, enabled: false })).toBeNull();
    // An empty text is the same thing: an auto-reply that says nothing is worse
    // than none, and the server would reject it anyway.
    expect(buildVacationSection({ ...base, message: "   " })).toBeNull();
  });

  it("requires the extension it uses", () => {
    expect(buildVacationSection(base)?.section).toContain('require ["vacation"];');
  });

  it("puts the date window into the SCRIPT, not into a client that must stay open", () => {
    const built = buildVacationSection({ ...base, from: "2026-08-10", to: "2026-08-20" });
    expect(built?.section).toContain('currentdate :value "ge" "date" "2026-08-10"');
    expect(built?.section).toContain('currentdate :value "le" "date" "2026-08-20"');
    expect(built?.extensions).toEqual(expect.arrayContaining(["date", "relational"]));
    expect(built?.section).toContain('require ["date", "relational", "vacation"];');
  });

  it("escapes a subject that carries quotes", () => {
    const built = buildVacationSection({ ...base, subject: 'Re: "Urlaub"' });
    expect(built?.section).toContain(':subject "Re: \\"Urlaub\\""');
  });

  it("stuffs a leading dot so the body cannot end the literal early", () => {
    const built = buildVacationSection({ ...base, message: "Hallo\n.\nTschüss" });
    expect(built?.section).toContain("\n..\n");
  });

  it("names the addresses this mailbox answers for", () => {
    const built = buildVacationSection({ ...base, addresses: ["a@example.org", "b@example.org"] });
    expect(built?.section).toContain(':addresses ["a@example.org", "b@example.org"]');
  });
});

describe("applying it end to end", () => {
  it("adds, updates and removes without ever touching the foreign part", () => {
    const on = applyVacation(FOREIGN, { enabled: true, message: "weg" }) ?? "";
    expect(on).toContain("chef@example.org");
    const off = applyVacation(on, { enabled: false, message: "weg" }) ?? "";
    expect(off).toContain("chef@example.org");
    expect(off).not.toContain("vacation");
  });
});
