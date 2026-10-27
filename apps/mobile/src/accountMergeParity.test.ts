import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { manualMergeCandidates, type CloudAccountRecord } from "@plainva/ui";

/**
 * E6, approved for the phone (review of plan "Verbinden", finding 5c): two
 * cards of ONE account that cannot be folded automatically get the desktop's
 * "Same account" on the phone too - the same candidates (the shared rule) and
 * the same guided repair, which says what moves before anything moves.
 */
const card = (id: string, family: CloudAccountRecord["family"]): CloudAccountRecord => ({ id, family, label: id, services: {} });

describe("the manual merge on the phone", () => {
  it("names the other cards of the same provider, never the card itself or another provider's", () => {
    const records = [card("a", "google"), card("b", "google"), card("c", "microsoft")];
    expect(manualMergeCandidates(records, records[0]).map((record) => record.id)).toEqual(["b"]);
    expect(manualMergeCandidates(records, records[2])).toEqual([]);
  });

  it("is offered on the account page and runs the guided repair", () => {
    const source = readFileSync(join(__dirname, "screens", "CloudAccountDetailScreen.tsx"), "utf8");
    expect(source).toMatch(/manualMergeCandidates\(/);
    expect(source).toMatch(/guideMobileAccountRepair\(loginVaultId, \{ accountIds: \[sourceId, target\.id\], targetId: target\.id \}/);
    expect(source).toMatch(/data-testid="cloudacct-merge-manual"/);
  });
});
