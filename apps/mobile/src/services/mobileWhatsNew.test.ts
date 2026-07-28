import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Which release dialog a start owes the user (BS5).
 *
 * This had no test, and that is how two welcomes ended up in a row: the sheet
 * carried a `firstRun` branch that could only appear right AFTER the onboarding
 * screen — which is itself the welcome on this platform. The rules below are
 * the merge: the onboarding welcomes, this sheet only ever says what changed.
 */

const store = {
  values: new Map<string, unknown>(),
  get: vi.fn(async (k: string) => store.values.get(k)),
  set: vi.fn(async (k: string, v: unknown) => void store.values.set(k, v)),
  save: vi.fn(async () => undefined),
};

vi.mock("@plainva/ui", async () => {
  const actual = await vi.importActual<typeof import("@plainva/ui")>("@plainva/ui");
  return {
    ...actual,
    getPlatformServices: () => ({ loadSettings: async () => store }),
  };
});

vi.mock("@capacitor/app", () => ({
  App: { getInfo: async () => ({ version: "9.9.9" }) },
}));

import { pendingReleaseDialog, markReleaseDialogSeen } from "./mobileWhatsNew";

beforeEach(() => {
  store.values.clear();
});

describe("pendingReleaseDialog", () => {
  it("says nothing to a fresh install — the onboarding screen is the welcome", async () => {
    expect(await pendingReleaseDialog(false)).toBe("none");
  });

  it("shows the highlights to someone who was here before the marker existed", async () => {
    expect(await pendingReleaseDialog(true)).toBe("whatsNew");
  });

  it("shows them once after an update, then not again", async () => {
    store.values.set("whatsNewSeenVersionMobile", "9.9.8");
    expect(await pendingReleaseDialog(true)).toBe("whatsNew");

    await markReleaseDialogSeen();
    expect(await pendingReleaseDialog(true)).toBe("none");
  });

  it("stays quiet when the onboarding finished and marked the version seen", async () => {
    // What finishOnboarding does: mark, then set the flag.
    await markReleaseDialogSeen();
    expect(await pendingReleaseDialog(true)).toBe("none");
  });

  it("never blocks the start when the store cannot be read", async () => {
    store.get.mockRejectedValueOnce(new Error("locked"));
    expect(await pendingReleaseDialog(true)).toBe("none");
  });
});
