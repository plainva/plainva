import { describe, it, expect, beforeEach } from "vitest";
import { takeReleaseDialogSlot, resetReleaseDialogSlot } from "./whatsNew";

/**
 * The release dialogs are an app-start decision, and stage D took away the
 * place that used to hold it.
 *
 * `App` sits under a `VaultProvider` keyed by the shown vault, so it remounts
 * when that vault arrives - which every ordinary start does, going from "no
 * vault yet" to the auto-opened one. The guard used to be a component ref, so
 * it reset on that remount and the dialog opened over the freshly loaded vault,
 * blocking every click behind its backdrop.
 */
describe("release dialog slot", () => {
  beforeEach(() => resetReleaseDialogSlot());

  it("is taken once per app start, however often the caller remounts", () => {
    expect(takeReleaseDialogSlot()).toBe(true);
    // Each of these stands for one remount of App.
    expect(takeReleaseDialogSlot()).toBe(false);
    expect(takeReleaseDialogSlot()).toBe(false);
  });

  it("is free again in the next app start", () => {
    expect(takeReleaseDialogSlot()).toBe(true);
    resetReleaseDialogSlot();
    expect(takeReleaseDialogSlot()).toBe(true);
  });
});
