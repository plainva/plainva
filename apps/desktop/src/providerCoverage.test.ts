import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PIM_PROVIDER_IDS } from "@plainva/core";

/**
 * Every place that branches on the PIM provider id knows every provider
 * (plan EventKit K1, § 4.1).
 *
 * The lesson behind it: the calendar login ran into an old fix for months
 * because one branch enumerated three providers and nobody counted. A fourth
 * provider is a value in a union; the union does not tell you where the
 * `switch` statements are. This test does — it names each place and reads its
 * source, so adding a provider fails here until every one of them says what
 * it does with it (handling it, or excluding it on purpose, in writing).
 */
const ROOT = join(__dirname, "..", "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

/**
 * Each place, with the ids it must name. A place that switches on the provider
 * names all four; a place that only has to KNOW the device account (because it
 * has no credential, or must not travel) names that one.
 */
const ALL = [...PIM_PROVIDER_IDS];
const PLACES: Array<[string, readonly string[]]> = [
  // account row → target, both shells
  ["apps/mobile/src/services/pim/pimService.ts", ALL],
  ["apps/desktop/src/services/pim/pimAccounts.ts", ALL],
  // the desktop's provider label
  ["apps/desktop/src/components/pim/PimAccountsSection.tsx", ALL],
  // what travels in the settings profile — the device account does not (E8)
  ["packages/ui/src/lib/accountProfile.ts", ALL],
  // family of a calendar account (card grouping), the family's name, the mobile provider of a family
  ["packages/ui/src/lib/cloudAccounts.ts", ["caldav", "device"]],
  ["packages/ui/src/lib/cloudAccountsLabels.ts", ["device"]],
  ["packages/ui/src/lib/familyTarget.ts", ["caldav", "google", "microsoft", "device"]],
  // sign-in states: a device account has a permission, not a credential
  ["apps/mobile/src/services/cloudAccountCards.ts", ["caldav", "device"]],
  ["apps/mobile/src/screens/PimAccountsScreen.tsx", ["caldav", "google", "microsoft", "device"]],
  ["apps/mobile/src/screens/PimCalendarScreen.tsx", ["device"]],
];

describe("every provider branch knows every provider", () => {
  it("the id list is the union", () => {
    expect([...PIM_PROVIDER_IDS]).toEqual(["caldav", "google", "microsoft", "device"]);
  });

  it.each(PLACES)("%s names the providers it must know", (rel, ids) => {
    const src = read(rel);
    for (const id of ids) {
      expect(src, `${rel} does not mention "${id}"`).toContain(`"${id}"`);
    }
  });
});
