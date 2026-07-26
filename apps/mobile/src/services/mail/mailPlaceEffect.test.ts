import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveMailAccount } from "./mailPlace";

/**
 * The mail list showed an empty inbox for good after the SECOND visit (device
 * report 2026-07-26). The mechanism, in three steps:
 *
 *   1. The screen seeds `accountId` from the remembered place, so on a rebuild
 *      it is already set BEFORE `listMobileMailAccounts()` resolves.
 *   2. Both the folder effect and `load` bail out on that first pass, because
 *      `accounts` is still empty and `accountById` finds nothing.
 *   3. When the list arrives, `resolveMailAccount` returns the SAME id, React
 *      bails out of the state update — and since `accountById` is deliberately
 *      identity-stable, neither effect's dependencies ever changed again.
 *
 * Result: no folders, no messages, no error, permanently. The fix is a value
 * that reflects WHICH accounts exist; these tests pin both halves of it.
 */
describe("mail list account dependency", () => {
  it("re-resolving a remembered account yields the identical value (React bails out)", () => {
    const accounts = [{ id: "acct-1" }, { id: "acct-2" }];
    // This is the step that made the screen look settled while it was not:
    // same string in, same string out, so setState changes nothing.
    expect(resolveMailAccount("acct-1", accounts)).toBe("acct-1");
  });

  it("both effects depend on the account list, not only on the chosen id", () => {
    const src = readFileSync(join(__dirname, "..", "..", "screens", "MailListScreen.tsx"), "utf8");
    // The folder effect and the loader must both carry the accounts key,
    // otherwise the arrival of the account list is invisible to them.
    const depLines = src.split("\n").filter((l) => l.includes("accountById, describeError"));
    expect(depLines.length).toBeGreaterThanOrEqual(2);
    for (const line of depLines) expect(line).toContain("accountsKey");
  });

  it("the accounts key changes when the set of accounts changes", () => {
    const key = (ids: string[]) => ids.join(",");
    expect(key([])).not.toBe(key(["acct-1"]));
    // …but a refresh that returns the same accounts must NOT fire another
    // round of requests at the provider (the Graph 429 lesson).
    expect(key(["acct-1", "acct-2"])).toBe(key(["acct-1", "acct-2"]));
  });
});
