import { afterAll, describe, expect, it } from "vitest";
import i18n from "@plainva/ui/i18n";
import { refusedChangesText, suspendedDeletionQuestion } from "@plainva/ui";

/**
 * The encrypted workspace's pull-side question is its own (review of release
 * 0.9.0). It asked with the plain sync's text — files missing in the cloud,
 * "no deletion of them was confirmed in Plainva" — when another device of the
 * workspace had deleted them, confirmed there. And a member who may not put
 * the files back was offered "keep and upload again", got fifty refusals
 * after it, and nothing came back for the others.
 */
describe("another device's mass deletion, asked in an encrypted workspace", () => {
  afterAll(async () => {
    await i18n.changeLanguage("en");
  });
  const workspace = { missing: 50, confirmed: 60, probed: 50, absent: 50, fromWorkspaceDevice: true as const };

  it("says another device of the workspace deleted them, and nothing about the cloud or a missing confirmation", async () => {
    await i18n.changeLanguage("de");
    const question = suspendedDeletionQuestion({ ...workspace, staysLocal: 0 });
    expect(question.title).toBe("Auf einem anderen Gerät gelöscht");
    expect(question.message).toBe("Ein anderes Gerät dieses Workspace hat 50 von 60 Dateien gelöscht. Sollen sie auch hier gelöscht werden?");
    expect(question.cancelLabel).toBe("Behalten und wieder hochladen");
    await i18n.changeLanguage("en");
    const english = suspendedDeletionQuestion({ ...workspace, staysLocal: 0 });
    expect(english.message).not.toMatch(/cloud|confirmed/);
  });

  it("where the files cannot be put back, keeping means this device only", async () => {
    await i18n.changeLanguage("de");
    const question = suspendedDeletionQuestion({ ...workspace, staysLocal: 50 });
    expect(question.message).toContain("50 davon dürfen von hier aus nicht wieder für die anderen bereitgestellt werden");
    expect(question.cancelLabel).toBe("Nur auf diesem Gerät behalten");
    expect(suspendedDeletionQuestion({ ...workspace, staysLocal: 10 }).cancelLabel).toBe("Behalten");
  });

  it("the plain sync keeps its own question", async () => {
    await i18n.changeLanguage("en");
    expect(suspendedDeletionQuestion({ missing: 50, confirmed: 60, probed: 10, absent: 10 }).title).toBe("Files missing in the cloud");
  });
});

describe("the notice of refused changes", () => {
  afterAll(async () => {
    await i18n.changeLanguage("en");
  });

  it("names an original not brought back yet, and that it waits", async () => {
    await i18n.changeLanguage("de");
    expect(refusedChangesText([], ["Team/y.md"])).toBe("Nicht erlaubt, und das Original ist hier noch nicht zurück: y. Plainva versucht es bei jedem Abgleich wieder; bis dahin wartet die Änderung.");
    expect(refusedChangesText(["Private/x.md"], ["Team/y.md"])).toMatch(/^In diesem Workspace nicht erlaubt: x\. .* Nicht erlaubt, und das Original/);
    expect(refusedChangesText([], [])).toBeNull();
  });
});
