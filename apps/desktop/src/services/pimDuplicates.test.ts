import { describe, expect, it } from "vitest";
import { reviewDuplicatePimRows } from "@plainva/ui";

/**
 * Duplicated calendar rows are SURFACED, never folded (E2, P3f).
 *
 * The cloud-card repair folds on verified identity because a card only groups
 * references. A calendar row is not that: it carries the calendar selection,
 * the cached events and the `plainva.pim` anchor of every mirrored task, so the
 * survivor is a decision. What had been missing entirely is that nothing ever
 * SAID two rows were the same account — the phone kept adding them silently.
 */
describe("reviewDuplicatePimRows", () => {
  const row = (id: string, label: string, subject?: string) => ({
    id,
    provider: "google",
    label,
    config: subject ? { plainvaVerifiedProviderIdentity: { issuer: "google", subject } } : {},
  });

  it("states it when the provider says two rows are one account", () => {
    const needs = reviewDuplicatePimRows([row("a", "Work", "sub-1"), row("b", "Anders benannt", "sub-1")]);
    expect(needs).toEqual([
      { reason: "same-identity", provider: "google", label: "Work", accountIds: ["a", "b"] },
    ]);
  });

  it("only asks when all it has is the same label", () => {
    const needs = reviewDuplicatePimRows([row("a", "Work"), row("b", "work")]);
    expect(needs[0].reason).toBe("same-label");
  });

  it("never groups rows of different providers", () => {
    const needs = reviewDuplicatePimRows([
      row("a", "Work"),
      { id: "b", provider: "microsoft", label: "Work", config: {} },
    ]);
    expect(needs).toEqual([]);
  });

  it("leaves two genuinely different accounts alone", () => {
    expect(reviewDuplicatePimRows([row("a", "Privat", "sub-1"), row("b", "Arbeit", "sub-2")])).toEqual([]);
  });

  it("does not fall back to the label once an identity is known", () => {
    // A verified row and an unverified one sharing a name are NOT a statement:
    // matching them would be exactly the guess the desktop rule forbids.
    const needs = reviewDuplicatePimRows([row("a", "Work", "sub-1"), row("b", "Work")]);
    expect(needs).toEqual([]);
  });
});
