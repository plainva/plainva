import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every row is its address (plan P1) — held at the source, for both shells.
 *
 * Each action, list patch, selection and snooze reads a row's account and
 * folder off its id. That holds only while EVERY list a mail screen keeps is
 * named by its address where it comes from the transport. A list put in with
 * its bare numbers — the desktop's search hits were, at first — brings the
 * old class straight back: its rows are found nowhere, or found under the
 * number of a message in another folder.
 *
 * So every call that fills a row list with something new must pass it through
 * `addressRows`; emptying a list, clearing it and changing it by a function
 * over its own rows (which keeps their ids) are the other allowed forms.
 */
const root = join(__dirname, "..", "..", "..", "..", "..");
const sources = {
  desktop: readFileSync(join(root, "apps/desktop/src/components/mail/MailView.tsx"), "utf8"),
  phone: readFileSync(join(root, "apps/mobile/src/screens/MailListScreen.tsx"), "utf8"),
};
const setters: Record<keyof typeof sources, string[]> = {
  desktop: ["setEnvelopes", "setSentEnvelopes", "setUnifiedEnvelopes", "setSearchResults", "setFlaggedResults"],
  phone: ["setRows", "setSentRows", "setUnifiedRows", "setSearchRows", "setFlaggedRows"],
};

/** The argument of each call of `name(...)`, as written (one level of parentheses). */
function callArguments(src: string, name: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`\\b${name}\\(`, "g");
  for (let m = re.exec(src); m; m = re.exec(src)) {
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    for (; i < src.length && depth > 0; i++) {
      if (src[i] === "(") depth++;
      else if (src[i] === ")") depth--;
    }
    out.push(src.slice(start, i - 1).trim());
  }
  return out;
}

/** What may fill a list: an addressed list, an empty one, nothing, or a change of the list's own rows. */
function allowed(arg: string): boolean {
  if (/^addressRows\(/.test(arg)) return true;
  if (arg === "[]" || arg === "null") return true;
  // A function over the rows already there (`prev => …`, `change`, `keep`) keeps their ids.
  if (/^\(?\s*\w+\s*\)?\s*=>/.test(arg) || /^(change|keep|apply)$/.test(arg)) return true;
  // A list built by this same rule a line above (`listed`, `mergeInboxes(pages…)` of addressed pages).
  if (/^listed$/.test(arg) || /^mergeInboxes\(pages/.test(arg) || /^\[\.\.\.rows, \.\.\.listed\./.test(arg)) return true;
  return false;
}

describe("every mail row list is filled with addressed rows", () => {
  for (const shell of Object.keys(sources) as Array<keyof typeof sources>) {
    it(`${shell}: no row list takes rows by their bare number`, () => {
      const offenders: string[] = [];
      for (const name of setters[shell]) {
        const calls = callArguments(sources[shell], name);
        expect(calls.length, `${name} is still called`).toBeGreaterThan(0);
        for (const arg of calls) if (!allowed(arg)) offenders.push(`${name}(${arg})`);
      }
      expect(offenders).toEqual([]);
    });
  }

  it("the merged list's pages are addressed before they are merged, in both shells", () => {
    for (const src of Object.values(sources)) expect(src).toMatch(/pages\.push\(addressRows\(page\.messages, \{ accountId: acct\.id, mailbox: box \}\)\)/);
  });
});
